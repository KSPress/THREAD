import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { schemaExtensions } from '../src/editor/extensions'

function roundtrip(md: string) {
  const editor = new Editor({ extensions: schemaExtensions(), content: md, contentType: 'markdown' } as any)
  const out = editor.getMarkdown()
  editor.destroy()
  return out
}

const SAMPLE = `# Emberfall

The city sits under [[The Ashen Reach|the Reach]] and trades with [[Varrow]].

> The ash remembers.
> [[Field Notes.pdf#page=3&highlight=h1]]

- [ ] Map the harbor
- [x] Name the river

<!-- thread-table {"columns":[{"name":"Name","type":"text"},{"name":"Age","type":"number"},{"name":"Home","type":"link"}]} -->
| Name | Age | Home |
| --- | ---: | --- |
| Aria | 24 | [[Emberfall]] |
| Bren | 31 | [[Varrow\\|Old Varrow]] |

\`\`\`thread-pinboard
{"title":"Map","elements":[]}
\`\`\`

| a | b |
| --- | --- |
| 1 | 2 |

Some **bold** and *italic* and ==marked==.
`

describe('markdown round trip', () => {
  it('preserves Thread syntax', () => {
    const out = roundtrip(SAMPLE)
    console.log(out)
    expect(out).toContain('[[The Ashen Reach|the Reach]]')
    expect(out).toContain('[[Field Notes.pdf#page=3&highlight=h1]]')
    expect(out).toContain('<!-- thread-table')
    expect(out).toContain('[[Varrow\\|Old Varrow]]')
    expect(out).toContain('```thread-pinboard')
    expect(out).toContain('- [ ] Map the harbor')
    expect(roundtrip(out)).toBe(out)
  })
})

describe('indents', () => {
  it('keeps a Tab indent through the Markdown file', () => {
    const md = 'First line\n\n  An indented paragraph.\n'
    expect(roundtrip(md).trim()).toBe(md.trim())
  })
})

describe('callouts and toggles', () => {
  it('keep Obsidian callout syntax through the editor', () => {
    const md = 'Intro.\n\n> [!tip] Remember\n> The ash **remembers**.\n>\n> - one\n> - two\n\n> [!toggle]- Spoilers\n> Bren is the heir.\n\nAfter.\n'
    const out = roundtrip(md)
    expect(out).toContain('> [!tip] Remember\n> The ash **remembers**.')
    expect(out).toContain('> - one')
    expect(out).toContain('> [!toggle]- Spoilers\n> Bren is the heir.')
    expect(out.trim().endsWith('After.')).toBe(true)
    expect(roundtrip(out)).toBe(out)
  })
  it('leaves ordinary quotes alone', () => {
    expect(roundtrip('> Just a quote.\n').trim()).toBe('> Just a quote.')
  })
})
