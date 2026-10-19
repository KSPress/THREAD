// "Thread style": icon, color and background for a single Thread.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ICON_STYLES, loadIconSet, parseBackground, parseIcon, threadColor, useIconSets, type IconStyle } from '../core/appearance'
import { PALETTES, useSettings } from '../core/settings'
import { useDyeColor, useStore } from '../core/store'
import type { Frontmatter } from '../core/markdown'
import { BackdropThumb } from './Backdrop'
import { Icon } from './Icon'
import { LineIcon } from './ThreadIcon'

type Tab = 'icon' | 'color' | 'background'

export function ThreadStylePop({ path, anchor, onClose, initialTab = 'icon' }: { path: string; anchor: DOMRect | null; onClose: () => void; initialTab?: Tab }) {
  const thread = useStore((s) => s.threads[path])
  const setFrontmatter = useStore((s) => s.setFrontmatter)
  const importFiles = useStore((s) => s.importFiles)
  const dyeColor = useDyeColor()
  const palette = useSettings((s) => s.palette)
  const [tab, setTab] = useState<Tab>(initialTab)
  const current = parseIcon(thread?.frontmatter.icon)
  const [style, setStyle] = useState<IconStyle>(current?.style ?? 'duotone')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const set = useIconSets((s) => s.sets[style])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadIconSet(style)
  }, [style])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    window.addEventListener('keydown', onKey)
    setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const icons = useMemo(() => {
    if (!set) return []
    const query = q.trim().toLowerCase()
    return Object.entries(set)
      .filter(([name, e]) => (!cat || e.c === cat) && (!query || name.includes(query) || e.c.includes(query)))
      .map(([name]) => name)
  }, [set, q, cat])
  const categories = useMemo(() => [...new Set(Object.values(set ?? {}).map((e) => e.c))].sort(), [set])

  if (!thread) return null
  const fm = thread.frontmatter
  const color = threadColor(fm, thread.dyes, dyeColor) ?? 'var(--text)'
  const patch = (p: Frontmatter) => {
    const next: Frontmatter = { ...fm, ...p }
    for (const k of Object.keys(p)) if (p[k] === undefined) delete next[k]
    void setFrontmatter(path, next)
  }
  const bg = parseBackground(fm.background)

  // Keep the pop inside the viewport; full-width sheet on phones.
  const w = Math.min(420, innerWidth - 16)
  const left = anchor ? Math.max(8, Math.min(anchor.left, innerWidth - w - 8)) : (innerWidth - w) / 2
  const top = anchor ? Math.min(anchor.bottom + 8, innerHeight - 480) : 80

  return createPortal(
    <div className="pop style-pop" ref={ref} style={{ left, top: Math.max(8, top), width: w }} role="dialog" aria-label="Thread style">
      <div className="style-pop__head">
        <span className="style-pop__preview" style={{ color }}>
          {current ? <LineIcon style={current.style} name={current.name} size={26} color={color} /> : <Icon name="file" size={24} />}
        </span>
        <b>{thread.name}</b>
        <span className="spacer" />
        <div className="seg seg--light">
          {(['icon', 'color', 'background'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
              {t === 'icon' ? 'Icon' : t === 'color' ? 'Color' : 'Background'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'icon' && (
        <>
          <div className="style-pop__bar">
            <div className="seg seg--light">
              {ICON_STYLES.map((s) => (
                <button key={s} className={style === s ? 'is-on' : ''} onClick={() => setStyle(s)}>
                  {s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="style-pop__bar">
            <input className="input" autoFocus placeholder="Search 361 icons…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" style={{ maxWidth: 140 }} value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/-/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="icon-grid" style={{ color }}>
            {!set && <div className="empty-note">Loading icons…</div>}
            {icons.map((name) => (
              <button
                key={name}
                title={name.replace(/-/g, ' ')}
                className={'icon-grid__cell' + (current?.name === name && current.style === style ? ' is-on' : '')}
                onClick={() => patch({ icon: `${style}/${name}` })}
              >
                <LineIcon style={style} name={name} size={22} />
              </button>
            ))}
            {set && icons.length === 0 && <div className="empty-note">No icon matches “{q}”.</div>}
          </div>
          {current && (
            <button className="chip-btn" style={{ marginTop: 8 }} onClick={() => patch({ icon: undefined })}>
              Remove icon
            </button>
          )}
        </>
      )}

      {tab === 'color' && (
        <div className="style-pop__section">
          <div className="label">[ {PALETTES[palette].name} palette ]</div>
          <div className="swatches" style={{ margin: '8px 0 12px' }}>
            {PALETTES[palette].colors.map((c) => (
              <button key={c} className={'swatch' + (fm.color === c ? ' is-on' : '')} style={{ background: c }} onClick={() => patch({ color: c })} />
            ))}
            <label className="swatch" title="Custom color" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', cursor: 'pointer' }}>
              <input type="color" style={{ opacity: 0, width: 0, height: 0 }} value={typeof fm.color === 'string' ? fm.color : '#ff5f45'} onChange={(e) => patch({ color: e.target.value })} />
            </label>
          </div>
          {thread.dyes.length > 0 && (
            <>
              <div className="label">[ Match a Dye ]</div>
              <div className="swatches" style={{ margin: '8px 0 12px' }}>
                {thread.dyes.map((d) => (
                  <button key={d} className="chip-btn" onClick={() => patch({ color: dyeColor(d) })}>
                    <span className="dye-dot" style={{ background: dyeColor(d) }} /> {d}
                  </button>
                ))}
              </div>
            </>
          )}
          <button className={'chip-btn' + (fm.color ? '' : ' is-on')} onClick={() => patch({ color: undefined })}>
            Follow first Dye{thread.dyes[0] ? ` (${thread.dyes[0]})` : ''}
          </button>
          <p className="muted" style={{ fontSize: 12 }}>The color tints this Thread’s icon, its row in the Spool, its node in the Tapestry and its page.</p>
        </div>
      )}

      {tab === 'background' && (
        <div className="style-pop__section">
          <div className="backdrop-pick" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <button className={!bg ? 'is-on' : ''} onClick={() => patch({ background: undefined })} style={{ display: 'grid', placeItems: 'center' }}>
              <Icon name="close" size={18} />
              <span>App</span>
            </button>
            {(['halftone', 'pixel', 'aurora', 'paper'] as const).map((k) => (
              <button key={k} className={bg?.kind === 'generated' && bg.preset === k ? 'is-on' : ''} onClick={() => patch({ background: k })}>
                <BackdropThumb kind={k} tint={typeof fm.color === 'string' ? fm.color : undefined} />
                <span>{k}</span>
              </button>
            ))}
          </div>
          <div className="label" style={{ margin: '12px 0 8px' }}>
            [ Solid ]
          </div>
          <div className="swatches">
            {PALETTES[palette].colors.map((c) => (
              <button key={c} className={'swatch' + (bg?.kind === 'color' && bg.color === c ? ' is-on' : '')} style={{ background: c }} onClick={() => patch({ background: c })} />
            ))}
            <label className="swatch" title="Custom color" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', cursor: 'pointer' }}>
              <input type="color" style={{ opacity: 0, width: 0, height: 0 }} onChange={(e) => patch({ background: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button
              className="btn"
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'image/*'
                input.onchange = async () => {
                  const f = input.files?.[0]
                  if (!f) return
                  const [p] = await importFiles('attachments', [f])
                  patch({ background: p })
                }
                input.click()
              }}
            >
              <Icon name="upload" size={14} /> Image…
            </button>
            {bg?.kind === 'image' && <span className="mono muted" style={{ fontSize: 11 }}>{bg.path}</span>}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Shown behind this Thread while it’s open. Generated backgrounds are tinted with the Thread’s color.</p>
        </div>
      )}
    </div>,
    document.body,
  )
}
