// Notion's block handle. Hover a block (or, on touch screens, put the cursor
// in it) and two buttons appear in the margin:
//   +   adds a block below and opens the / menu
//   ⋮⋮  drag to move the block; click for Turn into, Duplicate, Move, Delete
// Keyboard: Ctrl/⌘+Shift+↑/↓ moves a block, Ctrl/⌘+D duplicates it.
import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockOps: {
      moveBlock: (dir: -1 | 1) => ReturnType
      duplicateBlock: () => ReturnType
    }
  }
}

/** The top-level block containing `pos`. */
function blockAt(state: EditorState, pos: number): { pos: number; node: PMNode } | null {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)))
  if ($pos.depth === 0) {
    const node = state.doc.nodeAt(pos)
    return node ? { pos, node } : null
  }
  const start = $pos.before(1)
  return { pos: start, node: state.doc.nodeAt(start)! }
}

function moveBlock(state: EditorState, dispatch: ((tr: any) => void) | undefined, from: number, dir: -1 | 1) {
  const b = blockAt(state, from)
  if (!b) return false
  const $b = state.doc.resolve(b.pos)
  const index = $b.index(0)
  const target = index + dir
  if (target < 0 || target >= state.doc.childCount) return false
  if (dispatch) {
    const other = state.doc.child(target)
    const tr = state.tr
    const offsetInBlock = state.selection.from - b.pos
    if (dir < 0) {
      const otherPos = b.pos - other.nodeSize
      tr.delete(b.pos, b.pos + b.node.nodeSize).insert(otherPos, b.node)
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(otherPos + offsetInBlock, tr.doc.content.size))))
    } else {
      const end = b.pos + b.node.nodeSize
      tr.delete(b.pos, end).insert(b.pos + other.nodeSize, b.node)
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(b.pos + other.nodeSize + offsetInBlock, tr.doc.content.size))))
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

const TURN_INTO: { id: string; label: string; glyph: string; run: (e: Editor) => boolean }[] = [
  { id: 'p', label: 'Text', glyph: '¶', run: (e) => e.chain().focus().clearNodes().run() },
  { id: 'h1', label: 'Heading 1', glyph: 'H1', run: (e) => e.chain().focus().clearNodes().setHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Heading 2', glyph: 'H2', run: (e) => e.chain().focus().clearNodes().setHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Heading 3', glyph: 'H3', run: (e) => e.chain().focus().clearNodes().setHeading({ level: 3 }).run() },
  { id: 'todo', label: 'To-do list', glyph: '☐', run: (e) => e.chain().focus().clearNodes().toggleTaskList().run() },
  { id: 'ul', label: 'Bulleted list', glyph: '•', run: (e) => e.chain().focus().clearNodes().toggleBulletList().run() },
  { id: 'ol', label: 'Numbered list', glyph: '1.', run: (e) => e.chain().focus().clearNodes().toggleOrderedList().run() },
  { id: 'toggle', label: 'Toggle', glyph: '▸', run: (e) => e.chain().focus().clearNodes().setToggle().run() },
  { id: 'callout', label: 'Callout', glyph: '💡', run: (e) => e.chain().focus().clearNodes().setCallout('tip').run() },
  { id: 'quote', label: 'Quote', glyph: '❝', run: (e) => e.chain().focus().clearNodes().setBlockquote().run() },
  { id: 'code', label: 'Code', glyph: '</>', run: (e) => e.chain().focus().clearNodes().setCodeBlock().run() },
]

const key = new PluginKey('threadBlockHandle')

export const BlockHandle = Extension.create({
  name: 'blockOps',

  addCommands() {
    return {
      moveBlock:
        (dir) =>
        ({ state, dispatch }) =>
          moveBlock(state, dispatch, state.selection.from, dir),
      duplicateBlock:
        () =>
        ({ state, dispatch }) => {
          const b = blockAt(state, state.selection.from)
          if (!b) return false
          if (dispatch) {
            const end = b.pos + b.node.nodeSize
            const tr = state.tr.insert(end, b.node.copy(b.node.content))
            tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1)))
            dispatch(tr.scrollIntoView())
          }
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-ArrowUp': () => this.editor.commands.moveBlock(-1),
      'Mod-Shift-ArrowDown': () => this.editor.commands.moveBlock(1),
      'Mod-d': () => this.editor.commands.duplicateBlock(),
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key,
        view(view) {
          return new HandleView(view, editor)
        },
      }),
    ]
  },
})

class HandleView {
  el: HTMLDivElement
  host: HTMLElement | null
  block: { pos: number; node: PMNode } | null = null
  menu: HTMLDivElement | null = null
  hideTimer: ReturnType<typeof setTimeout> | undefined
  touch = typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches

  constructor(
    private view: EditorView,
    private editor: Editor,
  ) {
    this.host = view.dom.parentElement
    if (this.host && getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative'
    const el = document.createElement('div')
    el.className = 'block-handle'
    el.contentEditable = 'false'
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'block-handle__add'
    add.title = 'Add a block below'
    add.textContent = '+'
    const grip = document.createElement('button')
    grip.type = 'button'
    grip.className = 'block-handle__grip'
    grip.title = 'Drag to move · click for options'
    grip.draggable = true
    grip.innerHTML = '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></g></svg>'
    el.append(add, grip)
    this.el = el
    this.host?.appendChild(el)

    add.addEventListener('mousedown', (e) => e.preventDefault())
    add.addEventListener('click', () => this.addBelow())
    grip.addEventListener('mousedown', (e) => e.stopPropagation())
    grip.addEventListener('click', () => this.openMenu())
    grip.addEventListener('dragstart', (e) => this.dragStart(e))
    grip.addEventListener('dragend', () => this.hide())
    el.addEventListener('mouseenter', () => clearTimeout(this.hideTimer))

    this.onMove = this.onMove.bind(this)
    this.onLeave = this.onLeave.bind(this)
    view.dom.addEventListener('mousemove', this.onMove)
    view.dom.addEventListener('mouseleave', this.onLeave)
    view.dom.addEventListener('keydown', () => !this.touch && this.hide())
  }

  update(view: EditorView) {
    this.view = view
    if (!view.editable) return this.hide()
    // Touch screens have no hover: follow the cursor's block instead.
    if (this.touch && view.hasFocus()) this.show(blockAt(view.state, view.state.selection.from))
    else if (this.block) {
      // Keep the handle on the same block after edits elsewhere.
      const node = view.state.doc.nodeAt(this.block.pos)
      if (!node) this.hide()
      else this.place({ pos: this.block.pos, node })
    }
  }

  onMove(e: MouseEvent) {
    if (!this.view.editable || this.menu) return
    clearTimeout(this.hideTimer)
    const box = this.view.dom.getBoundingClientRect()
    const hit = this.view.posAtCoords({ left: Math.max(box.left + 4, Math.min(e.clientX, box.right - 4)), top: e.clientY })
    if (!hit) return
    this.show(blockAt(this.view.state, hit.inside >= 0 ? hit.inside : hit.pos))
  }

  onLeave(e: MouseEvent) {
    if (this.el.contains(e.relatedTarget as Node)) return
    this.hideTimer = setTimeout(() => this.hide(), 260)
  }

  show(b: { pos: number; node: PMNode } | null) {
    if (!b) return this.hide()
    this.block = b
    this.place(b)
  }

  place(b: { pos: number; node: PMNode }) {
    const dom = this.view.nodeDOM(b.pos)
    if (!(dom instanceof HTMLElement) || !this.host) return this.hide()
    const r = dom.getBoundingClientRect()
    const h = this.host.getBoundingClientRect()
    const cs = getComputedStyle(dom)
    const line = parseFloat(cs.lineHeight) || 24
    // Center on the first line of the block (headings are taller).
    const top = r.top - h.top + (parseFloat(cs.paddingTop) || 0) + Math.min(line, r.height) / 2 - 13
    this.el.style.transform = `translate(${r.left - h.left - 50}px, ${top}px)`
    this.el.classList.add('is-visible')
  }

  hide() {
    this.el.classList.remove('is-visible')
    if (!this.menu) this.block = null
  }

  addBelow() {
    const b = this.block
    if (!b) return
    const { state } = this.view
    const empty = b.node.type.name === 'paragraph' && b.node.content.size === 0
    const chain = this.editor.chain().focus()
    if (empty) chain.setTextSelection(b.pos + 1).insertContent('/').run()
    else {
      const at = b.pos + b.node.nodeSize
      chain.insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).insertContent('/').run()
    }
    void state
  }

  dragStart(e: DragEvent) {
    const b = this.block
    if (!b || !e.dataTransfer) return
    const sel = NodeSelection.create(this.view.state.doc, b.pos)
    this.view.dispatch(this.view.state.tr.setSelection(sel))
    const slice = sel.content()
    ;(this.view as any).dragging = { slice, move: true, node: sel }
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', b.node.textContent)
    const dom = this.view.nodeDOM(b.pos)
    if (dom instanceof HTMLElement) e.dataTransfer.setDragImage(dom, 0, 0)
  }

  openMenu() {
    const b = this.block
    if (!b) return
    this.closeMenu()
    // Put the cursor in the block so commands act on it.
    const inside = Math.min(b.pos + 1, this.view.state.doc.content.size)
    this.editor.chain().focus().setTextSelection(inside).run()
    const menu = document.createElement('div')
    menu.className = 'pop block-menu'
    const section = (label: string) => {
      const s = document.createElement('div')
      s.className = 'label block-menu__label'
      s.textContent = label
      menu.append(s)
    }
    const item = (glyph: string, label: string, hint: string, run: () => void, danger = false) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'block-menu__item' + (danger ? ' danger' : '')
      btn.innerHTML = `<i></i><span></span><small></small>`
      btn.querySelector('i')!.textContent = glyph
      btn.querySelector('span')!.textContent = label
      btn.querySelector('small')!.textContent = hint
      btn.addEventListener('mousedown', (e) => e.preventDefault())
      btn.addEventListener('click', () => {
        run()
        this.closeMenu()
      })
      menu.append(btn)
    }
    const mod = /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+'
    item('⧉', 'Duplicate', `${mod}D`, () => this.editor.commands.duplicateBlock())
    item('↑', 'Move up', `${mod}⇧↑`, () => this.editor.commands.moveBlock(-1))
    item('↓', 'Move down', `${mod}⇧↓`, () => this.editor.commands.moveBlock(1))
    item('🗑', 'Delete', 'Del', () => {
      const cur = blockAt(this.view.state, this.view.state.selection.from)
      if (cur) this.view.dispatch(this.view.state.tr.delete(cur.pos, cur.pos + cur.node.nodeSize))
    }, true)
    section('Turn into')
    for (const t of TURN_INTO) item(t.glyph, t.label, '', () => t.run(this.editor))
    document.body.appendChild(menu)
    const g = this.el.getBoundingClientRect()
    const m = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(g.left, innerWidth - m.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(g.bottom + 6, innerHeight - m.height - 8))}px`
    this.menu = menu
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.type === 'mousedown' && menu.contains(e.target as Node)) return
      this.closeMenu()
    }
    setTimeout(() => {
      document.addEventListener('mousedown', close)
      document.addEventListener('keydown', close)
    })
    this.menuCleanup = () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }

  menuCleanup: (() => void) | null = null
  closeMenu() {
    this.menuCleanup?.()
    this.menuCleanup = null
    this.menu?.remove()
    this.menu = null
  }

  destroy() {
    this.closeMenu()
    this.view.dom.removeEventListener('mousemove', this.onMove)
    this.view.dom.removeEventListener('mouseleave', this.onLeave)
    this.el.remove()
  }
}
