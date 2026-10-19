import { describe, expect, it } from 'vitest'
import { buildSections, newManuscript, toDocx, toPdf } from '../src/core/compiler'
import { indexThread } from '../src/core/store'

const threads = {
  't.md': indexThread('t.md', '# The Book\n\n*subtitle*', 0),
  'c1.md': indexThread('c1.md', '---\ndyes: [draft]\n---\n# Arrival\n\nShe came to [[Varrow]].\n\n- one\n- two\n\n> a quote\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n', 0),
}
const ms = {
  ...newManuscript('Test Book'),
  font: 'sans' as const,
  items: [
    { path: 't.md', role: 'title' as const },
    { path: 'c1.md', role: 'chapter' as const },
  ],
}

describe('exports', () => {
  it('binds a PDF', { timeout: 30000 }, async () => {
    const pdf = await toPdf(ms, buildSections(ms, threads))
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(2000)
  })
  it('binds a DOCX', { timeout: 30000 }, async () => {
    const docx = await toDocx(ms, buildSections(ms, threads))
    expect([...docx.slice(0, 2)]).toEqual([0x50, 0x4b]) // zip
  })
})
