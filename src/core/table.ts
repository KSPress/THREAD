// Notion-style relational Tables, serialized as portable GFM tables.
//
//   <!-- thread-table {"columns":[{"name":"Name","type":"text"}, ...]} -->
//   | Name | Home |
//   | --- | --- |
//   | Aria | [[Emberfall]] |
//
// Any Markdown reader sees a normal table; Thread reads the column schema from
// the comment. Link cells hold Stitches, so relations show up as backlinks.

export type ColumnType = 'text' | 'number' | 'link' | 'select' | 'checkbox' | 'date'

export interface Column {
  id: string
  name: string
  type: ColumnType
}

export interface Row {
  id: string
  cells: Record<string, string>
}

export interface TableData {
  columns: Column[]
  rows: Row[]
}

export const COLUMN_TYPES: { type: ColumnType; label: string; glyph: string }[] = [
  { type: 'text', label: 'Text', glyph: 'Aa' },
  { type: 'number', label: 'Number', glyph: '#' },
  { type: 'link', label: 'Stitch', glyph: '⌗' },
  { type: 'select', label: 'Dye', glyph: '◐' },
  { type: 'checkbox', label: 'Check', glyph: '☑' },
  { type: 'date', label: 'Date', glyph: '◷' },
]

let seq = 0
export const uid = (p = 'r') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

export function emptyTable(): TableData {
  const name = { id: uid('c'), name: 'Name', type: 'text' as const }
  const tags = { id: uid('c'), name: 'Dye', type: 'select' as const }
  const link = { id: uid('c'), name: 'Stitched to', type: 'link' as const }
  return {
    columns: [name, tags, link],
    rows: [1, 2, 3].map(() => ({ id: uid(), cells: {} })),
  }
}

export const TABLE_RE = /^<!-- thread-table (\{.*?\}) -->[ \t]*\r?\n((?:[ \t]*\|.*(?:\r?\n|$))+)/

export function parseTableBlock(src: string): { data: TableData; raw: string } | null {
  const m = TABLE_RE.exec(src)
  if (!m) return null
  let schema: { columns?: { name: string; type: ColumnType }[] } = {}
  try {
    schema = JSON.parse(m[1])
  } catch {
    return null
  }
  const lines = m[2].split(/\r?\n/).filter((l) => l.trim())
  const header = splitRow(lines[0] ?? '')
  const body = lines.slice(2).map(splitRow)
  const columns: Column[] = header.map((name, i) => ({
    id: uid('c'),
    name: unescapeCell(name),
    type: schema.columns?.[i]?.type ?? 'text',
  }))
  const rows: Row[] = body.map((cells) => ({
    id: uid(),
    cells: Object.fromEntries(columns.map((c, i) => [c.id, unescapeCell(cells[i] ?? '')])),
  }))
  return { data: { columns, rows }, raw: m[0] }
}

export function serializeTable(data: TableData): string {
  const schema = { columns: data.columns.map((c) => ({ name: c.name, type: c.type })) }
  const head = `| ${data.columns.map((c) => escapeCell(c.name) || ' ').join(' | ')} |`
  const sep = `| ${data.columns.map((c) => (c.type === 'number' ? '---:' : '---')).join(' | ')} |`
  const rows = data.rows.map((r) => `| ${data.columns.map((c) => escapeCell(r.cells[c.id] ?? '')).join(' | ')} |`)
  return [`<!-- thread-table ${JSON.stringify(schema)} -->`, head, sep, ...rows].join('\n')
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (s[i] === '|') {
      out.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  out.push(cur.trim())
  return out
}

function escapeCell(v: string) {
  return v.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
}
function unescapeCell(v: string) {
  return v.replace(/\\\|/g, '|')
}

/** Stitch targets inside a link cell: `[[A]], [[B]]`. */
export function linkTargets(v: string): string[] {
  return [...v.matchAll(/\[\[([^\]]+?)\]\]/g)].map((m) => m[1].split('|')[0].split('#')[0].trim())
}
