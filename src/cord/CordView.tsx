// The Cord editor: real pages. One continuous TipTap column is laid over a
// stack of page sheets; the pagination pass pushes blocks onto the page they
// fit on and reserves room at each page's foot for its footnotes. Headers,
// footers and page numbers are drawn on the sheets.
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { editorBus, useStore } from '../core/store'
import { useSettings } from '../core/settings'
import { saveFile } from '../core/platform'
import { kindOf, stem } from '../core/paths'
import { parseStitch } from '../core/markdown'
import { StitchPicker } from '../editor/commands'
import { cordExtensions, pagesKey, spacerDecorations } from './extensions'
import { computeLayout, layoutSignature, PAGE_GAP, pageBox, type Layout } from './layout'
import { cordToMarkdown, fillTokens, fontStack, parseCord, serializeCord, type CordFile } from './model'
import { Ribbon, type ExportKind } from './Ribbon'
import { onBeforeReload } from '../core/update'

const SAVE_DELAY = 500

/** Cords with edits not yet on disk (saved on switch, hide and unload). */
const dirtyCords = new Map<string, () => CordFile>()

export function flushCord(path: string) {
  const take = dirtyCords.get(path)
  if (!take) return
  dirtyCords.delete(path)
  return useStore.getState().saveThread(path, serializeCord(take()))
}

export default function CordView({ path }: { path: string }) {
  const raw = useStore((s) => s.threads[path]?.raw ?? '')
  const name = useStore((s) => s.threads[path]?.name ?? stem(path))
  const revision = useStore((s) => s.revisions[path] ?? 0)
  const spellcheck = useSettings((s) => s.spellcheck)
  const [cord, setCord] = useState<CordFile>(() => parseCord(raw))
  const cordRef = useRef(cord)
  cordRef.current = cord
  const editorRef = useRef<Editor | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const measurer = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const flowRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const sig = useRef('')
  const box = pageBox(cord)
  const [zoom, setZoom] = useState(1)

  const markDirty = useCallback(() => {
    dirtyCords.set(path, () => ({ ...cordRef.current, doc: editorRef.current?.getJSON() ?? cordRef.current.doc }))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flushCord(path), SAVE_DELAY)
  }, [path])

  const relayout = useCallback(() => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed || !mounted(ed)) return
    const l = computeLayout(ed.view, cordRef.current, measurer.current, PAGE_GAP)
    const s = layoutSignature(l) + '|' + l.pages.map((p) => p.notes.map((n) => n.id + n.text).join()).join('/')
    if (s === sig.current) return
    sig.current = s
    setLayout(l)
    const tr = ed.state.tr.setMeta(pagesKey, spacerDecorations(ed.state.doc, l.spacers)).setMeta('addToHistory', false)
    ed.view.dispatch(tr)
  }, [])
  const frame = useRef(0)
  const scheduleLayout = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(relayout)
  }, [relayout])

  const extensions = useMemo(() => [...cordExtensions(), StitchPicker], [])
  const editor = useEditor(
    {
      extensions,
      content: cord.doc,
      immediatelyRender: true,
      editorProps: {
        attributes: { class: 'cord-editor', spellcheck: String(spellcheck) },
        handleClickOn: (_view, _pos, node) => {
          if (node.type.name !== 'footnote') return false
          const el = document.querySelector<HTMLElement>(`[data-note-id="${node.attrs.id}"] .cord-note__text`)
          el?.focus()
          return true
        },
        handleKeyDown: (_view, e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            editorRef.current?.commands.insertPageBreak()
            return true
          }
          return false
        },
        handlePaste: (_view, event) => {
          const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
          if (!files.length) return false
          void insertFiles(files)
          return true
        },
        handleDrop: (_view, event) => {
          const files = [...((event as DragEvent).dataTransfer?.files ?? [])]
          if (!files.length) return false
          event.preventDefault()
          void insertFiles(files)
          return true
        },
      },
      onUpdate: ({ transaction }) => {
        if (transaction.docChanged) markDirty()
        scheduleLayout()
      },
    },
    [path],
  )
  editorRef.current = editor

  async function insertFiles(files: File[]) {
    const s = useStore.getState()
    for (const f of files) {
      const isImage = f.type.startsWith('image/')
      const [p] = await s.importFiles(isImage ? 'attachments' : 'Research', [f])
      if (isImage) editor?.chain().focus().setImage({ src: encodeURI(p), alt: stem(p) }).run()
      else if (kindOf(p) === 'pdf') editor?.chain().focus().insertStitch({ target: p.split('/').pop()! }).run()
    }
  }

  const update = useCallback(
    (patch: Partial<CordFile>) => {
      setCord((c) => {
        const next = { ...c, ...patch }
        cordRef.current = next
        return next
      })
      markDirty()
    },
    [markDirty],
  )

  // Page setup / style changes move every block: lay out again once they render.
  useLayoutEffect(() => {
    sig.current = ''
    scheduleLayout()
  }, [cord.page, cord.style, scheduleLayout, editor])

  // Images loading, fonts arriving, window resizes: anything that changes heights.
  useEffect(() => {
    const flow = flowRef.current
    if (!editor || !flow) return
    const ro = new ResizeObserver(() => scheduleLayout())
    ro.observe(flow)
    void document.fonts?.ready.then(() => scheduleLayout())
    return () => ro.disconnect()
  }, [editor, scheduleLayout])

  // External change (rename rewrite, Stitching panel meta edit, remote sync).
  useEffect(() => {
    if (revision === 0 || !editor) return
    const fresh = parseCord(useStore.getState().threads[path]?.raw ?? '')
    if (dirtyCords.has(path)) {
      // Keep the edits in flight; take only the new metadata.
      update({ meta: fresh.meta })
      return
    }
    setCord(fresh)
    cordRef.current = fresh
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(fresh.doc)) {
      const { from, to } = editor.state.selection
      editor.commands.setContent(fresh.doc, { emitUpdate: false })
      const max = editor.state.doc.content.size
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) })
      scheduleLayout()
    }
  }, [revision])

  // Save on switch / unmount / hide.
  useEffect(() => {
    const onHide = () => void flushCord(path)
    const unregister = onBeforeReload(() => flushCord(path))
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      void flushCord(path)
      unregister()
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [path])

  // The Desk and the sub-thread button stitch into whichever editor is live.
  useEffect(() => {
    if (!editor) return
    editorBus.insertStitch = (target) => editor.chain().focus().insertStitch({ target }).run()
    editorBus.insertQuote = (quote, stitch) => {
      const s = parseStitch(stitch.replace(/^\[\[|\]\]$/g, ''))
      editor
        .chain()
        .focus('end')
        .insertContent([
          {
            type: 'blockquote',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: quote }] },
              { type: 'paragraph', content: [{ type: 'stitch', attrs: { target: s.target, anchor: s.anchor ?? null, alias: s.alias ?? null } }] },
            ],
          },
          { type: 'paragraph' },
        ])
        .run()
    }
    return () => {
      editorBus.insertStitch = null
      editorBus.insertQuote = null
    }
  }, [editor])

  // Fit the page to narrow screens (phones) on open.
  useLayoutEffect(() => {
    const w = scroller.current?.clientWidth ?? 0
    if (w && w < box.w + 48) setZoom(Math.max(0.4, Math.floor(((w - 20) / box.w) * 100) / 100))
  }, [path])

  const setNote = (id: string, text: string) => {
    const ed = editorRef.current
    if (!ed) return
    let at = -1
    ed.state.doc.descendants((n, p) => {
      if (at < 0 && n.type.name === 'footnote' && n.attrs.id === id) at = p
      return at < 0
    })
    if (at < 0) return
    const node = ed.state.doc.nodeAt(at)!
    ed.view.dispatch(ed.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, text }))
  }
  const removeNote = (id: string) => {
    const ed = editorRef.current
    if (!ed) return
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === 'footnote' && n.attrs.id === id) {
        ed.view.dispatch(ed.state.tr.delete(p, p + n.nodeSize))
        return false
      }
      return true
    })
  }
  const jumpToRef = (pos: number) => {
    const ed = editorRef.current
    if (!ed) return
    ed.chain().focus().setNodeSelection(pos).run()
    const el = ed.view.nodeDOM(pos)
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const doExport = async (k: ExportKind) => {
    flushCord(path)
    const c = { ...cordRef.current, doc: editorRef.current?.getJSON() ?? cordRef.current.doc }
    if (k === 'md') {
      const meta = Object.entries(c.meta)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([key, v]) => `${key}: ${Array.isArray(v) ? `[${v.join(', ')}]` : JSON.stringify(v)}`)
      await saveFile(`${name}.md`, (meta.length ? `---\n${meta.join('\n')}\n---\n\n` : '') + cordToMarkdown(c.doc))
    } else if (k === 'docx') {
      const { cordToDocx } = await import('./docx')
      await saveFile(`${name}.docx`, await cordToDocx(c, name))
    } else {
      const { printCord } = await import('./print')
      const stage = document.querySelector<HTMLElement>('.cord-stage')
      if (stage) await printCord(stage, c, layout?.pages.length ?? 1, name)
    }
  }

  const pages = layout?.pages ?? [{ notes: [], notesHeight: 0 }]
  const title = typeof cord.meta.title === 'string' && cord.meta.title ? cord.meta.title : name
  const author = typeof cord.meta.author === 'string' ? cord.meta.author : ''
  const totalH = pages.length * (box.h + PAGE_GAP) - PAGE_GAP
  const total = pages.length + cord.numbering.start - 1
  const cssVars = {
    ['--cord-font' as any]: fontStack(cord.style.font),
    ['--cord-size' as any]: `${cord.style.size}pt`,
    ['--cord-lh' as any]: cord.style.lineHeight,
    ['--cord-indent' as any]: `${cord.style.firstLineIndent}in`,
    ['--cord-pspace' as any]: `${cord.style.paragraphSpacing}pt`,
  } as React.CSSProperties

  const band = (part: 'header' | 'footer', i: number) => {
    if (cord.differentFirst && i === 0) return null
    const slots = cord[part]
    if (!slots.left && !slots.center && !slots.right) return null
    const ctx = { page: i + cord.numbering.start, pages: total, title, author, format: cord.numbering.format }
    const m = part === 'header' ? box.margins.top : box.margins.bottom
    return (
      <div
        className={'cord-band cord-band--' + part}
        style={{ left: box.margins.left, right: box.margins.right, [part === 'header' ? 'top' : 'bottom']: Math.max(12, m / 2 - 9) }}
      >
        <span>{fillTokens(slots.left, ctx)}</span>
        <span>{fillTokens(slots.center, ctx)}</span>
        <span>{fillTokens(slots.right, ctx)}</span>
      </div>
    )
  }

  if (!editor) return null
  return (
    <div className="cord">
      <Ribbon editor={editor} cord={cord} update={update} pages={pages.length} onExport={(k) => void doExport(k)} zoom={zoom} setZoom={setZoom} />
      <div className="cord-scroll" ref={scroller}>
        <div className="cord-zoom" style={{ width: box.w * zoom, height: totalH * zoom }}>
          <div className="cord-stage" style={{ width: box.w, height: totalH, transform: `scale(${zoom})`, ...cssVars }}>
            {pages.map((p, i) => (
              <div key={i} className="cord-sheet" style={{ top: i * (box.h + PAGE_GAP), width: box.w, height: box.h }}>
                {band('header', i)}
                {p.notes.length > 0 && (
                  <div className="cord-notes" style={{ left: box.margins.left, right: box.margins.right, bottom: box.margins.bottom, minHeight: p.notesHeight }}>
                    {p.notes.map((n) => (
                      <div key={n.id} className="cord-note" data-note-id={n.id}>
                        <button className="cord-note__num" title="Back to the reference" onClick={() => jumpToRef(n.pos)}>
                          {n.num}
                        </button>
                        <NoteText
                          text={n.text}
                          onChange={(t) => setNote(n.id, t)}
                          onRemove={() => {
                            removeNote(n.id)
                            jumpToRef(Math.max(0, n.pos - 1))
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {band('footer', i)}
              </div>
            ))}
            <div className="cord-flow" ref={flowRef} style={{ width: box.w, padding: `${box.margins.top}px ${box.margins.right}px 0 ${box.margins.left}px` }}>
              <EditorContent editor={editor} />
            </div>
            <div ref={measurer} className="cord-note cord-note--measure" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  )
}

/** TipTap throws on `view` until EditorContent has mounted it. */
function mounted(ed: Editor) {
  try {
    return !!ed.view.dom.isConnected
  } catch {
    return false
  }
}

/** A footnote's text, edited in place at the foot of its page. */
function NoteText({ text, onChange, onRemove }: { text: string; onChange: (t: string) => void; onRemove: () => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.textContent !== text) el.textContent = text
  }, [text])
  return (
    <span
      ref={ref}
      className="cord-note__text"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      data-placeholder="Footnote text…"
      onInput={(e) => onChange(e.currentTarget.textContent ?? '')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === 'Backspace' && !e.currentTarget.textContent) {
          e.preventDefault()
          onRemove()
        }
      }}
    />
  )
}
