// Cord → Word. Page size, margins, headers/footers with live page fields,
// real footnotes, alignment, indents and spacing all map to native DOCX.
import type { JSONContent } from '@tiptap/core'
import { formatStitch } from '../core/markdown'
import { pageDims, type CordFile } from './model'

const TWIP = 1440 // per inch
const FONT_FALLBACK: Record<string, string> = { Literata: 'Georgia', Inter: 'Calibri', Jost: 'Century Gothic', 'JetBrains Mono': 'Consolas' }
const docxFont = (id: string) => FONT_FALLBACK[id] ?? id

export async function cordToDocx(cord: CordFile, name: string): Promise<Uint8Array> {
  const d = await import('docx')
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Footer, Header, PageNumber, Table, TableRow, TableCell, WidthType, FootnoteReferenceRun, TabStopType, Tab } = d
  type Block = InstanceType<typeof Paragraph> | InstanceType<typeof Table>
  type Run = InstanceType<typeof TextRun> | InstanceType<typeof FootnoteReferenceRun>

  const footnotes: Record<number, { children: InstanceType<typeof Paragraph>[] }> = {}
  let noteNo = 0
  const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  }
  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]
  const hex = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1) : undefined)

  const runs = (nodes: JSONContent[] = [], extra: Record<string, unknown> = {}): Run[] => {
    const out: Run[] = []
    for (const n of nodes) {
      if (n.type === 'text') {
        const o: Record<string, unknown> = { text: n.text ?? '', ...extra }
        for (const m of n.marks ?? []) {
          if (m.type === 'bold') o.bold = true
          if (m.type === 'italic') o.italics = true
          if (m.type === 'underline') o.underline = {}
          if (m.type === 'strike') o.strike = true
          if (m.type === 'subscript') o.subScript = true
          if (m.type === 'superscript') o.superScript = true
          if (m.type === 'code') o.font = 'Courier New'
          if (m.type === 'highlight') o.shading = { fill: hex(m.attrs?.color) ?? 'FFF3A3' }
          if (m.type === 'textStyle') {
            if (hex(m.attrs?.color)) o.color = hex(m.attrs?.color)
            if (m.attrs?.fontFamily) o.font = docxFont(String(m.attrs.fontFamily).split(',')[0].replace(/['"]/g, '').trim())
            if (m.attrs?.fontSize) o.size = Math.round(parseFloat(m.attrs.fontSize) * 2)
          }
        }
        // Tabs typed in the Cord become real Word tabs.
        const parts = String(o.text).split('\t')
        if (parts.length > 1) {
          delete o.text
          o.children = parts.flatMap((t, i) => (i ? [new Tab(), t] : [t])).filter((c) => c !== '')
        }
        out.push(new TextRun(o as any))
      } else if (n.type === 'hardBreak') out.push(new TextRun({ text: '', break: 1 }))
      else if (n.type === 'stitch') {
        const a = n.attrs ?? {}
        out.push(new TextRun({ text: a.alias || formatStitch({ target: a.target, anchor: a.anchor ?? undefined }).replace(/^\[\[|\]\]$/g, ''), ...extra }))
      } else if (n.type === 'footnote') {
        const id = ++noteNo
        footnotes[id] = { children: [new Paragraph({ children: [new TextRun(String(n.attrs?.text ?? ''))] })] }
        out.push(new FootnoteReferenceRun(id))
      }
    }
    return out
  }

  const paraOpts = (n: JSONContent, first = true) => {
    const a = n.attrs ?? {}
    const firstLine = a.firstLine ?? (n.type === 'paragraph' && first ? cord.style.firstLineIndent : 0)
    return {
      alignment: ALIGN[a.textAlign ?? 'left'],
      indent: { left: Math.round((a.indent ?? 0) * TWIP), firstLine: Math.round(firstLine * TWIP) },
      spacing: {
        before: a.spaceBefore != null ? a.spaceBefore * 20 : undefined,
        after: (a.spaceAfter ?? cord.style.paragraphSpacing) * 20,
        line: Math.round((a.lineHeight ?? cord.style.lineHeight) * 240),
      },
    }
  }

  const blocks = (nodes: JSONContent[] = [], ctx: { level?: number; ordered?: boolean; quote?: boolean } = {}): Block[] => {
    const out: Block[] = []
    let breakNext = false
    for (const n of nodes) {
      const brk = breakNext
      breakNext = false
      switch (n.type) {
        case 'heading': {
          const o = paraOpts(n, false)
          out.push(new Paragraph({ ...o, heading: HEADINGS[Math.min((n.attrs?.level ?? 1) - 1, 3)], pageBreakBefore: brk, children: runs(n.content) }))
          break
        }
        case 'paragraph':
          out.push(
            new Paragraph({
              ...paraOpts(n, !ctx.quote),
              ...(ctx.quote ? { indent: { left: 720 } } : {}),
              pageBreakBefore: brk,
              children: runs(n.content, ctx.quote ? { italics: true } : {}),
            }),
          )
          break
        case 'blockquote':
          out.push(...blocks(n.content, { ...ctx, quote: true }))
          break
        case 'bulletList':
        case 'orderedList':
          for (const item of n.content ?? []) {
            const [head, ...rest] = item.content ?? []
            out.push(
              new Paragraph({
                children: runs(head?.content),
                ...(n.type === 'orderedList' ? { numbering: { reference: 'cord-numbers', level: ctx.level ?? 0 } } : { bullet: { level: ctx.level ?? 0 } }),
              }),
            )
            for (const r of rest) {
              if (r.type === 'bulletList' || r.type === 'orderedList') out.push(...blocks([r], { level: (ctx.level ?? 0) + 1 }))
              else out.push(...blocks([r], ctx))
            }
          }
          break
        case 'codeBlock':
          for (const line of (n.content?.map((c) => c.text ?? '').join('') ?? '').split('\n'))
            out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New', size: 18 })] }))
          break
        case 'horizontalRule':
          out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('⁂')] }))
          break
        case 'pageBreak':
          breakNext = true
          break
        case 'image':
          out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `[${n.attrs?.alt || 'image'}]`, italics: true })] }))
          break
        case 'table':
          out.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: (n.content ?? []).map(
                (row) =>
                  new TableRow({
                    children: (row.content ?? []).map((cell) => new TableCell({ children: blocks(cell.content).filter((b): b is InstanceType<typeof Paragraph> => b instanceof Paragraph) })),
                  }),
              ),
            }),
          )
          break
      }
    }
    return out
  }

  const { w, h } = pageDims(cord)
  const m = cord.page.margins
  const title = typeof cord.meta.title === 'string' && cord.meta.title ? cord.meta.title : name
  const author = typeof cord.meta.author === 'string' ? cord.meta.author : ''
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const contentW = Math.round((w - m.left - m.right) * TWIP)

  // A slot's text with live page fields; tokens other than page/pages are filled now.
  const slotRuns = (text: string) => {
    const filled = text.replace(/\{title\}/g, title).replace(/\{author\}/g, author).replace(/\{date\}/g, date)
    const out: InstanceType<typeof TextRun>[] = []
    for (const part of filled.split(/(\{page\}|\{pages\})/)) {
      if (!part) continue
      if (part === '{page}') out.push(new TextRun({ children: [PageNumber.CURRENT], size: 18 }))
      else if (part === '{pages}') out.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18 }))
      else out.push(new TextRun({ text: part, size: 18 }))
    }
    return out
  }
  const band = (s: CordFile['header']) => {
    if (!s.left && !s.center && !s.right) return undefined
    return [
      new Paragraph({
        tabStops: [
          { type: TabStopType.CENTER, position: Math.round(contentW / 2) },
          { type: TabStopType.RIGHT, position: contentW },
        ],
        children: [...slotRuns(s.left), new TextRun('\t'), ...slotRuns(s.center), new TextRun('\t'), ...slotRuns(s.right)],
      }),
    ]
  }
  const header = band(cord.header)
  const footer = band(cord.footer)
  const FORMATS = { '1': d.NumberFormat.DECIMAL, i: d.NumberFormat.LOWER_ROMAN, I: d.NumberFormat.UPPER_ROMAN, a: d.NumberFormat.LOWER_LETTER } as const

  const children = blocks(cord.doc.content)
  const doc = new Document({
    creator: 'THREAD',
    title,
    styles: {
      default: {
        document: { run: { font: docxFont(cord.style.font), size: Math.round(cord.style.size * 2) } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'cord-numbers',
          levels: [0, 1, 2].map((level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START })),
        },
      ],
    },
    footnotes,
    sections: [
      {
        properties: {
          titlePage: cord.differentFirst,
          page: {
            size: { width: Math.round(w * TWIP), height: Math.round(h * TWIP), orientation: cord.page.orientation === 'landscape' ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT },
            margin: { top: Math.round(m.top * TWIP), right: Math.round(m.right * TWIP), bottom: Math.round(m.bottom * TWIP), left: Math.round(m.left * TWIP) },
            pageNumbers: { start: cord.numbering.start, formatType: FORMATS[cord.numbering.format] },
          },
        },
        headers: header ? { default: new Header({ children: header }), first: new Header({ children: [new Paragraph('')] }) } : undefined,
        footers: footer ? { default: new Footer({ children: footer }), first: new Footer({ children: [new Paragraph('')] }) } : undefined,
        children: children.length ? children : [new Paragraph('')],
      },
    ],
  })
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
}
