import { dirname } from '../core/paths'
// Quick switcher + command runner (Ctrl/Cmd+K).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../core/store'
import { fuzzy } from '../editor/suggest'
import { closeVault } from '../core/boot'
import { useSettings } from '../core/settings'
import { Icon } from './Icon'

interface Item {
  id: string
  title: string
  hint?: string
  icon: string
  run: () => void
  score: number
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  if (!open) return null
  return <Palette />
}

function Palette() {
  const s = useStore()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const close = () => s.set({ paletteOpen: false })

  const items = useMemo<Item[]>(() => {
    const commands: Omit<Item, 'score'>[] = [
      { id: 'c:new', title: 'New Thread', icon: 'plus', run: () => void s.createThread('', 'Untitled').then(s.open) },
      { id: 'c:cord', title: 'New Cord (word processor)', icon: 'compiler', run: () => void s.createCord('', 'Untitled Cord').then(s.open) },
      ...(s.active && s.threads[s.active]?.kind === 'thread'
        ? [{ id: 'c:tocord', title: 'Convert this Thread to a Cord', icon: 'compiler' as const, run: () => void s.createCord(dirname(s.active!), s.threads[s.active!].name, s.active!).then(s.open) }]
        : []),
      {
        id: 'c:proj',
        title: 'New Project',
        icon: 'folder',
        run: async () => {
          const n = prompt('Name your Project', 'New Project')
          if (n) s.open(await s.createProject(n))
        },
      },
      { id: 'c:home', title: 'Go to the Loom', hint: 'Alt 1', icon: 'home', run: () => s.setView('home') },
      { id: 'c:tap', title: 'Open the Tapestry', hint: 'Alt 3', icon: 'tapestry', run: () => s.setView('tapestry') },
      { id: 'c:desk', title: 'Open the Desk', hint: 'Alt 4', icon: 'desk', run: () => s.setView('desk') },
      { id: 'c:comp', title: 'Open the Compiler', hint: 'Alt 5', icon: 'compiler', run: () => s.setView('compiler') },
      { id: 'c:set', title: 'Personalize THREAD', hint: 'Ctrl ,', icon: 'settings', run: () => s.set({ settingsOpen: true }) },
      {
        id: 'c:theme',
        title: 'Toggle dark mode',
        icon: 'moon',
        run: () => {
          const st = useSettings.getState()
          st.set({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })
        },
      },
      { id: 'c:spool', title: 'Toggle the Spool', hint: 'Ctrl \\', icon: 'panelLeft', run: () => s.set({ spoolOpen: !s.spoolOpen }) },
      { id: 'c:close', title: 'Switch vault…', icon: 'vault', run: () => void closeVault() },
    ]
    const threads = Object.values(s.threads).map((t) => ({
      id: t.path,
      title: t.title === t.name ? t.name : `${t.name} — ${t.title}`,
      hint: t.path,
      icon: 'canvas',
      run: () => s.open(t.path),
    }))
    const pdfs = Object.values(s.files)
      .filter((f) => f.kind === 'pdf')
      .map((f) => ({ id: f.path, title: f.path.split('/').pop()!, hint: 'PDF · Desk', icon: 'pdf', run: () => s.openDesk(f.path) }))
    const all = [...threads, ...pdfs, ...commands]
    if (!q) {
      const recent = s.recent.map((p) => threads.find((t) => t.id === p)).filter(Boolean) as Omit<Item, 'score'>[]
      return [...recent.slice(0, 6), ...commands].map((i) => ({ ...i, score: 1 }))
    }
    const scored = all.map((i) => ({ ...i, score: Math.max(fuzzy(q, i.title), i.hint ? fuzzy(q, i.hint) * 0.8 : 0) })).filter((i) => i.score > 0)
    scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    const out = scored.slice(0, 40)
    out.push({
      id: 'c:create',
      title: `Weave a new Thread “${q}”`,
      icon: 'plus',
      score: 0,
      run: () => void s.createThread('', q).then(s.open),
    })
    return out
  }, [q, s.threads, s.files, s.recent])

  useEffect(() => setIdx(0), [q])
  useEffect(() => list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' }), [idx])

  const run = (i: Item) => {
    close()
    i.run()
  }

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="palette card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette__input">
          <Icon name="search" size={18} />
          <input
            autoFocus
            placeholder="Find a Thread or run a command…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx((i) => Math.min(items.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter' && items[idx]) run(items[idx])
            }}
          />
          <span className="label">esc</span>
        </div>
        <div className="palette__list" ref={list}>
          {items.map((i, n) => (
            <button key={i.id} className={'palette__item' + (n === idx ? ' is-active' : '')} onMouseEnter={() => setIdx(n)} onClick={() => run(i)}>
              <Icon name={i.icon} size={16} />
              <span>{i.title}</span>
              {i.hint && <small>{i.hint}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
