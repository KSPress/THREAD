// Cross-stitching: a passage dragged out of a PDF pane and dropped into a
// Thread (or Cord) becomes a quote with its Deep Stitch back to the page.
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { parseStitch } from '../core/markdown'
import { QUOTE_MIME, useStore, type QuoteDrag } from '../core/store'

/** The quote block: the passage, then its Deep Stitch on its own line. */
export function quoteContent(quote: string, stitch: string) {
  const s = parseStitch(stitch.replace(/^\[\[|\]\]$/g, ''))
  return [
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: quote }] },
        { type: 'paragraph', content: [{ type: 'stitch', attrs: { target: s.target, anchor: s.anchor ?? null, alias: s.alias ?? null } }] },
      ],
    },
    { type: 'paragraph' },
  ]
}

export const isQuoteDrag = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes(QUOTE_MIME)

/** Handle a quote drop; returns true when the event was a quote. */
export function dropQuote(editor: Editor | null, view: EditorView, event: DragEvent, path: string) {
  if (!editor || !isQuoteDrag(event)) return false
  event.preventDefault()
  let q: QuoteDrag
  try {
    q = JSON.parse(event.dataTransfer!.getData(QUOTE_MIME))
  } catch {
    return true
  }
  // Insert after the block under the pointer, never inside a word.
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
  const $pos = view.state.doc.resolve(hit?.pos ?? view.state.doc.content.size)
  const at = $pos.depth > 0 ? $pos.after(1) : $pos.pos
  void useStore
    .getState()
    .weaveQuote(q, null)
    .then((stitch) => {
      editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), quoteContent(q.text, stitch)).run()
      useStore.getState().notify(`Cross-stitched · p.${q.page} → ${useStore.getState().threads[path]?.name ?? ''}`)
    })
  return true
}
