// Activity heat map: which days which Threads were woven, in their Dye colors.
// A day worked on several dyes splits into bands (up to three), and the
// intensity follows how much writing happened.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { dayKey, mergedActivity, streaks, useActivity } from '../core/activity'
import { useDyeColor, useStore } from '../core/store'
import { DyeBadge } from './DyeBadge'

const CELL = 13
const GAP = 3
const UNDYED = 'var(--muted)'

interface Day {
  key: string
  date: Date
  total: number
  threads: { path: string; edits: number }[]
  bands: { color: string; weight: number }[]
  level: number
}

export function Heatmap({ path, maxWeeks = 53, compact = false }: { path?: string; maxWeeks?: number; compact?: boolean }) {
  const logs = useActivity((s) => s.logs)
  const threads = useStore((s) => s.threads)
  const open = useStore((s) => s.open)
  const dyeColor = useDyeColor()
  const [dye, setDye] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<{ day: Day; x: number; y: number } | null>(null)
  const [weeks, setWeeks] = useState(compact ? 16 : 26)
  const wrap = useRef<HTMLDivElement>(null)
  const cell = compact ? 10 : CELL

  // Fit as many weeks as the card is wide.
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const fit = Math.floor((el.clientWidth - (compact ? 0 : 26)) / (cell + GAP))
      setWeeks(Math.max(8, Math.min(maxWeeks, fit)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [cell, compact, maxWeeks])

  const merged = useMemo(() => mergedActivity(logs, threads), [logs, threads])

  const { columns, months, dyes, stats } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Weeks start on Monday; the last column holds today.
    const end = new Date(today)
    const start = new Date(today)
    start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7)
    const days: Day[] = []
    const dyeTotals = new Map<string, number>()
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d)
      const entries = Object.entries(merged[key] ?? {})
        .filter(([p]) => (!path || p === path) && (!dye || threads[p]?.dyes.includes(dye)))
        .map(([p, edits]) => ({ path: p, edits }))
        .sort((a, b) => b.edits - a.edits)
      const weights = new Map<string, number>()
      for (const e of entries) {
        const ds = threads[e.path]?.dyes ?? []
        const list = dye ? [dye] : ds.length ? ds : ['']
        for (const x of list) {
          weights.set(x, (weights.get(x) ?? 0) + e.edits / list.length)
          if (x) dyeTotals.set(x, (dyeTotals.get(x) ?? 0) + e.edits / list.length)
        }
      }
      const bands = [...weights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([x, weight]) => ({ color: x ? dyeColor(x) : UNDYED, weight }))
      days.push({ key, date: new Date(d), total: entries.reduce((s, e) => s + e.edits, 0), threads: entries, bands, level: 0 })
    }
    // Intensity levels by quartile of active days.
    const totals = days.map((d) => d.total).filter(Boolean).sort((a, b) => a - b)
    const q = (f: number) => totals[Math.min(totals.length - 1, Math.floor(totals.length * f))] ?? 1
    const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)]
    for (const d of days) d.level = !d.total ? 0 : d.total <= q1 ? 1 : d.total <= q2 ? 2 : d.total <= q3 ? 3 : 4
    const columns: Day[][] = []
    for (let i = 0; i < days.length; i += 7) columns.push(days.slice(i, i + 7))
    const months: { col: number; label: string }[] = []
    columns.forEach((c, i) => {
      const first = c.find((d) => d.date.getDate() <= 7)
      if (first && (i === 0 || first.date.getDate() <= 7) && (!months.length || months[months.length - 1].col < i - 2))
        months.push({ col: i, label: first.date.toLocaleDateString(undefined, { month: 'short' }) })
    })
    const active = new Set(days.filter((d) => d.total).map((d) => d.key))
    const allActive = new Set(Object.keys(merged).filter((k) => Object.keys(merged[k]).some((p) => (!path || p === path) && (!dye || threads[p]?.dyes.includes(dye)))))
    const perThread = new Map<string, number>()
    for (const d of days) for (const t of d.threads) perThread.set(t.path, (perThread.get(t.path) ?? 0) + t.edits)
    const top = [...perThread.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      columns,
      months,
      dyes: [...dyeTotals.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x),
      stats: { active: active.size, ...streaks(allActive), top: top ? threads[top[0]]?.name ?? top[0] : null },
    }
  }, [merged, weeks, path, dye, threads, dyeColor])

  // Most recent weeks stay in view on narrow screens.
  useEffect(() => {
    const el = wrap.current?.querySelector('.heat__scroll')
    if (el) el.scrollLeft = el.scrollWidth
  }, [columns.length])

  const sel = selected ? columns.flat().find((d) => d.key === selected) : null

  return (
    <div className={'heat' + (compact ? ' heat--compact' : '')} ref={wrap}>
      {!compact && (
        <div className="heat__stats">
          <div className="stat">
            <b>{stats.current}</b>
            <span>Day streak</span>
          </div>
          <div className="stat">
            <b>{stats.longest}</b>
            <span>Longest</span>
          </div>
          <div className="stat">
            <b>{stats.active}</b>
            <span>Active days</span>
          </div>
          <div className="stat heat__top">
            <b>{stats.top ?? '—'}</b>
            <span>Most woven</span>
          </div>
        </div>
      )}
      <div className="heat__scroll">
        <div className="heat__grid" style={{ ['--cell' as any]: `${cell}px`, ['--gap' as any]: `${GAP}px` }}>
          {!compact && (
            <div className="heat__months">
              {months.map((m) => (
                <span key={m.col} style={{ left: m.col * (cell + GAP) }}>
                  {m.label}
                </span>
              ))}
            </div>
          )}
          {!compact && (
            <div className="heat__weekdays">
              <span>M</span>
              <span />
              <span>W</span>
              <span />
              <span>F</span>
              <span />
              <span />
            </div>
          )}
          <div className="heat__cols" onMouseLeave={() => setHover(null)}>
            {columns.map((col, i) => (
              <div className="heat__col" key={i}>
                {col.map((d) => (
                  <button
                    key={d.key}
                    className={'heat__cell' + (d.key === selected ? ' is-selected' : '') + (d.key === dayKey(new Date()) ? ' is-today' : '')}
                    style={{ background: cellBackground(d) }}
                    aria-label={`${d.date.toDateString()}: ${d.total ? `${d.total} edits` : 'no writing'}`}
                    onMouseEnter={(e) => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      const host = wrap.current!.getBoundingClientRect()
                      // Keep the tooltip inside the card.
                      const x = Math.min(Math.max(r.left - host.left + r.width / 2, 95), host.width - 95)
                      setHover({ day: d, x, y: r.top - host.top })
                    }}
                    onClick={() => setSelected(selected === d.key ? null : d.key)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {hover && hover.day.total > 0 && (
        <div className="heat__tip" style={{ left: hover.x, top: hover.y }}>
          <b>{hover.day.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</b>
          <span className="mono"> · {hover.day.total} edits</span>
          {hover.day.threads.slice(0, 4).map((t) => (
            <div key={t.path} className="heat__tipRow">
              <span className="dye-dot" style={{ background: threads[t.path]?.dyes[0] ? dyeColor(threads[t.path].dyes[0]) : UNDYED }} />
              {threads[t.path]?.name ?? t.path.split('/').pop()}
              <span className="mono muted">{t.edits}</span>
            </div>
          ))}
        </div>
      )}
      {!compact && (
        <div className="heat__foot">
          <span className="label">Less</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="heat__legend" style={{ background: l ? `color-mix(in srgb, var(--accent) ${LEVEL_MIX[l]}%, var(--tile))` : 'var(--heat-empty)' }} />
          ))}
          <span className="label">More</span>
          <span className="spacer" />
          <div className="heat__dyes">
            {dye && (
              <button className="chip-btn" onClick={() => setDye(null)}>
                All ×
              </button>
            )}
            {(dye ? [dye] : dyes.slice(0, 6)).map((x) => (
              <span key={x} onClick={() => setDye(dye === x ? null : x)} style={{ cursor: 'pointer' }}>
                <DyeBadge dye={x} small />
              </span>
            ))}
          </div>
        </div>
      )}
      {sel && sel.total > 0 && (
        <div className="heat__day">
          <div className="label">[ {sel.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} ]</div>
          <div className="heat__dayList">
            {sel.threads.map((t) => (
              <button key={t.path} className="backlink" onClick={() => threads[t.path] && open(t.path)} disabled={!threads[t.path]}>
                <b>
                  <span className="dye-dot" style={{ background: threads[t.path]?.dyes[0] ? dyeColor(threads[t.path].dyes[0]) : UNDYED }} />
                  {threads[t.path]?.name ?? `${t.path} (moved or deleted)`}
                  <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                    {t.edits} edits
                  </span>
                </b>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const LEVEL_MIX = [0, 38, 58, 78, 100]

function cellBackground(d: Day) {
  if (!d.total || !d.bands.length) return 'var(--heat-empty)'
  const mix = LEVEL_MIX[d.level]
  const tone = (c: string) => `color-mix(in srgb, ${c} ${mix}%, var(--tile))`
  if (d.bands.length === 1) return tone(d.bands[0].color)
  const sum = d.bands.reduce((s, b) => s + b.weight, 0)
  let at = 0
  const stops = d.bands.map((b) => {
    const from = at
    at += (b.weight / sum) * 100
    return `${tone(b.color)} ${from.toFixed(1)}% ${at.toFixed(1)}%`
  })
  return `linear-gradient(135deg, ${stops.join(', ')})`
}
