// pdf.js reader with coordinate-level highlights (the research half of the Desk).
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, type Highlight, useDyeColor } from '../core/store'
import { Icon } from '../components/Icon'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type PDFDoc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>

export interface HighlightRequest {
  text: string
  page: number
  rects: Highlight['rects']
  dye: string
}

export function PdfReader({
  path,
  page,
  highlight,
  nonce,
  highlights,
  onHighlight,
  onDelete,
}: {
  path: string
  page: number
  highlight?: string
  nonce: number
  highlights: Highlight[]
  onHighlight: (h: HighlightRequest) => void
  onDelete: (id: string) => void
}) {
  const adapter = useStore((s) => s.adapter)
  const dyeColor = useDyeColor()
  const threads = useStore((s) => s.threads)
  const [doc, setDoc] = useState<PDFDoc | null>(null)
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([])
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(600)
  const [current, setCurrent] = useState(1)
  const [toolbar, setToolbar] = useState<{ x: number; y: number; req: Omit<HighlightRequest, 'dye'> } | null>(null)
  const [flash, setFlash] = useState<string | undefined>()
  const scroller = useRef<HTMLDivElement>(null)

  // Load the document.
  useEffect(() => {
    let cancelled = false
    let loaded: PDFDoc | null = null
    setDoc(null)
    setSizes([])
    setError('')
    ;(async () => {
      try {
        const data = await adapter!.readBinary(path)
        const task = pdfjs.getDocument({
          data,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
        })
        loaded = await task.promise
        const s: { w: number; h: number }[] = []
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 })
          s.push({ w: vp.width, h: vp.height })
        }
        if (cancelled) return
        setSizes(s)
        setDoc(loaded)
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    })()
    return () => {
      cancelled = true
      void loaded?.destroy()
    }
  }, [path, adapter])

  // Fit width.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth - 48)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const baseScale = sizes[0] ? width / sizes[0].w : 1
  const scale = baseScale * zoom

  // Jump to a Deep Stitch coordinate.
  useEffect(() => {
    if (!doc || !scroller.current) return
    const target = scroller.current.querySelector<HTMLElement>(`[data-page="${page}"]`)
    if (!target) return
    const h = highlights.find((x) => x.id === highlight)
    const offset = h ? h.rects[0].y * target.offsetHeight - 120 : -20
    scroller.current.scrollTo({ top: target.offsetTop + offset, behavior: 'smooth' })
    if (highlight) {
      setFlash(highlight)
      const t = setTimeout(() => setFlash(undefined), 3400)
      return () => clearTimeout(t)
    }
  }, [doc, page, highlight, nonce])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const pages = el.querySelectorAll<HTMLElement>('.pdf-page')
    const mid = el.scrollTop + el.clientHeight / 3
    for (const p of pages) {
      if (p.offsetTop + p.offsetHeight > mid) {
        setCurrent(Number(p.dataset.page))
        break
      }
    }
  }

  // Touch devices select by long-press and never send mouseup, so also
  // follow the document selection.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const onSel = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const sel = window.getSelection()
        const node = sel?.anchorNode
        if (node && scroller.current?.contains(node)) onMouseUp()
      }, 350)
    }
    document.addEventListener('selectionchange', onSel)
    return () => {
      clearTimeout(t)
      document.removeEventListener('selectionchange', onSel)
    }
  })

  const onMouseUp = () => {
    const sel = window.getSelection()
    const text = sel?.toString().replace(/\s+/g, ' ').trim()
    if (!sel || !text || sel.rangeCount === 0) {
      setToolbar(null)
      return
    }
    const range = sel.getRangeAt(0)
    const startEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as HTMLElement
    const pageEl = startEl?.closest<HTMLElement>('.pdf-page')
    if (!pageEl) return
    const box = pageEl.getBoundingClientRect()
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1 && r.top >= box.top - 2 && r.bottom <= box.bottom + 2)
      .map((r) => ({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height }))
    if (!rects.length) return
    const last = range.getBoundingClientRect()
    setToolbar({ x: Math.min(last.right, innerWidth - 320), y: last.bottom + 10, req: { text, page: Number(pageEl.dataset.page), rects: mergeRects(rects) } })
  }

  const dyes = useMemo(() => {
    const set = new Set<string>(['quote', 'lore', 'evidence'])
    highlights.forEach((h) => set.add(h.dye))
    Object.values(threads).forEach((t) => t.dyes.forEach((d) => set.add(d)))
    return [...set].slice(0, 8)
  }, [highlights, threads])

  return (
    <div className="reader">
      <div className="reader__bar">
        <Icon name="pdf" size={17} />
        <b style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{path.split('/').pop()}</b>
        <span className="spacer" />
        <span className="mono" style={{ fontSize: 11, color: 'rgba(244,238,211,.6)' }}>
          {current} / {sizes.length || '—'}
        </span>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.4, z / 1.15))}>
          <Icon name="zoomOut" size={16} />
        </button>
        <span className="mono" style={{ fontSize: 11, width: 38, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button className="icon-btn" onClick={() => setZoom((z) => Math.min(3, z * 1.15))}>
          <Icon name="zoomIn" size={16} />
        </button>
      </div>
      <div className="reader__body">
        <div className="reader__pages" ref={scroller} onScroll={onScroll} onMouseUp={onMouseUp}>
          {error && <div className="reader__empty">Could not open this PDF. {error}</div>}
          {!doc && !error && <div className="reader__empty mono">[ UNSPOOLING PDF… ]</div>}
          {doc &&
            sizes.map((s, i) => (
              <PdfPage
                key={i}
                doc={doc}
                index={i + 1}
                width={s.w * scale}
                height={s.h * scale}
                scale={scale}
                root={scroller.current}
                highlights={highlights.filter((h) => h.page === i + 1)}
                color={dyeColor}
                flash={flash}
              />
            ))}
        </div>
        <aside className="reader__side">
          <div className="label" style={{ marginBottom: 10 }}>
            [ Highlights · {highlights.length} ]
          </div>
          {highlights.length === 0 && (
            <p style={{ fontSize: 12, color: 'rgba(244,238,211,.55)' }}>Select text on a page, then pick a Dye to pull it into your Thread as a Deep Stitch.</p>
          )}
          {[...highlights]
            .sort((a, b) => a.page - b.page || a.rects[0].y - b.rects[0].y)
            .map((h) => (
              <div key={h.id} className="hl-item" style={{ ['--c' as any]: dyeColor(h.dye) }}>
                <button
                  style={{ textAlign: 'left', width: '100%' }}
                  onClick={() => useStore.getState().openDesk(path, h.page, h.id)}
                >
                  “{h.text.length > 140 ? h.text.slice(0, 139) + '…' : h.text}”
                </button>
                <small>
                  p.{h.page} · {h.dye} · #{h.id}
                  <button style={{ float: 'right', opacity: 0.7 }} onClick={() => onDelete(h.id)} title="Remove highlight">
                    ×
                  </button>
                </small>
              </div>
            ))}
        </aside>
      </div>
      {toolbar && (
        <div
          className="hl-toolbar"
          style={{ left: Math.max(8, Math.min(toolbar.x - 160, innerWidth - 340)), top: Math.min(toolbar.y, innerHeight - 70) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="label">Dye →</span>
          {dyes.map((d) => (
            <button
              key={d}
              className="dye dye--sm"
              style={{ ['--c' as any]: dyeColor(d) }}
              onClick={() => {
                onHighlight({ ...toolbar.req, dye: d })
                setToolbar(null)
                window.getSelection()?.removeAllRanges()
              }}
            >
              {d}
            </button>
          ))}
          <button className="icon-btn" onClick={() => setToolbar(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function PdfPage({
  doc,
  index,
  width,
  height,
  scale,
  root,
  highlights,
  color,
  flash,
}: {
  doc: PDFDoc
  index: number
  width: number
  height: number
  scale: number
  root: HTMLElement | null
  highlights: Highlight[]
  color: (d: string) => string
  flash?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root, rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let renderTask: { cancel(): void; promise: Promise<void> } | null = null
    let textLayer: pdfjs.TextLayer | null = null
    ;(async () => {
      const page = await doc.getPage(index)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      renderTask = page.render({
        canvas,
        canvasContext: canvas.getContext('2d')!,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      } as any)
      await renderTask.promise.catch(() => {})
      if (cancelled) return
      const container = textRef.current!
      container.replaceChildren()
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport })
      await textLayer.render().catch(() => {})
    })()
    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [visible, doc, index, scale])

  return (
    <div className="pdf-page" data-page={index} ref={ref} style={{ width, height, ['--total-scale-factor' as any]: scale }}>
      <span className="pdf-page__num">{index}</span>
      <canvas ref={canvasRef} />
      {highlights.flatMap((h) =>
        h.rects.map((r, i) => (
          <div
            key={h.id + i}
            className={'pdf-hl' + (flash === h.id ? ' is-flash' : '')}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: color(h.dye) }}
          />
        )),
      )}
      <div className="textLayer" ref={textRef} />
    </div>
  )
}

/** Merge per-span rects on the same line into one bar per line. */
function mergeRects(rects: Highlight['rects']): Highlight['rects'] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const out: Highlight['rects'] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.y - r.y) < r.h * 0.5 && r.x <= last.x + last.w + 0.02) {
      const right = Math.max(last.x + last.w, r.x + r.w)
      last.x = Math.min(last.x, r.x)
      last.w = right - last.x
      last.h = Math.max(last.h, r.h)
    } else out.push({ ...r })
  }
  return out.map((r) => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }))
}
const round = (n: number) => Math.round(n * 10000) / 10000
