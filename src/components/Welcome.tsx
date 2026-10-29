// The first screen: sign in with Google (Calendar + Drive), then pick a vault
// from one list — the sample world, vaults kept on this device, folders,
// Loom Satellites and vaults kept in Google Drive — or make/connect a new one.
import { useEffect, useState } from 'react'
import { lastVault, openAdapter, pickFolder, reopenFolder } from '../core/boot'
import { useSettings } from '../core/settings'
import { BrowserVault, FolderVault, isDesktopApp, isTauri, TauriVault } from '../core/vault'
import { forgetVault, knownVaults, type KnownVault } from '../core/vaults'
import type { DriveFile } from '../core/drive'
import { anyGoogleSignIn, signInGoogle, signOutGoogle, useGoogleAccount } from '../core/googleAccount'
import { Icon } from './Icon'
import { Logo } from './Logo'

const SAMPLE = 'Sample Vault'

export function Welcome() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [vaults, setVaults] = useState<KnownVault[]>([])
  const [drive, setDrive] = useState<DriveFile[] | null>(null)
  const [adding, setAdding] = useState<null | 'new' | 'loom'>(null)
  const google = useGoogleAccount()
  const signedIn = google.signedIn || anyGoogleSignIn()
  const canPick = isDesktopApp() || FolderVault.supported()
  const last = lastVault()

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      console.error(e)
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void knownVaults().then(setVaults)
  }, [])
  // Signed in: also list the vaults kept in Google Drive.
  useEffect(() => {
    if (!signedIn) return setDrive(null)
    void import('../core/gdrive')
      .then((m) => m.listDriveVaults())
      .then(setDrive)
      .catch(() => setDrive([]))
  }, [signedIn])

  const local = vaults.filter((v) => !(v.kind === 'device' && v.name === SAMPLE))
  const driveOnly = (drive ?? []).filter((f) => !vaults.some((v) => v.kind === 'device' && v.name === f.name))

  const openKnown = (v: KnownVault) =>
    run(async () => {
      if (v.loom) useSettings.getState().set({ loomUrl: v.loom })
      if (v.kind === 'tauri' && v.root) await openAdapter(new TauriVault(v.root))
      else if (v.kind === 'folder') {
        if (!(await reopenFolder())) throw new Error('Choose the folder again with “Open a folder”.')
      } else await openAdapter(new BrowserVault(v.name))
    })

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
        </div>

        <div className="tile welcome__opts">
          {/* 1 — Google */}
          <section className="welcome__step">
            <div className="welcome__step-head">
              <span className="welcome__num">1</span>
              <b>Google</b>
              <small>optional</small>
            </div>
            {signedIn ? (
              <div className="welcome__google is-on">
                <Icon name="cloud" size={18} />
                <span>
                  Signed in — Calendar reminders and Google Drive vaults are ready.
                </span>
                <button className="chip-btn" onClick={() => signOutGoogle()}>
                  Sign out
                </button>
              </div>
            ) : (
              <GoogleSignIn busy={busy || google.busy} onSignIn={() => run(signInGoogle)} />
            )}
          </section>

          {/* 2 — Vaults */}
          <section className="welcome__step">
            <div className="welcome__step-head">
              <span className="welcome__num">2</span>
              <b>Choose a vault</b>
            </div>
            <div className="vault-list" role="list">
              {local.map((v) => (
                <VaultRow key={`${v.kind}:${v.name}:${v.root ?? ''}`} v={v} busy={busy} onOpen={() => void openKnown(v)} onForget={() => (forgetVault(v.name, v.kind), setVaults((l) => l.filter((x) => x !== v)))} />
              ))}
              {driveOnly.map((f) => (
                <button
                  key={f.id}
                  className="vault-row"
                  role="listitem"
                  disabled={busy}
                  onClick={() => void run(async () => (await import('../core/gdrive')).openFromDrive(f))}
                >
                  <Icon name="cloud" size={18} />
                  <span className="vault-row__name">{f.name}</span>
                  <span className="vault-tag vault-tag--drive">In Google Drive</span>
                </button>
              ))}
              {signedIn && drive === null && <div className="vault-row is-quiet">Looking in Google Drive…</div>}
              <button className="vault-row" role="listitem" disabled={busy} onClick={() => void run(() => openAdapter(new BrowserVault(SAMPLE), { seed: true }))}>
                <Icon name="layers" size={18} />
                <span className="vault-row__name">
                  The Ashen Reach <small>sample world</small>
                </span>
                <span className="vault-tag">Sample</span>
              </button>
              {last?.kind === 'folder' && !local.some((v) => v.kind === 'folder') && (
                <button className="vault-row" role="listitem" disabled={busy} onClick={() => void run(reopenFolder)}>
                  <Icon name="vault" size={18} />
                  <span className="vault-row__name">Your last folder</span>
                  <span className="vault-tag">Folder</span>
                </button>
              )}
            </div>

            {adding === 'new' ? (
              <NewVault
                busy={busy}
                taken={vaults.map((v) => v.name)}
                drive={signedIn}
                onCancel={() => setAdding(null)}
                onCreate={(name, inDrive) =>
                  run(async () => {
                    await openAdapter(new BrowserVault(name))
                    if (inDrive) await (await import('../core/gdrive')).connectDrive()
                  })
                }
              />
            ) : adding === 'loom' ? (
              <JoinLoom busy={busy} onCancel={() => setAdding(null)} onJoin={() => run(() => openAdapter(new BrowserVault('Loom Satellite')))} />
            ) : (
              <div className="welcome__actions">
                <button className="btn btn--ink" disabled={busy} onClick={() => setAdding('new')}>
                  <Icon name="plus" size={14} /> New vault
                </button>
                {canPick && (
                  <button className="btn" disabled={busy} onClick={() => void run(pickFolder)} title="Use a folder of .md files on disk — works side by side with Obsidian">
                    <Icon name="folder" size={14} /> Open a folder
                  </button>
                )}
                <button className="btn" disabled={busy} onClick={() => setAdding('loom')} title="Run as a Satellite of your self-hosted Loom">
                  <Icon name="sync" size={14} /> Join a Loom
                </button>
              </div>
            )}
            {error && <p className="welcome__error">{error}</p>}
          </section>
        </div>
      </div>
    </div>
  )
}

function VaultRow({ v, busy, onOpen, onForget }: { v: KnownVault; busy: boolean; onOpen: () => void; onForget: () => void }) {
  const icon = v.drive ? 'cloud' : v.loom ? 'sync' : v.kind === 'device' ? 'vault' : 'folder'
  const when = v.opened ? new Date(v.opened).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
  return (
    <div className="vault-row-wrap" role="listitem">
      <button className="vault-row" disabled={busy} onClick={onOpen}>
        <Icon name={icon} size={18} />
        <span className="vault-row__name">
          {v.name}
          {when && <small>opened {when}</small>}
        </span>
        {v.drive && <span className="vault-tag vault-tag--drive">Drive</span>}
        {v.loom && <span className="vault-tag vault-tag--loom">Loom</span>}
        <span className="vault-tag">{v.kind === 'device' ? 'This device' : 'Folder'}</span>
      </button>
      {v.kind !== 'device' && (
        <button className="vault-row__forget" title="Remove from this list (the folder is untouched)" onClick={onForget}>
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  )
}

function GoogleSignIn({ busy, onSignIn }: { busy: boolean; onSignIn: () => void }) {
  const st = useSettings()
  const [setup, setSetup] = useState(false)
  if (!setup)
    return (
      <div className="welcome__google">
        <button className="btn btn--google" disabled={busy} onClick={() => (st.gcalClientId ? onSignIn() : setSetup(true))}>
          <GoogleG /> Sign in with Google
        </button>
        <small>For deadline reminders in Google Calendar and vaults kept in Google Drive. THREAD only sees what it creates.</small>
        <button className="chip-btn" onClick={() => setSetup(true)}>
          Client ID…
        </button>
      </div>
    )
  return (
    <form
      className="welcome__google welcome__google--setup"
      onSubmit={(e) => {
        e.preventDefault()
        setSetup(false)
        onSignIn()
      }}
    >
      <small>
        Google sign-in needs your own OAuth client ID (free, about 5 minutes once — see “Google setup” in the README). Skip this if you don’t need Calendar or Drive.
      </small>
      <input className="input" placeholder="Google OAuth client ID" value={st.gcalClientId} onChange={(e) => st.set({ gcalClientId: e.target.value.trim() })} required />
      {isTauri() && <input className="input" type="password" placeholder="Client secret (Desktop app client)" value={st.gcalClientSecret} onChange={(e) => st.set({ gcalClientSecret: e.target.value.trim() })} />}
      <div className="welcome__actions">
        <button className="btn btn--google" type="submit" disabled={busy || !st.gcalClientId}>
          <GoogleG /> Sign in with Google
        </button>
        <button className="btn" type="button" onClick={() => setSetup(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function NewVault({ busy, taken, drive, onCancel, onCreate }: { busy: boolean; taken: string[]; drive: boolean; onCancel: () => void; onCreate: (name: string, inDrive: boolean) => void }) {
  const lower = new Set(taken.map((t) => t.toLowerCase()))
  const [name, setName] = useState(() => {
    let n = 'My Vault'
    for (let i = 2; lower.has(n.toLowerCase()); i++) n = `My Vault ${i}`
    return n
  })
  const [inDrive, setInDrive] = useState(drive)
  return (
    <form
      className="welcome__form"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) onCreate(name.trim(), inDrive && drive)
      }}
    >
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Vault name" />
      {lower.has(name.trim().toLowerCase()) && <small>That vault is already on this device — this opens it.</small>}
      {drive && (
        <label className="welcome__check">
          <input type="checkbox" checked={inDrive} onChange={(e) => setInDrive(e.target.checked)} /> Also keep it in Google Drive
        </label>
      )}
      <div className="welcome__actions">
        <button className="btn btn--ink" type="submit" disabled={busy || !name.trim()}>
          <Icon name="plus" size={14} /> Create
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function JoinLoom({ busy, onCancel, onJoin }: { busy: boolean; onCancel: () => void; onJoin: () => void }) {
  const [url, setUrl] = useState(useSettings.getState().loomUrl || 'http://localhost:7878')
  const [token, setToken] = useState(useSettings.getState().loomToken)
  return (
    <form
      className="welcome__form"
      onSubmit={(e) => {
        e.preventDefault()
        useSettings.getState().set({ loomUrl: url, loomToken: token })
        onJoin()
      }}
    >
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://loom.local:7878" aria-label="Loom address" />
      <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Access token" type="password" aria-label="Loom access token" />
      <div className="welcome__actions">
        <button className="btn btn--ink" type="submit" disabled={busy}>
          <Icon name="sync" size={14} /> Become a Satellite
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
