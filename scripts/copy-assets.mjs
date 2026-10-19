// Copies runtime assets that must be served locally (Thread is offline-first):
// Excalidraw's handwriting fonts and the pdf.js character maps.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const copies = [
  ['node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'public/excalidraw/fonts'],
  ['node_modules/pdfjs-dist/cmaps', 'public/pdfjs/cmaps'],
  ['node_modules/pdfjs-dist/standard_fonts', 'public/pdfjs/standard_fonts'],
]
for (const [from, to] of copies) {
  const src = join(root, from)
  if (!existsSync(src)) continue
  mkdirSync(join(root, to), { recursive: true })
  cpSync(src, join(root, to), { recursive: true })
}
console.log('[thread] runtime assets copied')
