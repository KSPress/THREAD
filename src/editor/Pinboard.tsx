// The Pinboard: an infinite 2D canvas for visual worldbuilding, stored as a
// fenced ```thread-pinboard JSON block inside the Thread itself.
import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { useSettings } from '../core/settings'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pinboard: { insertPinboard: () => ReturnType }
  }
}

export interface PinboardScene {
  title?: string
  elements: any[]
  appState?: { viewBackgroundColor?: string }
  files?: Record<string, any>
}

export const EMPTY_SCENE: PinboardScene = { title: 'Pinboard', elements: [], files: {} }

const FENCE_RE = /^```thread-pinboard[^\n]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n|$)/

export function parseScene(data: string | null | undefined): PinboardScene {
  try {
    const s = JSON.parse(data || '{}')
    return { ...EMPTY_SCENE, ...s, elements: Array.isArray(s.elements) ? s.elements : [] }
  } catch {
    return { ...EMPTY_SCENE }
  }
}

export const Pinboard = Node.create({
  name: 'pinboard',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return { data: { default: JSON.stringify(EMPTY_SCENE) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-pinboard]', getAttrs: (el) => ({ data: (el as HTMLElement).dataset.pinboard }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-pinboard': node.attrs.data })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(PinboardView)
  },
  addCommands() {
    return {
      insertPinboard:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { data: JSON.stringify(EMPTY_SCENE) } }),
    }
  },

  markdownTokenizer: {
    name: 'pinboard',
    level: 'block',
    start: (src: string) => src.indexOf('```thread-pinboard'),
    tokenize(src: string) {
      const m = FENCE_RE.exec(src)
      if (!m) return undefined
      return { type: 'pinboard', raw: m[0], data: m[1] }
    },
  },
  parseMarkdown(token: any) {
    return { type: 'pinboard', attrs: { data: token.data } }
  },
  renderMarkdown(node: any) {
    // Compact JSON keeps diffs (and CRDT merges) line-oriented per element.
    const scene = parseScene(node.attrs.data)
    const body = JSON.stringify({ ...scene, elements: scene.elements }, null, 0)
    return '```thread-pinboard\n' + body + '\n```'
  },
})

const PinboardCanvas = lazy(() => import('./PinboardCanvas'))

function PinboardView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const scene = useMemo(() => parseScene(node.attrs.data), [node.attrs.data])
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<string>('')
  const theme = useSettings((s) => s.theme)

  useEffect(() => {
    let cancelled = false
    if (!scene.elements.filter((e) => !e.isDeleted).length) {
      setPreview('')
      return
    }
    void import('@excalidraw/excalidraw').then(async ({ exportToSvg }) => {
      const svg = await exportToSvg({
        elements: scene.elements,
        appState: { exportBackground: false, viewBackgroundColor: 'transparent', exportWithDarkMode: theme === 'dark' },
        files: scene.files ?? {},
        exportPadding: 16,
      })
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      if (!cancelled) setPreview(svg.outerHTML)
    })
    return () => {
      cancelled = true
    }
  }, [scene, theme])

  const count = scene.elements.filter((e) => !e.isDeleted).length

  return (
    <NodeViewWrapper className={'pinboard-block folder-card' + (selected ? ' is-selected' : '')} data-drag-handle="">
      <div className="folder-card__sky" contentEditable={false}>
        <span className="folder-card__kicker">
          Pinboard
          <br />
          Canvas
        </span>
      </div>
      <div className="folder-card__body" contentEditable={false}>
        <div className="folder-card__tab">
          <input
            className="pinboard-block__title"
            value={scene.title ?? 'Pinboard'}
            onChange={(e) => updateAttributes({ data: JSON.stringify({ ...scene, title: e.target.value }) })}
          />
          <span className="muted">Visual worldbuilding</span>
        </div>
        <div className="pinboard-block__preview" onDoubleClick={() => setOpen(true)}>
          {preview ? (
            <div className="pinboard-block__svg" dangerouslySetInnerHTML={{ __html: preview }} />
          ) : (
            <div className="pinboard-block__empty mono">[ EMPTY CANVAS — DOUBLE-CLICK TO PIN ]</div>
          )}
        </div>
        <div className="folder-card__foot">
          <span className="big-num">{String(count).padStart(2, '0')}</span>
          <span className="muted">Pins</span>
          <span className="spacer" />
          <button className="btn btn--ink" onClick={() => setOpen(true)}>
            <Icon name="expand" size={14} /> Open Pinboard
          </button>
        </div>
      </div>
      {open &&
        createPortal(
          <div className="pinboard-overlay">
            <Suspense fallback={<div className="pinboard-overlay__loading mono">[ THREADING CANVAS… ]</div>}>
              <PinboardHost scene={scene} onSave={(s) => updateAttributes({ data: JSON.stringify(s) })} onClose={() => setOpen(false)} />
            </Suspense>
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  )
}

function PinboardHost({ scene, onSave, onClose }: { scene: PinboardScene; onSave: (s: PinboardScene) => void; onClose: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef<PinboardScene>(scene)
  const flush = () => {
    clearTimeout(timer.current)
    onSave(latest.current)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && e.shiftKey && (flush(), onClose())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <>
      <div className="pinboard-overlay__bar">
        <span className="label">[ PINBOARD ]</span>
        <b>{scene.title}</b>
        <span className="spacer" />
        <span className="muted mono">Shift+Esc to close</span>
        <button
          className="btn btn--ink"
          onClick={() => {
            flush()
            onClose()
          }}
        >
          <Icon name="check" size={14} /> Done
        </button>
      </div>
      <PinboardCanvas
        scene={scene}
        onChange={(s) => {
          latest.current = { ...s, title: scene.title }
          clearTimeout(timer.current)
          timer.current = setTimeout(flush, 800)
        }}
      />
    </>
  )
}
