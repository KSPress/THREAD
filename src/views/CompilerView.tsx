// The Compiler (Manuscript): arrange Threads, then bind them into PDF / DOCX.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useStore, type Manuscript, type ManuscriptItem } from '../core/store'
import { buildSections, newManuscript, sectionHtml, toDocx, toMarkdown, toPdf } from '../core/compiler'
import { pandocAvailable, pandocConvert, saveFile } from '../core/platform'
import { dirname } from '../core/paths'

const ROLES: ManuscriptItem['role'][] = ['title', 'front', 'chapter', 'appendix']

export function CompilerView() {
  const threads = useStore((s) => s.threads)
  const readMeta = useStore((s) => s.readMeta)
  const writeMeta = useStore((s) => s.writeMeta)
  const notify = useStore((s) => s.notify)
  const [list, setList] = useState<Manuscript[] | null>(null)
  const [currentId, setCurrentId] = useState<string>('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'board' | 'preview'>('board')
  const [busy, setBusy] = useState<string | null>(null)
  const [pandoc, setPandoc] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void readMeta<Manuscript[]>('manuscripts.json', []).then((l) => {
      const ms = l.length ? l : [newManuscript('My Manuscript')]
      setList(ms)
      setCurrentId(ms[0].id)
    })
    void pandocAvailable().then(setPandoc)
  }, [])

  const ms = list?.find((m) => m.id === currentId) ?? list?.[0]

  const update = (patch: Partial<Manuscript>) => {
    if (!list || !ms) return
    const next = list.map((m) => (m.id === ms.id ? { ...m, ...patch } : m))
    setList(next)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void writeMeta('manuscripts.json', next), 300)
  }

  const sources = useMemo(() => {
    const q = query.toLowerCase()
    return Object.values(threads)
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.path.toLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  }, [threads, query])

  const sections = useMemo(() => (ms ? buildSections(ms, threads) : []), [ms, threads])
  const words = sections.reduce((s, x) => s + x.markdown.split(/\s+/).filter(Boolean).length, 0)

  if (!list || !ms) return <div className="view" />

  const inSet = new Set(ms.items.map((i) => i.path))
  const add = (path: string) => {
    if (inSet.has(path)) return
    const name = threads[path]?.name.toLowerCase() ?? ''
    const role: ManuscriptItem['role'] = /title/.test(name) ? 'title' : /appendix|glossary|index/.test(name) ? 'appendix' : 'chapter'
    update({ items: [...ms.items, { path, role }] })
  }
  const move = (from: number, to: number) => {
    const items = [...ms.items]
    const [it] = items.splice(from, 1)
    items.splice(to > from ? to - 1 : to, 0, it)
    update({ items })
  }

  const exportAs = async (kind: 'pdf' | 'docx' | 'md' | 'pandoc-pdf' | 'pandoc-docx' | 'pandoc-epub') => {
    setBusy(kind)
    try {
      const base = ms.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Manuscript'
      if (kind === 'md') await saveFile(`${base}.md`, toMarkdown(ms, sections))
      else if (kind === 'pdf') await saveFile(`${base}.pdf`, await toPdf(ms, sections))
      else if (kind === 'docx') await saveFile(`${base}.docx`, await toDocx(ms, sections))
      else {
        const fmt = kind.split('-')[1] as 'pdf' | 'docx' | 'epub'
        await saveFile(`${base}.${fmt}`, await pandocConvert(toMarkdown(ms, sections), fmt))
      }
      notify('Manuscript bound ✓')
    } catch (e) {
      console.error(e)
      alert(`Compile failed: ${e}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="view">
      <div className="topbar">
        <div className="crumbs">
          <Icon name="compiler" size={15} />
          <b>The Compiler</b>
        </div>
        <div className="toolbar-group">
          <select className="input" style={{ height: 30, border: 0, background: 'transparent' }} value={ms.id} onChange={(e) => setCurrentId(e.target.value)}>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            title="New manuscript"
            onClick={() => {
              const m = newManuscript(`Manuscript ${list.length + 1}`)
              const next = [...list, m]
              setList(next)
              setCurrentId(m.id)
              void writeMeta('manuscripts.json', next)
            }}
          >
            <Icon name="plus" size={16} />
          </button>
          {list.length > 1 && (
            <button
              className="icon-btn"
              title="Delete manuscript"
              onClick={() => {
                if (!confirm(`Delete “${ms.title}”? (Threads are untouched.)`)) return
                const next = list.filter((m) => m.id !== ms.id)
                setList(next)
                setCurrentId(next[0].id)
                void writeMeta('manuscripts.json', next)
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
        <span className="spacer" />
        <div className="seg seg--light">
          <button className={tab === 'board' ? 'is-on' : ''} onClick={() => setTab('board')}>
            Board
          </button>
          <button className={tab === 'preview' ? 'is-on' : ''} onClick={() => setTab('preview')}>
            Preview
          </button>
        </div>
      </div>

      <div className="compiler">
        <section className="module compiler__col">
          <div className="module__head">
            <span className="label">[ Threads ]</span>
          </div>
          <div style={{ padding: '0 12px 8px' }}>
            <input className="input" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="compiler__scroll">
            {sources.map((t) => (
              <button key={t.path} className={'source-item' + (inSet.has(t.path) ? ' is-in' : '')} onClick={() => add(t.path)} title={t.path}>
                <Icon name={inSet.has(t.path) ? 'check' : 'plus'} size={14} />
                <span>{t.name}</span>
                <small className="mono muted" style={{ fontSize: 10 }}>
                  {dirname(t.path).split('/').pop()}
                </small>
              </button>
            ))}
          </div>
        </section>

        <section className="module compiler__col glow" style={{ ['--glow' as any]: 'var(--tan)' }}>
          {tab === 'board' ? (
            <div className="manuscript">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '0 4px 4px' }}>
                <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.03em' }}>
                  {ms.title}
                  <span style={{ color: 'var(--accent)' }}>.</span>
                </h2>
                <span className="spacer" />
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {ms.items.length} threads · ~{words.toLocaleString()} words · ~{Math.max(1, Math.round(words / 280))} pages
                </span>
              </div>
              {ms.items.length === 0 && (
                <div className="empty-note" style={{ padding: 30, textAlign: 'center', border: '2px dashed var(--line-strong)', borderRadius: 18 }}>
                  Click Threads on the left to bind them into this manuscript. Drag cards to reorder.
                </div>
              )}
              {ms.items.map((it, i) => {
                const t = threads[it.path]
                const chapterNo = ms.items.slice(0, i + 1).filter((x) => x.role === it.role).length
                return (
                  <div
                    key={it.path}
                    className={`ms-card ms-card--${it.role}` + (dragIdx === i ? ' is-dragging' : '') + (overIdx === i && dragIdx !== i ? ' is-over' : '')}
                    draggable
                    onDragStart={(e) => {
                      setDragIdx(i)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setOverIdx(i)
                    }}
                    onDragEnd={() => {
                      setDragIdx(null)
                      setOverIdx(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragIdx !== null && dragIdx !== i) move(dragIdx, i)
                      setDragIdx(null)
                      setOverIdx(null)
                    }}
                    style={{ animationDelay: `${i * 25}ms` }}
                  >
                    <span className="ms-card__grip">
                      <Icon name="grip" size={18} />
                    </span>
                    <span className="ms-card__num">
                      {it.role === 'title' ? '✦' : it.role === 'appendix' ? String.fromCharCode(64 + chapterNo) : it.role === 'front' ? '§' : String(chapterNo).padStart(2, '0')}
                    </span>
                    <div className="ms-card__main">
                      <b>{t?.title ?? it.path}</b>
                      <small>{t ? `${t.words.toLocaleString()} words · ${it.path}` : 'Missing from the vault'}</small>
                      <div className="roles">
                        {ROLES.map((r) => (
                          <button
                            key={r}
                            className={it.role === r ? 'is-on' : ''}
                            onClick={() => update({ items: ms.items.map((x, j) => (j === i ? { ...x, role: r } : x)) })}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button className="icon-btn" onClick={() => update({ items: ms.items.filter((_, j) => j !== i) })} title="Remove">
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                )
              })}
              {ms.items.length > 0 && (
                <div
                  style={{ minHeight: 40 }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setOverIdx(ms.items.length)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragIdx !== null) move(dragIdx, ms.items.length)
                    setDragIdx(null)
                    setOverIdx(null)
                  }}
                />
              )}
            </div>
          ) : (
            <div className="preview-pages">
              <div className={'preview-page' + (ms.font === 'serif' ? ' preview-page--serif' : '')}>
                <div className="preview-title">
                  <h1>{ms.title}</h1>
                  {ms.subtitle && <p style={{ fontStyle: 'italic', color: '#666' }}>{ms.subtitle}</p>}
                  {ms.author && <p style={{ letterSpacing: '0.2em', fontSize: 10, marginTop: 30 }}>{ms.author.toUpperCase()}</p>}
                </div>
              </div>
              {sections
                .filter((s) => s.role !== 'title')
                .map((s, i) => (
                  <div key={i} className={'preview-page' + (ms.font === 'serif' ? ' preview-page--serif' : '')}>
                    {ms.runningHeader && (
                      <div style={{ position: 'absolute', top: '4%', left: 0, right: 0, textAlign: 'center', fontSize: 8, color: '#999', letterSpacing: '0.1em' }}>
                        {ms.title}
                      </div>
                    )}
                    {s.label && <div style={{ color: '#ff5f45', fontSize: 8, letterSpacing: '0.3em', marginTop: '14%' }}>{s.label.toUpperCase()}</div>}
                    <h1>{s.title}</h1>
                    <div dangerouslySetInnerHTML={{ __html: sectionHtml(s.markdown) }} />
                    {ms.pageNumbers && <div className="preview-page__foot">{i + 1}</div>}
                  </div>
                ))}
            </div>
          )}
        </section>

        <section className="module compiler__col">
          <div className="module__head">
            <span className="label">[ Binding ]</span>
          </div>
          <div className="compiler__scroll">
            <label className="field">
              <span className="label">Title</span>
              <input className="input" value={ms.title} onChange={(e) => update({ title: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Subtitle</span>
              <input className="input" value={ms.subtitle} onChange={(e) => update({ subtitle: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Author</span>
              <input className="input" value={ms.author} onChange={(e) => update({ author: e.target.value })} />
            </label>
            <div className="opt-row">
              <span>Page size</span>
              <div className="seg seg--light">
                {(['A5', 'B5', 'A4', 'LETTER'] as const).map((p) => (
                  <button key={p} className={ms.pageSize === p ? 'is-on' : ''} onClick={() => update({ pageSize: p })}>
                    {p === 'LETTER' ? 'Letter' : p}
                  </button>
                ))}
              </div>
            </div>
            <div className="opt-row">
              <span>Typeface</span>
              <div className="seg seg--light">
                <button className={ms.font === 'serif' ? 'is-on' : ''} onClick={() => update({ font: 'serif' })}>
                  Serif
                </button>
                <button className={ms.font === 'sans' ? 'is-on' : ''} onClick={() => update({ font: 'sans' })}>
                  Sans
                </button>
              </div>
            </div>
            <div className="opt-row">
              <span>Size · {ms.fontSize}pt</span>
              <input type="range" className="range" style={{ width: 110 }} min={9} max={14} step={0.5} value={ms.fontSize} onChange={(e) => update({ fontSize: +e.target.value })} />
            </div>
            {(
              [
                ['chapterBreaks', 'Chapters on new pages'],
                ['pageNumbers', 'Page numbers'],
                ['runningHeader', 'Running header'],
                ['keepDeepQuotes', 'Keep Deep Stitch citations'],
              ] as const
            ).map(([key, label]) => (
              <div className="opt-row" key={key}>
                <span>{label}</span>
                <button className={'toggle toggle--h' + (ms[key] ? ' is-on' : '')} onClick={() => update({ [key]: !ms[key] } as Partial<Manuscript>)}>
                  <span />
                </button>
              </div>
            ))}
            <div className="label" style={{ margin: '18px 0 8px' }}>
              [ Export ]
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <button className="btn btn--accent btn--block" disabled={!ms.items.length || !!busy} onClick={() => void exportAs('pdf')}>
                <Icon name="download" size={14} /> {busy === 'pdf' ? 'Binding…' : 'Print-ready PDF'}
              </button>
              <button className="btn btn--ink btn--block" disabled={!ms.items.length || !!busy} onClick={() => void exportAs('docx')}>
                <Icon name="download" size={14} /> {busy === 'docx' ? 'Binding…' : 'Word document (.docx)'}
              </button>
              <button className="btn btn--block" disabled={!ms.items.length || !!busy} onClick={() => void exportAs('md')}>
                <Icon name="download" size={14} /> Clean Markdown
              </button>
              {pandoc && (
                <>
                  <div className="label" style={{ marginTop: 10 }}>
                    [ Pandoc · host ]
                  </div>
                  {(['pandoc-pdf', 'pandoc-docx', 'pandoc-epub'] as const).map((k) => (
                    <button key={k} className="btn btn--block" disabled={!ms.items.length || !!busy} onClick={() => void exportAs(k)}>
                      <Icon name="layers" size={14} /> {busy === k ? 'Running Pandoc…' : `Pandoc → ${k.split('-')[1].toUpperCase()}`}
                    </button>
                  ))}
                </>
              )}
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 14 }}>
              The Compiler strips Dyes, Stitch brackets, Pinboards and table schemas, then typesets with standard pagination and headers.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
