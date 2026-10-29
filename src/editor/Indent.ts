// Tab indents, like a word processor. Lists nest, tables move between cells
// and code blocks get a real tab (those extensions answer first); everywhere
// else Tab inserts an indent and Shift+Tab takes one away. The indent is two
// em spaces: Markdown keeps them (unlike leading spaces, which it would read
// as a code block), so the file shows the indent in any editor.
import { Extension } from '@tiptap/core'

export const INDENT = '  '

export const Indent = Extension.create({
  name: 'threadIndent',
  // Below lists and tables, so nesting and cell navigation win.
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { state, view } = this.editor
        const { selection } = state
        if (this.editor.isActive('codeBlock')) return this.editor.commands.insertContent('\t')
        // A list item that can't nest further: keep focus in the editor.
        if (this.editor.isActive('listItem') || this.editor.isActive('taskItem')) return true
        const { $from, $to } = selection
        if ($from.sameParent($to)) {
          view.dispatch(state.tr.insertText(INDENT, selection.from, selection.to).scrollIntoView())
          return true
        }
        // Several paragraphs selected: indent each one.
        const tr = state.tr
        state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          if (!node.isTextblock) return true
          tr.insertText(INDENT, tr.mapping.map(pos + 1))
          return false
        })
        view.dispatch(tr)
        return true
      },
      'Shift-Tab': () => {
        const { state, view } = this.editor
        const { selection } = state
        if (this.editor.isActive('listItem') || this.editor.isActive('taskItem')) return true
        const tr = state.tr
        const strip = (start: number, text: string, before: number) => {
          // The indent just before the cursor, else the one at the start of the line.
          if (before >= 0 && text.slice(0, before).endsWith(INDENT)) {
            tr.delete(tr.mapping.map(start + before - INDENT.length), tr.mapping.map(start + before))
            return true
          }
          if (text.startsWith(INDENT)) {
            tr.delete(tr.mapping.map(start), tr.mapping.map(start + INDENT.length))
            return true
          }
          return false
        }
        if (selection.$from.sameParent(selection.$to)) {
          const $from = selection.$from
          strip($from.start(), $from.parent.textContent, selection.empty ? $from.parentOffset : -1)
        } else {
          state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
            if (!node.isTextblock) return true
            strip(pos + 1, node.textContent, -1)
            return false
          })
        }
        if (tr.docChanged) view.dispatch(tr)
        return true
      },
    }
  },
})

