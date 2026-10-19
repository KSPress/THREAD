import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { applyTextDiff, baselineUpdate, TEXT_KEY } from '../shared/ytext.js'
import { dyesOf, extractStitches, joinFrontmatter, parseDeepAnchor, splitFrontmatter, wordCount } from '../src/core/markdown'
import { parseTableBlock, serializeTable, linkTargets } from '../src/core/table'
import { buildSections, newManuscript, stripThreadSyntax, toMarkdown } from '../src/core/compiler'
import { indexThread, resolveTarget, backlinksOf, type FileInfo } from '../src/core/store'

describe('frontmatter & Dyes', () => {
  it('round-trips YAML frontmatter', () => {
    const raw = '---\ndyes: [lore, Place]\nage: 3\n---\n\n# Hi\n'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter.age).toBe(3)
    expect(body).toBe('# Hi\n')
    expect(dyesOf(frontmatter)).toEqual(['lore', 'place'])
    expect(splitFrontmatter(joinFrontmatter(frontmatter, body)).frontmatter).toEqual(frontmatter)
  })
  it('accepts Obsidian tags and leaves malformed YAML alone', () => {
    expect(dyesOf({ tags: '#a, b' })).toEqual(['a', 'b'])
    const bad = '---\n: : :\n  - [\n---\nbody'
    expect(splitFrontmatter(bad).body).toBe(bad)
  })
})

describe('Stitches', () => {
  it('parses plain, aliased and deep stitches, skipping code', () => {
    const s = extractStitches('See [[Emberfall]], [[Aria Venn|her]] and [[Notes.pdf#page=4&highlight=h1]]. `[[not]]`\n```\n[[nope]]\n```')
    expect(s.map((x) => x.target)).toEqual(['Emberfall', 'Aria Venn', 'Notes.pdf'])
    expect(s[1].alias).toBe('her')
    expect(s[2].deep).toBe(true)
    expect(parseDeepAnchor(s[2].anchor)).toEqual({ page: 4, highlight: 'h1' })
  })
  it('resolves names, folders (Projects) and builds backlinks', () => {
    const threads = {
      'P/P.md': indexThread('P/P.md', '# P\n[[A]]', 0),
      'P/A.md': indexThread('P/A.md', '# A\nBack to [[P]]', 0),
    }
    const files: Record<string, FileInfo> = {
      P: { path: 'P', kind: 'folder', size: 0, mtime: 0 },
      'P/P.md': { path: 'P/P.md', kind: 'thread', size: 0, mtime: 0 },
      'P/A.md': { path: 'P/A.md', kind: 'thread', size: 0, mtime: 0 },
    }
    expect(resolveTarget('a', files, threads)).toBe('P/A.md')
    expect(resolveTarget('P', files, threads)).toBe('P/P.md')
    expect(backlinksOf('P/P.md', { files, threads }).map((b) => b.from.path)).toEqual(['P/A.md'])
  })
  it('counts words without markup', () => {
    expect(wordCount('# Title\n\nOne **two** [[Three|three]]')).toBe(4)
  })
})

describe('relational Tables', () => {
  it('serializes to a portable GFM table with a schema comment', () => {
    const md = serializeTable({
      columns: [
        { id: 'a', name: 'Name', type: 'text' },
        { id: 'b', name: 'Home', type: 'link' },
      ],
      rows: [{ id: 'r', cells: { a: 'Aria | V', b: '[[Emberfall|E]]' } }],
    })
    expect(md).toContain('| Aria \\| V | [[Emberfall\\|E]] |')
    const parsed = parseTableBlock(md + '\n')!
    expect(parsed.data.columns.map((c) => c.type)).toEqual(['text', 'link'])
    expect(Object.values(parsed.data.rows[0].cells)).toEqual(['Aria | V', '[[Emberfall|E]]'])
    expect(linkTargets('[[A]], [[B|b]]')).toEqual(['A', 'B'])
  })
})

describe('the Compiler', () => {
  it('strips UI syntax', () => {
    const out = stripThreadSyntax(
      '---\ndyes: [x]\n---\n# T\n\nGo to [[Varrow|the bridge]].\n\n> quote\n> [[F.pdf#page=2&highlight=h]]\n\n```thread-pinboard\n{}\n```\n\n<!-- thread-table {"columns":[]} -->\n| a |\n| --- |\n| 1 |\n==hi==',
      { keepDeepQuotes: true },
    )
    expect(out).toContain('Go to the bridge.')
    expect(out).toContain('(F, p. 2)')
    expect(out).not.toMatch(/thread-pinboard|thread-table|dyes|\[\[|==/)
  })
  it('numbers chapters and appendices', () => {
    const ms = { ...newManuscript('Book'), items: [
      { path: 'a.md', role: 'chapter' as const },
      { path: 'b.md', role: 'appendix' as const },
    ] }
    const threads = { 'a.md': indexThread('a.md', '# One\ntext', 0), 'b.md': indexThread('b.md', 'gloss', 0) }
    const sections = buildSections(ms, threads)
    expect(sections.map((s) => s.label)).toEqual(['Chapter 1', 'Appendix A'])
    expect(toMarkdown(ms, sections)).toContain('# Chapter 1: One')
  })
})

describe('CRDT text', () => {
  it('produces identical baselines for identical files (no duplication)', () => {
    const a = new Y.Doc()
    Y.applyUpdate(a, baselineUpdate('x.md', 'same'))
    Y.applyUpdate(a, baselineUpdate('x.md', 'same'))
    expect(a.getText(TEXT_KEY).toString()).toBe('same')
  })
  it('merges concurrent minimal splices', () => {
    const base = baselineUpdate('x.md', 'The cat sat.')
    const a = new Y.Doc()
    const b = new Y.Doc()
    Y.applyUpdate(a, base)
    Y.applyUpdate(b, base)
    applyTextDiff(a.getText(TEXT_KEY), 'The black cat sat.')
    applyTextDiff(b.getText(TEXT_KEY), 'The cat sat down.')
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(a.getText(TEXT_KEY).toString()).toBe('The black cat sat down.')
    expect(b.getText(TEXT_KEY).toString()).toBe(a.getText(TEXT_KEY).toString())
  })
  it('never splits surrogate pairs', () => {
    const d = new Y.Doc()
    d.getText(TEXT_KEY).insert(0, 'a😀b')
    applyTextDiff(d.getText(TEXT_KEY), 'a😁b')
    expect(d.getText(TEXT_KEY).toString()).toBe('a😁b')
  })
})

describe('body edits', () => {
  it('keep the frontmatter block byte-for-byte', () => {
    const raw = '---\ndyes: [guide]   # keep me\n---\n\n# Body\n'
    const t = indexThread('x.md', raw, 0)
    expect(t.head + t.body).toBe(raw)
    expect(t.head + '# Changed\n').toBe('---\ndyes: [guide]   # keep me\n---\n\n# Changed\n')
  })
})
