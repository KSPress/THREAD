import { describe, expect, it } from 'vitest'
import { cordToMarkdown, fillTokens, formatNumber, newCord, parseCord, renameStitchTargets, serializeCord } from '../src/cord/model'
import { cordToDocx } from '../src/cord/docx'
import { indexThread } from '../src/core/store'

const t = (text: string, marks?: { type: string }[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) })

function sample() {
  const c = newCord('Letter', { dyes: ['draft'], author: 'A. Writer' })
  c.doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [t('Letter')] },
      {
        type: 'paragraph',
        content: [
          t('See '),
          { type: 'stitch', attrs: { target: 'Varrow', anchor: null, alias: null } },
          t(' and '),
          t('bold', [{ type: 'bold' }]),
          { type: 'footnote', attrs: { id: 'a', text: 'First note.' } },
        ],
      },
      { type: 'pageBreak' },
      { type: 'paragraph', content: [t('After the break.'), { type: 'footnote', attrs: { id: 'b', text: 'Second note.' } }] },
    ],
  }
  return c
}

describe('cords', () => {
  it('formats page numbers', () => {
    expect([1, 4, 9, 14].map((n) => formatNumber(n, 'i'))).toEqual(['i', 'iv', 'ix', 'xiv'])
    expect(formatNumber(1990, 'I')).toBe('MCMXC')
    expect([1, 26, 27].map((n) => formatNumber(n, 'a'))).toEqual(['a', 'z', 'aa'])
    expect(fillTokens('Page {page} of {pages} · {title}', { page: 3, pages: 9, title: 'T', author: '', format: '1' })).toBe('Page 3 of 9 · T')
  })

  it('round-trips and fills defaults', () => {
    const c = sample()
    const back = parseCord(serializeCord(c))
    expect(back.doc).toEqual(c.doc)
    expect(back.meta.dyes).toEqual(['draft'])
    const partial = parseCord(JSON.stringify({ cord: 1, meta: { title: 'x' }, page: { size: 'A4' } }))
    expect(partial.page.margins.top).toBe(1)
    expect(partial.style.font).toBe('Literata')
    expect(parseCord('not json').doc.type).toBe('doc')
  })

  it('renders Markdown with stitches and footnotes, and indexes like a Thread', () => {
    const md = cordToMarkdown(sample().doc)
    expect(md).toContain('# Letter')
    expect(md).toContain('[[Varrow]]')
    expect(md).toContain('**bold**[^1]')
    expect(md).toContain('[^1]: First note.')
    expect(md).toContain('[^2]: Second note.')
    const info = indexThread('Letters/Letter.cord', serializeCord(sample()), 0)
    expect(info.kind).toBe('cord')
    expect(info.dyes).toEqual(['draft'])
    expect(info.stitches.map((s) => s.target)).toContain('Varrow')
  })

  it('rewrites stitch targets on rename', () => {
    const c = sample()
    const changed = renameStitchTargets(c.doc, 'Varrow', 'Varrow Bridge')
    expect(changed).toBe(true)
    expect(JSON.stringify(c.doc)).toContain('"target":"Varrow Bridge"')
  })

  it('exports a Word document with footnotes, page setup and page numbers', async () => {
    const c = sample()
    c.page.size = 'A4'
    c.numbering = { format: 'i', start: 3 }
    const bytes = await cordToDocx(c, 'Letter')
    expect(bytes.length).toBeGreaterThan(4000)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(bytes)
    const doc = await zip.file('word/document.xml')!.async('string')
    expect(doc).toContain('w:titlePg')
    expect(doc).toMatch(/w:pgNumType w:start="3" w:fmt="lowerRoman"/)
    expect(doc).toContain('w:pageBreakBefore')
    const notes = await zip.file('word/footnotes.xml')!.async('string')
    expect(notes).toContain('First note.')
    expect(notes).toContain('Second note.')
    const footer = Object.keys(zip.files).filter((f) => f.startsWith('word/footer'))
    const footers = await Promise.all(footer.map((f) => zip.file(f)!.async('string')))
    expect(footers.some((x) => x.includes('PAGE'))).toBe(true)
  })
})

describe('find & replace', () => {
  it('finds across marks, respects case and whole words, and replaces all in one step', async () => {
    const { Editor } = await import('@tiptap/core')
    const StarterKit = (await import('@tiptap/starter-kit')).default
    const { FindReplace, findKey } = await import('../src/editor/find')
    const editor = new Editor({ extensions: [StarterKit, FindReplace], content: '<p>Ash and <b>as</b>h, ashen ASH.</p>' })
    editor.commands.setFind({ query: 'ash' })
    expect(findKey.getState(editor.state)!.matches.length).toBe(4)
    editor.commands.setFind({ query: 'ash', wholeWord: true })
    expect(findKey.getState(editor.state)!.matches.length).toBe(3)
    editor.commands.setFind({ query: 'ash', wholeWord: true, caseSensitive: true })
    expect(findKey.getState(editor.state)!.matches.length).toBe(1)
    editor.commands.setFind({ query: 'ash', wholeWord: true, caseSensitive: false })
    editor.commands.replaceAll('cinder')
    expect(editor.getText()).toBe('cinder and cinder, ashen cinder.')
    editor.commands.undo()
    expect(editor.getText()).toBe('Ash and ash, ashen ASH.')
    editor.destroy()
  })
})

describe('contents', () => {
  it('renders a table of contents as a list of headings in Markdown', () => {
    const c = sample()
    c.doc.content!.unshift({ type: 'cordToc' })
    expect(cordToMarkdown(c.doc)).toContain('**Contents**\n\n- Letter')
  })
})
