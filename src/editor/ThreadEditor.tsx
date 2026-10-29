// The Canvas editor: TipTap rendering Markdown visually, serializing straight
// back to the literal .md file.
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import { useEffect, useMemo, useRef } from 'react'
import { editorBus, pendingEdits, useStore } from '../core/store'
import { useSettings } from '../core/settings'
import { kindOf, stem } from '../core/paths'
import { parseStitch } from '../core/markdown'
import { editorExtensions } from './extensions'
import { onBeforeReload } from '../core/update'

const SAVE_DELAY = 450

export function ThreadEditor({ path, onEditor }: { path: string; onEditor?: (e: Editor | null) => void }) {
  const body = useStore((s) => s.threads[path]?.body ?? '')
  const revision = useStore((s) => s.revisions[path] ?? 0)
  const spellcheck = useSettings((s) => s.spellcheck)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const extensions = useMemo(() => editorExtensions(), [])

  const flush = (p = path) => {
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
        handleDrop: (_view, event) => {
          const files = [...((event as DragEvent).dataTransfer?.files ?? [])]
          if (!files.length) return false
          event.preventDefault()
          void insertFiles(files)
          return true
        },
      },
      onUpdate: ({ editor }) => {
        pendingEdits.set(path, editor.getMarkdown())
        clearTimeout(timer.current)
        timer.current = setTimeout(() => flush(path), SAVE_DELAY)
      },
    },
    [path],
  )

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

  // Let the Desk stitch quotes into whichever editor is live.
  useEffect(() => {
    if (!editor) return
    onEditor?.(editor)
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
    editorBus.insertStitch = (target) => editor.chain().focus().insertStitch({ target }).run()
    return () => {
      onEditor?.(null)
      editorBus.insertQuote = null
      editorBus.insertStitch = null
    }
  }, [editor])

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
