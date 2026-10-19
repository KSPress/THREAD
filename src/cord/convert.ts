// Thread (Markdown) → Cord document, for "Convert to Cord".
import { Editor, type JSONContent } from '@tiptap/core'
import { schemaExtensions } from '../editor/extensions'
import { parseScene } from '../editor/Pinboard'
import type { TableData } from '../core/table'

export async function markdownToCordDoc(markdown: string): Promise<JSONContent> {
  const editor = new Editor({ extensions: schemaExtensions(), content: markdown, contentType: 'markdown' } as any)
  const json = editor.getJSON()
  editor.destroy()
  return { type: 'doc', content: (json.content ?? []).flatMap(convert) }
}

function convert(n: JSONContent): JSONContent[] {
  switch (n.type) {
    case 'threadTable': {
      const data = n.attrs?.data as TableData | undefined
      if (!data) return []
      const cell = (type: string, text: string): JSONContent => ({
        type,
        content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
      })
      return [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: data.columns.map((c) => cell('tableHeader', c.name)) },
            ...data.rows.map((r) => ({ type: 'tableRow', content: data.columns.map((c) => cell('tableCell', r.cells[c.id] ?? '')) })),
          ],
        },
      ]
    }
    case 'pinboard':
      return [{ type: 'paragraph', content: [{ type: 'text', text: `[Pinboard: ${parseScene(n.attrs?.data).title ?? 'Pinboard'}]`, marks: [{ type: 'italic' }] }] }]
    case 'taskList':
      return [
        {
          type: 'bulletList',
          content: (n.content ?? []).map((li) => ({
            type: 'listItem',
            content: (li.content ?? []).map((c, i) =>
              i === 0 && c.type === 'paragraph' ? { ...c, content: [{ type: 'text', text: li.attrs?.checked ? '☑ ' : '☐ ' }, ...(c.content ?? [])] } : c,
            ),
          })),
        },
      ]
    default:
      return [n.content ? { ...n, content: n.content.flatMap(convert) } : n]
  }
}
