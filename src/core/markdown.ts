// Literal data layer: a Thread is a plain .md file with optional YAML frontmatter.
// Nothing here knows about the UI vocabulary beyond naming.
import YAML from 'yaml'

export type Frontmatter = Record<string, unknown>

export interface Stitch {
  /** Raw text between the brackets, e.g. `Research.pdf#page=12&highlight=ab12|Quote` */
  raw: string
  /** Target thread name or file path, without anchor or alias. */
  target: string
  /** Anchor after `#`, e.g. `page=12&highlight=ab12` or a heading. */
  anchor?: string
  alias?: string
  /** True when the stitch points into a PDF/ePub coordinate. */
  deep: boolean
}

export interface DeepAnchor {
  page: number
  highlight?: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export function splitFrontmatter(raw: string): { frontmatter: Frontmatter; body: string; fmText: string } {
  const m = raw.match(FRONTMATTER_RE)
  if (!m) return { frontmatter: {}, body: raw, fmText: '' }
  let frontmatter: Frontmatter = {}
  try {
    const parsed = YAML.parse(m[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) frontmatter = parsed as Frontmatter
  } catch {
    // Malformed YAML stays in the file untouched; we just do not surface it.
    return { frontmatter: {}, body: raw, fmText: '' }
  }
  return { frontmatter, body: raw.slice(m[0].length).replace(/^\r?\n/, ''), fmText: m[1] }
}

export function joinFrontmatter(frontmatter: Frontmatter, body: string): string {
  const keys = Object.keys(frontmatter).filter((k) => frontmatter[k] !== undefined)
  if (keys.length === 0) return body
  const clean: Frontmatter = {}
  for (const k of keys) clean[k] = frontmatter[k]
  const yaml = YAML.stringify(clean, { lineWidth: 0 }).trimEnd()
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, '')}`
}

/** Dyes live in the `dyes` property; `tags` is accepted for Obsidian compatibility. */
export function dyesOf(fm: Frontmatter): string[] {
  const out = new Set<string>()
  for (const key of ['dyes', 'tags']) {
    const v = fm[key]
    if (Array.isArray(v)) v.forEach((d) => d != null && out.add(normalizeDye(String(d))))
    else if (typeof v === 'string') v.split(/[,\s]+/).forEach((d) => d && out.add(normalizeDye(d)))
  }
  out.delete('')
  return [...out]
}

export function normalizeDye(d: string) {
  return d.trim().replace(/^#/, '').toLowerCase()
}

const STITCH_RE = /\[\[([^\[\]\n]+?)\]\]/g
const DEEP_EXT = /\.(pdf|epub)$/i

export function parseStitch(raw: string): Stitch {
  let rest = raw
  let alias: string | undefined
  const bar = rest.indexOf('|')
  if (bar >= 0) {
    alias = rest.slice(bar + 1).trim() || undefined
    rest = rest.slice(0, bar)
  }
  let anchor: string | undefined
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    anchor = rest.slice(hash + 1).trim() || undefined
    rest = rest.slice(0, hash)
  }
  const target = rest.trim()
  return { raw, target, anchor, alias, deep: DEEP_EXT.test(target) && !!anchor }
}

export function formatStitch(s: { target: string; anchor?: string; alias?: string }) {
  return `[[${s.target}${s.anchor ? '#' + s.anchor : ''}${s.alias ? '|' + s.alias : ''}]]`
}

export function extractStitches(body: string): Stitch[] {
  const out: Stitch[] = []
  const text = stripCode(body)
  // `\|` is how an alias pipe is escaped inside a Markdown table cell.
  for (const m of text.matchAll(STITCH_RE)) out.push(parseStitch(m[1].replace(/\\\|/g, '|')))
  return out
}

/** Blank out fenced and inline code so stitches inside code are ignored. */
function stripCode(md: string) {
  return md.replace(/```[\s\S]*?```/g, (s) => ' '.repeat(s.length)).replace(/`[^`\n]*`/g, (s) => ' '.repeat(s.length))
}

export function parseDeepAnchor(anchor?: string): DeepAnchor | null {
  if (!anchor) return null
  const params = new URLSearchParams(anchor)
  const page = parseInt(params.get('page') ?? '', 10)
  if (!Number.isFinite(page)) return null
  return { page, highlight: params.get('highlight') ?? undefined }
}

export function deepAnchor(page: number, highlight?: string) {
  return `page=${page}${highlight ? `&highlight=${highlight}` : ''}`
}

export function firstHeading(body: string): string | undefined {
  const m = body.match(/^#\s+(.+)$/m)
  return m?.[1].trim()
}

export function wordCount(body: string): number {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/[#>*_`~\-|[\]()]/g, ' ')
  const words = text.match(/[\p{L}\p{N}'’]+/gu)
  return words ? words.length : 0
}

export function excerpt(body: string, len = 140): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^#+\s.*$/gm, ' ')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/[#>*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > len ? text.slice(0, len - 1) + '…' : text
}
