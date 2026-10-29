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
import { FindReplace } from '../editor/find'

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

/** Each Cord editor's default first-line indent (inches), kept current by the Cord view. */
export const defaultFirstLine = new WeakMap<object, number>()

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
    const ed = () => this.editor
    const inList = () => ed().isActive('listItem') || ed().isActive('taskItem')
    const block = () => {
      const { $from } = ed().state.selection
      const node = $from.parent
      return BLOCKS.includes(node.type.name) ? node : null
    }
    // What the first line is indented by, whether set on the paragraph or by the document style.
    const firstLineOf = (node: { type: { name: string }; attrs: Record<string, any> }) =>
      node.attrs.firstLine ?? (node.type.name === 'paragraph' ? (defaultFirstLine.get(this.editor) ?? 0) : 0)
    const atLineStart = () => {
      const { selection } = ed().state
      return selection.empty && selection.$from.parentOffset === 0
    }
    return {
      // Word: Tab at the start of a paragraph indents its first line, then the whole
      // paragraph; in the middle of text it types a tab; lists nest; tables move cells.
      Tab: () => {
        if (inList()) return false
        if (ed().isActive('codeBlock')) return ed().commands.insertContent('\t')
        const { $from, $to } = ed().state.selection
        if (!$from.sameParent($to)) return ed().commands.changeIndent(0.5)
        const node = block()
        if (node && atLineStart()) return firstLineOf(node) > 0 ? ed().commands.changeIndent(0.5) : ed().commands.setFirstLine(0.5)
        return ed().commands.insertContent('\t')
      },
      'Shift-Tab': () => {
        if (inList()) return false
        const node = block()
        if (!node) return true
        if ((node.attrs.indent ?? 0) > 0) return ed().commands.changeIndent(-0.5)
        if (firstLineOf(node) > 0) return ed().commands.setFirstLine(0)
        return true
      },
      // Backspace at the very start takes the indent away before joining paragraphs.
      Backspace: () => {
        if (inList() || !atLineStart()) return false
        const node = block()
        if (!node) return false
        if ((node.attrs.indent ?? 0) > 0) return ed().commands.changeIndent(-0.5)
        if (node.attrs.firstLine != null && node.attrs.firstLine > 0) return ed().commands.setFirstLine(0)
        if (node.attrs.firstLine == null && firstLineOf(node) > 0 && ed().state.selection.$from.index(0) > 0) {
          const prev = ed().state.doc.child(ed().state.selection.$from.index(0) - 1)
          // A paragraph right after a heading shows no indent, so there is nothing to take away.
          if (prev.type.name !== 'heading') return ed().commands.setFirstLine(0)
        }
        return false
      },
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
    WordKeys,
    TableOfContents,
    FindReplace,
    Placeholder.configure({ placeholder: 'Start writing…' }),
  ]
}

/* ------------------------------------------------------------------ */
/* Word's keyboard shortcuts                                           */
/* ------------------------------------------------------------------ */

export const FONT_STEPS = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]

/** Each Cord editor's base font size (pt), so grow/shrink starts from what you see. */
export const baseFontSize = new WeakMap<object, number>()

export const WordKeys = Extension.create({
  name: 'cordWordKeys',
  addKeyboardShortcuts() {
    const ed = () => this.editor
    const sizeNow = () => {
      const v = ed().getAttributes('textStyle').fontSize as string | undefined
      return v ? parseFloat(v) : (baseFontSize.get(ed()) ?? 12)
    }
    const step = (dir: 1 | -1, fine = false) => {
      const cur = sizeNow()
      const next = fine ? cur + dir : dir > 0 ? (FONT_STEPS.find((s) => s > cur) ?? cur + 12) : ([...FONT_STEPS].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1))
      return ed().chain().focus().setFontSize(`${next}pt`).run()
    }
    return {
      // Alignment (Word: Ctrl+L / E / R / J).
      'Mod-l': () => ed().commands.setTextAlign('left'),
      'Mod-e': () => ed().commands.setTextAlign('center'),
      'Mod-r': () => ed().commands.setTextAlign('right'),
      'Mod-j': () => ed().commands.setTextAlign('justify'),
      // Font size: Ctrl+Shift+> / < by step, Ctrl+] / [ by a point.
      'Mod-Shift-.': () => step(1),
      'Mod-Shift-,': () => step(-1),
      'Mod-]': () => step(1, true),
      'Mod-[': () => step(-1, true),
      // Line spacing: Ctrl+1 single, Ctrl+5 one-and-a-half, Ctrl+2 double.
      'Mod-1': () => ed().commands.setLineHeight(1),
      'Mod-5': () => ed().commands.setLineHeight(1.5),
      'Mod-2': () => ed().commands.setLineHeight(2),
      // Normal style.
      'Mod-Shift-n': () => ed().chain().focus().setParagraph().run(),
      // Hyperlink.
      'Mod-k': () => {
        const url = prompt('Link to', ed().getAttributes('link').href ?? 'https://')
        if (url === null) return true
        if (!url) return ed().chain().focus().unsetLink().run()
        return ed().chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      },
    }
  },
})

/* ------------------------------------------------------------------ */
/* Table of contents: a live list of the Cord's headings with the page */
/* each one lands on (refreshed after every layout pass).              */
/* ------------------------------------------------------------------ */

/** Each Cord editor's "which page is this position on" (1-based, as numbered). */
export const pageOf = new WeakMap<object, (pos: number) => string>()
export const TOC_EVENT = 'cord-layout'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cordToc: { insertToc: () => ReturnType }
  }
}

export const TableOfContents = Node.create({
  name: 'cordToc',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'div[data-cord-toc]' }]
  },
  renderHTML() {
    return ['div', { 'data-cord-toc': '', class: 'cord-toc' }]
  },
  addCommands() {
    return {
      insertToc:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: this.name }, { type: 'paragraph' }]).run(),
    }
  },
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div')
      dom.className = 'cord-toc'
      dom.contentEditable = 'false'
      const render = () => {
        const find = pageOf.get(editor)
        const items: { level: number; text: string; pos: number }[] = []
        editor.state.doc.descendants((n, pos) => {
          if (n.type.name === 'heading' && n.textContent.trim()) items.push({ level: n.attrs.level, text: n.textContent, pos })
          return n.type.name !== 'heading'
        })
        dom.replaceChildren()
        const title = document.createElement('div')
        title.className = 'cord-toc__title'
        title.textContent = 'Contents'
        dom.append(title)
        if (!items.length) {
          const empty = document.createElement('div')
          empty.className = 'cord-toc__empty'
          empty.textContent = 'Add headings (Home → Style) and they appear here with their page numbers.'
          dom.append(empty)
        }
        for (const it of items) {
          const row = document.createElement('a')
          row.className = `cord-toc__row cord-toc__row--${it.level}`
          const label = document.createElement('span')
          label.textContent = it.text
          const dots = document.createElement('i')
          const page = document.createElement('b')
          page.textContent = find ? find(it.pos) : ''
          row.append(label, dots, page)
          row.addEventListener('mousedown', (e) => {
            e.preventDefault()
            editor.chain().focus().setTextSelection(it.pos + 1).scrollIntoView().run()
          })
          dom.append(row)
        }
      }
      render()
      const onLayout = () => render()
      window.addEventListener(TOC_EVENT, onLayout)
      return {
        dom,
        update: (node) => node.type.name === 'cordToc',
        destroy: () => window.removeEventListener(TOC_EVENT, onLayout),
        ignoreMutation: () => true,
      }
    }
  },
})
