// The Canvas: one or more documents side by side. Drag a Thread, Cord or PDF
// from the Spool (or a PDF from your computer) onto it to open it beside the
// others; drag a highlighted PDF passage into any open Thread to cross-stitch it.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { ThreadIcon } from '../components/ThreadIcon'
import { ThreadStylePop } from '../components/ThreadStyle'
import { parseIcon, threadColor } from '../core/appearance'
import { DyeBadge } from '../components/DyeBadge'
import { folderNote, isCompact, MAX_PANES, useDyeColor, useStore, type Highlight, type Pane } from '../core/store'
import { basename, dirname, kindOf, stem } from '../core/paths'
import { saveFile } from '../core/platform'
import { ThreadEditor } from '../editor/ThreadEditor'
import { FindBar } from '../editor/FindBar'
import type { Editor } from '@tiptap/core'

const CordView = lazy(() => import('../cord/CordView'))
const PdfReader = lazy(() => import('./PdfReader').then((m) => ({ default: m.PdfReader })))

const isPdf = (p: string) => kindOf(p) === 'pdf'
const draggingDoc = (e: DragEvent) => {
  const types = [...e.dataTransfer.types]
  return types.includes('text/thread-path') || types.includes('Files')
}

export function CanvasView() {
  const active = useStore((s) => s.active)
  const panesState = useStore((s) => s.panes)
  const files = useStore((s) => s.files)
  const thread = useStore((s) => (s.active ? s.threads[s.active] : undefined))
  const threads = useStore((s) => s.threads)
  const stitchingOpen = useStore((s) => s.stitchingOpen)
  const spoolOpen = useStore((s) => s.spoolOpen)
  const pickerOpen = useStore((s) => s.pickerOpen)
  const set = useStore((s) => s.set)
  const open = useStore((s) => s.open)
  const openPane = useStore((s) => s.openPane)
  const setView = useStore((s) => s.setView)
  const createThread = useStore((s) => s.createThread)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [shown, setShown] = useState<string | null>(null)
  const [compact, setCompact] = useState(isCompact())
  const pickerBtn = useRef<HTMLButtonElement>(null)
  const row = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onResize = () => setCompact(isCompact())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Older state (or a Thread set active elsewhere) without panes still shows that Thread.
  const panes: Pane[] = useMemo(
    () => (panesState.length ? panesState : active ? [{ id: 'solo', path: active, nonce: 0 }] : []).filter((p) => files[p.path]),
    [panesState, active, files],
  )
  // Phones show one pane at a time, with tabs.
  const visible = compact ? panes.filter((p) => p.id === (shown && panes.some((x) => x.id === shown) ? shown : panes.find((x) => x.path === active)?.id ?? panes[0]?.id)) : panes
  // Phones: show the focused Thread, or whatever was just opened (a PDF opened
  // beside a Thread comes to the front instead of hiding behind a tab).
  const seen = useRef(new Set<string>())
  useEffect(() => {
    const added = panes.filter((x) => !seen.current.has(x.id))
    panes.forEach((x) => seen.current.add(x.id))
    const fresh = added[added.length - 1]
    if (fresh && seen.current.size > added.length) setShown(fresh.id)
    else {
      const p = panes.find((x) => x.path === active)
      if (p) setShown(p.id)
    }
  }, [active, panes.map((x) => x.id + x.nonce).join('|')])

  const crumbs = useMemo(() => {
    if (!active) return []
    const parts = dirname(active).split('/').filter(Boolean)
    return parts.map((_, i) => {
      const dir = parts.slice(0, i + 1).join('/')
      return { dir, name: basename(dir), note: folderNote(dir, threads) }
    })
  }, [active, threads])

  /** Where a drop at this x lands among the panes (insertion index). */
  const indexAt = (x: number) => {
    const els = row.current ? [...row.current.querySelectorAll<HTMLElement>(':scope > .pane')] : []
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect()
      if (x < r.left + r.width / 2) return i
    }
    return els.length
  }
  const onDragOver = (e: DragEvent) => {
    if (!draggingDoc(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const i = compact ? panes.length : indexAt(e.clientX)
    if (i !== dropAt) setDropAt(i)
  }
  const onDrop = async (e: DragEvent) => {
    if (!draggingDoc(e)) return
    e.preventDefault()
    e.stopPropagation()
    const at = dropAt ?? panes.length
    setDropAt(null)
    const s = useStore.getState()
    const path = e.dataTransfer.getData('text/thread-path')
    if (path) {
      const f = s.files[path]
      const target = f?.kind === 'folder' ? folderNote(path, s.threads) : path
      if (target) openPane(target, { index: at })
      return
    }
    const docs = [...e.dataTransfer.files].filter((f) => /\.(pdf|md|markdown|cord)$/i.test(f.name))
    if (!docs.length) return
    const paths = await s.importFiles('Research', docs)
    paths.forEach((p, i) => openPane(p, { index: at + i, focus: !isPdf(p) }))
  }

  if (!panes.length) {
    return (
      <div className="view">
        {pickerOpen && <OpenBeside anchor={null} onClose={() => set({ pickerOpen: false })} />}
        <div className="canvas-scroll" onDragOver={onDragOver} onDragLeave={() => setDropAt(null)} onDrop={(e) => void onDrop(e)}>
          <div className={'editor-card glow' + (dropAt !== null ? ' is-drop' : '')} style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div className="label">[ Canvas ]</div>
              <h2 style={{ fontSize: 34, fontWeight: 500, margin: '10px 0 8px' }}>
                No Thread on the needle<span style={{ color: 'var(--accent)' }}>.</span>
              </h2>
              <p className="muted">Pick one from the Spool, drag Threads and PDFs here to open them side by side, or start fresh.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn--ink" onClick={() => void createThread('', 'Untitled').then(open)}>
                  <Icon name="plus" size={14} /> New Thread
                </button>
                <button className="btn" onClick={() => set({ pickerOpen: true })}>
                  <Icon name="desk" size={14} /> Open a PDF or Thread
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const total = panes.reduce((n, p) => n + (weights[p.id] ?? 1), 0)
  const startResize = (i: number, e: React.PointerEvent) => {
    e.preventDefault()
    const a = panes[i]
    const b = panes[i + 1]
    const width = row.current?.clientWidth ?? 1
    const wa = weights[a.id] ?? 1
    const wb = weights[b.id] ?? 1
    const x0 = e.clientX
    const move = (ev: PointerEvent) => {
      const d = ((ev.clientX - x0) / width) * total
      const na = Math.max(0.35, Math.min(wa + wb - 0.35, wa + d))
      setWeights((w) => ({ ...w, [a.id]: na, [b.id]: wa + wb - na }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="view">
      <div className="topbar">
        {!spoolOpen && (
          <button className="icon-btn" title="Show the Spool" onClick={() => set({ spoolOpen: true })}>
            <Icon name="panelLeft" size={17} />
          </button>
        )}
        <div className="crumbs">
          {thread ? (
            <>
              {crumbs.map((c) => (
                <span key={c.dir} style={{ display: 'contents' }}>
                  <button onClick={() => c.note && open(c.note)}>{c.name}</button>
                  <Icon name="chevron" size={12} />
                </span>
              ))}
              <b>{thread.name}</b>
              {thread.kind === 'cord' && <span className="cord-badge">Cord</span>}
            </>
          ) : (
            <b>{basename(panes[0].path)}</b>
          )}
        </div>
        <span className="spacer" />
        <div className="toolbar-group">
          <button
            ref={pickerBtn}
            className={'icon-btn' + (pickerOpen ? ' is-on' : '')}
            title="Open a PDF or Thread beside this one (or drag one in from the Spool)"
            disabled={panes.length >= MAX_PANES}
            onClick={() => set({ pickerOpen: !pickerOpen })}
          >
            <Icon name="desk" size={17} />
          </button>
          <button className="icon-btn" title="Find in the Tapestry" onClick={() => setView('tapestry')}>
            <Icon name="tapestry" size={17} />
          </button>
          {thread && active && (
            <button className="icon-btn" title={`Export this ${thread.kind === 'cord' ? 'Cord' : 'Thread as .md'}`} onClick={() => void saveFile(basename(active), thread.raw)}>
              <Icon name="download" size={17} />
            </button>
          )}
          <button
            className={'icon-btn' + (stitchingOpen ? ' is-on' : '')}
            title="Stitching panel (Ctrl+Shift+\)"
            onClick={() => set({ stitchingOpen: !stitchingOpen })}
          >
            <Icon name="panelRight" size={17} />
          </button>
        </div>
      </div>
      {pickerOpen && <OpenBeside anchor={pickerBtn.current} onClose={() => set({ pickerOpen: false })} />}

      {compact && panes.length > 1 && (
        <div className="pane-tabs" role="tablist">
          {panes.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={visible[0]?.id === p.id}
              className={'pane-tab' + (visible[0]?.id === p.id ? ' is-on' : '')}
              onClick={() => {
                setShown(p.id)
                if (!isPdf(p.path)) open(p.path)
              }}
            >
              <PaneGlyph path={p.path} />
              <span>{stem(p.path)}</span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={row}
        className={'workspace' + (panes.length > 1 ? ' is-multi' : '') + (dropAt !== null ? ' is-dropping' : '')}
        onDragOverCapture={onDragOver}
        onDragLeave={(e) => {
          if (!row.current?.contains(e.relatedTarget as Node)) setDropAt(null)
        }}
        onDropCapture={(e) => {
          // Documents dragged from the Spool open as panes; quotes fall through to the editors.
          if (draggingDoc(e)) void onDrop(e)
        }}
      >
        {visible.map((p, i) => (
          <PaneSlot
            key={p.id}
            pane={p}
            multi={panes.length > 1}
            flex={weights[p.id] ?? 1}
            dropBefore={!compact && dropAt === i}
            dropAfter={!compact && dropAt === panes.length && i === visible.length - 1}
            onResize={!compact && i < visible.length - 1 ? (e) => startResize(i, e) : undefined}
          />
        ))}
        {dropAt !== null && (
          <div className="workspace__hint">
            <Icon name="desk" size={15} /> Drop to open {panes.length >= MAX_PANES ? 'here (the oldest pane closes)' : 'beside'}
          </div>
        )}
      </div>
    </div>
  )
}

function PaneGlyph({ path }: { path: string }) {
  const t = useStore((s) => s.threads[path])
  if (t) return <ThreadIcon thread={t} size={14} />
  return <Icon name={isPdf(path) ? 'pdf' : 'file'} size={14} />
}

function PaneSlot({
  pane,
  multi,
  flex,
  dropBefore,
  dropAfter,
  onResize,
}: {
  pane: Pane
  multi: boolean
  flex: number
  dropBefore: boolean
  dropAfter: boolean
  onResize?: (e: React.PointerEvent) => void
}) {
  const active = useStore((s) => s.active)
  const closePane = useStore((s) => s.closePane)
  const open = useStore((s) => s.open)
  const focused = pane.path === active
  return (
    <>
      <section
        className={'pane' + (focused && multi ? ' is-focused' : '') + (dropBefore ? ' drop-before' : '') + (dropAfter ? ' drop-after' : '')}
        style={{ flex: `${flex} 1 0` }}
        onPointerDownCapture={() => !focused && !isPdf(pane.path) && open(pane.path)}
      >
        {multi && (
          <header className="pane__head">
            <PaneGlyph path={pane.path} />
            <b>{stem(pane.path)}</b>
            {isPdf(pane.path) && <span className="pane__kind">PDF</span>}
            <span className="spacer" />
            <button className="icon-btn" title="Close this pane" onClick={() => closePane(pane.id)}>
              <Icon name="close" size={14} />
            </button>
          </header>
        )}
        <Suspense fallback={<div className="pane__loading mono muted">[ UNSPOOLING… ]</div>}>
          {isPdf(pane.path) ? <PdfPane pane={pane} /> : <ThreadPane path={pane.path} />}
        </Suspense>
      </section>
      {onResize && <div className="pane-split" role="separator" aria-orientation="vertical" onPointerDown={onResize} />}
    </>
  )
}

function ThreadPane({ path }: { path: string }) {
  const thread = useStore((s) => s.threads[path])
  const set = useStore((s) => s.set)
  const open = useStore((s) => s.open)
  const createSubThread = useStore((s) => s.createSubThread)
  const dyeColor = useDyeColor()
  const [stylePop, setStylePop] = useState<{ rect: DOMRect; tab: 'icon' | 'color' | 'background' } | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [find, setFind] = useState<null | 'find' | 'replace'>(null)
  if (!thread) return null
  if (thread.kind === 'cord') return <CordView path={path} />

  const hasIcon = !!parseIcon(thread.frontmatter.icon)
  const tint = threadColor(thread.frontmatter, thread.dyes, dyeColor)
  return (
    <div
      className="canvas-scroll"
      onKeyDownCapture={(e) => {
        const k = e.key.toLowerCase()
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'f' || k === 'h')) {
          e.preventDefault()
          setFind(k === 'h' ? 'replace' : 'find')
        }
      }}
    >
      {find && editor && (
        <div className="thread-find">
          <FindBar editor={editor} replace={find === 'replace'} onClose={() => setFind(null)} />
        </div>
      )}
      <article className="editor-card" data-tinted={tint ? '' : undefined} style={tint ? ({ ['--thread-c' as any]: tint } as React.CSSProperties) : undefined}>
        <div className="thread-head">
          {hasIcon && (
            <button className="thread-head__icon" title="Change icon" onClick={(e) => setStylePop({ rect: e.currentTarget.getBoundingClientRect(), tab: 'icon' })}>
              <ThreadIcon thread={thread} size={38} />
            </button>
          )}
          <div className="thread-head__actions">
            {!hasIcon && (
              <button className="chip-btn" onClick={(e) => setStylePop({ rect: e.currentTarget.getBoundingClientRect(), tab: 'icon' })}>
                <Icon name="image" size={12} /> Add icon
              </button>
            )}
            <button className="chip-btn" onClick={(e) => setStylePop({ rect: e.currentTarget.getBoundingClientRect(), tab: 'color' })}>
              <Icon name="dye" size={12} /> Style
            </button>
            <button
              className="chip-btn"
              onClick={async () => {
                const name = prompt('Name the sub-thread', 'Untitled')
                if (name) open(await createSubThread(path, name, { stitch: true }))
              }}
            >
              <Icon name="plus" size={12} /> Sub-thread
            </button>
          </div>
        </div>
        {stylePop && <ThreadStylePop path={path} anchor={stylePop.rect} initialTab={stylePop.tab} onClose={() => setStylePop(null)} />}
        {thread.dyes.length > 0 && (
          <div className="editor-card__dyes">
            {thread.dyes.map((d) => (
              <DyeBadge key={d} dye={d} onClick={() => set({ dyeFilter: d, spoolOpen: true })} />
            ))}
          </div>
        )}
        <ThreadEditor path={path} onEditor={setEditor} />
      </article>
    </div>
  )
}

function PdfPane({ pane }: { pane: Pane }) {
  const s = useStore()
  const rev = useStore((st) => st.highlightRev[pane.path] ?? 0)
  const panes = useStore((st) => st.panes)
  const threads = useStore((st) => st.threads)
  const active = useStore((st) => st.active)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  useEffect(() => {
    void s.highlights(pane.path).then(setHighlights)
  }, [pane.path, rev])
  const targets = panes.filter((p) => threads[p.path]).map((p) => ({ path: p.path, name: threads[p.path].name }))
  const defaultTarget = active && targets.some((t) => t.path === active) ? active : targets[0]?.path ?? null

  return (
    <PdfReader
      path={pane.path}
      page={pane.page ?? 1}
      highlight={pane.highlight}
      nonce={pane.nonce}
      highlights={highlights}
      targets={targets}
      defaultTarget={defaultTarget}
      onHighlight={async (req, target) => {
        const q = { pdf: pane.path, ...req }
        if (target) {
          await s.weaveQuote(q, target)
          return
        }
        // No Thread open beside it: start a notes Thread and open it next to the PDF.
        const stitch = await s.weaveQuote(q, null)
        const name = `Notes on ${stem(pane.path)}`
        const path = await s.createThread('', name, `# ${name}\n\n> ${req.text}\n> ${stitch}\n`, { dyes: ['research'] })
        s.openPane(path)
      }}
      onDelete={(id) => void s.saveHighlights(pane.path, highlights.filter((h) => h.id !== id))}
    />
  )
}

/** "Open beside": PDFs and recent Threads, or import a PDF. */
function OpenBeside({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const files = useStore((s) => s.files)
  const recent = useStore((s) => s.recent)
  const panes = useStore((s) => s.panes)
  const threads = useStore((s) => s.threads)
  const openPane = useStore((s) => s.openPane)
  const importFiles = useStore((s) => s.importFiles)
  const [q, setQ] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const openNow = new Set(panes.map((p) => p.path))
  const match = (p: string) => !q || p.toLowerCase().includes(q.toLowerCase())
  const pdfs = Object.values(files).filter((f) => f.kind === 'pdf' && !openNow.has(f.path) && match(f.path))
  const docs = (q ? Object.keys(threads) : recent).filter((p) => threads[p] && !openNow.has(p) && match(p)).slice(0, 8)
  const r = anchor?.getBoundingClientRect()
  const pick = (p: string) => {
    if (isPdf(p)) useStore.getState().openDesk(p)
    else openPane(p)
    onClose()
  }
  const importPdf = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      const [p] = await importFiles('Research', [f])
      pick(p)
    }
    input.click()
  }
  return createPortal(
    <>
      <div className="scrim-clear" onClick={onClose} />
      <div
        className="pop open-beside"
        style={r ? { top: r.bottom + 8, right: Math.max(8, innerWidth - r.right) } : { top: 80, left: '50%', transform: 'translateX(-50%)' }}
      >
        <input className="input" autoFocus placeholder="Open beside…" value={q} onChange={(e) => setQ(e.target.value)} />
        {pdfs.length > 0 && <div className="label open-beside__label">PDFs</div>}
        {pdfs.map((f) => (
          <button key={f.path} className="open-beside__item" onClick={() => pick(f.path)}>
            <Icon name="pdf" size={15} />
            <span>{basename(f.path)}</span>
            <small>{dirname(f.path)}</small>
          </button>
        ))}
        {docs.length > 0 && <div className="label open-beside__label">{q ? 'Threads' : 'Recent Threads'}</div>}
        {docs.map((p) => (
          <button key={p} className="open-beside__item" onClick={() => pick(p)}>
            <ThreadIcon thread={threads[p]} size={15} />
            <span>{threads[p].name}</span>
            <small>{dirname(p)}</small>
          </button>
        ))}
        <button className="open-beside__item open-beside__import" onClick={importPdf}>
          <Icon name="upload" size={15} />
          <span>Import a PDF…</span>
        </button>
        <p className="muted open-beside__tip">Tip: drag Threads and PDFs from the Spool onto the Canvas.</p>
      </div>
    </>,
    document.body,
  )
}
