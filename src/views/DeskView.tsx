// The Desk: split-screen research. PDF on the left, the active Thread on the right.
import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { editorBus, useStore, type Highlight } from '../core/store'
import { basename, stem } from '../core/paths'
import { deepAnchor, formatStitch } from '../core/markdown'
import { uid } from '../core/table'
import { ThreadEditor } from '../editor/ThreadEditor'
import { PdfReader, type HighlightRequest } from './PdfReader'

type Layout = 'split' | 'left-only' | 'right-only'

export function DeskView() {
  const desk = useStore((s) => s.desk)
  const files = useStore((s) => s.files)
  const active = useStore((s) => s.active)
  const thread = useStore((s) => (s.active ? s.threads[s.active] : undefined))
  const s = useStore()
  const [layout, setLayout] = useState<Layout>('split')
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const pdfs = Object.values(files).filter((f) => f.kind === 'pdf')
  const pdf = desk.pdf && files[desk.pdf] ? desk.pdf : null

  useEffect(() => {
    if (!pdf) return
    void s.highlights(pdf).then(setHighlights)
  }, [pdf])

  const saveHighlights = async (list: Highlight[]) => {
    setHighlights(list)
    await s.saveHighlights(pdf!, list)
  }

  const onHighlight = async (req: HighlightRequest) => {
    if (!pdf) return
    const id = uid('h').slice(0, 9)
    const h: Highlight = { id, page: req.page, rects: req.rects, text: req.text, dye: req.dye, created: Date.now(), thread: active ?? undefined }
    await saveHighlights([...highlights, h])
    const stitch = formatStitch({ target: basename(pdf), anchor: deepAnchor(req.page, id) })
    // Automation: quote + Deep Stitch into the active Thread.
    if (editorBus.insertQuote && active) {
      editorBus.insertQuote(req.text, stitch)
    } else if (active && thread) {
      await s.saveBody(active, `${thread.body.trimEnd()}\n\n> ${req.text}\n> ${stitch}\n`)
    } else {
      const path = await s.createThread('', `Notes on ${stem(pdf)}`, `# Notes on ${stem(pdf)}\n\n> ${req.text}\n> ${stitch}\n`, { dyes: ['research'] })
      s.open(path)
    }
    s.notify(`Deep Stitch woven · p.${req.page}`)
  }

  const importPdf = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      const [p] = await s.importFiles('Research', [f])
      s.openDesk(p)
    }
    input.click()
  }

  return (
    <div className="view">
      <div className="topbar">
        <div className="crumbs">
          <Icon name="desk" size={15} />
          <b>The Desk</b>
        </div>
        <div className="toolbar-group">
          <select
            className="input"
            style={{ height: 30, border: 0, background: 'transparent', minWidth: 160 }}
            value={pdf ?? ''}
            onChange={(e) => s.openDesk(e.target.value || null)}
          >
            <option value="">Choose a PDF…</option>
            {pdfs.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
          <button className="icon-btn" title="Import a PDF into the vault" onClick={importPdf}>
            <Icon name="upload" size={16} />
          </button>
        </div>
        <span className="spacer" />
        <div className="toolbar-group">
          <button className={'icon-btn' + (layout === 'left-only' ? ' is-on' : '')} title="Reader only" onClick={() => setLayout(layout === 'left-only' ? 'split' : 'left-only')}>
            <Icon name="panelRight" size={16} />
          </button>
          <button className={'icon-btn' + (layout === 'split' ? ' is-on' : '')} title="Split" onClick={() => setLayout('split')}>
            <Icon name="desk" size={16} />
          </button>
          <button className={'icon-btn' + (layout === 'right-only' ? ' is-on' : '')} title="Thread only" onClick={() => setLayout(layout === 'right-only' ? 'split' : 'right-only')}>
            <Icon name="panelLeft" size={16} />
          </button>
        </div>
      </div>
      <div className={'desk ' + (layout === 'split' ? '' : layout)}>
        {pdf ? (
          <PdfReader
            path={pdf}
            page={desk.page}
            highlight={desk.highlight}
            nonce={desk.nonce}
            highlights={highlights}
            onHighlight={(r) => void onHighlight(r)}
            onDelete={(id) => void saveHighlights(highlights.filter((h) => h.id !== id))}
          />
        ) : (
          <div className="reader">
            <div className="reader__empty">
              <Icon name="pdf" size={36} />
              <h2 style={{ color: 'var(--cream)', fontWeight: 500 }}>Lay a source on the Desk</h2>
              <p>Open a PDF from your vault, or import one. Highlights become Deep Stitches that reopen at the exact coordinate.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {pdfs.slice(0, 4).map((f) => (
                  <button key={f.path} className="btn" onClick={() => s.openDesk(f.path)}>
                    {basename(f.path)}
                  </button>
                ))}
                <button className="btn btn--accent" onClick={importPdf}>
                  <Icon name="upload" size={14} /> Import PDF
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="desk__note">
          {active && thread ? (
            <div className="canvas-scroll">
              <article className="editor-card">
                <div className="label" style={{ marginBottom: 14 }}>
                  [ Stitching into · {thread.name} ]
                </div>
                <ThreadEditor path={active} />
              </article>
            </div>
          ) : (
            <div className="editor-card" style={{ display: 'grid', placeItems: 'center', textAlign: 'center', minHeight: 0, height: '100%' }}>
              <div>
                <div className="label">[ No active Thread ]</div>
                <p className="muted">Highlights will start a fresh “Notes on …” Thread, or pick one from the Spool.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
