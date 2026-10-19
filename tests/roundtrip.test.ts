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
