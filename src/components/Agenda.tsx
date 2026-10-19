// "Coming up": overdue and upcoming deadlines across the vault.
import { daysUntil, isOverdue, relativeDue, useDeadlines } from '../core/deadlines'
import { syncGoogle, useGcal } from '../core/gcal'
import { useDyeColor, useStore } from '../core/store'
import { Icon } from './Icon'

export function GcalPill() {
  const status = useGcal((s) => s.status)
  const label = { disconnected: 'Calendar off', connecting: 'Connecting', connected: 'Google synced', syncing: 'Syncing', expired: 'Reconnect', error: 'Sync error' }[status]
  return (
    <button
      className="gcal-pill"
      data-status={status}
      title={useGcal.getState().error ?? 'Google Calendar'}
      onClick={() => (status === 'connected' ? void syncGoogle() : useStore.getState().set({ settingsOpen: true }))}
    >
      <i />
      {label}
    </button>
  )
}

export function Agenda({ limit = 7 }: { limit?: number }) {
  const all = useDeadlines()
  const threads = useStore((s) => s.threads)
  const open = useStore((s) => s.open)
  const dyeColor = useDyeColor()
  const now = new Date()
  const items = all.filter((d) => isOverdue(d, now) || daysUntil(d, now) <= 60)
  const shown = items.slice(0, limit)

  return (
    <div className="agenda">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="label">[ Coming up ]</span>
        <span className="spacer" />
        <GcalPill />
      </div>
      {shown.length === 0 && (
        <p className="empty-note">
          No deadlines. Add <code>deadline: 2026-11-01</code> to a Thread’s properties, or a task like <code>- [ ] Draft 📅 2026-11-01</code>.
        </p>
      )}
      {shown.map((d) => {
        const due = new Date(d.due)
        const t = threads[d.path]
        const overdue = isOverdue(d, now)
        return (
          <button key={d.key} className={'agenda__item' + (overdue ? ' is-overdue' : '')} onClick={() => open(d.path)}>
            <span className="agenda__date">
              <b>{due.getDate()}</b>
              <small>{due.toLocaleDateString(undefined, { month: 'short' })}</small>
            </span>
            <span className="agenda__main">
              <b>
                {d.kind === 'task' ? '☐ ' : ''}
                {d.title}
              </b>
              <small>
                {t?.dyes[0] && <span className="dye-dot" style={{ background: dyeColor(t.dyes[0]) }} />}
                {d.kind === 'task' ? d.thread : d.path.split('/').slice(0, -1).join(' › ') || 'vault'}
              </small>
            </span>
            <span className="agenda__when">{relativeDue(d, now)}</span>
          </button>
        )
      })}
      {items.length > shown.length && <div className="empty-note">+ {items.length - shown.length} more</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button className="chip-btn" onClick={() => void import('../core/calendarExport').then((m) => m.downloadICS())}>
          <Icon name="calendar" size={12} /> Export .ics
        </button>
      </div>
    </div>
  )
}
