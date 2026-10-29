import { useEffect, useState } from 'react'
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
  // Vaults already kept on this device (phones, tablets and browsers).
  const [vaults, setVaults] = useState<string[]>([])
  useEffect(() => {
    void BrowserVault.names()
      .then(setVaults)
      .catch(() => setVaults([]))
  }, [])

  const newVault = async () => {
    const taken = new Set(vaults.map((v) => v.toLowerCase()))
    let suggestion = 'My Vault'
    for (let i = 2; taken.has(suggestion.toLowerCase()); i++) suggestion = `My Vault ${i}`
    const name = prompt('Name your new vault', suggestion)?.trim()
    if (!name) return
    if (taken.has(name.toLowerCase()) && !confirm(`A vault called “${name}” is already on this device. Open it?`)) return
    await openAdapter(new BrowserVault(name))
  }

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
            dye them, quote PDFs open <b>side by side</b> and bind it all into a manuscript.
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
          <button className="welcome__opt" disabled={busy} onClick={() => void run(newVault)}>
            <Icon name="plus" size={22} />
            <span>
              <b>Start a new vault</b>
              <br />
              <small>{canPick ? 'Kept inside THREAD on this device. To use a folder on disk instead, open one below.' : 'Kept inside THREAD on this device. Connect a Loom or Google Drive later to share it.'}</small>
            </span>
          </button>
          {vaults.filter((v) => v !== 'Sample Vault').length > 0 && (
            <div className="welcome__vaults">
              <div className="label">[ On this device ]</div>
              {vaults
                .filter((v) => v !== 'Sample Vault')
                .map((v) => (
                  <button key={v} className="chip-btn" disabled={busy} onClick={() => void run(() => openAdapter(new BrowserVault(v)))}>
                    <Icon name="vault" size={13} /> {v}
                  </button>
                ))}
            </div>
          )}
                    <button className="welcome__opt" disabled={busy || !canPick} onClick={() => void run(pickFolder)}>
            <Icon name="folder" size={22} />
            <span>
              <b>Open a folder vault</b>
              <br />
              <small>{canPick ? 'Use any folder of .md files — works side by side with Obsidian.' : 'Needs the desktop app or Chrome/Edge on a computer.'}</small>
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
              <small>“The Ashen Reach” — Threads, Stitches, a Table, a Pinboard, a Cord and a PDF to quote from.</small>
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
