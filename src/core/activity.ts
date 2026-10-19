// Writing activity per day, for the heat map.
//
// Each device appends to its own log, `.thread/activity/<device>.json`:
//   { "2026-10-19": { "Places/Emberfall.md": 7, … }, … }
// The number is how many times the Thread was saved that day (roughly, how
// many bursts of writing). One file per device means the Loom can sync them
// without two devices ever overwriting each other's history.
import { create } from 'zustand'
import { useStore } from './store'
import { META_DIR } from './paths'

export type DayLog = Record<string, Record<string, number>>

interface ActivityState {
  /** device id → log */
  logs: Record<string, DayLog>
  loaded: boolean
}

export const useActivity = create<ActivityState>(() => ({ logs: {}, loaded: false }))

export function deviceId(): string {
  let id = ''
  try {
    id = localStorage.getItem('thread.device') ?? ''
    if (!id) {
      id = `d${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`
      localStorage.setItem('thread.device', id)
    }
  } catch {
    id = 'device'
  }
  return id
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export async function loadActivity() {
  const s = useStore.getState()
  if (!s.adapter) return
  const logs: Record<string, DayLog> = {}
  const entries = await s.adapter.list().catch(() => [])
  for (const e of entries) {
    const m = new RegExp(`^${META_DIR}/activity/(.+)\\.json$`).exec(e.path)
    if (!m || e.dir) continue
    logs[m[1]] = await s.readMeta<DayLog>(`activity/${m[1]}.json`, {})
  }
  useActivity.setState({ logs, loaded: true })
}

let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const id = deviceId()
    void useStore.getState().writeMeta(`activity/${id}.json`, useActivity.getState().logs[id] ?? {})
  }, 4000)
}

export function recordActivity(path: string, when = new Date()) {
  const id = deviceId()
  const day = dayKey(when)
  useActivity.setState((st) => {
    const mine = { ...(st.logs[id] ?? {}) }
    mine[day] = { ...(mine[day] ?? {}), [path]: (mine[day]?.[path] ?? 0) + 1 }
    return { logs: { ...st.logs, [id]: mine } }
  })
  scheduleFlush()
}

/** Keep this device's history attached to a Thread when it moves. */
export function renameActivity(from: string, to: string) {
  const id = deviceId()
  const mine = useActivity.getState().logs[id]
  if (!mine) return
  const next: DayLog = {}
  for (const [day, paths] of Object.entries(mine)) {
    next[day] = {}
    for (const [p, n] of Object.entries(paths)) {
      const q = p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p
      next[day][q] = (next[day][q] ?? 0) + n
    }
  }
  useActivity.setState((st) => ({ logs: { ...st.logs, [id]: next } }))
  scheduleFlush()
}

/** All devices merged: day → path → edits. Threads with no logged history fall back to their modified date. */
export function mergedActivity(logs: Record<string, DayLog>, threads: Record<string, { path: string; mtime: number }>): DayLog {
  const out: DayLog = {}
  const seen = new Set<string>()
  for (const log of Object.values(logs)) {
    for (const [day, paths] of Object.entries(log)) {
      const d = (out[day] ??= {})
      for (const [p, n] of Object.entries(paths)) {
        d[p] = (d[p] ?? 0) + n
        seen.add(p)
      }
    }
  }
  for (const t of Object.values(threads)) {
    if (seen.has(t.path) || !t.mtime) continue
    const day = dayKey(new Date(t.mtime))
    ;(out[day] ??= {})[t.path] = (out[day][t.path] ?? 0) + 1
  }
  return out
}

/** Current and longest streak of active days, counting back from today. */
export function streaks(days: Set<string>, today = new Date()) {
  let current = 0
  const d = new Date(today)
  // Today not written yet doesn't break a streak that ran through yesterday.
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1)
  while (days.has(dayKey(d))) {
    current++
    d.setDate(d.getDate() - 1)
  }
  let longest = 0
  let run = 0
  let prev: number | null = null
  for (const k of [...days].sort()) {
    const t = new Date(k + 'T00:00:00').getTime()
    run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = t
  }
  return { current, longest }
}
