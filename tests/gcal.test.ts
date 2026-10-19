// Google Calendar sync end-to-end against an in-memory fake of the API.
import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { http, syncGoogle, useGcal } from '../src/core/gcal'
import { useStore } from '../src/core/store'
import { BrowserVault } from '../src/core/vault'

type Ev = Record<string, any>
const cal = { calendars: new Map<string, { id: string; summary: string }>(), events: new Map<string, Ev>(), calls: [] as string[] }
let nextId = 1

http.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  const method = init.method ?? 'GET'
  const auth = (init.headers as Record<string, string>)?.authorization
  cal.calls.push(`${method} ${url.pathname}`)
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })
  if (auth !== 'Bearer good-token') return json(401, { error: 'invalid' })
  const p = url.pathname.replace('/calendar/v3', '')
  let m
  if (p === '/calendars' && method === 'POST') {
    const c = { id: `cal${nextId++}`, summary: JSON.parse(String(init.body)).summary }
    cal.calendars.set(c.id, c)
    return json(200, c)
  }
  if ((m = /^\/calendars\/([^/]+)$/.exec(p))) {
    const c = cal.calendars.get(decodeURIComponent(m[1]))
    return c ? json(200, c) : json(404, {})
  }
  if ((m = /^\/calendars\/([^/]+)\/events$/.exec(p))) {
    if (method === 'GET') {
      expect(url.searchParams.get('privateExtendedProperty')).toBe('thread=1')
      return json(200, { items: [...cal.events.values()] })
    }
    const ev = { ...JSON.parse(String(init.body)), id: `ev${nextId++}` }
    cal.events.set(ev.id, ev)
    return json(200, ev)
  }
  if ((m = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(p))) {
    const id = decodeURIComponent(m[2])
    if (method === 'DELETE') {
      cal.events.delete(id)
      return json(204)
    }
    cal.events.set(id, { ...JSON.parse(String(init.body)), id })
    return json(200, cal.events.get(id))
  }
  return json(404, {})
}

const setToken = (t: string) => sessionStorage.setItem('thread.gcal.token', JSON.stringify({ access_token: t, expires_at: Date.now() + 3600_000 }))

beforeAll(async () => {
  const v = new BrowserVault('gcal-test')
  await v.writeText('Book/Ch 1.md', '---\ndeadline: 2026-11-01\nremind: 1d\n---\n# Chapter One\n')
  await v.writeText('Plan.md', '# Plan\n\n- [ ] Outline 📅 2026-11-05\n- [x] Done 📅 2026-10-01\n')
  await useStore.getState().openVault(v)
  setToken('good-token')
  useGcal.setState({ status: 'connected' })
})

describe('Google Calendar sync', () => {
  it('creates a dedicated calendar and one event per deadline', async () => {
    await syncGoogle()
    expect(useGcal.getState().status).toBe('connected')
    expect(useGcal.getState().lastResult).toEqual({ created: 2, updated: 0, deleted: 0 })
    expect([...cal.calendars.values()][0].summary).toBe('THREAD')
    const summaries = [...cal.events.values()].map((e) => e.summary).sort()
    expect(summaries).toEqual(['☐ Outline', '⏳ Chapter One'].sort())
    // The calendar id is remembered in the vault, so other devices reuse it.
    expect(await useStore.getState().readMeta('google.json', {})).toMatchObject({ calendarId: 'cal1' })
  })

  it('is idempotent, then updates and deletes as Threads change', async () => {
    await syncGoogle()
    expect(useGcal.getState().lastResult).toEqual({ created: 0, updated: 0, deleted: 0 })
    const s = useStore.getState()
    await s.saveThread('Book/Ch 1.md', '---\ndeadline: 2026-11-08T17:00\n---\n# Chapter One\n')
    await s.saveThread('Plan.md', '# Plan\n\n- [x] Outline 📅 2026-11-05\n')
    await syncGoogle()
    expect(useGcal.getState().lastResult).toEqual({ created: 0, updated: 1, deleted: 1 })
    const [ev] = [...cal.events.values()]
    expect(ev.start.dateTime).toBeTruthy()
    expect(cal.calendars.size).toBe(1)
  })

  it('reports an expired sign-in instead of failing silently', async () => {
    setToken('stale-token')
    await syncGoogle()
    expect(useGcal.getState().status).toBe('expired')
    expect(useGcal.getState().error).toMatch(/expired/)
  })
})
