// Google Calendar integration.
//
// Deadlines are pushed into a calendar THREAD creates for itself, using the
// narrow `calendar.app.created` scope: THREAD can only see and change
// calendars it made, never the rest of your Google Calendar. Each event
// carries a private `key`, so syncing is idempotent: create what's new,
// update what changed, delete what disappeared. Google then delivers the
// reminders to your phone even when THREAD is closed.
import { create } from 'zustand'
import type { Deadline } from '../../shared/deadlines.js'
import { allDeadlines } from './deadlines'
import { useSettings } from './settings'
import { useStore } from './store'
import { isTauri } from './vault'

export const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const API = 'https://www.googleapis.com/calendar/v3'
const TOKEN_KEY = 'thread.gcal.token'

interface Token {
  access_token: string
  expires_at: number
  refresh_token?: string
}

type Status = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'expired' | 'error'

interface GcalState {
  status: Status
  error?: string
  lastSync?: number
  lastResult?: { created: number; updated: number; deleted: number }
}

export const useGcal = create<GcalState>(() => ({ status: loadToken() ? 'connected' : 'disconnected' }))

function loadToken(): Token | null {
  try {
    // Browsers keep only the short-lived access token (session); the desktop
    // app also keeps its refresh token so it can reconnect after a restart.
    const raw = (isTauri() ? localStorage : sessionStorage).getItem(TOKEN_KEY)
    const t = raw ? (JSON.parse(raw) as Token) : null
    if (!t) return null
    if (t.expires_at < Date.now() + 60_000 && !t.refresh_token) return null
    return t
  } catch {
    return null
  }
}

function saveToken(t: Token | null) {
  const store = isTauri() ? localStorage : sessionStorage
  if (t) store.setItem(TOKEN_KEY, JSON.stringify(t))
  else store.removeItem(TOKEN_KEY)
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

let gisLoading: Promise<void> | null = null
function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve()
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisLoading = null
      reject(new Error('Could not load Google sign-in (offline?)'))
    }
    document.head.appendChild(s)
  })
  return gisLoading
}

/** Must be called from a user gesture (it opens Google's consent window). */
export async function connectGoogle(): Promise<void> {
  const { gcalClientId, gcalClientSecret } = useSettings.getState()
  if (!gcalClientId) throw new Error('Add your Google OAuth client ID first.')
  useGcal.setState({ status: 'connecting', error: undefined })
  try {
    let token: Token
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      const r = await invoke<{ access_token: string; expires_in: number; refresh_token?: string }>('google_oauth_start', {
        clientId: gcalClientId,
        clientSecret: gcalClientSecret,
        scope: GCAL_SCOPE,
      })
      token = { access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000, refresh_token: r.refresh_token }
    } else {
      await loadGis()
      token = await new Promise<Token>((resolve, reject) => {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: gcalClientId,
          scope: GCAL_SCOPE,
          callback: (r: any) =>
            r.error ? reject(new Error(r.error_description ?? r.error)) : resolve({ access_token: r.access_token, expires_at: Date.now() + Number(r.expires_in) * 1000 }),
          error_callback: (e: any) => reject(new Error(e?.message ?? e?.type ?? 'Sign-in was cancelled')),
        })
        client.requestAccessToken({ prompt: '' })
      })
    }
    saveToken(token)
    useGcal.setState({ status: 'connected' })
  } catch (e) {
    useGcal.setState({ status: 'error', error: String((e as Error).message ?? e) })
    throw e
  }
}

export function disconnectGoogle() {
  const t = loadToken()
  if (t && !isTauri()) (window as any).google?.accounts?.oauth2?.revoke?.(t.access_token)
  saveToken(null)
  useGcal.setState({ status: 'disconnected', error: undefined, lastResult: undefined })
}

async function accessToken(): Promise<string> {
  const t = loadToken()
  if (!t) throw new AuthError()
  if (t.expires_at > Date.now() + 60_000) return t.access_token
  if (t.refresh_token && isTauri()) {
    const { gcalClientId, gcalClientSecret } = useSettings.getState()
    const { invoke } = await import('@tauri-apps/api/core')
    const r = await invoke<{ access_token: string; expires_in: number }>('google_oauth_refresh', {
      clientId: gcalClientId,
      clientSecret: gcalClientSecret,
      refreshToken: t.refresh_token,
    })
    const next = { ...t, access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000 }
    saveToken(next)
    return next.access_token
  }
  throw new AuthError()
}

class AuthError extends Error {
  constructor() {
    super('Google sign-in expired — reconnect to keep syncing.')
  }
}

/** Injected in tests. */
export const http = { fetch: (input: RequestInfo, init?: RequestInit) => fetch(input, init) }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken()
  const res = await http.fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 401) {
    saveToken(null)
    throw new AuthError()
  }
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (res.status === 204 ? undefined : await res.json()) as T
}

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

export interface GEvent {
  id?: string
  summary: string
  description: string
  start: { date?: string; dateTime?: string; timeZone?: string }
  end: { date?: string; dateTime?: string; timeZone?: string }
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] }
  extendedProperties: { private: Record<string, string> }
  source?: { title: string; url: string }
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function toEvent(d: Deadline, link?: (path: string) => string | undefined, tz = Intl.DateTimeFormat().resolvedOptions().timeZone): GEvent {
  const due = new Date(d.due)
  const url = link?.(d.path)
  let start: GEvent['start']
  let end: GEvent['end']
  if (d.allDay) {
    const next = new Date(due)
    next.setDate(next.getDate() + 1)
    start = { date: ymd(due) }
    end = { date: ymd(next) }
  } else {
    start = { dateTime: due.toISOString(), timeZone: tz }
    end = { dateTime: new Date(due.getTime() + 30 * 60000).toISOString(), timeZone: tz }
  }
  // Google allows at most 5 overrides, 0–40320 minutes. An all-day "0" would
  // ring at midnight, so it's left to THREAD's own 09:00 notification.
  const overrides = d.reminders
    .filter((m) => m >= 0 && m <= 40320 && !(d.allDay && m === 0))
    .slice(0, 5)
    .map((minutes) => ({ method: 'popup' as const, minutes }))
  const ev: GEvent = {
    summary: d.kind === 'task' ? `☐ ${d.title}` : `⏳ ${d.title}`,
    description: [d.kind === 'task' ? `Task in “${d.thread}”` : 'Deadline', d.path, url].filter(Boolean).join('\n'),
    start,
    end,
    reminders: { useDefault: false, overrides },
    extendedProperties: { private: { thread: '1', key: d.key, path: d.path } },
  }
  if (url) ev.source = { title: 'Open in THREAD', url }
  ev.extendedProperties.private.sig = signature(ev)
  return ev
}

function signature(ev: GEvent) {
  const { extendedProperties: _x, ...rest } = ev
  let h = 0x811c9dc5
  const s = JSON.stringify(rest)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Pure diff between what THREAD wants and what the calendar has. */
export function planSync(desired: GEvent[], existing: GEvent[]) {
  const byKey = new Map(existing.map((e) => [e.extendedProperties?.private?.key, e]))
  const create: GEvent[] = []
  const update: { id: string; event: GEvent }[] = []
  const keep = new Set<string>()
  for (const ev of desired) {
    const key = ev.extendedProperties.private.key
    const have = byKey.get(key)
    if (!have) create.push(ev)
    else {
      keep.add(have.id!)
      if (have.extendedProperties.private.sig !== ev.extendedProperties.private.sig) update.push({ id: have.id!, event: ev })
    }
  }
  const remove = existing.filter((e) => e.id && !keep.has(e.id)).map((e) => e.id!)
  return { create, update, remove }
}

async function calendarId(): Promise<string> {
  const s = useStore.getState()
  const meta = await s.readMeta<{ calendarId?: string; name?: string }>('google.json', {})
  const name = useSettings.getState().gcalCalendarName || 'THREAD'
  if (meta.calendarId) {
    try {
      const cal = await api<{ id: string; summary: string }>(`/calendars/${encodeURIComponent(meta.calendarId)}`)
      if (cal.summary !== name) await api(`/calendars/${encodeURIComponent(cal.id)}`, { method: 'PATCH', body: JSON.stringify({ summary: name }) })
      return cal.id
    } catch (e) {
      if (e instanceof AuthError) throw e
      // Deleted in Google, or created by another client id: make a new one.
    }
  }
  const cal = await api<{ id: string }>('/calendars', {
    method: 'POST',
    body: JSON.stringify({ summary: name, description: `Deadlines from the THREAD vault “${s.adapter?.name}”.`, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  })
  // Stored in the vault, so every Satellite syncs into the same calendar.
  await s.writeMeta('google.json', { calendarId: cal.id, name })
  return cal.id
}

export function openLink(path: string): string | undefined {
  if (isTauri() || !/^https?:/.test(location.protocol)) return undefined
  return `${location.origin}${location.pathname}#open=${encodeURIComponent(path)}`
}

let running: Promise<void> | null = null

export function syncGoogle(): Promise<void> {
  running ??= doSync().finally(() => (running = null))
  return running
}

async function doSync() {
  if (!loadToken()) {
    useGcal.setState({ status: useGcal.getState().status === 'disconnected' ? 'disconnected' : 'expired' })
    return
  }
  useGcal.setState({ status: 'syncing', error: undefined })
  try {
    const cal = encodeURIComponent(await calendarId())
    const existing: GEvent[] = []
    let page: string | undefined
    do {
      const q = new URLSearchParams({ privateExtendedProperty: 'thread=1', maxResults: '2500', showDeleted: 'false', singleEvents: 'false' })
      if (page) q.set('pageToken', page)
      const r = await api<{ items: GEvent[]; nextPageToken?: string }>(`/calendars/${cal}/events?${q}`)
      existing.push(...(r.items ?? []))
      page = r.nextPageToken
    } while (page)
    const plan = planSync(allDeadlines().map((d) => toEvent(d, openLink)), existing)
    for (const ev of plan.create) await api(`/calendars/${cal}/events`, { method: 'POST', body: JSON.stringify(ev) })
    for (const { id, event } of plan.update) await api(`/calendars/${cal}/events/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(event) })
    for (const id of plan.remove) await api(`/calendars/${cal}/events/${encodeURIComponent(id)}`, { method: 'DELETE' })
    useGcal.setState({
      status: 'connected',
      lastSync: Date.now(),
      lastResult: { created: plan.create.length, updated: plan.update.length, deleted: plan.remove.length },
    })
  } catch (e) {
    const auth = e instanceof AuthError
    useGcal.setState({ status: auth ? 'expired' : 'error', error: String((e as Error).message ?? e) })
  }
}

/** Re-sync shortly after deadlines change, when connected and enabled. */
export function startGoogleAutoSync() {
  let last = ''
  let timer: ReturnType<typeof setTimeout>
  const check = () => {
    if (!useSettings.getState().gcalAutoSync || useGcal.getState().status === 'disconnected') return
    const sig = JSON.stringify(allDeadlines().map((d) => [d.key, d.due, d.title, d.reminders]))
    if (sig === last) return
    last = sig
    clearTimeout(timer)
    timer = setTimeout(() => void syncGoogle(), 3000)
  }
  useStore.subscribe((s, p) => {
    if (s.threads !== p.threads) check()
  })
  check()
}
