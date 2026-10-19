import { useMemo } from 'react'
import { Icon } from '../components/Icon'
import { DyeBadge } from '../components/DyeBadge'
import { folderNote, useStore } from '../core/store'
import { basename, dirname } from '../core/paths'
import { saveFile } from '../core/platform'
import { ThreadEditor } from '../editor/ThreadEditor'

export function CanvasView() {
  const active = useStore((s) => s.active)
  const thread = useStore((s) => (s.active ? s.threads[s.active] : undefined))
  const threads = useStore((s) => s.threads)
  const stitchingOpen = useStore((s) => s.stitchingOpen)
  const spoolOpen = useStore((s) => s.spoolOpen)
  const set = useStore((s) => s.set)
  const open = useStore((s) => s.open)
  const setView = useStore((s) => s.setView)
  const createThread = useStore((s) => s.createThread)

  const crumbs = useMemo(() => {
    if (!active) return []
    const parts = dirname(active).split('/').filter(Boolean)
    return parts.map((_, i) => {
      const dir = parts.slice(0, i + 1).join('/')
      return { dir, name: basename(dir), note: folderNote(dir, threads) }
    })
  }, [active, threads])

  if (!active || !thread) {
    return (
      <div className="view">
        <div className="canvas-scroll">
          <div className="editor-card glow" style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div className="label">[ Canvas ]</div>
              <h2 style={{ fontSize: 34, fontWeight: 500, margin: '10px 0 8px' }}>
                No Thread on the needle<span style={{ color: 'var(--accent)' }}>.</span>
              </h2>
              <p className="muted">Pick one from the Spool, or start fresh.</p>
              <button className="btn btn--ink" onClick={() => void createThread('', 'Untitled').then(open)}>
                <Icon name="plus" size={14} /> New Thread
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="view" key={active}>
      <div className="topbar">
        {!spoolOpen && (
          <button className="icon-btn" title="Show the Spool" onClick={() => set({ spoolOpen: true })}>
            <Icon name="panelLeft" size={17} />
          </button>
        )}
        <div className="crumbs">
          {crumbs.map((c) => (
            <span key={c.dir} style={{ display: 'contents' }}>
              <button onClick={() => c.note && open(c.note)}>{c.name}</button>
              <Icon name="chevron" size={12} />
            </span>
          ))}
          <b>{thread.name}</b>
        </div>
        <span className="spacer" />
        <div className="toolbar-group">
          <button className="icon-btn" title="Open the Desk beside this Thread" onClick={() => setView('desk')}>
            <Icon name="desk" size={17} />
          </button>
          <button className="icon-btn" title="Find in the Tapestry" onClick={() => setView('tapestry')}>
            <Icon name="tapestry" size={17} />
          </button>
          <button className="icon-btn" title="Export this Thread as .md" onClick={() => void saveFile(basename(active), thread.raw)}>
            <Icon name="download" size={17} />
          </button>
          <button
            className={'icon-btn' + (stitchingOpen ? ' is-on' : '')}
            title="Stitching panel (Ctrl+Shift+\)"
            onClick={() => set({ stitchingOpen: !stitchingOpen })}
          >
            <Icon name="panelRight" size={17} />
          </button>
        </div>
      </div>
      <div className="canvas-scroll">
        <article className="editor-card">
          {thread.dyes.length > 0 && (
            <div className="editor-card__dyes">
              {thread.dyes.map((d) => (
                <DyeBadge key={d} dye={d} onClick={() => set({ dyeFilter: d, spoolOpen: true })} />
              ))}
            </div>
          )}
          <ThreadEditor path={active} />
        </article>
      </div>
    </div>
  )
}
