// "Make your THREAD your own": backgrounds, blur, fonts, palettes, the Loom.
import { useStore } from '../core/store'
import { DEFAULT_SETTINGS, PALETTES, useSettings, type BackdropKind, type FontChoice, type PaletteId, type ThemeMode } from '../core/settings'
import { closeVault } from '../core/boot'
import { BackdropThumb } from './Backdrop'
import { Icon } from './Icon'

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

          <h3>The Loom (Host)</h3>
          <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>
            Point this Satellite at your self-hosted Loom. Every change is logged as an immutable Yjs event and streamed when online — offline work is never lost.
          </p>
          <div className="settings__grid">
            <input className="input" placeholder="http://loom.local:7878" value={st.loomUrl} onChange={(e) => st.set({ loomUrl: e.target.value.trim() })} />
            <input className="input" type="password" placeholder="Access token" value={st.loomToken} onChange={(e) => st.set({ loomToken: e.target.value })} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <button className="btn btn--ink" onClick={() => void connectLoom()}>
              <Icon name="sync" size={14} /> {st.loomUrl ? 'Connect' : 'Disconnect'}
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
            THREAD v0.1 · defaults: {DEFAULT_SETTINGS.backdrop} / blur {DEFAULT_SETTINGS.blur} / {DEFAULT_SETTINGS.palette}
          </p>
        </div>
      </div>
    </div>
  )
}
