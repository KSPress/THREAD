import { lazy, Suspense, useEffect, useState } from 'react'
import { Icon } from './components/Icon'
import { Backdrop } from './components/Backdrop'
import { CommandPalette } from './components/CommandPalette'
import { Rail } from './components/Rail'
import { SettingsPanel } from './components/SettingsPanel'
import { Spool } from './components/Spool'
import { Stitching } from './components/Stitching'
import { Welcome } from './components/Welcome'
import { restoreVault } from './core/boot'
import { startReminders } from './core/notify'
import { startGoogleAutoSync } from './core/gcal'
import { applyUpdate, buildLabel, startUpdateWatch, useUpdate } from './core/update'
import { useStore, type View } from './core/store'
import { useApplyTheme } from './core/theme'
import { CanvasView } from './views/CanvasView'
import { HomeView } from './views/HomeView'

// Heavier views (pdf.js, pdfmake/docx, the graph) load on first use.
const DeskView = lazy(() => import('./views/DeskView').then((m) => ({ default: m.DeskView })))
const CompilerView = lazy(() => import('./views/CompilerView').then((m) => ({ default: m.CompilerView })))
const TapestryView = lazy(() => import('./views/TapestryView').then((m) => ({ default: m.TapestryView })))

const VIEWS: View[] = ['home', 'canvas', 'tapestry', 'desk', 'compiler']

export function App() {
  useApplyTheme()
  const adapter = useStore((s) => s.adapter)
  const view = useStore((s) => s.view)
  const active = useStore((s) => s.active)
  const spoolOpen = useStore((s) => s.spoolOpen)
  const stitchingOpen = useStore((s) => s.stitchingOpen)
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    void restoreVault()
    startUpdateWatch()
  }, [])

  // Once a vault is open: reminders, Google auto-sync, and `#open=<path>`
  // deep links (used by the links inside Google Calendar events).
  useEffect(() => {
    if (!adapter) return
    startReminders()
    startGoogleAutoSync()
    const openFromHash = () => {
      const m = /^#open=(.+)$/.exec(location.hash)
      if (!m) return
      const path = decodeURIComponent(m[1])
      const s = useStore.getState()
      if (s.threads[path]) s.open(path)
      history.replaceState(null, '', location.pathname + location.search)
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [adapter])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const s = useStore.getState()
      if (!s.adapter || !mod) return
      if (e.key === 'k' || e.key === 'p' || e.key === 'o') {
        e.preventDefault()
        s.set({ paletteOpen: !s.paletteOpen })
      } else if (e.key === '\\') {
        e.preventDefault()
        if (e.shiftKey) s.set({ stitchingOpen: !s.stitchingOpen })
        else s.set({ spoolOpen: !s.spoolOpen })
      } else if (e.key === ',') {
        e.preventDefault()
        s.set({ settingsOpen: true })
      } else if (e.key === 'n' && e.altKey) {
        e.preventDefault()
        const dir = s.active ? s.active.split('/').slice(0, -1).join('/') : ''
        void s.createThread(dir, 'Untitled').then((p) => s.open(p))
      } else if (e.altKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault()
        s.setView(VIEWS[parseInt(e.key, 10) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!adapter) {
    return (
      <>
        <Backdrop />
        <Welcome />
      </>
    )
  }

  const showStitching = stitchingOpen && !!active && view === 'canvas'
  return (
    <>
      <Backdrop />
      <div className={'app' + (spoolOpen ? '' : ' no-spool') + (showStitching ? '' : ' no-stitching')} data-view={view}>
        <Rail />
        <Spool />
        <main className="stage">
          <Suspense fallback={<div className="view" />}>
            {view === 'home' && <HomeView />}
            {view === 'canvas' && <CanvasView />}
            {view === 'tapestry' && <TapestryView />}
            {view === 'desk' && <DeskView />}
            {view === 'compiler' && <CompilerView />}
          </Suspense>
        </main>
        <Stitching />
        {/* Tap-outside targets for the overlay panels on compact layouts. */}
        {spoolOpen && <div className="scrim-tap scrim-tap--spool" onClick={() => useStore.getState().set({ spoolOpen: false })} />}
        {showStitching && <div className="scrim-tap scrim-tap--stitching" onClick={() => useStore.getState().set({ stitchingOpen: false })} />}
      </div>
      <CommandPalette />
      <SettingsPanel />
      <UpdateBanner />
      {toast && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </>
  )
}

/** "A newer THREAD is ready" — applying it saves open edits, then reloads. */
function UpdateBanner() {
  const u = useUpdate()
  const [busy, setBusy] = useState(false)
  if (u.status !== 'available' || !u.remote || u.dismissed === u.remote.id) return null
  return (
    <div className="update-banner" role="status">
      <Icon name="sync" size={15} />
      <span>
        <b>A newer THREAD is ready</b>
        <small className="mono">{buildLabel(u.remote)}</small>
      </span>
      <button className="btn btn--accent" disabled={busy} onClick={() => (setBusy(true), void applyUpdate())}>
        {busy ? 'Saving…' : 'Update now'}
      </button>
      <button className="icon-btn" title="Later" onClick={() => useUpdate.setState({ dismissed: u.remote!.id })}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
