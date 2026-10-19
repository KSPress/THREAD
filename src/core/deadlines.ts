// Deadlines across the vault, derived from frontmatter and dated tasks.
import { useMemo } from 'react'
import { extractDeadlines, type Deadline } from '../../shared/deadlines.js'
import { useSettings } from './settings'
import { useStore, type ThreadInfo } from './store'

export type { Deadline }

export function deadlinesOf(threads: Record<string, ThreadInfo>, defaults: (string | number)[]): Deadline[] {
  const out: Deadline[] = []
  for (const t of Object.values(threads)) out.push(...extractDeadlines(t.path, t.title, t.frontmatter, t.body, { defaultReminders: defaults }))
  return out.sort((a, b) => a.due.localeCompare(b.due))
}

export function allDeadlines(): Deadline[] {
  return deadlinesOf(useStore.getState().threads, useSettings.getState().defaultReminders)
}

export function useDeadlines(): Deadline[] {
  const threads = useStore((s) => s.threads)
  const defaults = useSettings((s) => s.defaultReminders)
  return useMemo(() => deadlinesOf(threads, defaults), [threads, defaults])
}

const DAY = 86400000

/** Whole calendar days from today (negative = overdue). */
export function daysUntil(d: Deadline, now = new Date()) {
  const due = new Date(d.due)
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const b = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
  return Math.round((b - a) / DAY)
}

export function isOverdue(d: Deadline, now = new Date()) {
  return d.allDay ? daysUntil(d, now) < 0 : new Date(d.due).getTime() < now.getTime()
}

export function relativeDue(d: Deadline, now = new Date()) {
  const days = daysUntil(d, now)
  const time = d.allDay ? '' : ` · ${new Date(d.due).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  if (isOverdue(d, now)) {
    if (!d.allDay && now.getTime() - new Date(d.due).getTime() < 15 * 60000) return 'due now'
    if (days === 0) return `overdue${time}`
    return `overdue ${-days}d`
  }
  if (days === 0) return `today${time}`
  if (days === 1) return `tomorrow${time}`
  if (days < 7) return `in ${days} days`
  return new Date(d.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + time
}

/** When each reminder for a deadline should fire, as epoch ms. */
export function reminderTimes(d: Deadline): number[] {
  const due = new Date(d.due).getTime()
  return d.reminders.map((m) => {
    // An all-day "at the time" reminder fires at 09:00 on the day, not midnight.
    if (d.allDay && m === 0) return due + 9 * 3600000
    return due - m * 60000
  })
}
