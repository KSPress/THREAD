// The Tapestry: the visual network of Stitched Threads.
//   Web  — force-directed graph with curved, dye-colored routes.
//   Loom — lane view after git history graphs: each Project is a colored
//          warp line, Threads are knots by recency, Stitches route between lanes.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent } from 'react'
import { DyeBadge } from '../components/DyeBadge'
import { Icon } from '../components/Icon'
import { resolveTarget, useStore, useDyeColor } from '../core/store'
import { basename } from '../core/paths'
import { threadColor } from '../core/appearance'
import { PALETTES, useSettings } from '../core/settings'

interface GNode {
  id: string
  label: string
  kind: 'thread' | 'pdf' | 'ghost'
  group: string
  color: string
  degree: number
  mtime: number
  x: number
  y: number
  vx: number
  vy: number
  fixed?: boolean
}
interface GEdge {
  a: string
  b: string
  color: string
}

type Mode = 'web' | 'loom'

export function TapestryView() {
  const threads = useStore((s) => s.threads)
  const files = useStore((s) => s.files)
  const active = useStore((s) => s.active)
  const open = useStore((s) => s.open)
  const openDesk = useStore((s) => s.openDesk)
  const dyeColor = useDyeColor()
  const dyeColors = useStore((s) => s.dyeColors)
  const palette = useSettings((s) => s.palette)
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('thread.tapestry.mode') as Mode) || 'web')
  const [ghosts, setGhosts] = useState(false)
  const [dye, setDye] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [, setTick] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)
  const nodesRef = useRef<Map<string, GNode>>(new Map())
  const drag = useRef<{ kind: 'pan' | 'node'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)

  useEffect(() => localStorage.setItem('thread.tapestry.mode', mode), [mode])

  const colors = PALETTES[palette].colors
  const groups = useMemo(() => {
    const g = [...new Set(Object.keys(threads).map((p) => (p.includes('/') ? p.split('/')[0] : '· vault')))].sort()
    return new Map(g.map((name, i) => [name, colors[i % colors.length]]))
  }, [threads, colors])

  const graph = useMemo(() => {
    const nodes = new Map<string, GNode>()
    const edges: GEdge[] = []
    const prev = nodesRef.current
    const add = (id: string, n: Omit<GNode, 'x' | 'y' | 'vx' | 'vy' | 'degree'>) => {
      if (nodes.has(id)) return nodes.get(id)!
      const p = prev.get(id)
      const angle = Math.random() * Math.PI * 2
      const r = 120 + Math.random() * 220
      const node: GNode = { ...n, degree: 0, x: p?.x ?? Math.cos(angle) * r, y: p?.y ?? Math.sin(angle) * r, vx: 0, vy: 0 }
      nodes.set(id, node)
      return node
    }
    for (const t of Object.values(threads)) {
      if (dye && !t.dyes.includes(dye)) continue
      const group = t.path.includes('/') ? t.path.split('/')[0] : '· vault'
      add(t.path, {
        id: t.path,
        label: t.name,
        kind: 'thread',
        group,
        color: threadColor(t.frontmatter, t.dyes, dyeColor) ?? groups.get(group) ?? colors[0],
        mtime: t.mtime,
      })
    }
    const seen = new Set<string>()
    for (const t of Object.values(threads)) {
      if (!nodes.has(t.path)) continue
      for (const s of t.stitches) {
        let target = resolveTarget(s.target, files, threads)
        if (target && !nodes.has(target)) {
          const f = files[target]
          if (f?.kind === 'pdf' || f?.kind === 'epub') {
            add(target, { id: target, label: basename(target), kind: 'pdf', group: 'research', color: '#1FA3E0', mtime: f.mtime })
          } else continue
        }
        if (!target) {
          if (!ghosts) continue
          target = `ghost:${s.target.toLowerCase()}`
          add(target, { id: target, label: s.target, kind: 'ghost', group: 'loose', color: '#8a8a78', mtime: 0 })
        }
        if (target === t.path) continue
        const key = [t.path, target].sort().join('→')
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ a: t.path, b: target, color: nodes.get(t.path)!.color })
        nodes.get(t.path)!.degree++
        nodes.get(target)!.degree++
      }
    }
    return { nodes, edges }
  }, [threads, files, dye, ghosts, groups, dyeColor, dyeColors])

  nodesRef.current = graph.nodes

  // Force simulation for the Web mode.
  useEffect(() => {
    if (mode !== 'web') return
    let alpha = 1
    let raf = 0
    const nodes = [...graph.nodes.values()]
    const index = new Map(nodes.map((n, i) => [n.id, i]))
    const links = graph.edges.map((e) => [index.get(e.a)!, index.get(e.b)!] as const)
    const step = () => {
      const n = nodes.length
      for (let i = 0; i < n; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j]
          let dx = a.x - b.x
          let dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) {
            dx = Math.random()
            dy = Math.random()
            d2 = 1
          }
          if (d2 > 250000) continue
          const f = (4200 / d2) * alpha
          const d = Math.sqrt(d2)
          a.vx += (dx / d) * f
          a.vy += (dy / d) * f
          b.vx -= (dx / d) * f
          b.vy -= (dy / d) * f
        }
      }
      for (const [i, j] of links) {
        const a = nodes[i]
        const b = nodes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = ((d - 130) / d) * 0.05 * alpha
        a.vx += dx * f
        a.vy += dy * f
        b.vx -= dx * f
        b.vy -= dy * f
      }
      for (const nd of nodes) {
        nd.vx -= nd.x * 0.006 * alpha
        nd.vy -= nd.y * 0.006 * alpha
        if (nd.fixed) {
          nd.vx = nd.vy = 0
          continue
        }
        nd.vx *= 0.82
        nd.vy *= 0.82
        nd.x += nd.vx
        nd.y += nd.vy
      }
      alpha *= 0.985
      setTick((t) => t + 1)
      if (alpha > 0.02) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [graph, mode])

  // Lane layout for the Loom mode.
  const lanes = useMemo(() => {
    const order = [...graph.nodes.values()].sort((a, b) => b.mtime - a.mtime || a.label.localeCompare(b.label))
    const laneNames = [...new Set(order.map((n) => n.group))]
    const laneX = new Map(laneNames.map((g, i) => [g, 40 + i * 30]))
    const pos = new Map(order.map((n, i) => [n.id, { x: laneX.get(n.group)!, y: 40 + i * 34 }]))
    return { order, laneNames, laneX, pos, width: 40 + laneNames.length * 30 }
  }, [graph])

  // Center on first render / mode change.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const { width, height } = svg.getBoundingClientRect()
    if (mode === 'web') setView({ x: width / 2, y: height / 2, k: 1 })
    else setView({ x: 30, y: 150, k: 1 })
  }, [mode])

  const neighbors = useMemo(() => {
    const focus = hover ?? null
    if (!focus) return null
    const set = new Set([focus])
    for (const e of graph.edges) {
      if (e.a === focus) set.add(e.b)
      if (e.b === focus) set.add(e.a)
    }
    return set
  }, [hover, graph])
  const q = query.trim().toLowerCase()

  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k }
  }

  const onWheel = (e: WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const k = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k })
  }
  const onDown = (e: RPointerEvent, id?: string) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    if (id && mode === 'web') {
      const n = graph.nodes.get(id)!
      n.fixed = true
      drag.current = { kind: 'node', id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false }
    } else drag.current = { kind: 'pan', id, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }
  }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
    else {
      const n = graph.nodes.get(d.id!)!
      const w = toWorld(e.clientX, e.clientY)
      n.x = w.x
      n.y = w.y
      setTick((t) => t + 1)
    }
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'node') graph.nodes.get(d.id!)!.fixed = false
    if (!d.moved && d.id) {
      const n = graph.nodes.get(d.id)
      if (n?.kind === 'thread') open(d.id)
      else if (n?.kind === 'pdf') openDesk(d.id)
    }
  }

  const allDyes = useMemo(() => [...new Set(Object.values(threads).flatMap((t) => t.dyes))].sort(), [threads])
  const isLit = (id: string) => (neighbors ? neighbors.has(id) : q ? graph.nodes.get(id)?.label.toLowerCase().includes(q) : false)
  const focusing = !!neighbors || !!q

  const position = (n: GNode) => (mode === 'web' ? { x: n.x, y: n.y } : lanes.pos.get(n.id)!)

  return (
    <div className="view">
      <div className={'tapestry' + (focusing ? ' has-focus' : '')}>
        <svg
          ref={svgRef}
          onWheel={onWheel}
          onPointerDown={(e) => onDown(e)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <filter id="tap-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {mode === 'loom' &&
              lanes.laneNames.map((g) => {
                const ys = lanes.order.filter((n) => n.group === g).map((n) => lanes.pos.get(n.id)!.y)
                const x = lanes.laneX.get(g)!
                const color = groups.get(g) ?? (g === 'research' ? '#1FA3E0' : '#8a8a78')
                return (
                  <g key={g}>
                    <line x1={x} x2={x} y1={Math.min(...ys)} y2={Math.max(...ys)} stroke={color} strokeWidth={2.6} strokeLinecap="round" opacity={0.9} />
                    <text x={x} y={Math.min(...ys) - 18} className="lane-label" fill={color} textAnchor="middle" transform={`rotate(-35 ${x} ${Math.min(...ys) - 18})`}>
                      {g}
                    </text>
                  </g>
                )
              })}
            {graph.edges.map((e, i) => {
              const a = graph.nodes.get(e.a)!
              const b = graph.nodes.get(e.b)!
              const pa = position(a)
              const pb = position(b)
              const lit = neighbors ? neighbors.has(e.a) && neighbors.has(e.b) : false
              return (
                <path
                  key={i}
                  className={'tapestry__edge' + (lit ? ' is-lit' : '')}
                  d={mode === 'web' ? curve(pa, pb) : route(pa, pb)}
                  stroke={mode === 'web' ? e.color : groups.get(a.group) ?? e.color}
                  strokeWidth={mode === 'loom' ? 2.2 : 2.4 / Math.sqrt(view.k)}
                />
              )
            })}
            {[...graph.nodes.values()].map((n) => {
              const p = position(n)
              const r = n.kind === 'ghost' ? 4 : 5 + Math.sqrt(n.degree) * 2.4
              const lit = isLit(n.id)
              const showLabel = mode === 'loom' || lit || n.degree >= 3 || view.k > 1.3 || n.id === active
              return (
                <g
                  key={n.id}
                  className={'tapestry__node' + (lit ? ' is-lit' : '')}
                  transform={`translate(${p.x},${p.y})`}
                  onPointerDown={(e) => onDown(e, n.id)}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                >
                  {n.id === active && <circle r={r + 7} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="3 3" />}
                  <circle
                    r={mode === 'loom' ? 7 : r}
                    fill={n.kind === 'ghost' ? 'transparent' : n.color}
                    stroke={n.kind === 'ghost' ? n.color : '#111412'}
                    strokeWidth={n.kind === 'ghost' ? 1.5 : 2}
                    strokeDasharray={n.kind === 'ghost' ? '2 2' : undefined}
                    filter={lit ? 'url(#tap-glow)' : undefined}
                  />
                  {n.kind === 'pdf' && <text textAnchor="middle" dy={3.5} style={{ fontSize: 8, fill: '#fff', stroke: 'none' }}>❝</text>}
                  {showLabel &&
                    (mode === 'loom' ? (
                      <g transform={`translate(${lanes.width - p.x + 16},0)`}>
                        <rect x={0} y={-11} rx={6} height={22} width={Math.min(260, n.label.length * 7 + 26)} fill="none" stroke={n.color} strokeDasharray="3 2" />
                        <text x={10} y={4} style={{ fill: n.color === '#8a8a78' ? undefined : '#f4eed3' }}>
                          {n.label}
                        </text>
                      </g>
                    ) : (
                      <text x={r + 5} y={4}>
                        {n.label}
                      </text>
                    ))}
                </g>
              )
            })}
          </g>
        </svg>

        <div className="tapestry__hud">
          <div className="hud-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="label">[ Tapestry ]</span>
              <div className="seg">
                <button className={mode === 'web' ? 'is-on' : ''} onClick={() => setMode('web')}>
                  Web
                </button>
                <button className={mode === 'loom' ? 'is-on' : ''} onClick={() => setMode('loom')}>
                  Loom
                </button>
              </div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'rgba(244,238,211,.6)' }}>
              {graph.nodes.size} threads · {graph.edges.length} stitches
            </div>
          </div>
          <div className="hud-card" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="search" size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Highlight…"
              style={{ background: 'transparent', border: 0, outline: 'none', color: 'var(--cream)', width: 140 }}
            />
          </div>
          <span className="spacer" />
          <div className="hud-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxWidth: 420, alignItems: 'center' }}>
            <button className={'chip-btn'} onClick={() => setGhosts(!ghosts)} style={ghosts ? { background: 'var(--cream)', color: 'var(--ink)' } : undefined}>
              Loose stitches
            </button>
            {allDyes.slice(0, 10).map((d) => (
              <span key={d} onClick={() => setDye(dye === d ? null : d)} style={{ cursor: 'pointer', opacity: dye && dye !== d ? 0.45 : 1 }}>
                <DyeBadge dye={d} small />
              </span>
            ))}
          </div>
          <div className="hud-card" style={{ display: 'flex', gap: 2, padding: 4 }}>
            <button className="icon-btn" style={{ color: 'var(--cream)' }} onClick={() => setView((v) => ({ ...v, k: Math.min(4, v.k * 1.2) }))}>
              <Icon name="zoomIn" size={16} />
            </button>
            <button className="icon-btn" style={{ color: 'var(--cream)' }} onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))}>
              <Icon name="zoomOut" size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Gentle arc between two points (Web mode). */
function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const off = 0.18
  return `M${a.x},${a.y} Q${mx - dy * off},${my + dx * off} ${b.x},${b.y}`
}

/** Rounded orthogonal connector between lanes (Loom mode), git-graph style. */
function route(a: { x: number; y: number }, b: { x: number; y: number }) {
  if (a.x === b.x) {
    // Same lane: bow out to the side so the stitch stays visible.
    const bow = 14
    return `M${a.x},${a.y} C${a.x + bow},${a.y} ${a.x + bow},${b.y} ${b.x},${b.y}`
  }
  const r = 12
  const dir = b.y > a.y ? 1 : -1
  const sx = b.x > a.x ? 1 : -1
  return `M${a.x},${a.y} L${b.x - r * sx},${a.y} Q${b.x},${a.y} ${b.x},${a.y + r * dir} L${b.x},${b.y}`
}
