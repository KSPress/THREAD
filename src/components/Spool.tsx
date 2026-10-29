// The Spool: floating left sidebar with the nested Project tree and Dyes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
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

  const order = useStore((s) => s.order)
  const tree = useMemo(() => buildTree(files, threads, order), [files, threads, order])
  const dyes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of Object.values(threads)) for (const d of t.dyes) counts.set(d, (counts.get(d) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [threads])

  const toggle = (p: string, value?: boolean) => setOpenMap((m) => ({ ...m, [p]: value ?? !m[p] }))
  const renameSoon = (p: string) => setTimeout(() => setRenaming(p), 60)

  // Drag onto the top/bottom edge of a row to place beside it, onto its middle to nest inside it.
  const onPlace = async (moving: string, target: TreeNode, pos: DropPos, siblings: TreeNode[]) => {
    const s = useStore.getState()
    if (pos === 'inside') {
      await s.movePath(moving, childDir(target)!)
      toggle(target.path, true)
      return
    }
    const dir = dirname(target.path)
    const to = await s.movePath(moving, dir)
    const names = siblings.map((n) => basename(n.path)).filter((n) => n !== basename(moving) && n !== basename(to))
    const i = names.indexOf(basename(target.path))
    names.splice(pos === 'before' ? i : i + 1, 0, basename(to))
    await s.setOrder(dir, names)
  }
  // "+" on a row: a new page inside it, named right there in the Spool.
  const onAdd = async (node: TreeNode) => {
    const s = useStore.getState()
    const p = node.file.kind === 'folder' ? await s.createThread(node.path, 'Untitled') : await s.createSubThread(node.path, 'Untitled', { stitch: true })
    toggle(node.path, true)
    s.open(p)
    renameSoon(p)
  }

  const newThread = async (dir = '') => {
    const p = await createThread(dir, 'Untitled')
    if (dir) setOpenMap((m) => ({ ...m, [dir]: true }))
    open(p)
    renameSoon(p)
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
      if (dirname(moving) !== dir && !dir.startsWith(moving + '/')) await useStore.getState().movePath(moving, dir)
      return
    }
    if (e.dataTransfer.files.length) {
      const paths = await importFiles(dir, [...e.dataTransfer.files])
      useStore.getState().notify(`Spooled ${paths.length} file${paths.length === 1 ? '' : 's'} into ${dir || 'the vault'}`)
    }
  }

  // Touch drag: the lifted row follows the finger; rows under it show where it will land.
  const rows = useRef(new Map<string, { node: TreeNode; siblings: TreeNode[] }>()).current
  const scrollRef = useRef<HTMLDivElement>(null)
  const [touchDrag, setTouchDrag] = useState<{ node: TreeNode; x: number; y: number } | null>(null)
  const [touchOver, setTouchOver] = useState<{ path: string; pos: DropPos } | null>(null)
  const dragRef = useRef<{ node: TreeNode; over: { path: string; pos: DropPos } | 'root' | null } | null>(null)
  const touch = useMemo<TouchControl>(
    () => ({
      arm(node, x, y) {
        dragRef.current = { node, over: null }
        setTouchDrag({ node, x, y })
      },
      move(x, y) {
        const d = dragRef.current
        if (!d) return
        setTouchDrag({ node: d.node, x, y })
        // Scroll the Spool when the finger nears its edges.
        const sc = scrollRef.current
        if (sc) {
          const r = sc.getBoundingClientRect()
          if (y < r.top + 40) sc.scrollTop -= 12
          else if (y > r.bottom - 40) sc.scrollTop += 12
        }
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        const row = el?.closest<HTMLElement>('.tree-row[data-path]')
        let over: { path: string; pos: DropPos } | 'root' | null = null
        if (row && row.dataset.path !== d.node.path && !row.dataset.path!.startsWith(d.node.path + '/')) {
          const r = row.getBoundingClientRect()
          const t = (y - r.top) / r.height
          const nestable = row.dataset.nestable !== undefined
          const pos: DropPos = !nestable ? (t < 0.5 ? 'before' : 'after') : t < 0.28 ? 'before' : t > 0.72 ? 'after' : 'inside'
          over = { path: row.dataset.path!, pos }
        } else if (!row && el?.closest('.spool__scroll')) over = 'root'
        d.over = over
        setTouchOver(over && over !== 'root' ? over : null)
        setDropping(over === 'root')
      },
      drop() {
        const d = dragRef.current
        dragRef.current = null
        setTouchDrag(null)
        setTouchOver(null)
        setDropping(false)
        if (!d?.over) return
        if (d.over === 'root') {
          void useStore.getState().movePath(d.node.path, '')
          return
        }
        const target = rows.get(d.over.path)
        if (target) void onPlace(d.node.path, target.node, d.over.pos, target.siblings)
      },
      menu(node, x, y) {
        dragRef.current = null
        setTouchDrag(null)
        setTouchOver(null)
        setCtx({ x, y, node })
      },
      cancel() {
        dragRef.current = null
        setTouchDrag(null)
        setTouchOver(null)
        setDropping(false)
      },
    }),
    [],
  )

  const treeProps: TreeProps = {
    openMap,
    toggle,
    onCtx: setCtx,
    renaming,
    setRenaming,
    onDrop: (e, dir) => void onDrop(e, dir),
    onPlace: (m, t, p, sib) => void onPlace(m, t, p, sib),
    onAdd: (n) => void onAdd(n),
    touch,
    touchOver,
    rows,
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
          <button className="key" onClick={() => void newThread('')} title="New Thread" aria-label="New Thread">
            <Icon name="canvas" size={16} />+ Thread
          </button>
          <button className="key" onClick={() => void newCord('')} title="New Cord: a Thread with a full word processor (pages, headers & footers, page numbers, footnotes)" aria-label="New Cord">
            <Icon name="compiler" size={16} />+ Cord
          </button>
          <button className="key" onClick={() => void newProject('')} title="New Project" aria-label="New Project">
            <Icon name="folder" size={16} />+ Project
          </button>
        </div>

        <div
          ref={scrollRef}
          className={'spool__scroll' + (dropping ? ' spool__drop' : '') + (touchDrag ? ' is-touch-dragging' : '')}
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
                  siblings={[]}
                  depth={0}
                  open={false}
                  onToggle={() => {}}
                  {...treeProps}
                />
              ))
          ) : (
            <div role="tree" aria-label="Spool">
              <TreeList nodes={tree} depth={0} {...treeProps} />
              <button className="tree-addpage" onClick={() => void newThread('')}>
                <Icon name="plus" size={14} /> Add a page
              </button>
            </div>
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
      {touchDrag &&
        createPortal(
          <div className="spool-ghost" style={{ left: touchDrag.x, top: touchDrag.y }}>
            <Icon name={touchDrag.node.file.kind === 'folder' ? 'folder' : 'file'} size={14} /> {touchDrag.node.name}
          </div>,
          document.body,
        )}
      {stylePop && <ThreadStylePop path={stylePop.path} anchor={stylePop.rect} onClose={() => setStylePop(null)} />}
      {dyePop && <DyePicker path={dyePop.path} anchor={dyePop.rect} onClose={() => setDyePop(null)} />}
      {dyeEdit && <DyeEditor dye={dyeEdit.dye} anchor={dyeEdit.rect} onClose={() => setDyeEdit(null)} />}
    </aside>
  )
}

type DropPos = 'before' | 'inside' | 'after'

interface TreeProps {
  openMap: Record<string, boolean>
  toggle: (p: string, open?: boolean) => void
  onCtx: (c: { x: number; y: number; node: TreeNode | null }) => void
  renaming: string | null
  setRenaming: (p: string | null) => void
  onDrop: (e: DragEvent, dir: string) => void
  onPlace: (moving: string, target: TreeNode, pos: DropPos, siblings: TreeNode[]) => void
  onAdd: (node: TreeNode) => void
  /** Long-press menus and finger dragging (touch screens have no right-click or HTML drag). */
  touch: TouchControl
  touchOver: { path: string; pos: DropPos } | null
  /** Rows register themselves so a touch drop can find its target. */
  rows: Map<string, { node: TreeNode; siblings: TreeNode[] }>
}

interface TouchControl {
  arm(node: TreeNode, x: number, y: number): void
  move(x: number, y: number): void
  drop(): void
  menu(node: TreeNode, x: number, y: number): void
  cancel(): void
}

/** The folder a node's children live in: a Project's own folder, or a Thread's sub-thread folder. */
export function childDir(node: { path: string; file: FileInfo }) {
  if (node.file.kind === 'folder') return node.path
  if (node.file.kind === 'thread') return subThreadDir(node.path)
  return null
}

function TreeList(props: TreeProps & { nodes: TreeNode[]; depth: number }) {
  return (
    <>
      {props.nodes.map((n) => {
        const isOpen = !!props.openMap[n.path]
        const nestable = childDir(n) !== null
        return (
          <div key={n.path}>
            <Row {...props} node={n} siblings={props.nodes} depth={props.depth} open={isOpen} onToggle={() => props.toggle(n.path)} />
            {isOpen && nestable && (
              <div className="tree-children" style={{ ['--depth' as any]: props.depth + 1 }}>
                {n.children.length > 0 ? (
                  <TreeList {...props} nodes={n.children} depth={props.depth + 1} />
                ) : (
                  <div className="tree-empty" style={{ ['--depth' as any]: props.depth + 1 }}>
                    No pages inside
                  </div>
                )}
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
  siblings,
  depth,
  open,
  onToggle,
  onCtx,
  renaming,
  setRenaming,
  onDrop,
  onPlace,
  onAdd,
  touch,
  touchOver,
  rows,
}: TreeProps & { node: TreeNode; siblings: TreeNode[]; depth: number; open: boolean; onToggle: () => void }) {
  rows.set(node.path, { node, siblings })
  const rowRef = useRef<HTMLDivElement>(null)
  const nodeRef = useRef(node)
  nodeRef.current = node
  // Touch: hold to lift the row, then drag it (or let go for its menu).
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let start = { x: 0, y: 0 }
    let armed = false
    let moved = false
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY }
      armed = moved = false
      timer = setTimeout(() => {
        armed = true
        navigator.vibrate?.(8)
        touch.arm(nodeRef.current, start.x, start.y)
      }, 420)
    }
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!armed) {
        if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) clearTimeout(timer)
        return
      }
      e.preventDefault()
      if (!moved && Math.hypot(t.clientX - start.x, t.clientY - start.y) < 8) return
      moved = true
      touch.move(t.clientX, t.clientY)
    }
    const onEnd = (e: TouchEvent) => {
      clearTimeout(timer)
      if (!armed) return
      e.preventDefault()
      armed = false
      if (moved) touch.drop()
      else touch.menu(nodeRef.current, start.x, start.y)
    }
    const onCancel = () => {
      clearTimeout(timer)
      if (armed) touch.cancel()
      armed = false
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onCancel)
    return () => {
      clearTimeout(timer)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
    }
  }, [touch])
  const active = useStore((s) => s.active)
  const panes = useStore((s) => s.panes)
  const threads = useStore((s) => s.threads)
  const dyeColor = useDyeColor()
  const open_ = useStore((s) => s.open)
  const openPane = useStore((s) => s.openPane)
  const renamePath = useStore((s) => s.renamePath)
  const isFolder = node.file.kind === 'folder'
  const note = isFolder ? folderNote(node.path, threads) : null
  const isActive = isFolder ? !!note && note === active : node.path === active
  const inPane = !isActive && panes.some((p) => p.path === node.path || (!!note && p.path === note))
  const thread = threads[node.path]
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragDrop, setDrop] = useState<DropPos | null>(null)
  const drop = dragDrop ?? (touchOver?.path === node.path ? touchOver.pos : null)

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
  const nestable = childDir(node) !== null
  const where = (e: DragEvent): DropPos => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    if (!nestable) return y < 0.5 ? 'before' : 'after'
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
  }
  const openIt = () => {
    if (isFolder) {
      if (note) open_(note)
      if (!open || !note) onToggle()
    } else if (isThread) open_(node.path)
    else openPane(node.path)
  }

  return (
    <div
      className={
        'tree-row' +
        (isActive ? ' is-active' : '') +
        (inPane ? ' is-in-pane' : '') +
        (isFolder ? ' is-project' : '') +
        (open ? ' is-open' : '') +
        (drop ? ` drop-${drop}` : '')
      }
      ref={rowRef}
      data-path={node.path}
      data-nestable={nestable ? '' : undefined}
      style={{ ['--depth' as any]: depth }}
      role="treeitem"
      aria-expanded={nestable ? open : undefined}
      tabIndex={0}
      draggable={renaming !== node.path}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/thread-path', node.path)
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      onDragOver={(e) => {
        const moving = [...e.dataTransfer.types].includes('text/thread-path')
        if (!moving && !(nestable && e.dataTransfer.types.includes('Files'))) return
        e.preventDefault()
        e.stopPropagation()
        const pos = moving ? where(e) : 'inside'
        if (pos !== dragDrop) setDrop(pos)
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        const pos = dragDrop ?? 'inside'
        setDrop(null)
        const moving = e.dataTransfer.getData('text/thread-path')
        if (!moving) {
          const dir = childDir(node)
          if (dir !== null) onDrop(e, dir)
          return
        }
        e.preventDefault()
        e.stopPropagation()
        if (moving === node.path || node.path.startsWith(moving + '/') || (isThread && node.path.startsWith(subThreadDir(moving) + '/'))) return
        onPlace(moving, node, pos, siblings)
      }}
      onClick={() => renaming !== node.path && openIt()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setRenaming(node.path)
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2') setRenaming(node.path)
        else if (e.key === 'Enter' && renaming !== node.path) openIt()
        else if (e.key === 'ArrowRight' && nestable && !open) onToggle()
        else if (e.key === 'ArrowLeft' && open) onToggle()
      }}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        onCtx({ x: e.clientX, y: e.clientY, node })
      }}
    >
      {nestable ? (
        <span
          className="chev"
          role="button"
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          <Icon name="chevron" size={13} />
        </span>
      ) : (
        <span className="chev chev--none" />
      )}
      {isThread ? <ThreadIcon thread={thread} size={15} /> : <Icon name={icon} size={15} />}
      {renaming === node.path ? (
        <input
          ref={inputRef}
          defaultValue={node.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => void commitRename(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void commitRename((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setRenaming(null)
          }}
        />
      ) : (
        <span className="name">{node.name}</span>
      )}
      {thread?.dyes[0] && <span className="tree-row__dye" style={{ background: dyeColor(thread.dyes[0]) }} />}
      {isFolder && <span className="count">{countThreads(node)}</span>}
      <span className="tree-row__actions">
        <span
          className="tree-row__more"
          role="button"
          title="Delete, rename, dye and more…"
          aria-label={`More actions for ${node.name}`}
          onClick={(e) => {
            e.stopPropagation()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onCtx({ x: r.left, y: r.bottom + 4, node })
          }}
        >
          <Icon name="more" size={16} />
        </span>
        {nestable && (
          <span
            className="tree-row__add"
            role="button"
            title="Add a page inside"
            aria-label={`Add a page inside ${node.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onAdd(node)
            }}
          >
            <Icon name="plus" size={14} />
          </span>
        )}
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const dir = !node ? '' : node.file.kind === 'folder' ? node.path : dirname(node.path)
  // Portaled: the Spool's backdrop-filter (and clipped corners) would trap a fixed menu inside it.
  // Keep the whole menu on screen (it is taller than it used to be, and phones are short).
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({ left: Math.max(8, Math.min(x, innerWidth - width - 8)), top: Math.max(8, Math.min(y, innerHeight - height - 8)) })
  }, [x, y])
  return createPortal(
    <div ref={menuRef} className="ctx pop" style={pos}>
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
              <Icon name="desk" size={15} /> Open beside the Thread
            </button>
          )}
          {node.file.kind === 'thread' && (
            <>
              <button onClick={() => useStore.getState().openPane(node.path)}>
                <Icon name="desk" size={15} /> Open beside
              </button>
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

function buildTree(files: Record<string, FileInfo>, threads: Record<string, unknown>, order: Record<string, string[]>): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  const root: TreeNode[] = []
  const paths = Object.keys(files).sort()
  for (const p of paths) {
    const f = files[p]
    nodes.set(p, { path: p, name: f.kind === 'thread' ? basename(p).replace(/\.(md|cord)$/i, '') : basename(p), file: f, children: [] })
  }
  // A folder next to a Thread of the same name holds that Thread's sub-threads.
  const owner = (dir: string) => {
    if (files[dir]?.kind !== 'folder') return undefined
    const t = threads[`${dir}.md`] ? `${dir}.md` : threads[`${dir}.cord`] ? `${dir}.cord` : null
    return t ? nodes.get(t) : undefined
  }
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
  // Manual order (dragged in the Spool) first; anything not ordered yet follows, Projects first, then by name.
  const sort = (list: TreeNode[], dir: string | null) => {
    const manual = dir !== null ? order[dir] : undefined
    const rank = (n: TreeNode) => {
      const i = manual ? manual.indexOf(basename(n.path)) : -1
      return i < 0 ? Infinity : i
    }
    list.sort((a, b) => {
      const r = rank(a) - rank(b)
      if (r) return r
      const af = a.file.kind === 'folder' ? 0 : 1
      const bf = b.file.kind === 'folder' ? 0 : 1
      return af - bf || a.name.localeCompare(b.name, undefined, { numeric: true })
    })
    list.forEach((n) => sort(n.children, childDir(n)))
  }
  sort(root, '')
  return root
}

function countThreads(n: TreeNode): number {
  return n.children.reduce((s, c) => s + (c.file.kind === 'thread' ? 1 : 0) + countThreads(c), 0)
}
