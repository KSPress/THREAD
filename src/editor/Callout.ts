// Callouts and toggles, Notion-style, saved as Obsidian callouts so the .md
// stays readable everywhere:
//   > [!tip] Optional title          a callout
//   > [!toggle]- Summary            a toggle, folded ("-") or open ("+")
//   > body lines…
import { mergeAttributes, Node, type MarkdownLexerConfiguration, type MarkdownToken } from '@tiptap/core'

export const CALLOUT_KINDS: { kind: string; icon: string; label: string }[] = [
  { kind: 'note', icon: '📝', label: 'Note' },
  { kind: 'tip', icon: '💡', label: 'Tip' },
  { kind: 'info', icon: 'ℹ️', label: 'Info' },
  { kind: 'warning', icon: '⚠️', label: 'Warning' },
  { kind: 'danger', icon: '🔥', label: 'Danger' },
  { kind: 'success', icon: '✅', label: 'Success' },
  { kind: 'question', icon: '❓', label: 'Question' },
  { kind: 'quote', icon: '❝', label: 'Quote' },
]
const iconOf = (kind: string) => CALLOUT_KINDS.find((k) => k.kind === kind)?.icon ?? '📝'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (kind?: string) => ReturnType
      setToggle: () => ReturnType
    }
  }
}

const HEAD_RE = /^> ?\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)(?:\n|$)((?:>.*(?:\n|$))*)/

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: { default: 'note' },
      title: { default: '' },
      /** '' = always open (a callout), '+' = toggle shown open, '-' = toggle folded. */
      fold: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout]',
        getAttrs: (el) => {
          const e = el as HTMLElement
          return { kind: e.dataset.callout || 'note', title: e.dataset.title ?? '', fold: e.dataset.fold ?? '' }
        },
        contentElement: '.callout__body',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-callout': node.attrs.kind, 'data-title': node.attrs.title, 'data-fold': node.attrs.fold, class: 'callout' }),
      ['div', { class: 'callout__body' }, 0],
    ]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node
      const dom = document.createElement('div')
      const head = document.createElement('div')
      head.className = 'callout__head'
      head.contentEditable = 'false'
      const icon = document.createElement('button')
      icon.className = 'callout__icon'
      icon.type = 'button'
      const title = document.createElement('input')
      title.className = 'callout__title'
      const body = document.createElement('div')
      body.className = 'callout__body'
      head.append(icon, title)
      dom.append(head, body)

      const set = (attrs: Record<string, unknown>) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (pos == null) return
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }))
      }
      const paint = () => {
        const { kind, fold } = current.attrs
        const toggle = kind === 'toggle' || !!fold
        dom.className = 'callout' + (toggle ? ' callout--toggle' : '') + (fold === '-' ? ' is-folded' : '')
        dom.dataset.callout = kind
        icon.textContent = toggle ? '▸' : iconOf(kind)
        icon.title = toggle ? (fold === '-' ? 'Open' : 'Fold') : 'Change the callout type'
        title.placeholder = toggle ? 'Toggle' : CALLOUT_KINDS.find((k) => k.kind === kind)?.label ?? 'Callout'
        if (document.activeElement !== title) title.value = current.attrs.title
        title.disabled = !editor.isEditable
      }
      icon.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const { kind, fold } = current.attrs
        if (kind === 'toggle' || fold) set({ fold: fold === '-' ? '+' : '-' })
        else {
          const i = CALLOUT_KINDS.findIndex((k) => k.kind === kind)
          set({ kind: CALLOUT_KINDS[(i + 1) % CALLOUT_KINDS.length].kind })
        }
      })
      title.addEventListener('input', () => set({ title: title.value }))
      title.addEventListener('keydown', (e) => {
        // Enter (or ↓) goes into the body, like Notion.
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault()
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (pos != null) editor.chain().focus().setTextSelection(pos + 2).run()
          if (current.attrs.fold === '-') set({ fold: '+' })
        }
      })
      paint()
      return {
        dom,
        contentDOM: body,
        update: (n) => {
          if (n.type.name !== 'callout') return false
          current = n
          paint()
          return true
        },
        stopEvent: (e) => head.contains(e.target as globalThis.Node),
        ignoreMutation: (m) => head.contains(m.target),
      }
    }
  },

  addCommands() {
    return {
      setCallout:
        (kind = 'note') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind, title: '', fold: '' }),
      setToggle:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind: 'toggle', title: '', fold: '+' }),
    }
  },

  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: (src: string) => {
      const m = /^> ?\[!/m.exec(src)
      return m ? m.index : -1
    },
    tokenize(src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) {
      const m = HEAD_RE.exec(src)
      if (!m) return undefined
      const inner = m[4]
        .split('\n')
        .map((l) => l.replace(/^> ?/, ''))
        .join('\n')
        .trim()
      return { type: 'callout', raw: m[0], kind: m[1].toLowerCase(), fold: m[2], title: m[3].trim(), tokens: lexer.blockTokens(inner) }
    },
  },

  parseMarkdown(token: any, helpers: any) {
    const content = token.tokens?.length ? helpers.parseChildren(token.tokens) : []
    return {
      type: 'callout',
      attrs: { kind: token.kind, title: token.title, fold: token.fold },
      content: content.length ? content : [{ type: 'paragraph' }],
    }
  },

  renderMarkdown(node: any, helpers: any) {
    const { kind, title, fold } = node.attrs
    const head = `> [!${kind}]${fold ?? ''}${title ? ' ' + title : ''}`
    const body = (node.content ?? [])
      .map((child: any) => helpers.renderChildren([child]))
      .join('\n\n')
      .split('\n')
      .map((l: string) => (l.trim() ? `> ${l}` : '>'))
      .join('\n')
    return body.replace(/^>$/, '').trim() ? `${head}\n${body}` : head
  },
})
