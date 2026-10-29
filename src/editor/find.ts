// Find & Replace for any editor (Cords and Threads): matches are decorated in
// place, the current one is selected and scrolled to, and replacements are
// ordinary edits (one undo step for "Replace all").
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface FindState {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  matches: { from: number; to: number }[]
  index: number
}

export const findKey = new PluginKey<FindState>('threadFind')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    threadFind: {
      setFind: (opts: Partial<Pick<FindState, 'query' | 'caseSensitive' | 'wholeWord'>>) => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
      replaceCurrent: (text: string) => ReturnType
      replaceAll: (text: string) => ReturnType
      clearFind: () => ReturnType
    }
  }
}

function search(doc: PMNode, query: string, caseSensitive: boolean, wholeWord: boolean) {
  const out: { from: number; to: number }[] = []
  if (!query) return out
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc, caseSensitive ? 'gu' : 'giu')
  // Search each text block as one string so matches can span marks.
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    const map: number[] = []
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + offset + i)
        text += child.text
      } else {
        map.push(-1)
        text += '￼'
      }
    })
    for (const m of text.matchAll(re)) {
      if (!m[0].length) continue
      const from = map[m.index!]
      const last = map[m.index! + m[0].length - 1]
      if (from < 0 || last < 0) continue
      out.push({ from, to: last + 1 })
    }
    return false
  })
  return out
}

const EMPTY: FindState = { query: '', caseSensitive: false, wholeWord: false, matches: [], index: 0 }

export const FindReplace = Extension.create({
  name: 'threadFind',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined
            if (!meta && !tr.docChanged) return prev
            const next = { ...prev, ...(meta ?? {}) }
            if (!next.query) return { ...EMPTY, caseSensitive: next.caseSensitive, wholeWord: next.wholeWord }
            const matches = search(state.doc, next.query, next.caseSensitive, next.wholeWord)
            const index = matches.length ? Math.min(Math.max(0, next.index), matches.length - 1) : 0
            return { ...next, matches, index }
          },
        },
        props: {
          decorations(state) {
            const f = findKey.getState(state)
            if (!f || !f.matches.length) return null
            return DecorationSet.create(
              state.doc,
              f.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === f.index ? 'find-hit is-current' : 'find-hit' })),
            )
          },
        },
      }),
    ]
  },
  addCommands() {
    const go =
      (delta: number) =>
      ({ state, tr, dispatch, view }: any) => {
        const f = findKey.getState(state)
        if (!f || !f.matches.length) return false
        const index = (f.index + delta + f.matches.length) % f.matches.length
        const m = f.matches[index]
        if (dispatch) {
          tr.setMeta(findKey, { index }).setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
          dispatch(tr)
          view?.domAtPos(m.from)?.node?.parentElement?.scrollIntoView?.({ block: 'center' })
        }
        return true
      }
    return {
      setFind:
        (opts) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findKey, { ...opts, index: 0 }))
          return true
        },
      findNext: () => go(1),
      findPrev: () => go(-1),
      replaceCurrent:
        (text) =>
        ({ state, tr, dispatch }) => {
          const f = findKey.getState(state)
          if (!f || !f.matches.length) return false
          const m = f.matches[f.index]
          if (dispatch) {
            tr.insertText(text, m.from, m.to).setMeta(findKey, { index: f.index })
            dispatch(tr)
          }
          return true
        },
      replaceAll:
        (text) =>
        ({ state, tr, dispatch }) => {
          const f = findKey.getState(state)
          if (!f || !f.matches.length) return false
          if (dispatch) {
            // Back to front, so earlier positions stay valid.
            for (const m of [...f.matches].reverse()) tr.insertText(text, m.from, m.to)
            dispatch(tr.setMeta(findKey, { index: 0 }))
          }
          return true
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findKey, { query: '' }))
          return true
        },
    }
  },
})
