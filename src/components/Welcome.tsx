import { useState } from 'react'
import { lastVault, openAdapter, pickFolder, reopenFolder } from '../core/boot'
import { useSettings } from '../core/settings'
import { BrowserVault, FolderVault, isDesktopApp } from '../core/vault'
import { Icon } from './Icon'
import { Logo } from './Logo'

export function Welcome() {
  const [busy, setBusy] = useState(false)
  const [loom, setLoom] = useState(false)
  const [url, setUrl] = useState(useSettings.getState().loomUrl || 'http://localhost:7878')
  const [token, setToken] = useState(useSettings.getState().loomToken)
  const canPick = isDesktopApp() || FolderVault.supported()
  const last = lastVault()

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      console.error(e)
      alert(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome__card tiles">
        <div className="tile welcome__brand">
          <Logo size={26} />
          <h1>
            Spin up your
            <br />
            world<span style={{ color: 'var(--accent)' }}>.</span>
          </h1>
          <p>
            A local-first workspace for worldbuilders and writers. Every <b>Thread</b> is a plain Markdown file you own — <b>Stitch</b> them together,
            dye them, quote your research at the <b>Desk</b> and bind it all into a manuscript.
          </p>
          <div className="spacer" />
          <div className="label">[ Core / Host · Plain .md · Yjs CRDT sync ]</div>
        </div>
        <div className="tile welcome__opts">
          {last?.kind === 'folder' && (
            <button className="welcome__opt" disabled={busy} onClick={() => void run(reopenFolder)}>
              <Icon name="vault" size={22} />
              <span>
                <b>Reopen your folder</b>
                <br />
                <small>Continue where you left off.</small>
              </span>
            </button>
          )}
          <button className="welcome__opt" disabled={busy || !canPick} onClick={() => void run(pickFolder)}>
            <Icon name="folder" size={22} />
            <span>
              <b>Open a folder vault</b>
              <br />
              <small>{canPick ? 'Use any folder of .md files — works side by side with Obsidian.' : 'Needs the desktop app or Chrome/Edge on a computer. On phones, Threads are kept inside THREAD — connect a Loom to share them.'}</small>
            </span>
          </button>
          <button
            className="welcome__opt"
            disabled={busy}
            onClick={() => void run(() => openAdapter(new BrowserVault('Sample Vault'), { seed: true }))}
          >
            <Icon name="layers" size={22} />
            <span>
              <b>Explore the sample world</b>
              <br />
              <small>“The Ashen Reach” — Threads, Stitches, a Table, a Pinboard and a PDF at the Desk.</small>
            </span>
          </button>
          {!loom ? (
            <button className="welcome__opt" disabled={busy} onClick={() => setLoom(true)}>
              <Icon name="cloud" size={22} />
              <span>
                <b>Connect to a Loom</b>
                <br />
                <small>Run as a Satellite of your self-hosted Host.</small>
              </span>
            </button>
          ) : (
            <form
              className="welcome__opt"
              onSubmit={(e) => {
                e.preventDefault()
                useSettings.getState().set({ loomUrl: url, loomToken: token })
                void run(() => openAdapter(new BrowserVault('Loom Satellite')))
              }}
            >
              <b>Connect to a Loom</b>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://loom.local:7878" />
              <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Access token" type="password" />
              <button className="btn btn--ink" type="submit">
                <Icon name="sync" size={14} /> Become a Satellite
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
