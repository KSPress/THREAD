// The Canvas editor: TipTap rendering Markdown visually, serializing straight
// back to the literal .md file.
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import { useEffect, useMemo, useRef } from 'react'
import { editorBus, editors, pendingEdits, renamedTo, useStore } from '../core/store'
import { firstHeading } from '../core/markdown'
import { dropQuote, quoteContent } from './quoteDrop'
import { useSettings } from '../core/settings'
import { kindOf, stem } from '../core/paths'
import { editorExtensions } from './extensions'
import { onBeforeReload } from '../core/update'

const SAVE_DELAY = 450
/** Idle time before a changed title renames the file (the Spool follows the title). */
const TITLE_DELAY = 1200

export function ThreadEditor({ path, onEditor }: { path: string; onEditor?: (e: Editor | null) => void }) {
  const body = useStore((s) => s.threads[path]?.body ?? '')
  const revision = useStore((s) => s.revisions[path] ?? 0)
  const spellcheck = useSettings((s) => s.spellcheck)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const titleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const titleBefore = useRef<string | null>(null)
  const extensions = useMemo(() => editorExtensions(), [])

  // The same editor lives on when its Thread is renamed (by its own title, or in
  // the Spool), so typing is never interrupted; any other path is a new editor.
  const pathRef = useRef(path)
  const ident = useRef(path)
  if (pathRef.current !== path) {
    if (renamedTo.get(pathRef.current) !== path) ident.current = path
    pathRef.current = path
  }

  const flush = (p = pathRef.current) => {
    clearTimeout(timer.current)
    const pending = pendingEdits.get(p)
    if (pending === undefined) return
    pendingEdits.delete(p)
    return useStore.getState().saveBody(p, pending)
  }

  const editor = useEditor(
    {
      extensions,
      content: body,
      contentType: 'markdown',
      immediatelyRender: true,
      editorProps: {
        attributes: { class: 'thread-editor', spellcheck: String(spellcheck) },
        handlePaste: (_view, event) => {
          const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
          if (!files.length) return false
          void insertFiles(files)
          return true
        },
        handleDrop: (view, event) => {
          if (dropQuote(editorRef.current, view, event as DragEvent, path)) return true
          const files = [...((event as DragEvent).dataTransfer?.files ?? [])]
          if (!files.length) return false
          event.preventDefault()
          void insertFiles(files)
          return true
        },
      },
      onUpdate: ({ editor }) => {
        const p = pathRef.current
        if (titleBefore.current === null) titleBefore.current = firstHeading(useStore.getState().threads[p]?.body ?? '') ?? ''
        pendingEdits.set(p, editor.getMarkdown())
        clearTimeout(timer.current)
        timer.current = setTimeout(() => flush(p), SAVE_DELAY)
        clearTimeout(titleTimer.current)
        titleTimer.current = setTimeout(async () => {
          const before = titleBefore.current ?? ''
          titleBefore.current = null
          await flush(pathRef.current)
          await useStore.getState().followTitle(pathRef.current, before)
        }, TITLE_DELAY)
      },
    },
    [ident.current],
  )

  const editorRef = useRef<Editor | null>(null)
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

  // Save on switch / unmount.
  useEffect(() => () => void flush(path), [path])
  useEffect(() => () => clearTimeout(titleTimer.current), [ident.current])
  useEffect(() => {
    const onHide = () => void flush(path)
    const unregister = onBeforeReload(() => flush(path))
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      unregister()
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  })

  // External change (remote merge, rename rewrite, frontmatter edit).
  useEffect(() => {
    if (!editor || revision === 0 || pendingEdits.has(path)) return
    const current = useStore.getState().threads[path]?.body ?? ''
    if (editor.getMarkdown() === current) return
    const { from, to } = editor.state.selection
    editor.commands.setContent(current, { contentType: 'markdown', emitUpdate: false })
    const max = editor.state.doc.content.size
    editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) })
  }, [revision, editor, path])

  // Quotes from PDF panes can target this editor; the focused one also serves the / menu and buttons.
  const isActive = useStore((s) => s.active === path)
  useEffect(() => {
    if (!editor) return
    onEditor?.(editor)
    const insertQuote = (quote: string, stitch: string) => editor.chain().focus('end').insertContent(quoteContent(quote, stitch)).run()
    editors.set(path, { insertQuote })
    return () => {
      onEditor?.(null)
      if (editors.get(path)?.insertQuote === insertQuote) editors.delete(path)
    }
  }, [editor, path])
  useEffect(() => {
    if (!editor || !isActive) return
    const insertQuote = (quote: string, stitch: string) => editor.chain().focus('end').insertContent(quoteContent(quote, stitch)).run()
    const insertStitch = (target: string) => editor.chain().focus().insertStitch({ target }).run()
    editorBus.insertQuote = insertQuote
    editorBus.insertStitch = insertStitch
    return () => {
      if (editorBus.insertQuote === insertQuote) editorBus.insertQuote = null
      if (editorBus.insertStitch === insertStitch) editorBus.insertStitch = null
    }
  }, [editor, isActive])

  if (!editor) return null
  return (
    <>
      <BubbleMenu editor={editor} options={{ placement: 'top' }} shouldShow={({ editor, state }) => !state.selection.empty && !(state.selection instanceof NodeSelection) && editor.isEditable}>
        <div className="bubble">
          <button className={editor.isActive('bold') ? 'is-on' : ''} onClick={() => editor.chain().focus().toggleBold().run()}>
            B
          </button>
          <button className={editor.isActive('italic') ? 'is-on' : ''} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <em>I</em>
          </button>
          <button className={editor.isActive('strike') ? 'is-on' : ''} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <s>S</s>
          </button>
          <button className={editor.isActive('highlight') ? 'is-on' : ''} onClick={() => editor.chain().focus().toggleHighlight().run()}>
            ▮
          </button>
          <button className={editor.isActive('code') ? 'is-on' : ''} onClick={() => editor.chain().focus().toggleCode().run()}>
            {'</>'}
          </button>
          <i />
          <button
            title="Stitch the selection"
            onClick={() => {
              const { from, to } = editor.state.selection
              const text = editor.state.doc.textBetween(from, to, ' ').trim()
              if (text) editor.chain().focus().deleteSelection().insertStitch({ target: text }).run()
            }}
          >
            ⌗
          </button>
          <button
            title="Link"
            onClick={() => {
              const url = prompt('Link to', editor.getAttributes('link').href ?? 'https://')
              if (url === null) return
              if (!url) editor.chain().focus().unsetLink().run()
              else editor.chain().focus().setLink({ href: url }).run()
            }}
          >
            ↗
          </button>
          <button className={editor.isActive('heading', { level: 2 }) ? 'is-on' : ''} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            H2
          </button>
          <button className={editor.isActive('blockquote') ? 'is-on' : ''} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            ❝
          </button>
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </>
  )
}
