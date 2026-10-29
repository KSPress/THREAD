// Cords: Threads with a full word processor. A Cord is a `.cord` file — JSON
// holding page setup, header/footer, document style, its Dyes/icon (the same
// keys a Thread keeps in frontmatter) and the rich document itself.
import type { JSONContent } from '@tiptap/core'
import type { Frontmatter } from '../core/markdown'

export type PageSizeId = 'Letter' | 'A4' | 'A5' | 'Legal' | 'Trade'
export type NumberFormat = '1' | 'i' | 'I' | 'a'

export interface CordFile {
  cord: 1
  meta: Frontmatter
  page: {
    size: PageSizeId
    orientation: 'portrait' | 'landscape'
    /** inches */
    margins: { top: number; right: number; bottom: number; left: number }
  }
  /** Header/footer slots. Tokens: {page} {pages} {title} {author} {date} */
  header: { left: string; center: string; right: string }
  footer: { left: string; center: string; right: string }
  numbering: { format: NumberFormat; start: number }
  /** 2 = Word-like defaults (no automatic first-line indent). Older Cords are migrated on open. */
  styleRev?: number
  differentFirst: boolean
  style: {
    font: string
    /** pt */
    size: number
    lineHeight: number
    /** inches */
    firstLineIndent: number
    /** pt after each paragraph */
    paragraphSpacing: number
  }
  doc: JSONContent
}

/** Page sizes in inches (portrait). */
export const PAGE_SIZES: Record<PageSizeId, { w: number; h: number; label: string }> = {
  Letter: { w: 8.5, h: 11, label: 'Letter 8.5 × 11 in' },
  A4: { w: 8.27, h: 11.69, label: 'A4 210 × 297 mm' },
  A5: { w: 5.83, h: 8.27, label: 'A5 148 × 210 mm' },
  Legal: { w: 8.5, h: 14, label: 'Legal 8.5 × 14 in' },
  Trade: { w: 6, h: 9, label: 'Trade 6 × 9 in (book)' },
}

export const FONTS = [
  { id: 'Literata', stack: "'Literata', Georgia, serif" },
  { id: 'Georgia', stack: 'Georgia, serif' },
  { id: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  { id: 'Garamond', stack: "Garamond, 'EB Garamond', Georgia, serif" },
  { id: 'Inter', stack: "'Inter', system-ui, sans-serif" },
  { id: 'Jost', stack: "'Jost', 'Futura', sans-serif" },
  { id: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'Courier New', stack: "'Courier New', 'JetBrains Mono', monospace" },
  { id: 'JetBrains Mono', stack: "'JetBrains Mono', monospace" },
]

export const fontStack = (id: string) => FONTS.find((f) => f.id === id)?.stack ?? `'${id}', serif`

export function newCord(title: string, meta: Frontmatter = {}): CordFile {
  return {
    cord: 1,
    meta: { title, ...meta },
    page: { size: 'Letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { left: '', center: '', right: '{title}' },
    footer: { left: '', center: '{page}', right: '' },
    numbering: { format: '1', start: 1 },
    differentFirst: true,
    // Word's "Normal": no automatic indent, a little space after each paragraph.
    // A manuscript look (indented first lines, no gaps) is one click away in Layout.
    style: { font: 'Literata', size: 12, lineHeight: 1.15, firstLineIndent: 0, paragraphSpacing: 8 },
    styleRev: 2,
    doc: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: title }] },
        { type: 'paragraph' },
      ],
    },
  }
}

export const isCordPath = (path: string) => /\.cord$/i.test(path)

export function parseCord(raw: string): CordFile {
  let data: Partial<CordFile> = {}
  try {
    data = JSON.parse(raw)
  } catch {
    // An unreadable Cord opens empty rather than crashing; the file is untouched until edited.
  }
  const base = newCord(typeof data.meta?.title === 'string' ? data.meta.title : 'Untitled')
  return {
    ...base,
    ...data,
    cord: 1,
    meta: { ...(data.meta ?? {}) },
    page: { ...base.page, ...(data.page ?? {}), margins: { ...base.page.margins, ...(data.page?.margins ?? {}) } },
    header: { ...base.header, ...(data.header ?? {}) },
    footer: { ...base.footer, ...(data.footer ?? {}) },
    numbering: { ...base.numbering, ...(data.numbering ?? {}) },
    style: migrateStyle({ ...base.style, ...(data.style ?? {}) }, data.styleRev),
    styleRev: 2,
    doc: data.doc && data.doc.type === 'doc' ? data.doc : base.doc,
  }
}

/** Cords made before styleRev 2 started with an automatic 0.5in first-line indent
 *  and no paragraph spacing; untouched ones move to the Word-like defaults. */
function migrateStyle(style: CordFile['style'], rev?: number): CordFile['style'] {
  if (rev && rev >= 2) return style
  if (style.firstLineIndent === 0.5 && style.paragraphSpacing === 0 && style.lineHeight === 1.5) return { ...style, firstLineIndent: 0, paragraphSpacing: 8 }
  return style
}

export const serializeCord = (c: CordFile) => JSON.stringify(c, null, 1) + '\n'

export function pageDims(c: CordFile) {
  const s = PAGE_SIZES[c.page.size] ?? PAGE_SIZES.Letter
  return c.page.orientation === 'landscape' ? { w: s.h, h: s.w } : { w: s.w, h: s.h }
}

export function formatNumber(n: number, f: NumberFormat): string {
  if (f === 'a') {
    let s = ''
    for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s
    return s
  }
  if (f === 'i' || f === 'I') {
    const table: [number, string][] = [
      [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
    ]
    let s = ''
    let x = n
    for (const [v, r] of table) while (x >= v) (s += r), (x -= v)
    return f === 'I' ? s.toUpperCase() : s
  }
  return String(n)
}

/** Fill header/footer tokens for one page. */
export function fillTokens(text: string, ctx: { page: number; pages: number; title: string; author: string; format: NumberFormat }) {
  return text
    .replace(/\{page\}/g, formatNumber(ctx.page, ctx.format))
    .replace(/\{pages\}/g, formatNumber(ctx.pages, ctx.format))
    .replace(/\{title\}/g, ctx.title)
    .replace(/\{author\}/g, ctx.author)
    .replace(/\{date\}/g, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))
}

/* ------------------------------------------------------------------ */
/* Markdown rendering: what the vault indexes (Stitches, words, search),*/
/* what the Compiler binds, and the "Markdown" export.                  */
/* ------------------------------------------------------------------ */

export function cordToMarkdown(doc: JSONContent): string {
  const notes: string[] = []
  const inline = (nodes: JSONContent[] = []): string =>
    nodes
      .map((n) => {
        if (n.type === 'text') {
          let t = n.text ?? ''
          const marks = new Set((n.marks ?? []).map((m) => m.type))
          if (marks.has('code')) return '`' + t + '`'
          if (marks.has('bold')) t = `**${t}**`
          if (marks.has('italic')) t = `*${t}*`
          if (marks.has('strike')) t = `~~${t}~~`
          if (marks.has('highlight')) t = `==${t}==`
          const link = n.marks?.find((m) => m.type === 'link')
          if (link) t = `[${t}](${link.attrs?.href ?? ''})`
          return t
        }
        if (n.type === 'stitch') {
          const a = n.attrs ?? {}
          return `[[${a.target}${a.anchor ? '#' + a.anchor : ''}${a.alias ? '|' + a.alias : ''}]]`
        }
        if (n.type === 'footnote') {
          notes.push(String(n.attrs?.text ?? ''))
          return `[^${notes.length}]`
        }
        if (n.type === 'hardBreak') return '  \n'
        if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](${n.attrs?.src ?? ''})`
        return inline(n.content)
      })
      .join('')

  const block = (n: JSONContent, indent = ''): string => {
    switch (n.type) {
      case 'heading':
        return '#'.repeat(n.attrs?.level ?? 1) + ' ' + inline(n.content)
      case 'paragraph':
        return indent + inline(n.content)
      case 'blockquote':
        return (n.content ?? []).map((c) => block(c)).join('\n\n').replace(/^/gm, '> ')
      case 'codeBlock':
        return '```\n' + inline(n.content) + '\n```'
      case 'horizontalRule':
        return '---'
      case 'pageBreak':
        return '<!-- page break -->'
      case 'cordToc': {
        // Contents as a list of the Cord's headings.
        const heads: string[] = []
        const walk = (x: JSONContent) => {
          if (x.type === 'heading') heads.push(`${'  '.repeat(Math.max(0, (x.attrs?.level ?? 1) - 1))}- ${inline(x.content)}`)
          else x.content?.forEach(walk)
        }
        walk(doc)
        return heads.length ? '**Contents**\n\n' + heads.join('\n') : ''
      }
      case 'bulletList':
      case 'orderedList':
        return (n.content ?? [])
          .map((li, i) => {
            const marker = n.type === 'orderedList' ? `${i + 1}. ` : '- '
            const [first, ...rest] = li.content ?? []
            const head = indent + marker + (first ? block(first).trim() : '')
            const tail = rest.map((c) => block(c, indent + '  ')).join('\n')
            return tail ? head + '\n' + tail : head
          })
          .join('\n')
      case 'table': {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inline(p.content)).join(' ').replace(/\|/g, '\\|')))
        if (!rows.length) return ''
        const head = `| ${rows[0].join(' | ')} |`
        const sep = `| ${rows[0].map(() => '---').join(' | ')} |`
        return [head, sep, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n')
      }
      case 'image':
        return `![${n.attrs?.alt ?? ''}](${n.attrs?.src ?? ''})`
      default:
        return inline(n.content)
    }
  }

  const body = (doc.content ?? []).map((n) => block(n)).filter((s) => s !== '').join('\n\n')
  const defs = notes.map((t, i) => `[^${i + 1}]: ${t}`).join('\n')
  return (defs ? `${body}\n\n${defs}` : body) + '\n'
}

/** Rewrite Stitch targets inside a Cord (used when a Thread is renamed). */
export function renameStitchTargets(doc: JSONContent, from: string, to: string): boolean {
  let changed = false
  const walk = (n: JSONContent) => {
    if (n.type === 'stitch' && n.attrs?.target === from) {
      n.attrs = { ...n.attrs, target: to }
      changed = true
    }
    n.content?.forEach(walk)
  }
  walk(doc)
  return changed
}
