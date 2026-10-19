// Deadlines and reminders, shared by Satellites and the Loom.
//
// Sources inside a Thread:
//   frontmatter   deadline: 2026-11-01            (all-day)
//                 deadline: 2026-11-01T17:00      (timed, local time)
//                 remind: 1d | [1w, 1d, 2h] | 2026-10-30T09:00
//   tasks         - [ ] Draft chapter 📅 2026-11-01
//                 - [ ] Call Bren 📅 2026-11-01 ⏰ 14:30
//                 - [ ] Send query @due(2026-11-01)
// Completed tasks (- [x]) never produce deadlines.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/

/** Parse `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` as local time. */
export function parseWhen(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return { date: value, allDay: value.getHours() === 0 && value.getMinutes() === 0 }
  }
  if (typeof value !== 'string') return null
  const m = DATE_RE.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d), h ? Number(h) : 0, mi ? Number(mi) : 0)
  if (isNaN(date.getTime())) return null
  return { date, allDay: h === undefined }
}

/** `1w`, `2d`, `3h`, `30m` → minutes. */
export function parseOffset(value) {
  const m = /^(\d+)\s*([wdhm])$/i.exec(String(value).trim())
  if (!m) return null
  const n = Number(m[1])
  return n * { w: 10080, d: 1440, h: 60, m: 1 }[m[2].toLowerCase()]
}

/**
 * Reminder offsets in minutes before the deadline. Absolute reminder times
 * are converted using the deadline's time.
 */
export function reminderMinutes(remind, due, defaults, allDay = false) {
  if (remind === false || remind === 'none') return []
  const list = remind == null ? defaults : Array.isArray(remind) ? remind : [remind]
  const out = new Set()
  for (const r of list) {
    if (typeof r === 'number') {
      out.add(r)
      continue
    }
    const off = parseOffset(r)
    if (off !== null) {
      // All-day: "1d before" means 09:00 the day before (as Google Calendar does).
      out.add(allDay && off >= 1440 ? off - 540 : off)
      continue
    }
    const abs = parseWhen(r)
    if (abs) out.add(Math.max(0, Math.round((due.getTime() - abs.date.getTime()) / 60000)))
  }
  return [...out].sort((a, b) => b - a)
}

function hashKey(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

const TASK_RE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/
const TASK_DATE_RE = /(?:📅|🗓️?|@due\()\s*(\d{4}-\d{2}-\d{2})\)?(?:\s*⏰\s*(\d{1,2}:\d{2}))?/u

/**
 * Extract deadlines from one Thread.
 * @param {string} path vault-relative path
 * @param {string} title display title
 * @param {Record<string, unknown>} frontmatter parsed YAML
 * @param {string} body markdown without frontmatter
 * @param {{ defaultReminders?: (string|number)[] }} [opts]
 */
export function extractDeadlines(path, title, frontmatter, body, opts = {}) {
  const defaults = opts.defaultReminders ?? ['1d', 0]
  const out = []
  const dueValue = frontmatter.deadline ?? frontmatter.due
  const due = parseWhen(dueValue)
  if (due && frontmatter.done !== true) {
    out.push({
      key: hashKey(`${path}#deadline`),
      path,
      title,
      kind: 'thread',
      due: due.date.toISOString(),
      allDay: due.allDay,
      reminders: reminderMinutes(frontmatter.remind, due.date, defaults, due.allDay),
    })
  }
  const lines = body.split('\n')
  let fence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence
    if (fence) continue
    const t = TASK_RE.exec(line)
    if (!t || t[1] !== ' ') continue
    const d = TASK_DATE_RE.exec(t[2])
    if (!d) continue
    const when = parseWhen(d[2] ? `${d[1]}T${d[2].padStart(5, '0')}` : d[1])
    if (!when) continue
    const text = t[2]
      .replace(TASK_DATE_RE, '')
      .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
      .replace(/\s+/g, ' ')
      .trim()
    out.push({
      key: hashKey(`${path}#task#${text}`),
      path,
      title: text || title,
      thread: title,
      kind: 'task',
      due: when.date.toISOString(),
      allDay: when.allDay,
      reminders: reminderMinutes(undefined, when.date, defaults, when.allDay),
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* iCalendar (RFC 5545)                                                */
/* ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0')
const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const icsUtc = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

function fold(line) {
  // Lines longer than 75 octets are folded with CRLF + space.
  const out = []
  let rest = line
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 74
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--
    out.push(rest.slice(0, cut))
    rest = ' ' + rest.slice(cut)
  }
  out.push(rest)
  return out.join('\r\n')
}

/**
 * @param {ReturnType<typeof extractDeadlines>} items
 * @param {{ name?: string, link?: (path: string) => string }} [opts]
 */
export function toICS(items, opts = {}) {
  const now = icsUtc(new Date())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KSPress//THREAD//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(opts.name ?? 'THREAD')}`]
  for (const it of items) {
    const due = new Date(it.due)
    const link = opts.link?.(it.path)
    lines.push('BEGIN:VEVENT', `UID:${it.key}@thread`, `DTSTAMP:${now}`)
    if (it.allDay) {
      const end = new Date(due)
      end.setDate(end.getDate() + 1)
      lines.push(`DTSTART;VALUE=DATE:${icsDate(due)}`, `DTEND;VALUE=DATE:${icsDate(end)}`)
    } else {
      lines.push(`DTSTART:${icsUtc(due)}`, `DTEND:${icsUtc(new Date(due.getTime() + 30 * 60000))}`)
    }
    lines.push(`SUMMARY:${icsText(it.kind === 'task' ? `☐ ${it.title}` : `⏳ ${it.title}`)}`)
    lines.push(`DESCRIPTION:${icsText(`${it.kind === 'task' ? `Task in ${it.thread}` : 'Deadline'} — ${it.path}${link ? `\n${link}` : ''}`)}`)
    if (link) lines.push(`URL:${link}`)
    for (const m of it.reminders) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(it.title)}`, `TRIGGER:-PT${m}M`, 'END:VALARM')
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
