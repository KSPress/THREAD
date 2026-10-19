// The Spool: floating left sidebar with the nested Project tree and Dyes.
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { folderNote, subThreadDir, useStore, type FileInfo, useDyeColor } from '../core/store'
import { basename, dirname, extname, join } from '../core/paths'
import { Icon } from './Icon'
import { DyeEditor, DyePicker } from './DyeEditor'
import { ThreadIcon } from './ThreadIcon'
import { ThreadStylePop } from './ThreadStyle'
import { Logo } from './Logo'

interface TreeNode {
  path: string
  name: string
  file: FileInfo
  children: TreeNode[]
}

const OPEN_KEY = 'thread.spool.open'

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function Spool() {
  const files = useStore((s) => s.files)
  const threads = useStore((s) => s.threads)
  const adapter = useStore((s) => s.adapter)
  const dyeFilter = useStore((s) => s.dyeFilter)
  const set = useStore((s) => s.set)
  const createThread = useStore((s) => s.createThread)
  const createProject = useStore((s) => s.createProject)
  const open = useStore((s) => s.open)
  const importFiles = useStore((s) => s.importFiles)
  const dyeColor = useDyeColor()
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(loadOpen)
  const [ctx, setCtx] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const [stylePop, setStylePop] = useState<{ path: string; rect: DOMRect } | null>(null)
  const [dyePop, setDyePop] = useState<{ path: string; rect: DOMRect } | null>(null)
  const [dyeEdit, setDyeEdit] = useState<{ dye: string; rect: DOMRect } | null>(null)
  const [editDyes, setEditDyes] = useState(false)
  const createSubThread = useStore((s) => s.createSubThread)

  useEffect(() => localStorage.setItem(OPEN_KEY, JSON.stringify(openMap)), [openMap])

  const tree = useMemo(() => buildTree(files, threads), [files, threads])
  const dyes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of Object.values(threads)) for (const d of t.dyes) counts.set(d, (counts.get(d) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [threads])

  const toggle = (p: string) => setOpenMap((m) => ({ ...m, [p]: !m[p] }))

  const newThread = async (dir = '') => {
    const p = await createThread(dir, 'Untitled')
    if (dir) setOpenMap((m) => ({ ...m, [dir]: true }))
    open(p)
  }
  const newCord = async (dir = '') => {
    const name = prompt('Name the Cord — a Thread with pages, headers, page numbers and footnotes', 'Untitled Cord')
    if (!name) return
    const p = await useStore.getState().createCord(dir, name)
    if (dir) setOpenMap((m) => ({ ...m, [dir]: true }))
    open(p)
  }
  const newProject = async (parent = '') => {
    const name = prompt('Name your Project', 'New Project')
    if (!name) return
    const note = await createProject(name, parent)
    setOpenMap((m) => ({ ...m, [dirname(note)]: true, ...(parent ? { [parent]: true } : {}) }))
    open(note)
  }

  const onDrop = async (e: DragEvent, dir: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropping(false)
    const moving = e.dataTransfer.getData('text/thread-path')
    if (moving) {
      const target = join(dir, basename(moving))
      if (target !== moving && !target.startsWith(moving + '/')) await useStore.getState().renamePath(moving, target)
      return
    }
    if (e.dataTransfer.files.length) {
      const paths = await importFiles(dir, [...e.dataTransfer.files])
      useStore.getState().notify(`Spooled ${paths.length} file${paths.length === 1 ? '' : 's'} into ${dir || 'the vault'}`)
    }
  }

  return (
    <aside className="spool">
      <div className="spool__inner">
        <div className="spool__head">
          <Logo size={18} word={false} />
          <span className="spool__vault" title={adapter?.name}>
            {adapter?.name}
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="Collapse the Spool" onClick={() => set({ spoolOpen: false })}>
            <Icon name="panelLeft" size={17} />
          </button>
        </div>
        <button className="spool__search" onClick={() => set({ paletteOpen: true })}>
          <Icon name="search" size={15} /> Find a Thread… <kbd>Ctrl K</kbd>
        </button>
        <div className="spool__actions">
          <button className="key" onClick={() => void newThread('')}>
            <Icon name="canvas" size={16} />
            New Thread
          </button>
          <button className="key" onClick={() => void newCord('')} title="A Thread with a full word processor: pages, headers & footers, page numbers, footnotes">
            <Icon name="compiler" size={16} />
            New Cord
          </button>
          <button className="key" onClick={() => void newProject('')}>
            <Icon name="folder" size={16} />
            New Project
          </button>
        </div>

        <div
          className={'spool__scroll' + (dropping ? ' spool__drop' : '')}
          onDragOver={(e) => {
            e.preventDefault()
            setDropping(true)
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => void onDrop(e, '')}
          onContextMenu={(e) => {
            e.preventDefault()
            setCtx({ x: e.clientX, y: e.clientY, node: null })
          }}
        >
          <div className="spool__section">
            <span className="label">[ Spool ]</span>
            <span className="spacer" />
            {dyeFilter && (
              <button className="chip-btn" onClick={() => set({ dyeFilter: null })}>
                {dyeFilter} ×
              </button>
            )}
          </div>
          {dyeFilter ? (
            Object.values(threads)
              .filter((t) => t.dyes.includes(dyeFilter))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <Row
                  key={t.path}
                  node={{ path: t.path, name: t.name, file: files[t.path], children: [] }}
                  depth={0}
                  open={false}
                  onToggle={() => {}}
                  onCtx={setCtx}
                  renaming={renaming}
                  setRenaming={setRenaming}
                  onDrop={onDrop}
                />
              ))
          ) : (
            <TreeList
              nodes={tree}
              depth={0}
              openMap={openMap}
              toggle={toggle}
              onCtx={setCtx}
              renaming={renaming}
              setRenaming={setRenaming}
              onDrop={onDrop}
            />
          )}

          <div className="spool__section">
            <span className="label">[ Dyes ]</span>
            <span className="spacer" />
            {dyes.length > 0 && (
              <button className={'chip-btn' + (editDyes ? ' is-on' : '')} onClick={() => setEditDyes(!editDyes)} title="Rename, recolor or remove Dyes">
                {editDyes ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
          <div className="dye-list">
            {dyes.length === 0 && <span className="empty-note">Add a Dye to any Thread from the Stitching panel.</span>}
            {dyes.map(([d, n]) => (
              <button
                key={d}
                className={'dye dye--sm' + (dyeFilter === d ? ' is-on' : '')}
                style={{ ['--c' as any]: dyeColor(d) }}
                onClick={(e) =>
                  editDyes ? setDyeEdit({ dye: d, rect: e.currentTarget.getBoundingClientRect() }) : set({ dyeFilter: dyeFilter === d ? null : d })
                }
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDyeEdit({ dye: d, rect: e.currentTarget.getBoundingClientRect() })
                }}
                title={editDyes ? `Edit “${d}”` : `${n} Thread${n === 1 ? '' : 's'} · right-click to edit`}
              >
                {d}
                <span className="mono" style={{ opacity: 0.6 }}>
                  {n}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {ctx && (
        <ContextMenu
          {...ctx}
          onClose={() => setCtx(null)}
          onNewThread={(dir) => void newThread(dir)}
          onNewCord={(dir) => void newCord(dir)}
          onNewProject={(dir) => void newProject(dir)}
          onRename={(p) => setRenaming(p)}
          onSubThread={async (p) => {
            const name = prompt('Name the sub-thread', 'Untitled')
            if (!name) return
            setOpenMap((m) => ({ ...m, [p]: true }))
            open(await createSubThread(p, name))
          }}
          onStyle={(p, rect) => setStylePop({ path: p, rect })}
          onDye={(p, rect) => setDyePop({ path: p, rect })}
        />
      )}
      {stylePop && <ThreadStylePop path={stylePop.path} anchor={stylePop.rect} onClose={() => setStylePop(null)} />}
      {dyePop && <DyePicker path={dyePop.path} anchor={dyePop.rect} onClose={() => setDyePop(null)} />}
      {dyeEdit && <DyeEditor dye={dyeEdit.dye} anchor={dyeEdit.rect} onClose={() => setDyeEdit(null)} />}
    </aside>
  )
}

function TreeList(props: {
  nodes: TreeNode[]
  depth: number
  openMap: Record<string, boolean>
  toggle: (p: string) => void
  onCtx: (c: { x: number; y: number; node: TreeNode | null }) => void
  renaming: string | null
  setRenaming: (p: string | null) => void
  onDrop: (e: DragEvent, dir: string) => void
}) {
  return (
    <>
      {props.nodes.map((n) => {
        const isOpen = !!props.openMap[n.path]
        return (
          <div key={n.path}>
            <Row
              node={n}
              depth={props.depth}
              open={isOpen}
              onToggle={() => props.toggle(n.path)}
              onCtx={props.onCtx}
              renaming={props.renaming}
              setRenaming={props.setRenaming}
              onDrop={props.onDrop}
            />
            {isOpen && n.children.length > 0 && (
              <div className="tree-children">
                <TreeList {...props} nodes={n.children} depth={props.depth + 1} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function Row({
  node,
  depth,
  open,
  onToggle,
  onCtx,
  renaming,
  setRenaming,
  onDrop,
}: {
  node: TreeNode
  depth: number
  open: boolean
  onToggle: () => void
  onCtx: (c: { x: number; y: number; node: TreeNode | null }) => void
  renaming: string | null
  setRenaming: (p: string | null) => void
  onDrop: (e: DragEvent, dir: string) => void
}) {
  const active = useStore((s) => s.active)
  const deskPdf = useStore((s) => s.desk.pdf)
  const view = useStore((s) => s.view)
  const threads = useStore((s) => s.threads)
  const dyeColor = useDyeColor()
  const open_ = useStore((s) => s.open)
  const renamePath = useStore((s) => s.renamePath)
  const isFolder = node.file.kind === 'folder'
  const note = isFolder ? folderNote(node.path, threads) : null
  const isActive = isFolder ? !!note && note === active : node.path === active || (view === 'desk' && node.path === deskPdf)
  const thread = threads[node.path]
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (renaming === node.path) inputRef.current?.select()
  }, [renaming, node.path])

  const commitRename = async (value: string) => {
    setRenaming(null)
    const name = value.trim()
    if (!name || name === node.name) return
    const ext = isFolder ? '' : extname(node.path)
    await renamePath(node.path, join(dirname(node.path), name + ext))
  }

  const icon = isFolder ? 'folder' : node.file.kind === 'pdf' || node.file.kind === 'epub' ? 'pdf' : node.file.kind === 'image' ? 'image' : 'file'
  const isThread = node.file.kind === 'thread'
  const expandable = isFolder || node.children.length > 0

  return (
    <div
      className={'tree-row' + (isActive ? ' is-active' : '') + (isFolder ? ' is-project' : '') + (open ? ' is-open' : '')}
      style={{ ['--depth' as any]: depth, ...(over ? { outline: '2px dashed var(--accent)' } : {}) }}
      role="button"
      tabIndex={0}
      draggable={renaming !== node.path}
      onDragStart={(e) => e.dataTransfer.setData('text/thread-path', node.path)}
      onDragOver={(e) => {
        // Drop onto a folder to move into it, onto a Thread to nest as a sub-thread.
        if (!isFolder && !isThread) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        if (isFolder) onDrop(e, node.path)
        else if (isThread && e.dataTransfer.getData('text/thread-path') !== node.path) onDrop(e, subThreadDir(node.path))
      }}
      onClick={() => {
        if (renaming === node.path) return
        if (isFolder) {
          if (note) open_(note)
          if (!open || !note) onToggle()
        } else open_(node.path)
      }}
      onKeyDown={(e) => e.key === 'F2' && setRenaming(node.path)}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        onCtx({ x: e.clientX, y: e.clientY, node })
      }}
    >
      {expandable ? (
        <span
          className="chev"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          <Icon name="chevron" size={13} />
        </span>
      ) : (
        <span style={{ width: 13 }} />
      )}
      {isThread ? <ThreadIcon thread={thread} size={15} /> : <Icon name={icon} size={15} />}
      {renaming === node.path ? (
        <input
          ref={inputRef}
          defaultValue={node.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => void commitRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setRenaming(null)
          }}
        />
      ) : (
        <span className="name">{node.name}</span>
      )}
      {thread?.dyes[0] && <span className="tree-row__dye" style={{ background: dyeColor(thread.dyes[0]) }} />}
      {expandable && <span className="count">{countThreads(node)}</span>}
      <span
        className="tree-row__more"
        role="button"
        aria-label={`More actions for ${node.name}`}
        onClick={(e) => {
          e.stopPropagation()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onCtx({ x: r.left, y: r.bottom + 4, node })
        }}
      >
        <Icon name="more" size={16} />
      </span>
    </div>
  )
}

function ContextMenu({
  x,
  y,
  node,
  onClose,
  onNewThread,
  onNewCord,
  onNewProject,
  onRename,
  onSubThread,
  onStyle,
  onDye,
}: {
  x: number
  y: number
  node: TreeNode | null
  onClose: () => void
  onNewThread: (dir: string) => void
  onNewCord: (dir: string) => void
  onNewProject: (dir: string) => void
  onRename: (path: string) => void
  onSubThread: (path: string) => void
  onStyle: (path: string, rect: DOMRect) => void
  onDye: (path: string, rect: DOMRect) => void
}) {
  const deletePath = useStore((s) => s.deletePath)
  const openDesk = useStore((s) => s.openDesk)
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])
  const dir = !node ? '' : node.file.kind === 'folder' ? node.path : dirname(node.path)
  // Portaled: the Spool's backdrop-filter (and clipped corners) would trap a fixed menu inside it.
  return createPortal(
    <div className="ctx pop" style={{ left: Math.min(x, innerWidth - 210), top: Math.min(y, innerHeight - 240) }}>
      <button onClick={() => onNewThread(dir)}>
        <Icon name="canvas" size={15} /> New Thread here
      </button>
      <button onClick={() => onNewCord(dir)}>
        <Icon name="compiler" size={15} /> New Cord here
      </button>
      <button onClick={() => onNewProject(dir)}>
        <Icon name="folder" size={15} /> New Project here
      </button>
      {node && (
        <>
          <hr />
          {(node.file.kind === 'pdf' || node.file.kind === 'epub') && (
            <button onClick={() => openDesk(node.path)}>
              <Icon name="desk" size={15} /> Open at the Desk
            </button>
          )}
          {node.file.kind === 'thread' && (
            <>
              <button onClick={() => onSubThread(node.path)}>
                <Icon name="plus" size={15} /> New sub-thread
              </button>
              <button onClick={() => onDye(node.path, new DOMRect(x, y, 0, 0))}>
                <Icon name="dye" size={15} /> Dye…
              </button>
              <button onClick={() => onStyle(node.path, new DOMRect(x, y, 0, 0))}>
                <Icon name="image" size={15} /> Icon, color &amp; background…
              </button>
              {!node.path.endsWith('.cord') && (
                <button
                  onClick={async () => {
                    const s = useStore.getState()
                    s.open(await s.createCord(dirname(node.path), node.name, node.path))
                    s.notify(`Made a Cord from “${node.name}” — the Thread is untouched`)
                  }}
                >
                  <Icon name="compiler" size={15} /> Convert to Cord
                </button>
              )}
            </>
          )}
          <button onClick={() => onRename(node.path)}>
            <Icon name="rename" size={15} /> Rename
          </button>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Unravel “${node.name}”? This deletes it from the vault.`)) void deletePath(node.path)
            }}
          >
            <Icon name="trash" size={15} /> Delete
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}

function buildTree(files: Record<string, FileInfo>, threads: Record<string, unknown>): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  const root: TreeNode[] = []
  const paths = Object.keys(files).sort()
  for (const p of paths) {
    const f = files[p]
    nodes.set(p, { path: p, name: f.kind === 'thread' ? basename(p).replace(/\.md$/i, '') : basename(p), file: f, children: [] })
  }
  // A folder next to a Thread of the same name holds that Thread's sub-threads.
  const owner = (dir: string) => (files[dir]?.kind === 'folder' && threads[`${dir}.md`] ? nodes.get(`${dir}.md`) : undefined)
  for (const p of paths) {
    const node = nodes.get(p)!
    const parent = dirname(p)
    // A Project's folder note is the Project itself; don't list it twice.
    if (node.file.kind === 'thread' && parent && basename(parent) + '.md' === basename(p) && threads[p]) continue
    if (owner(p)) continue
    const target = (parent && owner(parent)) || (parent ? nodes.get(parent) : undefined)
    if (target) target.children.push(node)
    else root.push(node)
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => {
      const af = a.file.kind === 'folder' ? 0 : 1
      const bf = b.file.kind === 'folder' ? 0 : 1
      return af - bf || a.name.localeCompare(b.name, undefined, { numeric: true })
    })
    list.forEach((n) => sort(n.children))
  }
  sort(root)
  return root
}

function countThreads(n: TreeNode): number {
  return n.children.reduce((s, c) => s + (c.file.kind === 'thread' ? 1 : 0) + countThreads(c), 0)
}
