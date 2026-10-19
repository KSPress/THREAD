// Stitch: an inline, atomic `[[Target#anchor|alias]]` link. Deep Stitches are
// the same node with a PDF/ePub target and a `page=…&highlight=…` anchor.
import { InputRule, mergeAttributes, Node } from '@tiptap/core'
import { formatStitch, parseDeepAnchor, parseStitch } from '../core/markdown'
import { useStore } from '../core/store'

export interface StitchAttrs {
  target: string
  anchor: string | null
  alias: string | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    stitch: {
      insertStitch: (attrs: { target: string; anchor?: string | null; alias?: string | null }) => ReturnType
    }
  }
}

export function stitchLabel(a: StitchAttrs) {
  if (a.alias) return a.alias
  const deep = parseDeepAnchor(a.anchor ?? undefined)
  const name = a.target.replace(/\.md$/i, '').split('/').pop() ?? a.target
  if (deep) return `${name.replace(/\.(pdf|epub)$/i, '')} · p.${deep.page}`
  return a.anchor ? `${name} › ${a.anchor}` : name
}

export const Stitch = Node.create({
  name: 'stitch',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: { default: '' },
      anchor: { default: null },
      alias: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-stitch]',
        getAttrs: (el) => {
          const e = el as HTMLElement
          return { target: e.dataset.target ?? '', anchor: e.dataset.anchor || null, alias: e.dataset.alias || null }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as StitchAttrs
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-stitch': '',
        'data-target': a.target,
        'data-anchor': a.anchor ?? '',
        'data-alias': a.alias ?? '',
        class: 'stitch',
      }),
      stitchLabel(a),
    ]
  },

  renderText({ node }) {
    return formatStitch(node.attrs as StitchAttrs as any)
  },

  addNodeView() {
    return ({ node }) => {
      const a = node.attrs as StitchAttrs
      const dom = document.createElement('span')
      const deep = !!parseDeepAnchor(a.anchor ?? undefined)
      dom.className = 'stitch' + (deep ? ' stitch--deep' : '')
      dom.dataset.stitch = ''
      dom.title = formatStitch({ target: a.target, anchor: a.anchor ?? undefined, alias: a.alias ?? undefined })
      const glyph = document.createElement('span')
      glyph.className = 'stitch__glyph'
      glyph.textContent = deep ? '❝' : '⌗'
      const label = document.createElement('span')
      label.textContent = stitchLabel(a)
      dom.append(glyph, label)
      const update = () => {
        const resolved = useStore.getState().resolve(a.target)
        dom.classList.toggle('stitch--loose', !resolved)
      }
      update()
      const unsub = useStore.subscribe((s, p) => {
        if (s.files !== p.files) update()
      })
      dom.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        useStore.getState().openStitch(a.target, a.anchor ?? undefined)
      })
      return { dom, destroy: unsub }
    }
  },

  addCommands() {
    return {
      insertStitch:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent([
              { type: this.name, attrs: { target: attrs.target, anchor: attrs.anchor ?? null, alias: attrs.alias ?? null } },
              { type: 'text', text: ' ' },
            ])
            .run(),
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^\[\]\n]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const s = parseStitch(match[1])
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ target: s.target, anchor: s.anchor ?? null, alias: s.alias ?? null }),
          )
        },
      }),
    ]
  },

  markdownTokenizer: {
    name: 'stitch',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize(src: string) {
      const m = /^\[\[([^\[\]\n]+?)\]\]/.exec(src)
      if (!m) return undefined
      return { type: 'stitch', raw: m[0], inner: m[1].replace(/\\\|/g, '|') }
    },
  },

  parseMarkdown(token: any) {
    const s = parseStitch(token.inner)
    return { type: 'stitch', attrs: { target: s.target, anchor: s.anchor ?? null, alias: s.alias ?? null } }
  },

  renderMarkdown(node: any) {
    const a = node.attrs as StitchAttrs
    return formatStitch({ target: a.target, anchor: a.anchor ?? undefined, alias: a.alias ?? undefined })
  },
})
