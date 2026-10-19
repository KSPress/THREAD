// The Compiler (Manuscript): binds scattered Threads into a single, clean
// document. UI-only syntax (Dyes, Stitch brackets, Pinboards, table schemas)
// is stripped before typesetting.
import { marked, type Token, type Tokens } from 'marked'
import { parseDeepAnchor, parseStitch, splitFrontmatter } from './markdown'
import { stem } from './paths'
import type { Manuscript, ThreadInfo } from './store'

export function newManuscript(title = 'Untitled Manuscript'): Manuscript {
  return {
    id: `ms${Date.now().toString(36)}`,
    title,
    subtitle: '',
    author: '',
    items: [],
    pageSize: 'A5',
    font: 'serif',
    fontSize: 11,
    chapterBreaks: true,
    pageNumbers: true,
    runningHeader: true,
    keepDeepQuotes: true,
  }
}

/** Remove everything that only makes sense inside Thread. */
export function stripThreadSyntax(md: string, opts: { keepDeepQuotes: boolean }): string {
  let out = splitFrontmatter(md).body
  out = out.replace(/```thread-pinboard[\s\S]*?```[ \t]*\n?/g, '')
  out = out.replace(/<!-- thread-table .*? -->[ \t]*\n/g, '')
  out = out.replace(/<!--[\s\S]*?-->/g, '')
  out = out.replace(/\[\[([^\[\]\n]+?)\]\]/g, (_m, inner: string) => {
    const s = parseStitch(inner.replace(/\\\|/g, '|'))
    const deep = parseDeepAnchor(s.anchor)
    if (s.deep && deep) {
      if (!opts.keepDeepQuotes) return ''
      return `(${s.alias ?? stem(s.target)}, p. ${deep.page})`
    }
    return s.alias ?? stem(s.target)
  })
  out = out.replace(/==([^=\n]+)==/g, '$1')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export interface Section {
  role: 'title' | 'front' | 'chapter' | 'appendix'
  title: string
  markdown: string
  /** Chapter / appendix label, e.g. "Chapter 3" or "Appendix B". */
  label?: string
}

export function buildSections(ms: Manuscript, threads: Record<string, ThreadInfo>): Section[] {
  let chapter = 0
  let appendix = 0
  const out: Section[] = []
  for (const item of ms.items) {
    const t = threads[item.path]
    if (!t) continue
    let md = stripThreadSyntax(t.raw, ms)
    // Lift a leading H1 into the section title so we control heading levels.
    let title = t.title
    const h1 = md.match(/^#\s+(.+)\n?/)
    if (h1) {
      title = h1[1].trim()
      md = md.slice(h1[0].length).trim()
    }
    const label =
      item.role === 'chapter' ? `Chapter ${++chapter}` : item.role === 'appendix' ? `Appendix ${String.fromCharCode(65 + appendix++)}` : undefined
    out.push({ role: item.role, title, markdown: md, label })
  }
  return out
}

export function toMarkdown(ms: Manuscript, sections: Section[]): string {
  const parts: string[] = []
  parts.push(`---\ntitle: ${JSON.stringify(ms.title)}\n${ms.subtitle ? `subtitle: ${JSON.stringify(ms.subtitle)}\n` : ''}${ms.author ? `author: ${JSON.stringify(ms.author)}\n` : ''}---`)
  for (const s of sections) {
    if (s.role === 'title') {
      parts.push(s.markdown)
      continue
    }
    const heading = s.label ? `${s.label}: ${s.title}` : s.title
    parts.push(`# ${heading}\n\n${s.markdown}`)
  }
  return parts.join('\n\n') + '\n'
}

/* ------------------------------------------------------------------ */
/* PDF (pdfmake)                                                       */
/* ------------------------------------------------------------------ */

type PdfNode = any

function inlineToPdf(tokens: Token[] | undefined, style: Record<string, unknown> = {}): PdfNode[] {
  if (!tokens) return []
  const out: PdfNode[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'strong':
        out.push(...inlineToPdf((t as Tokens.Strong).tokens, { ...style, bold: true }))
        break
      case 'em':
        out.push(...inlineToPdf((t as Tokens.Em).tokens, { ...style, italics: true }))
        break
      case 'del':
        out.push(...inlineToPdf((t as Tokens.Del).tokens, { ...style, decoration: 'lineThrough' }))
        break
      case 'codespan':
        out.push({ text: decode((t as Tokens.Codespan).text), ...style, font: 'Roboto', fontSize: 9, background: '#eeeeee' })
        break
      case 'link':
        out.push(...inlineToPdf((t as Tokens.Link).tokens, { ...style, decoration: 'underline' }))
        break
      case 'br':
        out.push({ text: '\n' })
        break
      case 'text':
        if ((t as Tokens.Text).tokens) out.push(...inlineToPdf((t as Tokens.Text).tokens, style))
        else out.push({ text: decode((t as Tokens.Text).text), ...style })
        break
      case 'escape':
        out.push({ text: (t as Tokens.Escape).text, ...style })
        break
      case 'image':
        break
      default:
        if ('text' in t && typeof t.text === 'string') out.push({ text: decode(t.text), ...style })
    }
  }
  return out
}

function blocksToPdf(tokens: Token[]): PdfNode[] {
  const out: PdfNode[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading
        out.push({ text: inlineToPdf(h.tokens), style: `h${Math.min(h.depth + 1, 4)}` })
        break
      }
      case 'paragraph':
        out.push({ text: inlineToPdf((t as Tokens.Paragraph).tokens), style: 'p' })
        break
      case 'blockquote':
        out.push({
          table: { widths: [2, '*'], body: [[{ text: '', fillColor: '#bbbbbb' }, { stack: blocksToPdf((t as Tokens.Blockquote).tokens), style: 'quote' }]] },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: (i: number) => (i ? 10 : 0), paddingRight: () => 0 },
          margin: [0, 2, 0, 10],
        })
        break
      case 'list': {
        const l = t as Tokens.List
        const items = l.items.map((it) => {
          const stack = blocksToPdf(it.tokens)
          if (it.task) stack.unshift({ text: it.checked ? '☑ ' : '☐ ', font: 'Roboto' })
          return stack.length === 1 ? stack[0] : { stack }
        })
        out.push(l.ordered ? { ol: items, style: 'list' } : { ul: items, style: 'list' })
        break
      }
      case 'code':
        out.push({
          table: { widths: ['*'], body: [[{ text: (t as Tokens.Code).text, font: 'Roboto', fontSize: 8.5, preserveLeadingSpaces: true }]] },
          layout: { fillColor: () => '#f2f2f2', hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
          margin: [0, 2, 0, 10],
        })
        break
      case 'hr':
        out.push({ text: '⁂', alignment: 'center', margin: [0, 8, 0, 8], color: '#777777', font: 'Roboto' })
        break
      case 'table': {
        const tb = t as Tokens.Table
        out.push({
          table: {
            headerRows: 1,
            widths: tb.header.map(() => '*'),
            body: [
              tb.header.map((c) => ({ text: inlineToPdf(c.tokens), bold: true })),
              ...tb.rows.map((r) => r.map((c) => ({ text: inlineToPdf(c.tokens) }))),
            ],
          },
          layout: 'lightHorizontalLines',
          fontSize: 9,
          margin: [0, 4, 0, 12],
        })
        break
      }
      case 'text':
        out.push({ text: inlineToPdf((t as Tokens.Text).tokens ?? [t]), style: 'p' })
        break
      default:
        break
    }
  }
  return out
}

const PAGE_SIZES: Record<Manuscript['pageSize'], string> = { A4: 'A4', LETTER: 'LETTER', A5: 'A5', B5: 'B5' }

export async function toPdf(ms: Manuscript, sections: Section[]): Promise<Uint8Array> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts') as Promise<any>,
  ])
  ;(pdfMake as any).addVirtualFileSystem(vfs)
  const serif = ms.font === 'serif'
  if (serif) await registerSerif(pdfMake)

  const content: PdfNode[] = []
  const titleSection = sections.find((s) => s.role === 'title')
  // Title page
  content.push(
    { text: '', margin: [0, 140, 0, 0] },
    { text: ms.title, style: 'bookTitle' },
    ms.subtitle ? { text: ms.subtitle, style: 'bookSubtitle' } : null,
    ms.author ? { text: ms.author, style: 'bookAuthor' } : null,
    ...(titleSection ? blocksToPdf(marked.lexer(titleSection.markdown)).map((n) => ({ ...n, alignment: 'center' })) : []),
  )
  let first = true
  for (const s of sections) {
    if (s.role === 'title') continue
    content.push({
      stack: [
        s.label ? { text: s.label.toUpperCase(), style: 'chapterLabel' } : null,
        { text: s.title, style: 'h1', tocItem: true },
      ].filter(Boolean),
      pageBreak: first || ms.chapterBreaks ? 'before' : undefined,
      headlineLevel: 1,
    })
    first = false
    content.push(...blocksToPdf(marked.lexer(s.markdown)))
  }

  const font = serif ? 'Literata' : 'Roboto'
  const doc = {
    pageSize: PAGE_SIZES[ms.pageSize],
    pageMargins: ms.pageSize === 'A5' ? [54, 64, 54, 64] : [72, 80, 72, 80],
    info: { title: ms.title, author: ms.author, creator: 'THREAD Compiler' },
    content: content.filter(Boolean),
    defaultStyle: { font, fontSize: ms.fontSize, lineHeight: 1.35, color: '#1d1d1d' },
    header: (page: number) =>
      ms.runningHeader && page > 1
        ? { text: ms.title, alignment: 'center', fontSize: 8, color: '#888888', margin: [0, 28, 0, 0], characterSpacing: 1 }
        : null,
    footer: (page: number) =>
      ms.pageNumbers && page > 1 ? { text: String(page - 1), alignment: 'center', fontSize: 9, color: '#666666', margin: [0, 20, 0, 0] } : null,
    styles: {
      bookTitle: { fontSize: 30, bold: true, alignment: 'center', margin: [0, 0, 0, 10] },
      bookSubtitle: { fontSize: 15, italics: true, alignment: 'center', color: '#555555', margin: [0, 0, 0, 30] },
      bookAuthor: { fontSize: 12, alignment: 'center', characterSpacing: 2, margin: [0, 0, 0, 20] },
      chapterLabel: { fontSize: 9, characterSpacing: 3, color: '#ff5f45', margin: [0, 60, 0, 6], font: 'Roboto' },
      h1: { fontSize: 22, bold: true, margin: [0, 0, 0, 24] },
      h2: { fontSize: 15, bold: true, margin: [0, 14, 0, 6] },
      h3: { fontSize: 12.5, bold: true, margin: [0, 10, 0, 4] },
      h4: { fontSize: 11, bold: true, italics: true, margin: [0, 8, 0, 4] },
      p: { margin: [0, 0, 0, 8], alignment: 'justify' },
      quote: { italics: true, color: '#444444' },
      list: { margin: [0, 0, 0, 8] },
    },
  }
  return new Uint8Array(await (pdfMake as any).createPdf(doc).getBuffer())
}

async function registerSerif(pdfMake: any) {
  const urls = await Promise.all([
    import('@fontsource/literata/files/literata-latin-400-normal.woff?url'),
    import('@fontsource/literata/files/literata-latin-700-normal.woff?url'),
    import('@fontsource/literata/files/literata-latin-400-italic.woff?url'),
    import('@fontsource/literata/files/literata-latin-700-italic.woff?url'),
  ])
  const names = ['Literata-Regular.woff', 'Literata-Bold.woff', 'Literata-Italic.woff', 'Literata-BoldItalic.woff']
  const vfs: Record<string, string> = {}
  await Promise.all(
    urls.map(async (u, i) => {
      const buf = new Uint8Array(await (await fetch(u.default)).arrayBuffer())
      let s = ''
      for (let j = 0; j < buf.length; j += 0x8000) s += String.fromCharCode(...buf.subarray(j, j + 0x8000))
      vfs[names[i]] = btoa(s)
    }),
  )
  pdfMake.addVirtualFileSystem(vfs)
  pdfMake.addFonts({
    Literata: { normal: names[0], bold: names[1], italics: names[2], bolditalics: names[3] },
    Roboto: { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf' },
  })
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

export async function toDocx(ms: Manuscript, sections: Section[]): Promise<Uint8Array> {
  const d = await import('docx')
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Footer, Header, PageNumber, Table, TableRow, TableCell, WidthType } = d

  const runs = (tokens: Token[] | undefined, style: { bold?: boolean; italics?: boolean; strike?: boolean } = {}): InstanceType<typeof TextRun>[] => {
    if (!tokens) return []
    const out: InstanceType<typeof TextRun>[] = []
    for (const t of tokens) {
      if (t.type === 'strong') out.push(...runs((t as Tokens.Strong).tokens, { ...style, bold: true }))
      else if (t.type === 'em') out.push(...runs((t as Tokens.Em).tokens, { ...style, italics: true }))
      else if (t.type === 'del') out.push(...runs((t as Tokens.Del).tokens, { ...style, strike: true }))
      else if (t.type === 'link') out.push(...runs((t as Tokens.Link).tokens, style))
      else if (t.type === 'codespan') out.push(new TextRun({ text: decode((t as Tokens.Codespan).text), font: 'Courier New', ...style }))
      else if (t.type === 'br') out.push(new TextRun({ text: '', break: 1 }))
      else if (t.type === 'text' && (t as Tokens.Text).tokens) out.push(...runs((t as Tokens.Text).tokens, style))
      else if ('text' in t && typeof t.text === 'string') out.push(new TextRun({ text: decode(t.text), ...style }))
    }
    return out
  }

  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]

  const blocks = (tokens: Token[], level = 0): (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] => {
    const out: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []
    for (const t of tokens) {
      switch (t.type) {
        case 'heading':
          out.push(new Paragraph({ heading: HEADINGS[Math.min((t as Tokens.Heading).depth, 3)], children: runs((t as Tokens.Heading).tokens) }))
          break
        case 'paragraph':
          out.push(new Paragraph({ children: runs((t as Tokens.Paragraph).tokens), spacing: { after: 160 } }))
          break
        case 'text':
          out.push(new Paragraph({ children: runs((t as Tokens.Text).tokens ?? [t]) }))
          break
        case 'blockquote':
          for (const c of (t as Tokens.Blockquote).tokens) {
            if (c.type !== 'paragraph' && c.type !== 'text') continue
            out.push(
              new Paragraph({
                indent: { left: 720 },
                spacing: { after: 160 },
                children: runs((c as Tokens.Paragraph).tokens ?? [c], { italics: true }),
              }),
            )
          }
          break
        case 'list':
          ;(t as Tokens.List).items.forEach((it, i) => {
            const children = it.tokens.flatMap((c) => (c.type === 'text' || c.type === 'paragraph' ? runs((c as Tokens.Text).tokens ?? [c]) : []))
            const prefix = it.task ? (it.checked ? '☑ ' : '☐ ') : ''
            out.push(
              new Paragraph({
                children: [new TextRun(prefix), ...children],
                ...((t as Tokens.List).ordered ? { numbering: { reference: 'thread-numbers', level } } : { bullet: { level } }),
              }),
            )
            const nested = it.tokens.filter((c) => c.type === 'list')
            if (nested.length) out.push(...blocks(nested, level + 1))
            void i
          })
          break
        case 'code':
          for (const line of (t as Tokens.Code).text.split('\n'))
            out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New', size: 18 })] }))
          break
        case 'hr':
          out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('⁂')] }))
          break
        case 'table': {
          const tb = t as Tokens.Table
          const row = (cells: Tokens.TableCell[], bold = false) =>
            new TableRow({
              children: cells.map(
                (c) => new TableCell({ children: [new Paragraph({ children: runs(c.tokens, { bold }) })] }),
              ),
            })
          out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(tb.header, true), ...tb.rows.map((r) => row(r))] }))
          break
        }
      }
    }
    return out
  }

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ spacing: { before: 3000 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: ms.title, bold: true, size: 56 })] }),
  ]
  if (ms.subtitle) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: ms.subtitle, italics: true, size: 30 })] }))
  if (ms.author) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 }, children: [new TextRun({ text: ms.author, size: 24 })] }))
  const titleSection = sections.find((s) => s.role === 'title')
  if (titleSection) children.push(...blocks(marked.lexer(titleSection.markdown)))

  let first = true
  for (const s of sections) {
    if (s.role === 'title') continue
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        pageBreakBefore: first || ms.chapterBreaks,
        children: [
          ...(s.label ? [new TextRun({ text: s.label.toUpperCase(), size: 18, color: 'FF5F45', break: 0 }), new TextRun({ text: '', break: 1 })] : []),
          new TextRun({ text: s.title }),
        ],
      }),
    )
    first = false
    children.push(...blocks(marked.lexer(s.markdown)))
  }

  const font = ms.font === 'serif' ? 'Georgia' : 'Calibri'
  const doc = new Document({
    creator: 'THREAD Compiler',
    title: ms.title,
    styles: { default: { document: { run: { font, size: ms.fontSize * 2 } } } },
    numbering: {
      config: [
        {
          reference: 'thread-numbers',
          levels: [0, 1, 2].map((level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START })),
        },
      ],
    },
    sections: [
      {
        headers: ms.runningHeader
          ? { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: ms.title, size: 16, color: '888888' })] })] }) }
          : undefined,
        footers: ms.pageNumbers
          ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) }
          : undefined,
        children,
      },
    ],
  })
  const blob = await Packer.toBlob(doc)
  return new Uint8Array(await blob.arrayBuffer())
}

/* ------------------------------------------------------------------ */

/** Lightweight HTML for the in-app paginated preview. */
export function sectionHtml(md: string) {
  return marked.parse(md, { async: false }) as string
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
