import { describe, expect, it } from 'vitest'
import { extractDeadlines, parseWhen, reminderMinutes, toICS } from '../shared/deadlines.js'
import { dueReminders } from '../src/core/notify'
import { reminderTimes, relativeDue, daysUntil } from '../src/core/deadlines'
import { planSync, toEvent, type GEvent } from '../src/core/gcal'
import { mergedActivity, streaks, dayKey } from '../src/core/activity'

describe('deadline parsing', () => {
  it('reads frontmatter deadlines (all-day and timed) and skips done ones', () => {
    const [d] = extractDeadlines('a.md', 'A', { deadline: '2026-11-01', remind: '1w' }, '')
    expect(d.allDay).toBe(true)
    expect(new Date(d.due).getDate()).toBe(1)
    expect(d.reminders).toEqual([10080 - 540]) // 1w before, at 09:00
    const [t] = extractDeadlines('a.md', 'A', { deadline: '2026-11-01T17:30', remind: ['1d', '1h', 0] }, '')
    expect(t.allDay).toBe(false)
    expect(new Date(t.due).getHours()).toBe(17)
    expect(t.reminders).toEqual([1440, 60, 0])
    expect(extractDeadlines('a.md', 'A', { deadline: '2026-11-01', done: true }, '')).toEqual([])
    expect(extractDeadlines('a.md', 'A', { deadline: 'soon' }, '')).toEqual([])
  })

  it('reads dated tasks, ignoring completed ones and code blocks', () => {
    const body = [
      '- [ ] Draft [[Chapter|ch.]] 3 📅 2026-11-02',
      '- [ ] Call Bren 📅 2026-11-03 ⏰ 9:15',
      '- [ ] Query agent @due(2026-11-04)',
      '- [x] Done already 📅 2026-10-01',
      '```',
      '- [ ] not a task 📅 2026-11-05',
      '```',
    ].join('\n')
    const items = extractDeadlines('p.md', 'Plan', {}, body)
    expect(items.map((i) => i.title)).toEqual(['Draft ch. 3', 'Call Bren', 'Query agent'])
    expect(new Date(items[1].due).getMinutes()).toBe(15)
    expect(items.every((i) => i.kind === 'task' && i.thread === 'Plan')).toBe(true)
    // Keys are stable across re-parses (used for calendar sync).
    expect(extractDeadlines('p.md', 'Plan', {}, body)[0].key).toBe(items[0].key)
  })

  it('converts absolute reminder times to offsets', () => {
    const due = parseWhen('2026-11-01T12:00')!.date
    expect(reminderMinutes('2026-11-01T10:00', due, [])).toEqual([120])
    expect(reminderMinutes('none', due, ['1d'])).toEqual([])
  })
})

describe('reminders', () => {
  const [item] = extractDeadlines('a.md', 'A', { deadline: '2026-11-01', remind: [0, '1d'] }, '')
  it('fires all-day "at time" reminders at 09:00, not midnight', () => {
    const times = reminderTimes(item).map((t) => new Date(t))
    expect(times.map((t) => t.getHours())).toEqual([9, 9])
    expect(times[1].getDate()).toBe(1)
    expect(times[0].getDate()).toBe(31)
  })
  it('fires each reminder once, and not when hours late', () => {
    const at = reminderTimes(item)[1]
    const now = at + 60_000
    const first = dueReminders([item], {}, now)
    expect(first.map((r) => r.id).length).toBeGreaterThan(0)
    const sent = Object.fromEntries(first.map((r) => [r.id, now]))
    expect(dueReminders([item], sent, now + 30_000)).toHaveLength(0)
    expect(dueReminders([item], {}, at + 7 * 3600_000)).toHaveLength(0)
  })
  it('describes relative dates', () => {
    const now = new Date(2026, 9, 30, 12)
    expect(daysUntil(item, now)).toBe(2)
    expect(relativeDue(item, now)).toBe('in 2 days')
    expect(relativeDue(item, new Date(2026, 10, 1, 8))).toBe('today')
    expect(relativeDue(item, new Date(2026, 10, 3))).toBe('overdue 2d')
  })
})

describe('iCalendar export', () => {
  it('writes valid all-day and timed events with alarms', () => {
    const items = [
      ...extractDeadlines('Book/Ch 1.md', 'Chapter, one; draft', { deadline: '2026-11-01', remind: '1d' }, ''),
      ...extractDeadlines('b.md', 'B', { deadline: '2026-11-02T17:00' }, ''),
    ]
    const ics = toICS(items, { name: 'Test', link: (p) => `https://x.test/#open=${encodeURIComponent(p)}` })
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261101')
    expect(ics).toContain('DTEND;VALUE=DATE:20261102')
    expect(ics).toContain(String.raw`SUMMARY:⏳ Chapter\, one\; draft`)
    expect(ics).toContain('TRIGGER:-PT900M')
    expect(ics).toMatch(/DTSTART:2026110\dT\d{6}Z/)
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })
})

describe('Google Calendar sync plan', () => {
  const items = [
    ...extractDeadlines('a.md', 'A', { deadline: '2026-11-01', remind: [0, '1d'] }, ''),
    ...extractDeadlines('b.md', 'B', { deadline: '2026-11-02T17:00' }, '- [ ] task 📅 2026-11-03'),
  ]
  const desired = items.map((d) => toEvent(d, undefined, 'Europe/London'))

  it('maps deadlines to events Google accepts', () => {
    expect(desired[0].start).toEqual({ date: '2026-11-01' })
    expect(desired[0].end).toEqual({ date: '2026-11-02' })
    expect(desired[0].reminders.overrides).toEqual([{ method: 'popup', minutes: 900 }]) // all-day 0 left to THREAD
    expect(desired[1].start.timeZone).toBe('Europe/London')
    expect(desired[2].summary).toBe('☐ task')
  })

  it('creates, updates and deletes only what changed', () => {
    const stale: GEvent = { ...desired[1], id: 'e2', summary: 'old', extendedProperties: { private: { ...desired[1].extendedProperties.private, sig: 'old' } } }
    const same: GEvent = { ...desired[0], id: 'e1' }
    const orphan: GEvent = { ...desired[0], id: 'e9', extendedProperties: { private: { thread: '1', key: 'gone', path: 'x.md', sig: 's' } } }
    const plan = planSync(desired, [same, stale, orphan])
    expect(plan.create.map((e) => e.summary)).toEqual(['☐ task'])
    expect(plan.update.map((u) => u.id)).toEqual(['e2'])
    expect(plan.remove).toEqual(['e9'])
    expect(planSync(desired, desired.map((e, i) => ({ ...e, id: `x${i}` })))).toEqual({ create: [], update: [], remove: [] })
  })
})

describe('activity', () => {
  it('merges device logs and backfills from modified dates', () => {
    const merged = mergedActivity(
      { a: { '2026-10-01': { 'x.md': 2 } }, b: { '2026-10-01': { 'x.md': 3, 'y.md': 1 } } },
      { 'x.md': { path: 'x.md', mtime: 0 }, 'z.md': { path: 'z.md', mtime: new Date(2026, 9, 5, 12).getTime() } },
    )
    expect(merged['2026-10-01']).toEqual({ 'x.md': 5, 'y.md': 1 })
    expect(merged['2026-10-05']).toEqual({ 'z.md': 1 })
  })
  it('counts streaks', () => {
    const today = new Date(2026, 9, 19)
    const back = (n: number) => dayKey(new Date(2026, 9, 19 - n))
    expect(streaks(new Set([back(1), back(2), back(3), back(10), back(11)]), today)).toEqual({ current: 3, longest: 3 })
    expect(streaks(new Set([back(0), back(1)]), today).current).toBe(2)
    expect(streaks(new Set([back(2)]), today).current).toBe(0)
  })
})
