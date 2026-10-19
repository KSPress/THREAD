export interface Deadline {
  /** Stable id (used as the Google Calendar / ICS key). */
  key: string
  path: string
  title: string
  /** For tasks: the Thread the task lives in. */
  thread?: string
  kind: 'thread' | 'task'
  /** ISO timestamp. All-day deadlines are local midnight. */
  due: string
  allDay: boolean
  /** Minutes before `due`, largest first. */
  reminders: number[]
}

export function parseWhen(value: unknown): { date: Date; allDay: boolean } | null
export function parseOffset(value: unknown): number | null
export function reminderMinutes(remind: unknown, due: Date, defaults: (string | number)[], allDay?: boolean): number[]
export function extractDeadlines(
  path: string,
  title: string,
  frontmatter: Record<string, unknown>,
  body: string,
  opts?: { defaultReminders?: (string | number)[] },
): Deadline[]
export function toICS(items: Deadline[], opts?: { name?: string; link?: (path: string) => string | undefined }): string
