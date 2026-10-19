// Page layout for Cords. The editor is one continuous column laid over a
// stack of page sheets; this pass measures every top-level block and gives the
// first block of each page a top margin so it starts on the page it fits on, leaving room at the
// foot of each page for the footnotes referenced on it.
import type { EditorView } from '@tiptap/pm/view'
import { pageDims, type CordFile } from './model'

export const DPI = 96
export const PAGE_GAP = 32
const NOTE_SEPARATOR = 18

export interface PageNote {
  id: string
  text: string
  /** document position of the reference */
  pos: number
  num: number
}

export interface PageLayout {
  notes: PageNote[]
  /** px reserved at the bottom of the page for its footnotes */
  notesHeight: number
}

export interface Layout {
  spacers: { pos: number; height: number }[]
  pages: PageLayout[]
  /** page box in px */
  w: number
  h: number
  margins: { top: number; right: number; bottom: number; left: number }
}

export function pageBox(cord: CordFile) {
  const { w, h } = pageDims(cord)
  const m = cord.page.margins
  return {
    w: Math.round(w * DPI),
    h: Math.round(h * DPI),
    margins: { top: Math.round(m.top * DPI), right: Math.round(m.right * DPI), bottom: Math.round(m.bottom * DPI), left: Math.round(m.left * DPI) },
  }
}

const noteCache = new Map<string, number>()

function noteHeight(measurer: HTMLElement | null, width: number, num: number, text: string) {
  const key = `${width}|${num}|${text}`
  const hit = noteCache.get(key)
  if (hit !== undefined) return hit
  if (!measurer) return 18
  measurer.style.width = `${width}px`
  measurer.textContent = `${num} ${text || ' '}`
  const h = measurer.offsetHeight + 2
  if (noteCache.size > 2000) noteCache.clear()
  noteCache.set(key, h)
  return h
}

export function computeLayout(view: EditorView, cord: CordFile, measurer: HTMLElement | null, gap = PAGE_GAP): Layout {
  const box = pageBox(cord)
  const contentH = box.h - box.margins.top - box.margins.bottom
  const contentW = box.w - box.margins.left - box.margins.right
  const spacers: Layout['spacers'] = []
  const pages: PageLayout[] = [{ notes: [], notesHeight: 0 }]
  let page = 0
  let used = 0
  let forceNext = false
  let num = 0

  view.state.doc.forEach((node, offset) => {
    const el = view.nodeDOM(offset)
    let h = 0
    if (el instanceof HTMLElement) {
      const cs = getComputedStyle(el)
      // margin-top is the page spacer itself (blocks have none of their own).
      h = el.offsetHeight + (parseFloat(cs.marginBottom) || 0)
    }
    const notes: PageNote[] = []
    node.descendants((child, p) => {
      if (child.type.name === 'footnote') notes.push({ id: String(child.attrs.id), text: String(child.attrs.text ?? ''), pos: offset + 1 + p, num: ++num })
      return true
    })
    const notesH = (list: PageNote[], first: boolean) =>
      list.reduce((s, n) => s + noteHeight(measurer, contentW, n.num, n.text), 0) + (list.length && first ? NOTE_SEPARATOR : 0)

    let extra = notesH(notes, pages[page].notes.length === 0)
    if (forceNext || (used > 0 && used + h + pages[page].notesHeight + extra > contentH)) {
      spacers.push({ pos: offset, height: box.h + gap - used })
      page++
      used = 0
      pages.push({ notes: [], notesHeight: 0 })
      extra = notesH(notes, true)
    }
    forceNext = node.type.name === 'pageBreak'
    used += h
    pages[page].notes.push(...notes)
    pages[page].notesHeight += extra
  })

  return { spacers, pages, ...box }
}

export const layoutSignature = (l: Layout) =>
  l.spacers.map((s) => `${s.pos}:${Math.round(s.height)}`).join(',') + '|' + l.pages.map((p) => `${p.notes.length}:${Math.round(p.notesHeight)}`).join(',') + `|${l.w}x${l.h}`
