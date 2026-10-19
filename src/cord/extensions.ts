// Word-processor extensions used only by Cords.
import { Extension, mergeAttributes, Node, type Extensions } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { Stitch } from '../editor/Stitch'
import { VaultImage } from '../editor/VaultImage'
import { uid } from '../core/table'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cordFootnote: { insertFootnote: (text?: string) => ReturnType }
    cordPageBreak: { insertPageBreak: () => ReturnType }
    cordParagraph: {
      setIndent: (inches: number) => ReturnType
      changeIndent: (deltaInches: number) => ReturnType
      setFirstLine: (inches: number | null) => ReturnType
      setLineHeight: (value: number | null) => ReturnType
      setSpacing: (beforePt: number | null, afterPt: number | null) => ReturnType
    }
  }
}

/* ------------------------------------------------------------------ */
/* Footnotes: an inline marker holding the note's text. Numbering is   */
/* document order (CSS counter in the page, same order in the notes).  */
/* ------------------------------------------------------------------ */

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: null },
      text: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote]', getAttrs: (el) => ({ id: (el as HTMLElement).dataset.id, text: (el as HTMLElement).dataset.text ?? '' }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote': '', 'data-id': node.attrs.id, 'data-text': node.attrs.text, class: 'fn-ref' })]
  },
  addCommands() {
    return {
      insertFootnote:
        (text = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { id: uid('fn'), text } }),
    }
  },
})

/* ------------------------------------------------------------------ */

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'cord-pagebreak' }]
  },
  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: this.name }, { type: 'paragraph' }]).run(),
    }
  },
})

/* ------------------------------------------------------------------ */
/* Paragraph formatting: left indent, first-line indent, line height,  */
/* spacing before/after. Stored as attributes, rendered as styles.     */
/* ------------------------------------------------------------------ */

const BLOCKS = ['paragraph', 'heading']

export const ParagraphFormat = Extension.create({
  name: 'cordParagraph',
  addGlobalAttributes() {
    const attr = (name: string, css: (v: number) => string) => ({
      default: null,
      parseHTML: (el: HTMLElement) => {
        const v = el.dataset[name]
        return v == null ? null : Number(v)
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        const v = attrs[name]
        if (v == null) return {}
        return { [`data-${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`]: String(v), style: css(v as number) }
      },
    })
    return [
      {
        types: BLOCKS,
        attributes: {
          indent: attr('indent', (v) => `margin-left: ${v}in`),
          firstLine: attr('firstLine', (v) => `text-indent: ${v}in`),
          lineHeight: attr('lineHeight', (v) => `line-height: ${v}`),
          spaceBefore: attr('spaceBefore', (v) => `padding-top: ${v}pt`),
          spaceAfter: attr('spaceAfter', (v) => `margin-bottom: ${v}pt`),
        },
      },
    ]
  },
  addCommands() {
    const update =
      (fn: (attrs: Record<string, any>) => Record<string, any>) =>
      ({ tr, state, dispatch }: any) => {
        const { from, to } = state.selection
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (BLOCKS.includes(node.type.name)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...fn(node.attrs) })
        })
        if (dispatch) dispatch(tr)
        return true
      }
    return {
      setIndent: (inches) => update(() => ({ indent: inches || null })),
      changeIndent: (d) => update((a) => ({ indent: Math.max(0, Math.round(((a.indent ?? 0) + d) * 100) / 100) || null })),
      setFirstLine: (inches) => update(() => ({ firstLine: inches })),
      setLineHeight: (v) => update(() => ({ lineHeight: v })),
      setSpacing: (b, a) => update(() => ({ spaceBefore: b, spaceAfter: a })),
    }
  },
  addKeyboardShortcuts() {
    return {
      // Tab indents paragraphs (lists keep their own Tab handling).
      Tab: () => (this.editor.isActive('listItem') ? false : this.editor.commands.changeIndent(0.5)),
      'Shift-Tab': () => (this.editor.isActive('listItem') ? false : this.editor.commands.changeIndent(-0.5)),
    }
  },
})

/* ------------------------------------------------------------------ */
/* Pagination: spacer widgets push whole blocks onto the next page, so */
/* the editor lines up with the page sheets drawn behind it.           */
/* ------------------------------------------------------------------ */

export const pagesKey = new PluginKey<DecorationSet>('cordPages')

export const Pagination = Extension.create({
  name: 'cordPagination',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pagesKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const next = tr.getMeta(pagesKey) as DecorationSet | undefined
            return next ?? old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations: (state) => pagesKey.getState(state),
        },
      }),
    ]
  },
})

/** Push each block that starts a new page down with a top margin. Node
 *  decorations restyle the block in place — no DOM is inserted next to the
 *  caret, so typing across a page boundary never disturbs the selection. */
export function spacerDecorations(doc: import('@tiptap/pm/model').Node, spacers: { pos: number; height: number }[]) {
  const out: Decoration[] = []
  for (const { pos, height } of spacers) {
    const node = doc.nodeAt(pos)
    if (!node) continue
    out.push(Decoration.node(pos, pos + node.nodeSize, { style: `margin-top: ${Math.round(height)}px`, class: 'cord-newpage' }))
  }
  return DecorationSet.create(doc, out)
}

export function cordExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: { openOnClick: false, autolink: true } }),
    TextStyleKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript,
    Superscript,
    Highlight.configure({ multicolor: true }),
    TableKit.configure({ table: { resizable: false } }),
    VaultImage,
    Stitch,
    Footnote,
    PageBreak,
    ParagraphFormat,
    Pagination,
    Placeholder.configure({ placeholder: 'Start writing…' }),
  ]
}
