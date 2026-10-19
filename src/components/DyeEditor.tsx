// Managing Dyes: rename/recolor/remove a Dye everywhere, or dye one Thread.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { normalizeDye } from '../core/markdown'
import { PALETTES, useSettings } from '../core/settings'
import { useDyeColor, useStore } from '../core/store'
import { Icon } from './Icon'

function Floating({ anchor, onClose, width = 280, children, label }: { anchor: DOMRect | null; onClose: () => void; width?: number; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])
  const w = Math.min(width, innerWidth - 16)
  const left = anchor ? Math.max(8, Math.min(anchor.left, innerWidth - w - 8)) : (innerWidth - w) / 2
  const top = anchor ? Math.max(8, Math.min(anchor.bottom + 6, innerHeight - 360)) : 100
  return createPortal(
    <div className="pop style-pop" ref={ref} style={{ left, top, width: w }} role="dialog" aria-label={label}>
      {children}
    </div>,
    document.body,
  )
}

export function DyeEditor({ dye, anchor, onClose }: { dye: string; anchor: DOMRect | null; onClose: () => void }) {
  const threads = useStore((s) => s.threads)
  const renameDye = useStore((s) => s.renameDye)
  const deleteDye = useStore((s) => s.deleteDye)
  const setDyeColor = useStore((s) => s.setDyeColor)
  const dyeColor = useDyeColor()
  const palette = useSettings((s) => s.palette)
  const [name, setName] = useState(dye)
  const [busy, setBusy] = useState(false)
  const count = useMemo(() => Object.values(threads).filter((t) => t.dyes.includes(dye)).length, [threads, dye])
  const existing = normalizeDye(name) !== dye && Object.values(threads).some((t) => t.dyes.includes(normalizeDye(name)))
  const color = dyeColor(dye)

  const commit = async () => {
    const next = normalizeDye(name)
    if (!next || next === dye) return onClose()
    setBusy(true)
    await renameDye(dye, next)
    setBusy(false)
    onClose()
  }

  return (
    <Floating anchor={anchor} onClose={onClose} label={`Edit Dye ${dye}`}>
      <div className="style-pop__head">
        <span className="dye" style={{ ['--c' as any]: color }}>
          {dye}
        </span>
        <span className="spacer" />
        <span className="mono muted" style={{ fontSize: 11 }}>
          {count} Thread{count === 1 ? '' : 's'}
        </span>
      </div>
      <label className="field" style={{ margin: 0 }}>
        <span className="label">Label</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void commit()} />
          <button className="btn btn--ink" disabled={busy} onClick={() => void commit()}>
            {busy ? '…' : 'Save'}
          </button>
        </div>
      </label>
      {existing && <div className="empty-note">“{normalizeDye(name)}” already exists. Saving merges the two Dyes.</div>}
      <div className="label">Color</div>
      <div className="swatches">
        {PALETTES[palette].colors.map((c) => (
          <button key={c} className={'swatch' + (color === c ? ' is-on' : '')} style={{ background: c }} onClick={() => void setDyeColor(dye, c)} />
        ))}
        <label className="swatch" title="Custom color" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', cursor: 'pointer' }}>
          <input type="color" style={{ opacity: 0, width: 0, height: 0 }} value={color} onChange={(e) => void setDyeColor(dye, e.target.value)} />
        </label>
      </div>
      <button
        className="btn btn--ghost danger"
        style={{ alignSelf: 'flex-start' }}
        onClick={async () => {
          if (!confirm(`Remove the Dye “${dye}” from ${count} Thread${count === 1 ? '' : 's'}? The Threads themselves stay.`)) return
          await deleteDye(dye)
          onClose()
        }}
      >
        <Icon name="trash" size={14} /> Remove Dye everywhere
      </button>
    </Floating>
  )
}

export function DyePicker({ path, anchor, onClose }: { path: string; anchor: DOMRect | null; onClose: () => void }) {
  const threads = useStore((s) => s.threads)
  const toggleDye = useStore((s) => s.toggleDye)
  const dyeColor = useDyeColor()
  const thread = threads[path]
  const [draft, setDraft] = useState('')
  const all = useMemo(() => {
    const s = new Set<string>()
    Object.values(threads).forEach((t) => t.dyes.forEach((d) => s.add(d)))
    return [...s].sort()
  }, [threads])
  if (!thread) return null
  const add = () => {
    const d = normalizeDye(draft)
    setDraft('')
    if (d && !thread.dyes.includes(d)) void toggleDye(path, d)
  }
  return (
    <Floating anchor={anchor} onClose={onClose} label={`Dye ${thread.name}`}>
      <div className="label">[ Dye “{thread.name}” ]</div>
      <div className="dye-list" style={{ padding: 0 }}>
        {all.map((d) => (
          <button
            key={d}
            className={'dye dye--sm' + (thread.dyes.includes(d) ? ' is-on' : '')}
            style={{ ['--c' as any]: dyeColor(d) }}
            onClick={() => void toggleDye(path, d)}
            aria-pressed={thread.dyes.includes(d)}
          >
            {d}
          </button>
        ))}
        {all.length === 0 && <span className="empty-note">No Dyes yet — make the first one below.</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input" placeholder="New Dye…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn btn--ink" onClick={add}>
          <Icon name="plus" size={14} />
        </button>
      </div>
    </Floating>
  )
}
