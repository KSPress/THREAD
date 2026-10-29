// The modular block-menu (`/`) and the Stitch picker (`[[`).
import type { Editor, Range } from '@tiptap/core'
import { useStore } from '../core/store'
import { stem } from '../core/paths'
import { fuzzy, suggestExtension, type MenuItem } from './suggest'

function block(id: string, title: string, glyph: string, group: string, hint: string, run: (e: Editor) => void): MenuItem {
  return {
    id,
    title,
    glyph,
    group,
    hint,
    run: (editor: Editor, range: Range) => {
      editor.chain().focus().deleteRange(range).run()
      run(editor)
    },
  }
}

export const SLASH_ITEMS: MenuItem[] = [
  block('p', 'Text', 'Aa', 'Basic', 'Plain paragraph', (e) => e.chain().setParagraph().run()),
  block('h1', 'Heading 1', 'H1', 'Basic', 'Big section heading', (e) => e.chain().toggleHeading({ level: 1 }).run()),
  block('h2', 'Heading 2', 'H2', 'Basic', 'Medium heading', (e) => e.chain().toggleHeading({ level: 2 }).run()),
  block('h3', 'Heading 3', 'H3', 'Basic', 'Small heading', (e) => e.chain().toggleHeading({ level: 3 }).run()),
  block('ul', 'Bulleted list', '•', 'Basic', 'Simple list', (e) => e.chain().toggleBulletList().run()),
  block('ol', 'Numbered list', '1.', 'Basic', 'Ordered list', (e) => e.chain().toggleOrderedList().run()),
  block('todo', 'To-do', '☑', 'Basic', 'Track tasks', (e) => e.chain().toggleTaskList().run()),
  block('quote', 'Quote', '❝', 'Basic', 'Capture a quote', (e) => e.chain().toggleBlockquote().run()),
  block('code', 'Code', '</>', 'Basic', 'Code block', (e) => e.chain().toggleCodeBlock().run()),
  block('hr', 'Divider', '—', 'Basic', 'Visual break', (e) => e.chain().setHorizontalRule().run()),
  block('table', 'Table', '▦', 'Weave', 'Relational, typed columns', (e) => e.chain().insertThreadTable().run()),
  block('grid', 'Simple grid', '▤', 'Weave', 'Plain Markdown table', (e) =>
    e.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  ),
  block('pinboard', 'Pinboard', '◫', 'Weave', 'Infinite visual canvas', (e) => e.chain().insertPinboard().run()),
  block('stitch', 'Stitch', '⌗', 'Weave', 'Link to another Thread', (e) => e.chain().insertContent('[[').run()),
  block('image', 'Image', '▣', 'Weave', 'Upload into the vault', (e) => pickImage(e)),
  {
    id: 'sub',
    title: 'Sub-thread',
    glyph: '↳',
    group: 'Weave',
    hint: 'A new Thread nested inside this one',
    run: (editor: Editor, range: Range) => {
      editor.chain().focus().deleteRange(range).run()
      const s = useStore.getState()
      const parent = s.active
      if (!parent) return
      const name = prompt('Name the sub-thread', 'Untitled')
      if (!name) return
      void s.createSubThread(parent, name).then((p) => editor.chain().focus().insertStitch({ target: stem(p) }).run())
    },
  },
  block('due', 'Due date', '📅', 'Weave', 'Add a dated to-do (reminders + calendar)', (e) => {
    const d = new Date(Date.now() + 7 * 86400000)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!e.isActive('taskItem')) e.chain().toggleTaskList().run()
    e.chain().insertContent(` 📅 ${iso}`).run()
  }),
  block('desk', 'Deep Stitch', '❞', 'Weave', 'Open a PDF beside this Thread, then drag a passage in', () => useStore.getState().openDesk(null)),
]

function pickImage(editor: Editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const [path] = await useStore.getState().importFiles('attachments', [file])
    editor.chain().focus().setImage({ src: encodeURI(path), alt: stem(path) }).run()
  }
  input.click()
}

export const SlashCommand = suggestExtension({
  name: 'slash',
  char: '/',
  title: 'BLOCKS',
  items: (query) =>
    SLASH_ITEMS.map((i) => ({ i, score: Math.max(fuzzy(query, i.title), fuzzy(query, i.id)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i),
})

export const StitchPicker = suggestExtension({
  name: 'stitchPicker',
  char: '[[',
  title: 'STITCH TO',
  allowSpaces: true,
  items: (query) => {
    const { threads, files, dyeColor } = useStore.getState()
    const q = query.replace(/\]+$/, '')
    const items: (MenuItem & { score: number })[] = []
    for (const t of Object.values(threads)) {
      const score = Math.max(fuzzy(q, t.name), fuzzy(q, t.title))
      if (!score) continue
      items.push({
        id: t.path,
        title: t.name,
        hint: t.path,
        glyph: '⌗',
        color: t.dyes[0] ? dyeColor(t.dyes[0]) : undefined,
        score,
        run: (e, range) => e.chain().focus().deleteRange(range).insertStitch({ target: t.name }).run(),
      })
    }
    for (const f of Object.values(files)) {
      if (f.kind !== 'pdf' && f.kind !== 'epub' && f.kind !== 'image') continue
      const name = f.path.split('/').pop()!
      const score = fuzzy(q, name)
      if (!score) continue
      items.push({
        id: f.path,
        title: name,
        hint: f.kind.toUpperCase(),
        glyph: '❝',
        score: score - 0.5,
        run: (e, range) => e.chain().focus().deleteRange(range).insertStitch({ target: name }).run(),
      })
    }
    items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    const out: MenuItem[] = items.slice(0, 12)
    if (q.trim() && !items.some((i) => i.title.toLowerCase() === q.trim().toLowerCase())) {
      out.push({
        id: '__new',
        title: `Weave “${q.trim()}”`,
        hint: 'Create a new Thread on click',
        glyph: '+',
        run: (e, range) => e.chain().focus().deleteRange(range).insertStitch({ target: q.trim() }).run(),
      })
    }
    return out
  },
})
