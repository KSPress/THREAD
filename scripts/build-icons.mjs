// Converts the Lineicons Free SVG pack into recolorable icon sets for THREAD.
//   node scripts/build-icons.mjs <path to free-svg-files>
// Writes src/assets/icons/<style>.json: { "<name>": { c: "<category>", s: "<inner svg>" } }
// Every hard-coded color becomes currentColor, so icons follow any Dye or palette color.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const src = process.argv[2]
if (!src) throw new Error('usage: node scripts/build-icons.mjs <free-svg-files dir>')
const out = join(import.meta.dirname, '..', 'src', 'assets', 'icons')
mkdirSync(out, { recursive: true })

const STYLES = ['stroke', 'solid', 'duotone', 'bulk']
const sets = Object.fromEntries(STYLES.map((s) => [s, {}]))
let viewBox = ''

for (const category of readdirSync(src).sort()) {
  const catDir = join(src, category, 'rounded')
  if (!statSync(join(src, category)).isDirectory()) continue
  for (const style of STYLES) {
    let files = []
    try {
      files = readdirSync(join(catDir, style)).filter((f) => f.endsWith('.svg'))
    } catch {
      continue
    }
    for (const f of files.sort()) {
      const svg = readFileSync(join(catDir, style, f), 'utf8')
      viewBox ||= svg.match(/viewBox="([^"]+)"/)?.[1] ?? ''
      const inner = svg
        .replace(/^[\s\S]*?<svg[^>]*>/, '')
        .replace(/<\/svg>\s*$/, '')
        .replace(/(fill|stroke)="#[0-9A-Fa-f]{3,8}"/g, '$1="currentColor"')
        .replace(/\s+xmlns="[^"]*"/g, '')
        .replace(/>\s+</g, '><')
        // Trim coordinate precision: plenty for a 24px grid, a third of the bytes.
        .replace(/(\d+\.\d{2})\d+/g, '$1')
        .trim()
      sets[style][f.replace(/\.svg$/, '')] = { c: category, s: inner }
    }
  }
}

for (const style of STYLES) {
  writeFileSync(join(out, `${style}.json`), JSON.stringify(sets[style]))
  console.log(`${style}: ${Object.keys(sets[style]).length} icons`)
}
writeFileSync(join(out, 'meta.json'), JSON.stringify({ viewBox, styles: STYLES, source: 'Lineicons Free 5.2' }))
