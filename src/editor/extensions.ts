import type { Extensions } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { SlashCommand, StitchPicker } from './commands'
import { Pinboard } from './Pinboard'
import { Stitch } from './Stitch'
import { ThreadTable } from './ThreadTable'
import { VaultImage } from './VaultImage'
import { Indent } from './Indent'

/** Nodes and marks that define the document schema (and its Markdown form). */
export function schemaExtensions(): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true },
      heading: { levels: [1, 2, 3, 4] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Highlight,
    VaultImage,
    Stitch,
    ThreadTable,
    Pinboard,
    Markdown.configure({ markedOptions: { gfm: true } }),
  ]
}

/** Everything the live Canvas needs on top of the schema. */
export function editorExtensions(): Extensions {
  return [
    ...schemaExtensions(),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'heading' ? 'Title' : 'Type / for blocks, [[ to stitch…'),
    }),
    SlashCommand,
    StitchPicker,
    Indent,
  ]
}
