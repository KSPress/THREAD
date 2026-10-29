// "Make your THREAD your own": backgrounds, blur, fonts, palettes, the Loom.
import { useStore } from '../core/store'
import { DEFAULT_SETTINGS, PALETTES, useSettings, type BackdropKind, type CornerStyle, type FontChoice, type PaletteId, type ThemeMode } from '../core/settings'
import { closeVault } from '../core/boot'
import { BackdropThumb } from './Backdrop'
import { Icon } from './Icon'
import { useEffect, useState } from 'react'
import { connectGoogle, disconnectGoogle, syncGoogle, useGcal } from '../core/gcal'
import { notificationPermission, requestNotifications, showNotification } from '../core/notify'
import { isTauri } from '../core/vault'
import { applyUpdate, BUILD, buildLabel, checkForUpdate, runningLive, useUpdate } from '../core/update'

const BACKDROPS: { kind: Exclude<BackdropKind, 'image'>; label: string }[] = [
  { kind: 'halftone', label: 'Halftone' },
  { kind: 'pixel', label: 'Pixel' },
  { kind: 'aurora', label: 'Aurora' },
  { kind: 'paper', label: 'Paper' },
]
const FONTS: { id: FontChoice; label: string }[] = [
  { id: 'inter', label: 'Inter' },
  { id: 'jost', label: 'Jost' },
  { id: 'literata', label: 'Literata' },
  { id: 'mono', label: 'Mono' },
]
// Preview shapes: an outer frame and an inner tile, each drawn in the corner style.
const CORNERS: { id: CornerStyle; label: string; hint: string; path: string; inner: string }[] = [
  {
    id: 'round',
    label: 'Radial',
    hint: 'Soft rounded corners',
    path: 'M12 3h40a9 9 0 0 1 9 9v20a9 9 0 0 1-9 9H12a9 9 0 0 1-9-9V12a9 9 0 0 1 9-9z',
    inner: 'M15 11h14a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4z',
  },
  {
    id: 'diagonal',
    label: 'Diagonal',
    hint: 'Chamfered, panel-cut edges',
    path: 'M12 3h40l9 9v20l-9 9H12l-9-9V12z',
    inner: 'M15 11h14l4 4v14l-4 4H15l-4-4V15z',
  },
  {
    id: 'square',
    label: 'Square',
    hint: 'Modern sharp cuts',
    path: 'M3 3h58v38H3z',
    inner: 'M11 11h22v22H11z',
  },
]

const ACCENTS = ['#FF5F45', '#E8772E', '#1FA3E0', '#6D5BD0', '#22A04A', '#F2B33D', '#303830', '#C98BB9']
const TINTS = ['#2f5784', '#3f6e73', '#5b4a7a', '#7a4f3a', '#344034', '#1f2a44']

export function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen)
  const set = useStore((s) => s.set)
  const st = useSettings()
  const status = useStore((s) => s.loomStatus)
  const pending = useStore((s) => s.loomPending)
  const detail = useStore((s) => s.loomDetail)
  const connectLoom = useStore((s) => s.connectLoom)
  const adapter = useStore((s) => s.adapter)
  // Escape closes, like every other overlay.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && set({ settingsOpen: false })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null

  const close = () => set({ settingsOpen: false })

  const uploadBackground = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return
      const img = new Image()
      img.onload = () => {
        // Downscale so the data URL fits comfortably in local storage.
        const scale = Math.min(1, 2200 / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * scale)
        c.height = Math.round(img.height * scale)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        st.set({ backdrop: 'image', backdropImage: c.toDataURL('image/jpeg', 0.86) })
        URL.revokeObjectURL(img.src)
      }
      img.src = URL.createObjectURL(f)
    }
    input.click()
  }

  return (
    <div className="scrim" onMouseDown={close} style={{ paddingTop: '8vh' }}>
      <div className="settings card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="card__head" style={{ padding: '18px 22px 6px' }}>
          <div>
            <div className="label">[ Personalize ]</div>
            <h2 style={{ fontSize: 26, fontWeight: 500 }}>
              Make your THREAD your own<span style={{ color: 'var(--accent)' }}>.</span>
            </h2>
          </div>
          <span className="spacer" />
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="settings__body">
          <h3>Backdrop</h3>
          <div className="backdrop-pick">
            {BACKDROPS.map((b) => (
              <button key={b.kind} className={st.backdrop === b.kind ? 'is-on' : ''} onClick={() => st.set({ backdrop: b.kind })}>
                <BackdropThumb kind={b.kind} />
                <span>{b.label}</span>
              </button>
            ))}
            <button
              className={st.backdrop === 'image' ? 'is-on' : ''}
              style={st.backdropImage ? { backgroundImage: `url(${st.backdropImage})` } : { display: 'grid', placeItems: 'center' }}
              onClick={() => (st.backdropImage ? st.set({ backdrop: 'image' }) : uploadBackground())}
            >
              {!st.backdropImage && <Icon name="upload" size={22} />}
              <span>Your image</span>
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <span className="label">Sky tint</span>
            <div className="swatches">
              {TINTS.map((c) => (
                <button key={c} className={'swatch' + (st.backdropTint === c ? ' is-on' : '')} style={{ background: c }} onClick={() => st.set({ backdropTint: c })} />
              ))}
            </div>
            <span className="spacer" />
            <button className="btn btn--ghost" onClick={uploadBackground}>
              <Icon name="upload" size={14} /> Upload background
            </button>
          </div>

          <h3>Window corners</h3>
          <div className="corner-pick" role="radiogroup" aria-label="Window corners">
            {CORNERS.map((c) => (
              <button
                key={c.id}
                role="radio"
                aria-checked={st.corners === c.id}
                className={'key corner-pick__opt' + (st.corners === c.id ? ' is-on' : '')}
                onClick={() => st.set({ corners: c.id })}
              >
                <svg viewBox="0 0 64 44" width="64" height="44" aria-hidden>
                  <path d={c.path} fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="2.5" strokeLinejoin={c.id === 'round' ? 'round' : 'miter'} />
                  <path d={c.inner} fill="currentColor" fillOpacity="0.35" />
                </svg>
                <span>
                  <b>{c.label}</b>
                  <small>{c.hint}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="settings__grid">
            <div>
              <h3>Radial blur · {st.blur}</h3>
              <input className="range" type="range" min={0} max={100} value={st.blur} onChange={(e) => st.set({ blur: +e.target.value })} />
            </div>
            <div>
              <h3>Card opacity · {st.glass}%</h3>
              <input className="range" type="range" min={55} max={100} value={st.glass} onChange={(e) => st.set({ glass: +e.target.value })} />
            </div>
            <div>
              <h3>Theme</h3>
              <div className="seg seg--light">
                {(['light', 'dark', 'auto'] as ThemeMode[]).map((t) => (
                  <button key={t} className={st.theme === t ? 'is-on' : ''} onClick={() => st.set({ theme: t })}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3>Film grain</h3>
              <button className={'toggle toggle--h' + (st.grain ? ' is-on' : '')} onClick={() => st.set({ grain: !st.grain })}>
                <span />
              </button>
            </div>
            <div>
              <h3>Writing font</h3>
              <div className="seg seg--light">
                {FONTS.map((f) => (
                  <button key={f.id} className={st.bodyFont === f.id ? 'is-on' : ''} onClick={() => st.set({ bodyFont: f.id })}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3>Display font</h3>
              <div className="seg seg--light">
                {FONTS.map((f) => (
                  <button key={f.id} className={st.displayFont === f.id ? 'is-on' : ''} onClick={() => st.set({ displayFont: f.id })}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3>Accent</h3>
              <div className="swatches">
                {ACCENTS.map((c) => (
                  <button key={c} className={'swatch' + (st.accent === c ? ' is-on' : '')} style={{ background: c }} onClick={() => st.set({ accent: c })} />
                ))}
                <label className="swatch" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', cursor: 'pointer' }}>
                  <input type="color" style={{ opacity: 0, width: 0, height: 0 }} value={st.accent} onChange={(e) => st.set({ accent: e.target.value })} />
                </label>
              </div>
            </div>
            <div>
              <h3>Dye palette</h3>
              <div className="seg seg--light">
                {(Object.keys(PALETTES) as PaletteId[]).map((p) => (
                  <button key={p} className={st.palette === p ? 'is-on' : ''} onClick={() => st.set({ palette: p })}>
                    {PALETTES[p].name}
                  </button>
                ))}
              </div>
              <div className="swatches" style={{ marginTop: 8 }}>
                {PALETTES[st.palette].colors.map((c) => (
                  <span key={c} className="swatch" style={{ background: c, width: 18, height: 18 }} />
                ))}
              </div>
            </div>
            <div>
              <h3>Canvas width · {st.editorWidth}px</h3>
              <input className="range" type="range" min={560} max={1100} step={20} value={st.editorWidth} onChange={(e) => st.set({ editorWidth: +e.target.value })} />
            </div>
            <div>
              <h3>Spellcheck</h3>
              <button className={'toggle toggle--h' + (st.spellcheck ? ' is-on' : '')} onClick={() => st.set({ spellcheck: !st.spellcheck })}>
                <span />
              </button>
            </div>
          </div>

          <UpdateSettings />

          <CalendarSettings />

          <h3>The Loom (Host)</h3>
          <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>
            Point this Satellite at your self-hosted Loom. Every change is logged as an immutable Yjs event and streamed when online — offline work is never lost.
          </p>
          <div className="settings__grid">
            <input className="input" placeholder="http://loom.local:7878" value={st.loomUrl} onChange={(e) => st.set({ loomUrl: e.target.value.trim() })} />
            <input className="input" type="password" placeholder="Access token" value={st.loomToken} onChange={(e) => st.set({ loomToken: e.target.value })} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <button className="btn btn--ink" disabled={!st.loomUrl && status === 'disabled'} onClick={() => void connectLoom()}>
              <Icon name="sync" size={14} /> {!st.loomUrl ? (status === 'disabled' ? 'Connect' : 'Disconnect') : status === 'online' ? 'Reconnect' : 'Connect'}
            </button>
            <span className="mono muted" style={{ fontSize: 12 }}>
              status: <b style={{ color: status === 'online' ? '#22a04a' : status === 'error' ? 'var(--coral)' : 'inherit' }}>{status}</b> · queued events: {pending}
              {detail ? ` · ${detail}` : ''}
            </span>
          </div>

          <h3>Vault</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 12 }}>
              {adapter?.name} · {adapter?.kind === 'tauri' ? 'native folder' : adapter?.kind === 'folder' ? 'browser folder access' : 'browser storage'}
            </span>
            <span className="spacer" />
            <button className="btn" onClick={() => st.reset()}>
              Reset look
            </button>
            <button
              className="btn"
              onClick={() => {
                close()
                void closeVault()
              }}
            >
              <Icon name="vault" size={14} /> Switch vault
            </button>
          </div>
          <p className="muted mono" style={{ fontSize: 10.5, marginTop: 18 }}>
            THREAD v0.1 · build {BUILD.commit} · defaults: {DEFAULT_SETTINGS.backdrop} / blur {DEFAULT_SETTINGS.blur} / {DEFAULT_SETTINGS.palette}
          </p>
        </div>
      </div>
    </div>
  )
}

const DEFAULT_CHOICES: { value: string | number; label: string }[] = [
  { value: 0, label: 'At time' },
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
  { value: '3d', label: '3 days' },
  { value: '1w', label: '1 week' },
]

function CalendarSettings() {
  const st = useSettings()
  const g = useGcal()
  const loomUrl = useSettings((s) => s.loomUrl)
  const loomToken = useSettings((s) => s.loomToken)
  const [perm, setPerm] = useState<string>('default')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void notificationPermission().then(setPerm)
  }, [])
  const desktop = isTauri() // desktop and Android apps use the loopback OAuth flow
  const feed = loomUrl ? `${loomUrl.replace(/\/$/, '')}/calendar.ics?token=${encodeURIComponent(loomToken)}` : ''

  return (
    <>
      <h3>Reminders</h3>
      <div className="settings__grid">
        <div>
          <div className="opt-row">
            <span>System notifications</span>
            <button
              className={'toggle toggle--h' + (st.notifications ? ' is-on' : '')}
              onClick={async () => {
                if (st.notifications) return st.set({ notifications: false })
                const ok = await requestNotifications()
                setPerm(ok ? 'granted' : await notificationPermission())
                st.set({ notifications: ok })
              }}
            >
              <span />
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            {perm === 'denied'
              ? 'Notifications are blocked for this site in your browser settings.'
              : perm === 'unsupported'
                ? 'This browser has no notifications; reminders appear inside THREAD. On iPhone, add THREAD to your Home Screen first.'
                : 'While THREAD is open. When it is closed, your Google Calendar (or .ics feed) carries the reminders.'}
          </p>
          {st.notifications && (
            <button className="chip-btn" style={{ marginTop: 6 }} onClick={() => void showNotification('⏳ THREAD reminder', 'Notifications are working.')}>
              Send a test
            </button>
          )}
        </div>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>
            Default reminders (when a Thread sets none)
          </div>
          <div className="remind-chips">
            {DEFAULT_CHOICES.map((c) => {
              const on = st.defaultReminders.some((x) => String(x) === String(c.value))
              return (
                <button
                  key={c.label}
                  className={on ? 'is-on' : ''}
                  onClick={() => st.set({ defaultReminders: on ? st.defaultReminders.filter((x) => String(x) !== String(c.value)) : [...st.defaultReminders, c.value] })}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <h3>Google Calendar</h3>
      <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>
        Deadlines go into a calendar THREAD creates for itself. THREAD can only see calendars it made, never the rest of your Google Calendar.
      </p>
      <div className="settings__grid">
        <input
          className="input"
          placeholder={desktop ? 'OAuth client ID (Desktop app)' : 'OAuth client ID (Web application)'}
          value={st.gcalClientId}
          onChange={(e) => st.set({ gcalClientId: e.target.value.trim() })}
        />
        {desktop ? (
          <input className="input" type="password" placeholder="Client secret (Desktop app)" value={st.gcalClientSecret} onChange={(e) => st.set({ gcalClientSecret: e.target.value.trim() })} />
        ) : (
          <input className="input" placeholder="Calendar name" value={st.gcalCalendarName} onChange={(e) => st.set({ gcalCalendarName: e.target.value })} />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {g.status === 'disconnected' || g.status === 'error' || g.status === 'expired' ? (
          <button
            className="btn btn--ink"
            disabled={!st.gcalClientId || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await connectGoogle()
                await syncGoogle()
              } catch {
                // status + error are shown below
              } finally {
                setBusy(false)
              }
            }}
          >
            <Icon name="calendar" size={14} /> {g.status === 'expired' ? 'Reconnect Google' : 'Connect Google Calendar'}
          </button>
        ) : (
          <>
            <button className="btn btn--ink" disabled={g.status === 'syncing'} onClick={() => void syncGoogle()}>
              <Icon name="sync" size={14} /> {g.status === 'syncing' ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn" onClick={disconnectGoogle}>
              Disconnect
            </button>
          </>
        )}
        <div className="opt-row" style={{ border: 0, minHeight: 0, gap: 8 }}>
          <span className="label">Auto-sync</span>
          <button className={'toggle toggle--h' + (st.gcalAutoSync ? ' is-on' : '')} onClick={() => st.set({ gcalAutoSync: !st.gcalAutoSync })}>
            <span />
          </button>
        </div>
      </div>
      <p className="mono muted" style={{ fontSize: 11.5 }}>
        status: <b>{g.status}</b>
        {g.lastSync ? ` · last sync ${new Date(g.lastSync).toLocaleTimeString()}` : ''}
        {g.lastResult ? ` · +${g.lastResult.created} ~${g.lastResult.updated} −${g.lastResult.deleted}` : ''}
        {g.error ? ` · ${g.error}` : ''}
      </p>
      <details className="muted" style={{ fontSize: 12.5 }}>
        <summary style={{ cursor: 'pointer' }}>How to get a client ID (5 minutes, once)</summary>
        <ol style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Open console.cloud.google.com → create (or pick) a project.</li>
          <li>APIs &amp; Services → Library → enable <b>Google Calendar API</b>.</li>
          <li>OAuth consent screen → External → add yourself as a test user.</li>
          <li>
            Credentials → Create credentials → OAuth client ID →{' '}
            {desktop ? (
              <>
                <b>Desktop app</b>. Paste the client ID and secret above.
              </>
            ) : (
              <>
                <b>Web application</b>, with <code>{location.origin}</code> as an authorized JavaScript origin. Paste the client ID above.
              </>
            )}
          </li>
        </ol>
      </details>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn" onClick={() => void import('../core/calendarExport').then((m) => m.downloadICS())}>
          <Icon name="download" size={14} /> Export deadlines (.ics)
        </button>
        {feed && (
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(feed)
              useStore.getState().notify('Calendar feed URL copied')
            }}
            title="Subscribe to this URL from Google Calendar (Other calendars → From URL). The Loom must be reachable from the internet."
          >
            <Icon name="link" size={14} /> Copy Loom calendar feed
          </button>
        )}
      </div>
    </>
  )
}

function UpdateSettings() {
  const st = useSettings()
  const u = useUpdate()
  const app = isTauri()
  const where = !app ? 'this website' : runningLive() ? 'the live build from the web' : 'the copy inside this app'
  return (
    <>
      <h3>Updates</h3>
      <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>
        {app
          ? 'Each time THREAD starts, it loads the newest published version when you are online. Your vault and settings stay on this device. Offline, it starts the version built into the app.'
          : 'THREAD checks for a newer version while it is open and offers to reload. Installed (Add to Home Screen) copies update the same way.'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 12 }}>
          Running {buildLabel(BUILD)} · {where}
        </span>
        <span className="spacer" />
        {u.status === 'available' && u.remote ? (
          <button className="btn btn--accent" onClick={() => void applyUpdate()}>
            <Icon name="sync" size={14} /> Update to {u.remote.commit}
          </button>
        ) : (
          <button className="btn" disabled={u.status === 'checking'} onClick={() => void checkForUpdate()}>
            <Icon name="sync" size={14} /> {u.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>
      {u.checkedAt && u.status !== 'checking' && (
        <p className="mono muted" style={{ fontSize: 11, marginTop: 6 }}>
          {u.status === 'current' ? 'Up to date.' : u.status === 'offline' ? 'Could not reach the update server.' : u.remote ? `New: ${buildLabel(u.remote)}` : ''}
        </p>
      )}
      {app && (
        <div className="settings__row" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <button className={'toggle toggle--h' + (st.liveUpdates ? ' is-on' : '')} onClick={() => st.set({ liveUpdates: !st.liveUpdates })}>
            <span />
          </button>
          <span style={{ fontSize: 13 }}>Load the newest version at launch</span>
        </div>
      )}
    </>
  )
}
