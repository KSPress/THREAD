// A small sample world so every part of THREAD has something to show.
import type { VaultAdapter } from './vault'
import { serializeTable, uid, type TableData } from './table'

const P = 'The Ashen Reach'

function table(): string {
  const cols = [
    { id: 'c1', name: 'Place', type: 'text' as const },
    { id: 'c2', name: 'Dye', type: 'select' as const },
    { id: 'c3', name: 'Population', type: 'number' as const },
    { id: 'c4', name: 'Stitched to', type: 'link' as const },
    { id: 'c5', name: 'Visited', type: 'checkbox' as const },
  ]
  const rows: [string, string, string, string, string][] = [
    ['Emberfall', 'place', '42000', '[[Emberfall]], [[Aria Venn]]', '[x]'],
    ['Varrow', 'place', '9100', '[[Varrow]], [[Bren Hollow]]', '[x]'],
    ['The Cinder Steps', 'danger', '0', '[[The Ash Compact]]', '[ ]'],
    ['Glass Hollow', 'mystery', '320', '', '[ ]'],
  ]
  const data: TableData = {
    columns: cols,
    rows: rows.map((r) => ({ id: uid(), cells: Object.fromEntries(cols.map((c, i) => [c.id, r[i]])) })),
  }
  return serializeTable(data)
}

async function pinboard(): Promise<string> {
  try {
    const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw')
    const elements = convertToExcalidrawElements([
      { type: 'rectangle', x: 0, y: 0, width: 200, height: 90, backgroundColor: '#ffc9b9', fillStyle: 'solid', label: { text: 'Emberfall' }, id: 'pb-ember' } as any,
      { type: 'rectangle', x: 380, y: 30, width: 180, height: 80, backgroundColor: '#b2f2bb', fillStyle: 'solid', label: { text: 'Varrow' }, id: 'pb-varrow' } as any,
      { type: 'ellipse', x: 170, y: 220, width: 220, height: 110, backgroundColor: '#e9ecef', fillStyle: 'hachure', label: { text: 'The Cinder Steps' }, id: 'pb-steps' } as any,
      { type: 'arrow', x: 205, y: 45, width: 170, height: 20, start: { id: 'pb-ember' }, end: { id: 'pb-varrow' }, label: { text: 'ash trade' } } as any,
      { type: 'arrow', x: 100, y: 95, width: 120, height: 120, start: { id: 'pb-ember' }, end: { id: 'pb-steps' } } as any,
      { type: 'text', x: 0, y: -60, text: 'The Reach — rough map', fontSize: 24 } as any,
    ])
    // Text was measured before the hand-drawn font loaded; give it room.
    for (const el of elements as any[]) {
      if (el.type !== 'text') continue
      const w = el.text.length * el.fontSize * 0.62
      if (el.containerId) {
        el.x -= (w - el.width) / 2
      }
      el.width = Math.max(el.width, w)
    }
    return JSON.stringify({ title: 'Map of the Reach', elements, files: {} })
  } catch {
    return JSON.stringify({ title: 'Map of the Reach', elements: [], files: {} })
  }
}

async function samplePdf(): Promise<Uint8Array | null> {
  try {
    const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts') as Promise<any>,
    ])
    ;(pdfMake as any).addVirtualFileSystem(vfs)
    const para = (t: string) => ({ text: t, margin: [0, 0, 0, 10], alignment: 'justify', lineHeight: 1.35 })
    const doc = {
      pageSize: 'A5',
      pageMargins: [48, 56, 48, 56],
      content: [
        { text: 'FIELD NOTES ON ASH', fontSize: 9, characterSpacing: 3, color: '#ff5f45', margin: [0, 40, 0, 6] },
        { text: 'Observations from the Cinder Steps', fontSize: 20, bold: true, margin: [0, 0, 0, 20] },
        para('The ash of the Reach does not settle the way ordinary ash settles. It drifts against the wind for a quarter hour after every eruption, as though remembering the shape of the mountain it fell from.'),
        para('Locals in Emberfall say that the ash remembers every promise spoken over it. Contracts in the city are still sealed by pressing a thumb into a bowl of cinder and naming the debt aloud.'),
        para('Samples taken from the Steps glow faintly when held near running water. No sample retained its glow beyond the third night.'),
        { text: 'On the Compact', fontSize: 14, bold: true, margin: [0, 10, 0, 8], pageBreak: 'before' },
        para('The Ash Compact was signed in the year of the Long Smoke by the three founding houses. Its first clause forbids the export of living ash beyond the Varrow toll-bridge.'),
        para('Every copy of the Compact I examined had been rewritten by hand within the last decade. The wording drifts. The meaning, the scribes insist, does not.'),
        para('If the ash truly remembers, then the Compact is less a law than a living witness — and a witness can be persuaded.'),
        { text: 'Appendix: Sample Log', fontSize: 14, bold: true, margin: [0, 10, 0, 8], pageBreak: 'before' },
        {
          table: {
            widths: ['auto', '*', 'auto'],
            body: [
              ['#', 'Location', 'Glow'],
              ['1', 'Lower Steps', 'faint'],
              ['2', 'Emberfall well', 'none'],
              ['3', 'Varrow toll-bridge', 'bright'],
            ],
          },
          layout: 'lightHorizontalLines',
        },
      ],
      defaultStyle: { fontSize: 10.5, color: '#222222' },
      footer: (p: number) => ({ text: String(p), alignment: 'center', fontSize: 8, color: '#888888' }),
    }
    return new Uint8Array(await (pdfMake as any).createPdf(doc).getBuffer())
  } catch (e) {
    console.warn('Sample PDF skipped', e)
    return null
  }
}

export async function seedVault(v: VaultAdapter) {
  const files: Record<string, string> = {
    'Welcome to THREAD.md': `---
dyes: [guide]
pinned: true
---

# Welcome to THREAD

THREAD is a local-first workspace: every **Thread** is a plain \`.md\` file in your vault, so nothing you write is ever locked in.

## The vocabulary

- **Thread** — a single note, like this one.
- **Stitch** — a two-way link. Type \`[[\` to stitch, e.g. [[The Ashen Reach]] or [[Aria Venn|our heroine]].
- **Deep Stitch** — a link into a PDF coordinate, like [[Field Notes on Ash.pdf#page=1&highlight=hseed01|the ash remembers]]. Click it to open the Desk at that exact highlight.
- **Dye** — a tag, kept in YAML frontmatter, shown as color everywhere. See the Stitching panel on the right →
- **Table** — a typed, relational block. Type \`/table\`.
- **Project** — a folder that opens as its own dashboard Thread.
- **Tapestry** — the graph of everything stitched together.
- **Pinboard** — an infinite canvas living inside a Thread. Type \`/pinboard\`.
- **The Desk** — PDF on the left, Thread on the right.
- **The Compiler** — binds Threads into a print-ready PDF or Word file.

## Try it

- [ ] Type \`/\` on an empty line to open the block menu
- [ ] Select some text to Dye it, bold it or turn it into a Stitch
- [ ] Press **Ctrl/⌘ K** to jump anywhere
- [ ] Open **Make it yours** (the sliders icon) to change the backdrop, blur, fonts and palette

> Your vault is just a folder. Open it in Obsidian, sync it with git, or point a Loom at it.
`,
    [`${P}/${P}.md`]: `---
type: project
dyes: [project, worldbuilding]
summary: A volcanic frontier where the ash remembers every promise.
status: drafting
---

# ${P}

A volcanic frontier where the ash remembers every promise spoken over it. Start with [[Emberfall]], then follow the trade road to [[Varrow]].

## Places

${table()}

## Map

\`\`\`thread-pinboard
__PINBOARD__
\`\`\`

## Threads to pull

- The origins of [[The Ash Compact]]
- Why does [[Bren Hollow]] refuse to cross the toll-bridge?
- [[Glass Hollow]] — still unwritten
`,
    [`${P}/Places/Emberfall.md`]: `---
dyes: [place]
population: 42000
founded: 1132-04-09
capital: true
---

# Emberfall

The ash-city at the foot of the mountain. Contracts here are sealed by pressing a thumb into cinder — see [[The Ash Compact]].

> Locals in Emberfall say that the ash remembers every promise spoken over it.
> [[Field Notes on Ash.pdf#page=1&highlight=hseed01]]

Home of [[Aria Venn]]. Trades glass and grief with [[Varrow]].
`,
    [`${P}/Places/Varrow.md`]: `---
dyes: [place]
population: 9100
---

# Varrow

A toll-town on the only bridge out of the Reach. [[Bren Hollow]] keeps the bridge ledger.

The first clause of [[The Ash Compact]] forbids living ash from crossing here.
`,
    [`${P}/Characters/Aria Venn.md`]: `---
dyes: [character, protagonist]
age: 24
home: "[[Emberfall]]"
alive: true
---

# Aria Venn

A cinder-scribe from [[Emberfall]] who discovers her copy of [[The Ash Compact]] has been rewritten.

## Wants

- To learn who changed the Compact
- To leave the Reach without breaking a promise

## Relationships

- [[Bren Hollow]] — owes her a debt sealed in ash
`,
    [`${P}/Characters/Bren Hollow.md`]: `---
dyes: [character]
age: 31
home: "[[Varrow]]"
alive: true
---

# Bren Hollow

Keeper of the Varrow bridge ledger. Has never crossed his own bridge. Owes [[Aria Venn]] a debt.
`,
    [`${P}/Lore/The Ash Compact.md`]: `---
dyes: [lore, law]
signed: 1132-04-09
---

# The Ash Compact

Signed in the year of the Long Smoke by the three founding houses of [[Emberfall]].

> If the ash truly remembers, then the Compact is less a law than a living witness — and a witness can be persuaded.
> [[Field Notes on Ash.pdf#page=2&highlight=hseed02]]

## Clauses

1. No living ash shall cross the bridge at [[Varrow]].
2. Every debt sealed in cinder is owed by the bloodline, not the person.
3. The Compact may be copied, never amended.
`,
    [`${P}/Manuscript/Title Page.md`]: `# The Ash Remembers

*A novel of the Reach*
`,
    [`${P}/Manuscript/01 The Cinder Scribe.md`]: `---
dyes: [chapter, draft]
---

# The Cinder Scribe

Aria pressed her thumb into the bowl and felt the ash press back.

It was not supposed to do that. In eleven years of sealing contracts for the merchants of [[Emberfall]], the cinder had always been warm, obedient, *dead*. Tonight it moved like something waking.

"Name the debt," said the merchant.

She opened her mouth, and the words that came out were not the ones written in the ledger.
`,
    [`${P}/Manuscript/02 The Toll-Bridge.md`]: `---
dyes: [chapter, draft]
---

# The Toll-Bridge

[[Bren Hollow]] had kept the ledger at [[Varrow]] for nine years, and in nine years he had never once looked at the far side of the bridge.

"You're the scribe," he said when Aria reached the gate. "You're early. The debt isn't due until the Long Smoke."

"The debt," Aria said, "has changed."
`,
    [`${P}/Manuscript/Glossary.md`]: `# Glossary

**Cinder-scribe** — one who seals contracts in ash.

**Long Smoke** — the year the Compact was signed; also any eruption lasting more than a week.
`,
    'Research/Reading List.md': `---
dyes: [research]
---

# Reading List

- [[Field Notes on Ash.pdf]] — primary source for the ash's memory
- Volcanic glass formation (to research)
`,
  }

  for (const dir of [P, `${P}/Places`, `${P}/Characters`, `${P}/Lore`, `${P}/Manuscript`, 'Research', 'attachments']) await v.mkdir(dir)
  const board = await pinboard()
  for (const [path, content] of Object.entries(files)) await v.writeText(path, content.replace('__PINBOARD__', board))

  const pdf = await samplePdf()
  if (pdf) {
    await v.writeBinary('Research/Field Notes on Ash.pdf', pdf)
    const quotes = [
      { id: 'hseed01', page: 1, dye: 'lore', thread: `${P}/Places/Emberfall.md`, text: 'Locals in Emberfall say that the ash remembers every promise spoken over it.' },
      {
        id: 'hseed02',
        page: 2,
        dye: 'evidence',
        thread: `${P}/Lore/The Ash Compact.md`,
        text: 'If the ash truly remembers, then the Compact is less a law than a living witness — and a witness can be persuaded.',
      },
    ]
    const highlights = []
    for (const q of quotes) highlights.push({ ...q, rects: await locateText(pdf, q.page, q.text), created: Date.now() })
    await v.writeText('.thread/highlights/Research/Field Notes on Ash.pdf.json', JSON.stringify(highlights, null, 2))
  }

  await v.writeText(
    '.thread/dyes.json',
    JSON.stringify(
      {
        guide: '#FF5F45',
        project: '#5A6B66',
        worldbuilding: '#7D8F69',
        place: '#4F6D7A',
        character: '#B5714E',
        protagonist: '#FF5F45',
        lore: '#8C6A9E',
        law: '#C9A27A',
        chapter: '#D9A441',
        draft: '#5E7F73',
        research: '#1FA3E0',
        evidence: '#E8772E',
        danger: '#E04848',
        mystery: '#6D5BD0',
      },
      null,
      2,
    ),
  )
  await v.writeText(
    '.thread/manuscripts.json',
    JSON.stringify(
      [
        {
          id: 'ms-ashen',
          title: 'The Ash Remembers',
          subtitle: 'A novel of the Reach',
          author: 'You',
          items: [
            { path: `${P}/Manuscript/Title Page.md`, role: 'title' },
            { path: `${P}/Manuscript/01 The Cinder Scribe.md`, role: 'chapter' },
            { path: `${P}/Manuscript/02 The Toll-Bridge.md`, role: 'chapter' },
            { path: `${P}/Manuscript/Glossary.md`, role: 'appendix' },
          ],
          pageSize: 'A5',
          font: 'serif',
          fontSize: 11,
          chapterBreaks: true,
          pageNumbers: true,
          runningHeader: true,
          keepDeepQuotes: true,
        },
      ],
      null,
      2,
    ),
  )
}

/** Find where a sentence sits on a PDF page, as normalized line boxes. */
async function locateText(pdf: Uint8Array, pageNo: number, needle: string) {
  try {
    const pdfjs = await import('pdfjs-dist')
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const doc = await pdfjs.getDocument({ data: pdf.slice() }).promise
    const page = await doc.getPage(pageNo)
    const { width: W, height: H } = page.getViewport({ scale: 1 })
    const items = (await page.getTextContent()).items.filter((i): i is (typeof i & { str: string; transform: number[]; width: number; height: number }) => 'str' in i && !!i.str.trim())
    // Locate the needle in the page's joined text, then map back to items.
    const norm = (t: string) => t.replace(/\s+/g, ' ')
    let joined = ''
    const offsets = items.map((i) => {
      const at = joined.length
      joined += norm(i.str) + ' '
      return at
    })
    const pos = norm(joined).indexOf(norm(needle).slice(0, 24))
    let start = -1
    for (let i = 0; i < offsets.length && pos >= 0; i++) if (offsets[i] <= pos) start = i
    const rects: { x: number; y: number; w: number; h: number }[] = []
    let covered = 0
    for (let i = Math.max(0, start); start >= 0 && i < items.length && covered < needle.length; i++) {
      const it = items[i]
      const h = it.height || Math.abs(it.transform[3])
      const top = H - it.transform[5] - h * 0.8
      const last = rects[rects.length - 1]
      const box = { x: it.transform[4] / W, y: top / H, w: it.width / W, h: (h * 1.15) / H }
      if (last && Math.abs(last.y - box.y) < 0.004) last.w = Math.max(last.x + last.w, box.x + box.w) - last.x
      else rects.push(box)
      covered += it.str.length + 1
    }
    await doc.destroy()
    const round = (n: number) => Math.round(n * 10000) / 10000
    return rects.map((r) => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }))
  } catch (e) {
    console.warn('Could not locate sample highlight', e)
    return [{ x: 0.1, y: 0.1, w: 0.8, h: 0.03 }]
  }
}
