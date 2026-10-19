// Print / Save as PDF: each page is a window onto a copy of the on-screen
// page stack, so the printout matches what the Cord shows exactly.
import { PAGE_GAP, pageBox } from './layout'
import { pageDims, type CordFile } from './model'

export async function printCord(stage: HTMLElement, cord: CordFile, pages: number, title: string) {
  const { w, h } = pageDims(cord)
  const box = pageBox(cord)
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('\n')
  const copy = stage.cloneNode(true) as HTMLElement
  copy.style.transform = 'none'
  copy.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'))
  copy.querySelectorAll('.ProseMirror-selectednode').forEach((e) => e.classList.remove('ProseMirror-selectednode'))
  const html = copy.outerHTML
  const sheets = Array.from(
    { length: pages },
    (_, i) => `<div class="cord-print-page" style="width:${box.w}px;height:${box.h}px"><div style="position:absolute;left:0;top:${-i * (box.h + PAGE_GAP)}px">${html}</div></div>`,
  ).join('')
  doc.open()
  doc.write(`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>${styles}
<style>
@page { size: ${w}in ${h}in; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff !important }
.cord-print-page { position: relative; overflow: hidden; break-after: page; page-break-after: always }
.cord-print-page:last-child { break-after: auto; page-break-after: auto }
.cord-sheet { box-shadow: none !important; border: 0 !important; border-radius: 0 !important }
.cord-pagebreak { visibility: hidden }
.cord-note--measure, .is-editor-empty::before { display: none !important }
</style></head><body>${sheets}</body></html>`)
  doc.close()
  await new Promise((r) => setTimeout(r, 300))
  await doc.fonts?.ready
  frame.contentWindow!.focus()
  frame.contentWindow!.print()
  setTimeout(() => frame.remove(), 60_000)
}
