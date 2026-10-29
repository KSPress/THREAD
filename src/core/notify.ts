// Local reminders while THREAD is open. (When it's closed, the Google
// Calendar or ICS copies of your deadlines carry the reminders.)
import { allDeadlines, reminderTimes, relativeDue, type Deadline } from './deadlines'
import { useSettings } from './settings'
import { useStore } from './store'
import { isTauri } from './vault'
import { BASE } from './base'

const SENT_KEY = 'thread.reminders.sent'
const ICON = `${BASE}icons/icon-192.png`
/** Reminders older than this when first noticed are skipped, not fired late. */
const GRACE = 6 * 3600000

function sent(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export async function notificationPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification')
    return (await n.isPermissionGranted()) ? 'granted' : 'default'
  }
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export async function requestNotifications(): Promise<boolean> {
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification')
    return (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted'
  }
  if (!('Notification' in window)) return false
  return (await Notification.requestPermission()) === 'granted'
}

export async function showNotification(title: string, body: string, path?: string) {
  const data = { path }
  try {
    if (isTauri()) {
      const n = await import('@tauri-apps/plugin-notification')
      n.sendNotification({ title, body })
      return true
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') return false
    // Android Chrome only allows notifications through a service worker.
    const reg = await navigator.serviceWorker?.getRegistration?.()
    if (reg) await reg.showNotification(title, { body, icon: ICON, badge: ICON, data, tag: path })
    else {
      const n = new Notification(title, { body, icon: ICON, tag: path })
      n.onclick = () => {
        window.focus()
        if (path) useStore.getState().open(path)
      }
    }
    return true
  } catch (e) {
    console.warn('[notify]', e)
    return false
  }
}

/** Which reminders are due now; pure so it can be tested. */
export function dueReminders(items: Deadline[], already: Record<string, number>, now: number) {
  const out: { id: string; item: Deadline }[] = []
  for (const item of items) {
    reminderTimes(item).forEach((at, i) => {
      const id = `${item.key}:${item.due}:${item.reminders[i]}`
      if (already[id] || at > now || now - at > GRACE) return
      out.push({ id, item })
    })
  }
  return out
}

let timer: ReturnType<typeof setInterval> | null = null

export function startReminders() {
  if (timer) return
  const tick = async () => {
    const s = useStore.getState()
    if (!s.adapter) return
    const record = sent()
    const due = dueReminders(allDeadlines(), record, Date.now())
    if (!due.length) return
    for (const { id, item } of due) {
      record[id] = Date.now()
      const title = item.kind === 'task' ? `☐ ${item.title}` : `⏳ ${item.title}`
      const body = `${relativeDue(item)} · ${item.kind === 'task' ? item.thread : item.path}`
      const shown = useSettings.getState().notifications && (await showNotification(title, body, item.path))
      if (!shown) s.notify(`${title} — ${relativeDue(item)}`)
    }
    // Keep the record small: forget anything older than 60 days.
    const cutoff = Date.now() - 60 * 86400000
    for (const k of Object.keys(record)) if (record[k] < cutoff) delete record[k]
    localStorage.setItem(SENT_KEY, JSON.stringify(record))
  }
  void tick()
  timer = setInterval(() => void tick(), 30_000)
}
