// The Stitching: right sidebar with Backlinks and the tactile Frontmatter UI.
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { backlinksOf, subThreadDir, useStore, type ThreadInfo } from '../core/store'
import { ThreadIcon } from './ThreadIcon'
import { normalizeDye, type Frontmatter } from '../core/markdown'
import { Icon } from './Icon'
import { DyeBadge } from './DyeBadge'
import { Heatmap } from './Heatmap'
import { DyeEditor } from './DyeEditor'
import { GcalPill } from './Agenda'
import { extractDeadlines, parseWhen } from '../../shared/deadlines.js'
import { relativeDue, isOverdue } from '../core/deadlines'

const RESERVED = new Set(['dyes', 'tags', 'deadline', 'due', 'remind', 'done', 'icon', 'color', 'background'])

export function Stitching() {
  const active = useStore((s) => s.active)
  const thread = useStore((s) => (s.active ? s.threads[s.active] : undefined))
  return (
    <aside className="stitching">
      <div className="stitching__inner">{active && thread && <StitchingBody key={active} thread={thread} />}</div>
    </aside>
  )
}

function StitchingBody({ thread }: { thread: ThreadInfo }) {
  const files = useStore((s) => s.files)
  const threads = useStore((s) => s.threads)
  const open = useStore((s) => s.open)
  const openStitch = useStore((s) => s.openStitch)
  const set = useStore((s) => s.set)
  const backlinks = useMemo(() => backlinksOf(thread.path, { files, threads }), [thread.path, files, threads])
  // One card per Thread, even when it stitches here several times.
  const grouped = useMemo(() => {
    const map = new Map<string, { from: ThreadInfo; stitches: typeof backlinks[number]['stitch'][] }>()
    for (const b of backlinks) {
      const g = map.get(b.from.path) ?? { from: b.from, stitches: [] }
      g.stitches.push(b.stitch)
      map.set(b.from.path, g)
    }
    return [...map.values()]
  }, [backlinks])
  const outline = useMemo(
    () => [...thread.body.matchAll(/^(#{1,4})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2') })),
    [thread.body],
  )
  const outgoing = useMemo(() => {
    const seen = new Set<string>()
    return thread.stitches.filter((s) => {
      const k = s.target + (s.anchor ?? '')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [thread.stitches])
  const modified = thread.mtime ? new Date(thread.mtime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'

  return (
    <>
      <section className="module module--frame screws thread-card">
        <div className="label" style={{ textAlign: 'center' }}>
          [ Thread ]
        </div>
        <h3>{thread.title}</h3>
        <div className="thread-card__path">{thread.path}</div>
        <div className="stat-row">
          <div className="stat">
            <b>{thread.words.toLocaleString()}</b>
            <span>Words</span>
          </div>
          <div className="stat">
            <b>{grouped.length}</b>
            <span>Stitched</span>
          </div>
          <div className="stat">
            <b style={{ fontSize: 15, lineHeight: '23px' }}>{modified}</b>
            <span>Woven</span>
          </div>
        </div>
      </section>

      <DyesModule thread={thread} />
      <SubThreadsModule thread={thread} />
      <DeadlineModule thread={thread} />
      <PropertiesModule thread={thread} />
      <section className="module">
        <div className="module__head">
          <span className="label">[ Woven on ]</span>
        </div>
        <div className="module__body">
          <Heatmap path={thread.path} compact />
        </div>
      </section>

      <section className="module">
        <div className="module__head">
          <span className="label">[ Stitched from ]</span>
          <span className="spacer" />
          <span className="mono muted" style={{ fontSize: 11 }}>
            {grouped.length}
          </span>
        </div>
        <div className="module__body">
          {backlinks.length === 0 && <div className="empty-note">No Threads stitch here yet. Type [[{thread.name}]] anywhere.</div>}
          {grouped.map(({ from, stitches }) => (
            <button key={from.path} className="backlink" onClick={() => open(from.path)}>
              <b>
                <Icon name="stitch" size={13} /> {from.name}
                {stitches.length > 1 && <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>×{stitches.length}</span>}
              </b>
              <small>{contextLine(from.body, stitches[0].raw)}</small>
            </button>
          ))}
        </div>
      </section>

      {outgoing.length > 0 && (
        <section className="module">
          <div className="module__head">
            <span className="label">[ Stitches out ]</span>
          </div>
          <div className="module__body" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {outgoing.map((s) => (
              <span
                key={s.raw}
                className={'stitch' + (s.deep ? ' stitch--deep' : '') + (useStore.getState().resolve(s.target) ? '' : ' stitch--loose')}
                onClick={() => openStitch(s.target, s.anchor)}
              >
                <span className="stitch__glyph">{s.deep ? '❝' : '⌗'}</span>
                {s.alias ?? s.target.replace(/\.md$/, '')}
                {s.deep && s.anchor ? ` · p.${new URLSearchParams(s.anchor).get('page')}` : ''}
              </span>
            ))}
          </div>
        </section>
      )}

      {outline.length > 1 && (
        <section className="module">
          <div className="module__head">
            <span className="label">[ Outline ]</span>
          </div>
          <div className="module__body">
            {outline.map((h, i) => (
              <button
                key={i}
                className="outline-item"
                style={{ ['--lvl' as any]: h.level - 1 }}
                onClick={() => {
                  const el = [...document.querySelectorAll('.thread-editor h1, .thread-editor h2, .thread-editor h3, .thread-editor h4, .cord-editor h1, .cord-editor h2, .cord-editor h3, .cord-editor h4')].find(
                    (e) => e.textContent?.trim() === h.text.trim(),
                  )
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                {h.text}
              </button>
            ))}
          </div>
        </section>
      )}
      <button className="btn btn--ghost" style={{ alignSelf: 'center' }} onClick={() => set({ stitchingOpen: false })}>
        <Icon name="panelRight" size={14} /> Hide panel
      </button>
    </>
  )
}

function contextLine(body: string, raw: string) {
  const i = body.indexOf(`[[${raw}]]`)
  if (i < 0) return ''
  const start = body.lastIndexOf('\n', i) + 1
  let end = body.indexOf('\n', i)
  if (end < 0) end = body.length
  const line = body
    .slice(start, end)
    .replace(/`[^`]*`/g, '')
    .replace(/^\s*(?:[>#]+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, '')
    .replace(/\[\[([^\[\]|]+\|)?([^\[\]]+)\]\]/g, (_m, _a, b: string) => b.replace(/#.*$/, ''))
    .replace(/\\\|/g, '|')
    .replace(/(\*\*|__|==|~~)/g, '')
    .replace(/^\|\s*|\s*\|$/g, '')
    .trim()
  return line.length > 120 ? line.slice(0, 119) + '…' : line
}

/* ------------------------------------------------------------------ */

function DyesModule({ thread }: { thread: ThreadInfo }) {
  const setFrontmatter = useStore((s) => s.setFrontmatter)
  const threads = useStore((s) => s.threads)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ dye: string; rect: DOMRect } | null>(null)
  const all = useMemo(() => {
    const s = new Set<string>()
    Object.values(threads).forEach((t) => t.dyes.forEach((d) => s.add(d)))
    return [...s].sort()
  }, [threads])

  const write = (dyes: string[]) => {
    const fm: Frontmatter = { ...thread.frontmatter }
    delete fm.tags
    fm.dyes = dyes.length ? dyes : undefined
    void setFrontmatter(thread.path, fm)
  }
  const add = () => {
    const d = normalizeDye(draft)
    setDraft('')
    if (d && !thread.dyes.includes(d)) write([...thread.dyes, d])
  }

  return (
    <section className="module">
      <div className="module__head">
        <span className="label">[ Dyes ]</span>
      </div>
      <div className="module__body">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {thread.dyes.map((d) => (
            <DyeBadge key={d} dye={d} onClick={(e) => setEditing({ dye: d, rect: (e!.currentTarget as HTMLElement).getBoundingClientRect() })}>
              <span
                role="button"
                style={{ marginLeft: 2, opacity: 0.55 }}
                onClick={(e) => {
                  e.stopPropagation()
                  write(thread.dyes.filter((x) => x !== d))
                }}
              >
                ×
              </span>
            </DyeBadge>
          ))}
          {thread.dyes.length === 0 && <span className="empty-note">Undyed. Dyes color this Thread across the Spool and the Tapestry.</span>}
        </div>
        {editing && <DyeEditor dye={editing.dye} anchor={editing.rect} onClose={() => setEditing(null)} />}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="input"
            list="thread-all-dyes"
            placeholder="Add a Dye…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn btn--ink" onClick={add}>
            <Icon name="dye" size={14} />
          </button>
          <datalist id="thread-all-dyes">
            {all.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

type PropType = 'text' | 'number' | 'toggle' | 'date' | 'list' | 'stitch'

const PROP_TYPES: { type: PropType; label: string; glyph: string; init: unknown }[] = [
  { type: 'text', label: 'Text', glyph: 'Aa', init: '' },
  { type: 'number', label: 'Number', glyph: '#', init: 0 },
  { type: 'toggle', label: 'Toggle', glyph: '◧', init: false },
  { type: 'date', label: 'Date', glyph: '◷', init: new Date().toISOString().slice(0, 10) },
  { type: 'list', label: 'List', glyph: '≡', init: [] },
  { type: 'stitch', label: 'Stitch', glyph: '⌗', init: '[[]]' },
]

function typeOf(v: unknown): PropType {
  if (typeof v === 'boolean') return 'toggle'
  if (typeof v === 'number') return 'number'
  if (Array.isArray(v)) return 'list'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date'
  if (typeof v === 'string' && /^\[\[.*\]\]$/.test(v)) return 'stitch'
  return 'text'
}

function PropertiesModule({ thread }: { thread: ThreadInfo }) {
  const setFrontmatter = useStore((s) => s.setFrontmatter)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const entries = Object.entries(thread.frontmatter).filter(([k]) => !RESERVED.has(k))

  const update = (key: string, value: unknown) => void setFrontmatter(thread.path, { ...thread.frontmatter, [key]: value })
  const remove = (key: string) => {
    const fm = { ...thread.frontmatter }
    delete fm[key]
    void setFrontmatter(thread.path, fm)
  }
  const add = (type: PropType) => {
    const key = name.trim().replace(/\s+/g, '_') || `${type}_${entries.length + 1}`
    update(key, PROP_TYPES.find((p) => p.type === type)!.init)
    setName('')
    setAdding(false)
  }

  return (
    <section className="module">
      <div className="module__head">
        <span className="label">[ Properties ]</span>
        <span className="spacer" />
        <button className="chip-btn" onClick={() => setAdding(!adding)}>
          <Icon name="plus" size={11} /> Add
        </button>
      </div>
      <div className="module__body">
        {entries.length === 0 && !adding && <div className="empty-note">No properties. They live in this file’s YAML frontmatter.</div>}
        {entries.map(([k, v]) => (
          <div className="prop" key={k}>
            <span className="prop__key" title={k}>
              {k}
            </span>
            <div className="prop__val">
              <PropControl value={v} onChange={(nv) => update(k, nv)} />
            </div>
            <button className="prop__del" onClick={() => remove(k)} title="Remove property">
              ×
            </button>
          </div>
        ))}
        {adding && (
          <div style={{ marginTop: 10 }}>
            <input className="input" autoFocus placeholder="Property name" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="prop-add">
              {PROP_TYPES.map((p) => (
                <button key={p.type} className="key" onClick={() => add(p.type)}>
                  <b>{p.glyph}</b>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function PropControl({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const openStitch = useStore((s) => s.openStitch)
  const type = typeOf(value)
  const [listDraft, setListDraft] = useState('')
  switch (type) {
    case 'toggle':
      return (
        <button className={'toggle toggle--h' + (value ? ' is-on' : '')} onClick={() => onChange(!value)} aria-pressed={!!value}>
          <span />
        </button>
      )
    case 'number':
      return <Knob value={value as number} onChange={onChange} />
    case 'date':
      return <input type="date" value={value as string} onChange={(e) => onChange(e.target.value)} />
    case 'list':
      return (
        <>
          {(value as unknown[]).map((item, i) => (
            <span key={i} className="chip-btn" onClick={() => onChange((value as unknown[]).filter((_, j) => j !== i))} title="Remove">
              {String(item)} ×
            </span>
          ))}
          <input
            placeholder="+ item"
            style={{ width: 80 }}
            value={listDraft}
            onChange={(e) => setListDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && listDraft.trim()) {
                onChange([...(value as unknown[]), listDraft.trim()])
                setListDraft('')
              }
            }}
          />
        </>
      )
    case 'stitch': {
      const target = String(value).slice(2, -2)
      return (
        <>
          {target && (
            <span className="stitch" onClick={() => openStitch(target)}>
              <span className="stitch__glyph">⌗</span>
              {target}
            </span>
          )}
          <input
            list="thread-names"
            defaultValue={target}
            placeholder="Thread…"
            onBlur={(e) => onChange(`[[${e.target.value.trim()}]]`)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            style={{ width: target ? 70 : '100%' }}
          />
          <ThreadNames />
        </>
      )
    }
    default:
      return <input value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value)} />
  }
}

function ThreadNames() {
  const threads = useStore((s) => s.threads)
  return (
    <datalist id="thread-names">
      {Object.values(threads).map((t) => (
        <option key={t.path} value={t.name} />
      ))}
    </datalist>
  )
}

/** Rotary knob: drag vertically to dial a number, or type it. */
function Knob({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const start = useRef<{ y: number; v: number } | null>(null)
  const angle = ((((value % 100) + 100) % 100) / 100) * 300 - 150
  const onDown = (e: PointerEvent<HTMLSpanElement>) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, v: value }
  }
  const onMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (!start.current) return
    const step = e.shiftKey ? 10 : 1
    onChange(Math.round(start.current.v + ((start.current.y - e.clientY) / 4) * step))
  }
  return (
    <>
      <span
        className="knob"
        style={{ ['--a' as any]: `${angle}deg` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (start.current = null)}
        onWheel={(e) => onChange(value + (e.deltaY < 0 ? 1 : -1))}
        title="Drag up/down (Shift = ×10)"
      />
      <input className="knob-val" inputMode="decimal" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </>
  )
}

/* ------------------------------------------------------------------ */

const REMINDERS: { value: string | number; label: string }[] = [
  { value: 0, label: 'At time' },
  { value: '1h', label: '1h' },
  { value: '1d', label: '1 day' },
  { value: '1w', label: '1 week' },
]

function DeadlineModule({ thread }: { thread: ThreadInfo }) {
  const setFrontmatter = useStore((s) => s.setFrontmatter)
  const fm = thread.frontmatter
  const raw = (fm.deadline ?? fm.due) as string | undefined
  const when = parseWhen(raw)
  const [date, time] = typeof raw === 'string' ? raw.split(/[T ]/) : ['', '']
  const remind = fm.remind === undefined ? null : Array.isArray(fm.remind) ? fm.remind : [fm.remind]
  const items = useMemo(() => extractDeadlines(thread.path, thread.title, fm, thread.body), [thread])
  const tasks = items.filter((d) => d.kind === 'task')
  const own = items.find((d) => d.kind === 'thread')

  const write = (patch: Record<string, unknown>) => {
    const next: Frontmatter = { ...fm, ...patch }
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k]
    if (next.due !== undefined && patch.deadline !== undefined) delete next.due
    void setFrontmatter(thread.path, next)
  }
  const setWhen = (d: string, t: string) => write({ deadline: d ? (t ? `${d}T${t}` : d) : undefined, ...(d ? {} : { remind: undefined, done: undefined }) })
  const toggleRemind = (v: string | number) => {
    const cur = remind ?? ['1d', 0]
    const has = cur.some((x) => String(x) === String(v))
    const next = has ? cur.filter((x) => String(x) !== String(v)) : [...cur, v]
    write({ remind: next.length ? next : 'none' })
  }

  return (
    <section className="module">
      <div className="module__head">
        <span className="label">[ Deadline ]</span>
        <span className="spacer" />
        {when && <GcalPill />}
      </div>
      <div className="module__body">
        <div className="deadline-row">
          <input className="input" type="date" value={date ?? ''} onChange={(e) => setWhen(e.target.value, time ?? '')} aria-label="Deadline date" />
          <input
            className="input"
            type="time"
            value={time ?? ''}
            disabled={!date}
            onChange={(e) => setWhen(date ?? '', e.target.value)}
            style={{ maxWidth: 112 }}
            aria-label="Deadline time"
          />
        </div>
        {when && own && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className={'agenda__when'} style={isOverdue(own) && fm.done !== true ? { color: 'var(--coral)' } : undefined}>
                {fm.done === true ? 'done' : relativeDue(own)}
              </span>
              <span className="spacer" />
              <span className="label">Done</span>
              <button className={'toggle toggle--h' + (fm.done === true ? ' is-on' : '')} onClick={() => write({ done: fm.done === true ? undefined : true })}>
                <span />
              </button>
            </div>
            <div className="label" style={{ marginBottom: 5 }}>
              Remind me
            </div>
            <div className="remind-chips">
              {REMINDERS.map((r) => {
                const on = (remind ?? ['1d', 0]).some((x) => String(x) === String(r.value))
                return (
                  <button key={r.label} className={on ? 'is-on' : ''} onClick={() => toggleRemind(r.value)}>
                    {r.label}
                  </button>
                )
              })}
            </div>
          </>
        )}
        {!when && <div className="empty-note">Set a date to see it in Coming up, get reminders, and sync it to Google Calendar.</div>}
        {tasks.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="label" style={{ marginBottom: 4 }}>
              Dated tasks
            </div>
            {tasks.map((t) => (
              <div key={t.key} className="prop" style={{ minHeight: 32 }}>
                <span style={{ flex: 1, fontSize: 12.5 }}>☐ {t.title}</span>
                <span className={'agenda__when'} style={isOverdue(t) ? { color: 'var(--coral)' } : undefined}>
                  {relativeDue(t)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function SubThreadsModule({ thread }: { thread: ThreadInfo }) {
  const threads = useStore((s) => s.threads)
  const open = useStore((s) => s.open)
  const createSubThread = useStore((s) => s.createSubThread)
  const dir = subThreadDir(thread.path) + '/'
  const children = Object.values(threads)
    .filter((t) => t.path.startsWith(dir) && !t.path.slice(dir.length).includes('/'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return (
    <section className="module">
      <div className="module__head">
        <span className="label">[ Sub-threads ]</span>
        <span className="spacer" />
        <button
          className="chip-btn"
          onClick={async () => {
            const name = prompt('Name the sub-thread', 'Untitled')
            if (name) open(await createSubThread(thread.path, name, { stitch: true }))
          }}
        >
          <Icon name="plus" size={11} /> New
        </button>
      </div>
      <div className="module__body">
        {children.length === 0 && <div className="empty-note">None yet. Type /sub-thread in the page, or drop a Thread onto this one in the Spool.</div>}
        {children.map((c) => (
          <button key={c.path} className="backlink" onClick={() => open(c.path)}>
            <b>
              <ThreadIcon thread={c} size={14} /> {c.name}
              <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                {c.words}w
              </span>
            </b>
          </button>
        ))}
      </div>
    </section>
  )
}
