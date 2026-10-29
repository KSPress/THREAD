import { useStore, type View } from '../core/store'
import { useSettings } from '../core/settings'
import { useIsDark } from '../core/theme'
import { Icon } from './Icon'
import { Mark } from './Logo'

const ITEMS: { view: View; icon: string; label: string }[] = [
  { view: 'home', icon: 'home', label: 'The Loom' },
  { view: 'canvas', icon: 'canvas', label: 'Canvas' },
  { view: 'tapestry', icon: 'tapestry', label: 'Tapestry' },
  { view: 'compiler', icon: 'compiler', label: 'Compiler' },
]

export function Rail() {
  const view = useStore((s) => s.view)
  const set = useStore((s) => s.set)
  const setView = useStore((s) => s.setView)
  const spoolOpen = useStore((s) => s.spoolOpen)
  const status = useStore((s) => s.loomStatus)
  const pending = useStore((s) => s.loomPending)
  const detail = useStore((s) => s.loomDetail)
  const dark = useIsDark()
  const setSettings = useSettings((s) => s.set)

  const statusText =
    status === 'disabled'
      ? 'Local only — connect a Loom in Settings'
      : status === 'online'
        ? `Synced with the Loom${pending ? ` · ${pending} events queued` : ''}`
        : `${status[0].toUpperCase() + status.slice(1)}${pending ? ` · ${pending} events queued` : ''}${detail ? ` · ${detail}` : ''}`

  return (
    <nav className="rail">
      <button className="rail__logo" title="Toggle the Spool (Ctrl+\)" onClick={() => set({ spoolOpen: !spoolOpen })}>
        <Mark size={24} />
      </button>
      <button className="rail__btn rail__spoolbtn" onClick={() => set({ spoolOpen: !spoolOpen })} aria-label="Spool" title="Spool">
        <Icon name="menu" size={20} />
      </button>
      {ITEMS.map((i) => (
        <button key={i.view} className={'rail__btn' + (view === i.view ? ' is-on' : '')} onClick={() => setView(i.view)} aria-label={i.label}>
          <Icon name={i.icon} size={20} />
          <span className="tip">{i.label}</span>
        </button>
      ))}
      <span className="spacer rail__spacer" />
      <button className="rail__btn" onClick={() => set({ paletteOpen: true })} aria-label="Search">
        <Icon name="search" size={20} />
        <span className="tip">Search · Ctrl K</span>
      </button>
      <button className="rail__btn rail__extra" onClick={() => setSettings({ theme: dark ? 'light' : 'dark' })} aria-label="Theme">
        <Icon name={dark ? 'sun' : 'moon'} size={20} />
        <span className="tip">{dark ? 'Light' : 'Dark'} mode</span>
      </button>
      <button className="rail__btn" onClick={() => set({ settingsOpen: true })} aria-label="Settings">
        <Icon name="settings" size={20} />
        <span className="tip">Make it yours</span>
      </button>
      <button className="rail__orb rail__extra" data-status={status} title={statusText} onClick={() => set({ settingsOpen: true })}>
        {pending > 0 && <i>{pending > 99 ? '99+' : pending}</i>}
      </button>
    </nav>
  )
}
