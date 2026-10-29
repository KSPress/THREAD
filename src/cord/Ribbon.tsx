// The Cord ribbon: a word-processor header in THREAD's visual language.
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { useRef, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { PALETTES, useSettings } from '../core/settings'
import { useStore } from '../core/store'
import { stem } from '../core/paths'
import { FONTS, PAGE_SIZES, type CordFile, type NumberFormat, type PageSizeId } from './model'

type Tab = 'home' | 'insert' | 'layout' | 'header' | 'review'
export type ExportKind = 'print' | 'docx' | 'md'

const SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72]
const LINE = [1, 1.15, 1.5, 2, 2.5, 3]
const MARGINS: { id: string; label: string; m: CordFile['page']['margins'] }[] = [
  { id: 'normal', label: 'Normal · 1″', m: { top: 1, right: 1, bottom: 1, left: 1 } },
  { id: 'narrow', label: 'Narrow · 0.5″', m: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 } },
  { id: 'moderate', label: 'Moderate · 1″ / 0.75″', m: { top: 1, right: 0.75, bottom: 1, left: 0.75 } },
  { id: 'wide', label: 'Wide · 1″ / 2″', m: { top: 1, right: 2, bottom: 1, left: 2 } },
  { id: 'book', label: 'Book · 0.75″ / 0.9″', m: { top: 0.75, right: 0.9, bottom: 0.75, left: 0.9 } },
  { id: 'manuscript', label: 'Manuscript · 1″ / 1.25″', m: { top: 1, right: 1.25, bottom: 1, left: 1.25 } },
]

/** Buttons keep the editor's selection: act on mousedown, never take focus. */
function RB({ on, title, onRun, children, wide }: { on?: boolean; title: string; onRun: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <button
      className={'rb' + (on ? ' is-on' : '') + (wide ? ' rb--wide' : '')}
      title={title}
      aria-label={title}
      aria-pressed={on}
      onMouseDown={(e) => {
        e.preventDefault()
        onRun()
      }}
    >
      {children}
    </button>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rgroup">
      <div className="rgroup__row">{children}</div>
      <div className="rgroup__label">{label}</div>
    </div>
  )
}

function ColorMenu({ title, glyph, colors, current, onPick }: { title: string; glyph: ReactNode; colors: string[]; current?: string; onPick: (c: string | null) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rcolor">
      <button
        className="rb"
        title={title}
        aria-label={title}
        onMouseDown={(e) => {
          e.preventDefault()
          setOpen(!open)
        }}
      >
        {glyph}
        <i style={{ background: current ?? 'currentColor' }} />
      </button>
      {open && (
        <div className="pop rcolor__menu" onMouseLeave={() => setOpen(false)}>
          <div className="swatches">
            {colors.map((c) => (
              <button
                key={c}
                className="swatch"
                style={{ background: c }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(c)
                  setOpen(false)
                }}
              />
            ))}
            <label className="swatch" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', cursor: 'pointer' }}>
              <input type="color" style={{ opacity: 0, width: 0, height: 0 }} onChange={(e) => onPick(e.target.value)} />
            </label>
          </div>
          <button
            className="chip-btn"
            style={{ marginTop: 6 }}
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(null)
              setOpen(false)
            }}
          >
            Automatic
          </button>
        </div>
      )}
    </div>
  )
}

export function Ribbon({
  editor,
  cord,
  update,
  pages,
  onExport,
  zoom,
  setZoom,
}: {
  editor: Editor
  cord: CordFile
  update: (patch: Partial<CordFile>) => void
  pages: number
  onExport: (k: ExportKind) => void
  zoom: number
  setZoom: (z: number) => void
}) {
  const [tab, setTab] = useState<Tab>('home')
  const palette = useSettings((s) => s.palette)
  const importFiles = useStore((s) => s.importFiles)
  const lastField = useRef<{ el: HTMLInputElement; apply: (v: string) => void } | null>(null)
  const colors = ['#1d1d1d', '#5f6559', '#c0392b', ...PALETTES[palette].colors]
  const highlights = ['#fff3a3', '#ffd6cc', '#d5f0d0', '#d6e8ff', '#ecdcff', '#E7C5A4', '#DBCCB1']

  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const ts = e.getAttributes('textStyle')
      const para = e.isActive('heading') ? e.getAttributes('heading') : e.getAttributes('paragraph')
      const style = e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : e.isActive('blockquote')
              ? 'quote'
              : e.isActive('codeBlock')
                ? 'code'
                : 'p'
      const text = e.state.doc.textContent
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        sub: e.isActive('subscript'),
        sup: e.isActive('superscript'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        align: (para.textAlign as string) || 'left',
        font: (ts.fontFamily as string) || '',
        size: (ts.fontSize as string) || '',
        color: (ts.color as string) || undefined,
        lineHeight: (para.lineHeight as number | null) ?? null,
        firstLine: (para.firstLine as number | null) ?? null,
        style,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        words: (text.match(/[\p{L}\p{N}'’]+/gu) ?? []).length,
        chars: text.length,
        notes: (() => {
          let n = 0
          e.state.doc.descendants((x) => {
            if (x.type.name === 'footnote') n++
          })
          return n
        })(),
      }
    },
  })

  const c = () => editor.chain().focus()
  const fontId = FONTS.find((f) => st.font && st.font.includes(f.id))?.id ?? ''
  const sizePt = st.size ? parseFloat(st.size) : ''

  const setStyle = (v: string) => {
    if (v === 'p') c().setParagraph().run()
    else if (v === 'title') c().setHeading({ level: 1 }).setTextAlign('center').run()
    else if (v.startsWith('h')) c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run()
    else if (v === 'quote') c().toggleBlockquote().run()
    else if (v === 'code') c().toggleCodeBlock().run()
  }

  const slot = (part: 'header' | 'footer', key: 'left' | 'center' | 'right', label: string) => (
    <label className="hf-slot">
      <span className="label">{label}</span>
      <input
        className="input"
        value={cord[part][key]}
        placeholder="—"
        onFocus={(e) => (lastField.current = { el: e.currentTarget, apply: (v) => update({ [part]: { ...cord[part], [key]: v } } as Partial<CordFile>) })}
        onChange={(e) => update({ [part]: { ...cord[part], [key]: e.target.value } } as Partial<CordFile>)}
      />
    </label>
  )
  const insertToken = (t: string) => {
    const f = lastField.current
    if (!f) return
    const el = f.el
    const s = el.selectionStart ?? el.value.length
    const v = el.value.slice(0, s) + t + el.value.slice(el.selectionEnd ?? s)
    f.apply(v)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(s + t.length, s + t.length)
    })
  }
  const numberPreset = (() => {
    const all = (o: CordFile['header']) => [o.left, o.center, o.right].join('|')
    if (cord.footer.center === '{page}' && !all(cord.header).includes('{page}')) return 'bottom-center'
    if (cord.footer.right === '{page}') return 'bottom-right'
    if (cord.header.right === '{page}') return 'top-right'
    if (cord.footer.center === 'Page {page} of {pages}') return 'page-of'
    if (!all(cord.header).includes('{page}') && !all(cord.footer).includes('{page}')) return 'none'
    return 'custom'
  })()
  const setNumberPreset = (v: string) => {
    const strip = (o: CordFile['header']) => ({
      left: o.left.replace(/\s*(Page )?\{page\}( of \{pages\})?/g, '').trim(),
      center: o.center.replace(/\s*(Page )?\{page\}( of \{pages\})?/g, '').trim(),
      right: o.right.replace(/\s*(Page )?\{page\}( of \{pages\})?/g, '').trim(),
    })
    const header = strip(cord.header)
    const footer = strip(cord.footer)
    if (v === 'bottom-center') footer.center = '{page}'
    if (v === 'bottom-right') footer.right = '{page}'
    if (v === 'top-right') header.right = '{page}'
    if (v === 'page-of') footer.center = 'Page {page} of {pages}'
    update({ header, footer })
  }

  return (
    <div className="ribbon">
      <div className="ribbon__tabs">
        {(
          [
            ['home', 'Home'],
            ['insert', 'Insert'],
            ['layout', 'Layout'],
            ['header', 'Header & Footer'],
            ['review', 'Review'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={'ribbon__tab' + (tab === id ? ' is-on' : '')} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        <div className="ribbon__zoom">
          <button className="rb" title="Zoom out" onClick={() => setZoom(Math.max(0.4, Math.round((zoom - 0.1) * 10) / 10))}>
            <Icon name="zoomOut" size={15} />
          </button>
          <span className="mono">{Math.round(zoom * 100)}%</span>
          <button className="rb" title="Zoom in" onClick={() => setZoom(Math.min(2, Math.round((zoom + 0.1) * 10) / 10))}>
            <Icon name="zoomIn" size={15} />
          </button>
        </div>
        <button className="btn btn--accent ribbon__export" onClick={() => onExport('print')} title="Print, or save as PDF">
          <Icon name="download" size={14} /> PDF
        </button>
        <button className="btn btn--ink ribbon__export" onClick={() => onExport('docx')} title="Word document with headers, footers, page numbers and footnotes">
          <Icon name="download" size={14} /> Word
        </button>
      </div>

      <div className="ribbon__body">
        {tab === 'home' && (
          <>
            <Group label="History">
              <RB title="Undo (Ctrl+Z)" onRun={() => c().undo().run()}>
                ↶
              </RB>
              <RB title="Redo (Ctrl+Shift+Z)" onRun={() => c().redo().run()}>
                ↷
              </RB>
            </Group>
            <Group label="Style">
              <select className="rselect rselect--wide" value={st.style} onChange={(e) => setStyle(e.target.value)} aria-label="Paragraph style">
                <option value="p">Normal</option>
                <option value="title">Title</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
                <option value="quote">Quote</option>
                <option value="code">Code</option>
              </select>
            </Group>
            <Group label="Font">
              <select
                className="rselect rselect--wide"
                value={fontId}
                onChange={(e) => (e.target.value ? c().setFontFamily(FONTS.find((f) => f.id === e.target.value)!.stack).run() : c().unsetFontFamily().run())}
                aria-label="Font"
              >
                <option value="">{cord.style.font} (default)</option>
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                    {f.id}
                  </option>
                ))}
              </select>
              <select
                className="rselect"
                value={sizePt}
                onChange={(e) => (e.target.value ? c().setFontSize(`${e.target.value}pt`).run() : c().unsetFontSize().run())}
                aria-label="Font size"
              >
                <option value="">{cord.style.size}</option>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <RB title="Bold (Ctrl+B)" on={st.bold} onRun={() => c().toggleBold().run()}>
                <b>B</b>
              </RB>
              <RB title="Italic (Ctrl+I)" on={st.italic} onRun={() => c().toggleItalic().run()}>
                <i style={{ fontFamily: 'Georgia, serif' }}>I</i>
              </RB>
              <RB title="Underline (Ctrl+U)" on={st.underline} onRun={() => c().toggleUnderline().run()}>
                <u>U</u>
              </RB>
              <RB title="Strikethrough" on={st.strike} onRun={() => c().toggleStrike().run()}>
                <s>S</s>
              </RB>
              <RB title="Superscript" on={st.sup} onRun={() => c().toggleSuperscript().run()}>
                x²
              </RB>
              <RB title="Subscript" on={st.sub} onRun={() => c().toggleSubscript().run()}>
                x₂
              </RB>
              <ColorMenu title="Text color" glyph={<b>A</b>} colors={colors} current={st.color} onPick={(v) => (v ? c().setColor(v).run() : c().unsetColor().run())} />
              <ColorMenu
                title="Highlight"
                glyph={<Icon name="dye" size={14} />}
                colors={highlights}
                onPick={(v) => (v ? c().setHighlight({ color: v }).run() : c().unsetHighlight().run())}
              />
              <RB title="Clear formatting" onRun={() => c().unsetAllMarks().run()}>
                <Icon name="close" size={13} />
              </RB>
            </Group>
            <Group label="Paragraph">
              {(['left', 'center', 'right', 'justify'] as const).map((a) => (
                <RB key={a} title={`Align ${a}`} on={st.align === a} onRun={() => c().setTextAlign(a).run()}>
                  <AlignGlyph a={a} />
                </RB>
              ))}
              <RB title="Bulleted list" on={st.bullet} onRun={() => c().toggleBulletList().run()}>
                •≡
              </RB>
              <RB title="Numbered list" on={st.ordered} onRun={() => c().toggleOrderedList().run()}>
                1≡
              </RB>
              <RB title="Decrease indent (Shift+Tab)" onRun={() => c().changeIndent(-0.5).run()}>
                ⇤
              </RB>
              <RB title="Increase indent (Tab)" onRun={() => c().changeIndent(0.5).run()}>
                ⇥
              </RB>
              <RB
                title="First-line indent"
                on={st.firstLine != null ? st.firstLine > 0 : cord.style.firstLineIndent > 0}
                onRun={() => c().setFirstLine(st.firstLine != null ? (st.firstLine > 0 ? 0 : null) : cord.style.firstLineIndent > 0 ? 0 : 0.5).run()}
              >
                ¶→
              </RB>
              <select
                className="rselect"
                value={st.lineHeight ?? ''}
                onChange={(e) => c().setLineHeight(e.target.value ? Number(e.target.value) : null).run()}
                aria-label="Line spacing"
                title="Line spacing"
              >
                <option value="">↕ {cord.style.lineHeight}</option>
                {LINE.map((l) => (
                  <option key={l} value={l}>
                    {l.toFixed(l % 1 ? 2 : 1)}
                  </option>
                ))}
              </select>
            </Group>
          </>
        )}

        {tab === 'insert' && (
          <>
            <Group label="Pages">
              <RB wide title="Page break (Ctrl+Enter)" onRun={() => c().insertPageBreak().run()}>
                <Icon name="layers" size={15} /> Page break
              </RB>
            </Group>
            <Group label="References">
              <RB
                wide
                title="Footnote: a numbered note at the foot of the page, linked both ways"
                onRun={() => {
                  c().insertFootnote('').run()
                  // Jump to the new note's text at the bottom of its page.
                  setTimeout(() => {
                    const notes = document.querySelectorAll<HTMLElement>('.cord-note__text')
                    const empty = [...notes].find((n) => !n.textContent?.trim())
                    empty?.focus()
                  }, 120)
                }}
              >
                <sup>1</sup> Footnote
              </RB>
              <RB wide title="Stitch to a Thread" onRun={() => c().insertContent('[[').run()}>
                ⌗ Stitch
              </RB>
            </Group>
            <Group label="Elements">
              <RB wide title="Table" onRun={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
                ▦ Table
              </RB>
              <RB
                wide
                title="Image"
                onRun={() => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.accept = 'image/*'
                  input.onchange = async () => {
                    const f = input.files?.[0]
                    if (!f) return
                    const [p] = await importFiles('attachments', [f])
                    c().setImage({ src: encodeURI(p), alt: stem(p) }).run()
                  }
                  input.click()
                }}
              >
                ▣ Image
              </RB>
              <RB wide title="Divider" onRun={() => c().setHorizontalRule().run()}>
                — Divider
              </RB>
              <RB wide title="Today's date" onRun={() => c().insertContent(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })).run()}>
                ◷ Date
              </RB>
            </Group>
          </>
        )}

        {tab === 'layout' && (
          <>
            <Group label="Page">
              <select className="rselect rselect--wide" value={cord.page.size} onChange={(e) => update({ page: { ...cord.page, size: e.target.value as PageSizeId } })} aria-label="Page size">
                {Object.entries(PAGE_SIZES).map(([id, s]) => (
                  <option key={id} value={id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <div className="seg seg--light">
                {(['portrait', 'landscape'] as const).map((o) => (
                  <button key={o} className={cord.page.orientation === o ? 'is-on' : ''} onClick={() => update({ page: { ...cord.page, orientation: o } })}>
                    {o === 'portrait' ? 'Portrait' : 'Landscape'}
                  </button>
                ))}
              </div>
            </Group>
            <Group label="Margins (in)">
              <select
                className="rselect rselect--wide"
                value={MARGINS.find((m) => JSON.stringify(m.m) === JSON.stringify(cord.page.margins))?.id ?? ''}
                onChange={(e) => {
                  const m = MARGINS.find((x) => x.id === e.target.value)
                  if (m) update({ page: { ...cord.page, margins: m.m } })
                }}
                aria-label="Margin preset"
              >
                <option value="">Custom</option>
                {MARGINS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              {(['top', 'bottom', 'left', 'right'] as const).map((k) => (
                <label key={k} className="rnum">
                  <span>{k[0].toUpperCase()}</span>
                  <input
                    type="number"
                    step={0.05}
                    min={0.2}
                    max={3}
                    value={cord.page.margins[k]}
                    onChange={(e) => update({ page: { ...cord.page, margins: { ...cord.page.margins, [k]: Math.max(0.2, Number(e.target.value) || 0.2) } } })}
                  />
                </label>
              ))}
            </Group>
            <Group label="Document style">
              <select className="rselect rselect--wide" value={cord.style.font} onChange={(e) => update({ style: { ...cord.style, font: e.target.value } })} aria-label="Body font">
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id}
                  </option>
                ))}
              </select>
              <select className="rselect" value={cord.style.size} onChange={(e) => update({ style: { ...cord.style, size: Number(e.target.value) } })} aria-label="Body size">
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} pt
                  </option>
                ))}
              </select>
              <select className="rselect" value={cord.style.lineHeight} onChange={(e) => update({ style: { ...cord.style, lineHeight: Number(e.target.value) } })} aria-label="Line spacing">
                {LINE.map((l) => (
                  <option key={l} value={l}>
                    ↕ {l}
                  </option>
                ))}
              </select>
              <label className="rnum" title="First-line indent for every paragraph (in)">
                <span>¶</span>
                <input type="number" step={0.1} min={0} max={2} value={cord.style.firstLineIndent} onChange={(e) => update({ style: { ...cord.style, firstLineIndent: Number(e.target.value) || 0 } })} />
              </label>
              <label className="rnum" title="Space after each paragraph (pt)">
                <span>⇣</span>
                <input type="number" step={2} min={0} max={36} value={cord.style.paragraphSpacing} onChange={(e) => update({ style: { ...cord.style, paragraphSpacing: Number(e.target.value) || 0 } })} />
              </label>
            </Group>
          </>
        )}

        {tab === 'header' && (
          <>
            <Group label="Header">
              {slot('header', 'left', 'Left')}
              {slot('header', 'center', 'Center')}
              {slot('header', 'right', 'Right')}
            </Group>
            <Group label="Footer">
              {slot('footer', 'left', 'Left')}
              {slot('footer', 'center', 'Center')}
              {slot('footer', 'right', 'Right')}
            </Group>
            <Group label="Insert into field">
              {['{page}', '{pages}', '{title}', '{author}', '{date}'].map((t) => (
                <button key={t} className="chip-btn mono" onMouseDown={(e) => e.preventDefault()} onClick={() => insertToken(t)}>
                  {t}
                </button>
              ))}
            </Group>
            <Group label="Page numbers">
              <select className="rselect rselect--wide" value={numberPreset} onChange={(e) => setNumberPreset(e.target.value)} aria-label="Page number position">
                <option value="none">None</option>
                <option value="bottom-center">Bottom · center</option>
                <option value="bottom-right">Bottom · right</option>
                <option value="top-right">Top · right</option>
                <option value="page-of">“Page 1 of N” · bottom</option>
                {numberPreset === 'custom' && <option value="custom">Custom</option>}
              </select>
              <select
                className="rselect"
                value={cord.numbering.format}
                onChange={(e) => update({ numbering: { ...cord.numbering, format: e.target.value as NumberFormat } })}
                aria-label="Number format"
              >
                <option value="1">1, 2, 3</option>
                <option value="i">i, ii, iii</option>
                <option value="I">I, II, III</option>
                <option value="a">a, b, c</option>
              </select>
              <label className="rnum" title="Start numbering at">
                <span>#</span>
                <input type="number" min={0} value={cord.numbering.start} onChange={(e) => update({ numbering: { ...cord.numbering, start: Math.max(0, Number(e.target.value) || 1) } })} />
              </label>
              <label className="rcheck">
                <input type="checkbox" checked={cord.differentFirst} onChange={(e) => update({ differentFirst: e.target.checked })} /> Different first page
              </label>
            </Group>
          </>
        )}

        {tab === 'review' && (
          <>
            <Group label="Count">
              <div className="rstat">
                <b>{st.words.toLocaleString()}</b>
                <span>words</span>
              </div>
              <div className="rstat">
                <b>{st.chars.toLocaleString()}</b>
                <span>characters</span>
              </div>
              <div className="rstat">
                <b>{pages}</b>
                <span>pages</span>
              </div>
              <div className="rstat">
                <b>{st.notes}</b>
                <span>footnotes</span>
              </div>
              <div className="rstat">
                <b>{Math.max(1, Math.round(st.words / 230))}m</b>
                <span>to read</span>
              </div>
            </Group>
            <Group label="Export">
              <RB wide title="Print, or save as PDF" onRun={() => onExport('print')}>
                <Icon name="download" size={14} /> Print / PDF
              </RB>
              <RB wide title="Word document" onRun={() => onExport('docx')}>
                <Icon name="download" size={14} /> Word (.docx)
              </RB>
              <RB wide title="Markdown" onRun={() => onExport('md')}>
                <Icon name="download" size={14} /> Markdown
              </RB>
            </Group>
          </>
        )}
      </div>
    </div>
  )
}

function AlignGlyph({ a }: { a: 'left' | 'center' | 'right' | 'justify' }) {
  const lines = { left: [14, 10, 14, 8], center: [14, 10, 14, 8], right: [14, 10, 14, 8], justify: [14, 14, 14, 14] }[a]
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
      {lines.map((w, i) => {
        const x = a === 'center' ? (16 - w) / 2 : a === 'right' ? 16 - w : 1
        return <rect key={i} x={x} y={1 + i * 3.5} width={w} height="1.6" rx="0.8" fill="currentColor" />
      })}
    </svg>
  )
}
