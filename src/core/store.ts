// The in-memory index of a vault plus every action the UI can take on it.
import { create } from 'zustand'
import {
  dyesOf,
  extractStitches,
  firstHeading,
  joinFrontmatter,
  splitFrontmatter,
  wordCount,
  type Frontmatter,
  type Stitch,
} from './markdown'
import { basename, dirname, isHidden, join, kindOf, META_DIR, safeName, stem, type FileKind } from './paths'
import { LoomSync, type LoomStatus } from './sync'
import { PALETTES, useSettings } from './settings'
import { deviceId, loadActivity, recordActivity, renameActivity } from './activity'
import type { VaultAdapter, VaultEntry } from './vault'

export type View = 'home' | 'canvas' | 'tapestry' | 'desk' | 'compiler'

export interface ThreadInfo {
  path: string
  name: string
  title: string
  raw: string
  body: string
  /** The literal frontmatter block (with delimiters), preserved byte-for-byte on body edits. */
  head: string
  frontmatter: Frontmatter
  dyes: string[]
  stitches: Stitch[]
  words: number
  mtime: number
}

export interface FileInfo {
  path: string
  kind: FileKind | 'folder'
  size: number
  mtime: number
}

export interface Highlight {
  id: string
  page: number
  /** Normalised (0–1) rectangles relative to the page box. */
  rects: { x: number; y: number; w: number; h: number }[]
  text: string
  dye: string
  created: number
  /** Thread the quote was stitched into. */
  thread?: string
}

export interface ManuscriptItem {
  path: string
  role: 'title' | 'front' | 'chapter' | 'appendix'
}

export interface Manuscript {
  id: string
  title: string
  subtitle: string
  author: string
  items: ManuscriptItem[]
  pageSize: 'A4' | 'LETTER' | 'A5' | 'B5'
  font: 'serif' | 'sans'
  fontSize: number
  chapterBreaks: boolean
  pageNumbers: boolean
  runningHeader: boolean
  keepDeepQuotes: boolean
}

interface DeskState {
  pdf: string | null
  page: number
  highlight?: string
  /** Bumped to force a scroll even when the same target is requested twice. */
  nonce: number
}

interface State {
  adapter: VaultAdapter | null
  loading: boolean
  files: Record<string, FileInfo>
  threads: Record<string, ThreadInfo>
  dyeColors: Record<string, string>
  active: string | null
  view: View
  desk: DeskState
  /** Per-path counter bumped when a Thread changes outside the editor. */
  revisions: Record<string, number>
  dyeFilter: string | null
  recent: string[]
  spoolOpen: boolean
  stitchingOpen: boolean
  paletteOpen: boolean
  settingsOpen: boolean
  loomStatus: LoomStatus
  loomPending: number
  loomDetail?: string
  toast: { id: number; text: string } | null
}

interface Actions {
  openVault(adapter: VaultAdapter): Promise<void>
  refresh(): Promise<void>
  open(path: string): void
  openStitch(target: string, anchor?: string): void
  resolve(target: string): string | null
  setView(v: View): void
  saveThread(path: string, raw: string): Promise<void>
  saveBody(path: string, body: string): Promise<void>
  setFrontmatter(path: string, fm: Frontmatter): Promise<void>
  createThread(dir: string, name: string, body?: string, fm?: Frontmatter): Promise<string>
  createProject(name: string, parent?: string): Promise<string>
  renamePath(from: string, to: string): Promise<void>
  deletePath(path: string): Promise<void>
  importFiles(dir: string, files: File[]): Promise<string[]>
  dyeColor(dye: string): string
  setDyeColor(dye: string, color: string): Promise<void>
  readMeta<T>(name: string, fallback: T): Promise<T>
  writeMeta(name: string, value: unknown): Promise<void>
  highlights(pdf: string): Promise<Highlight[]>
  saveHighlights(pdf: string, list: Highlight[]): Promise<void>
  openDesk(pdf: string | null, page?: number, highlight?: string): void
  connectLoom(): Promise<void>
  notify(text: string): void
  set(patch: Partial<State>): void
}

let sync: LoomSync | null = null

/** Phones (either orientation) and tablets in portrait: side panels overlay the content. */
export const isCompact = () => typeof window !== 'undefined' && (window.innerWidth <= 860 || window.innerHeight <= 520)
export const getSync = () => sync

export const useStore = create<State & Actions>((set, get) => ({
  adapter: null,
  loading: false,
  files: {},
  threads: {},
  dyeColors: {},
  active: null,
  view: 'home',
  desk: { pdf: null, page: 1, nonce: 0 },
  revisions: {},
  dyeFilter: null,
  recent: [],
  // Satellites on tablets/phones start with the side panels tucked away.
  spoolOpen: !isCompact(),
  stitchingOpen: typeof window === 'undefined' || window.innerWidth > 1180,
  paletteOpen: false,
  settingsOpen: false,
  loomStatus: 'disabled',
  loomPending: 0,
  toast: null,

  set: (patch) => set(patch),

  async openVault(adapter) {
    sync?.disconnect()
    set({ adapter, loading: true, files: {}, threads: {}, active: null, view: 'home', recent: [] })
    sync = new LoomSync(adapter.name, {
      onRemoteText: (path, text) => void applyRemote(path, text),
      onRemoteDelete: (path) => void applyRemoteDelete(path),
      onRemoteRename: (from, to) => void applyRemoteRename(from, to),
      onStatus: (loomStatus, loomPending, loomDetail) => set({ loomStatus, loomPending, loomDetail }),
      takePendingLocal: (path) => {
        const body = pendingEdits.get(path)
        if (body === undefined) return null
        pendingEdits.delete(path)
        return (get().threads[path]?.head ?? '') + body
      },
    })
    await get().refresh()
    const dyeColors = await get().readMeta<Record<string, string>>('dyes.json', {})
    const recent = (await get().readMeta<string[]>('recent.json', [])).filter((p) => get().threads[p])
    set({ dyeColors, recent, loading: false })
    await loadActivity()
    await get().connectLoom()
  },

  async refresh() {
    const adapter = get().adapter
    if (!adapter) return
    const entries = await adapter.list()
    const files: Record<string, FileInfo> = {}
    const threads: Record<string, ThreadInfo> = {}
    const reads: Promise<void>[] = []
    for (const e of entries) {
      if (isHidden(e.path)) continue
      files[e.path] = { path: e.path, kind: e.dir ? 'folder' : kindOf(e.path), size: e.size, mtime: e.mtime }
      if (!e.dir && kindOf(e.path) === 'thread') {
        reads.push(
          adapter.readText(e.path).then((raw) => {
            threads[e.path] = indexThread(e.path, raw, e.mtime)
          }),
        )
      }
    }
    await Promise.all(reads)
    set({ files, threads })
  },

  open(path) {
    const f = get().files[path]
    if (!f) return
    if (f.kind === 'folder') {
      // A Project opens its dashboard Thread (folder note).
      const note = folderNote(path, get().threads)
      if (note) get().open(note)
      return
    }
    if (f.kind === 'pdf' || f.kind === 'epub') {
      get().openDesk(path)
      return
    }
    if (f.kind !== 'thread') return
    const recent = [path, ...get().recent.filter((p) => p !== path)].slice(0, 30)
    set({ active: path, recent, view: get().view === 'desk' ? 'desk' : 'canvas' })
    if (isCompact()) set({ spoolOpen: false, stitchingOpen: false })
    void get().writeMeta('recent.json', recent)
  },

  resolve(target) {
    return resolveTarget(target, get().files, get().threads)
  },

  openStitch(target, anchor) {
    const path = get().resolve(target)
    if (!path) {
      // Unresolved stitch: weave a new Thread into existence, like Obsidian.
      const dir = get().active ? dirname(get().active!) : ''
      void get()
        .createThread(dir, target)
        .then((p) => get().open(p))
      return
    }
    const kind = get().files[path]?.kind
    if (kind === 'pdf' || kind === 'epub') {
      const params = new URLSearchParams(anchor ?? '')
      get().openDesk(path, parseInt(params.get('page') ?? '1', 10) || 1, params.get('highlight') ?? undefined)
    } else get().open(path)
  },

  setView(view) {
    set(isCompact() ? { view, spoolOpen: false, stitchingOpen: false } : { view })
  },

  async saveThread(path, raw) {
    const adapter = get().adapter
    if (!adapter) return
    const prev = get().threads[path]
    if (prev && prev.raw === raw) return
    await adapter.writeText(path, raw)
    const info = indexThread(path, raw, Date.now())
    set((s) => ({
      threads: { ...s.threads, [path]: info },
      files: { ...s.files, [path]: { path, kind: 'thread', size: raw.length, mtime: info.mtime } },
    }))
    recordActivity(path)
    if (useSettings.getState().loomUrl) await sync?.track(path, raw)
  },

  async saveBody(path, body) {
    const t = get().threads[path]
    await get().saveThread(path, t ? t.head + body : body)
  },

  async setFrontmatter(path, fm) {
    const t = get().threads[path]
    if (!t) return
    await get().saveThread(path, joinFrontmatter(fm, t.body))
    bump(path)
  },

  async createThread(dir, name, body, fm) {
    const adapter = get().adapter!
    const base = safeName(name)
    let path = join(dir, `${base}.md`)
    for (let i = 2; get().files[path] || (await adapter.exists(path)); i++) path = join(dir, `${base} ${i}.md`)
    const content = joinFrontmatter(fm ?? {}, body ?? `# ${base}\n\n`)
    await get().saveThread(path, content)
    return path
  },

  async createProject(name, parent = '') {
    const adapter = get().adapter!
    const base = safeName(name)
    let dir = join(parent, base)
    for (let i = 2; get().files[dir]; i++) dir = join(parent, `${base} ${i}`)
    await adapter.mkdir(dir)
    set((s) => ({ files: { ...s.files, [dir]: { path: dir, kind: 'folder', size: 0, mtime: Date.now() } } }))
    const project = basename(dir)
    const note = await get().createThread(
      dir,
      project,
      `# ${project}\n\nThe central dashboard for this Project. Stitch the Threads that matter here.\n\n## Threads\n\n- \n`,
      { type: 'project', dyes: ['project'] },
    )
    return note
  },

  async renamePath(from, to) {
    const adapter = get().adapter!
    if (from === to) return
    const isFolder = get().files[from]?.kind === 'folder'
    await adapter.rename(from, to)
    // Keep Stitches intact: rewrite [[Old]] to [[New]] across the vault.
    if (!isFolder && kindOf(from) === 'thread' && stem(from) !== stem(to)) {
      const oldName = stem(from)
      const newName = stem(to)
      const re = new RegExp(`\\[\\[${escapeRe(oldName)}(?=[#|\\]])`, 'g')
      for (const t of Object.values(get().threads)) {
        if (t.path === from || !re.test(t.raw)) continue
        re.lastIndex = 0
        await get().saveThread(t.path, t.raw.replace(re, `[[${newName}`))
        bump(t.path)
      }
    }
    // Folder notes follow their Project.
    if (isFolder) {
      const oldNote = join(to, `${basename(from)}.md`)
      const newNote = join(to, `${basename(to)}.md`)
      if (await adapter.exists(oldNote)) await adapter.rename(oldNote, newNote)
    }
    await sync?.rename(from, to)
    renameActivity(from, to)
    const active = get().active
    await get().refresh()
    if (active && (active === from || active.startsWith(from + '/'))) set({ active: to + active.slice(from.length) })
  },

  async deletePath(path) {
    const adapter = get().adapter!
    await adapter.remove(path)
    for (const p of Object.keys(get().threads)) if (p === path || p.startsWith(path + '/')) await sync?.remove(p)
    const active = get().active
    await get().refresh()
    if (active && (active === path || active.startsWith(path + '/'))) set({ active: null, view: 'home' })
  },

  async importFiles(dir, list) {
    const adapter = get().adapter!
    const out: string[] = []
    for (const f of list) {
      let path = join(dir, safeName(f.name.replace(/\.[^.]+$/, '')) + (f.name.match(/\.[^.]+$/)?.[0] ?? ''))
      const data = new Uint8Array(await f.arrayBuffer())
      if (kindOf(path) === 'thread') await get().saveThread(path, new TextDecoder().decode(data))
      else {
        await adapter.writeBinary(path, data)
        void sync?.pushAsset(path, data)
      }
      out.push(path)
    }
    await get().refresh()
    return out
  },

  dyeColor(dye) {
    const c = get().dyeColors[dye]
    if (c) return c
    const colors = PALETTES[useSettings.getState().palette].colors
    let h = 0
    for (const ch of dye) h = (h * 31 + ch.charCodeAt(0)) | 0
    return colors[Math.abs(h) % colors.length]
  },

  async setDyeColor(dye, color) {
    const dyeColors = { ...get().dyeColors, [dye]: color }
    set({ dyeColors })
    await get().writeMeta('dyes.json', dyeColors)
  },

  async readMeta(name, fallback) {
    try {
      return JSON.parse(await get().adapter!.readText(join(META_DIR, name)))
    } catch {
      return fallback
    }
  },

  async writeMeta(name, value) {
    const text = JSON.stringify(value, null, 2)
    const path = join(META_DIR, name)
    await get().adapter?.writeText(path, text)
    if (name !== 'recent.json') void sync?.pushAsset(path, new TextEncoder().encode(text))
  },

  async highlights(pdf) {
    return get().readMeta<Highlight[]>(`highlights/${pdf}.json`, [])
  },

  async saveHighlights(pdf, list) {
    await get().writeMeta(`highlights/${pdf}.json`, list)
  },

  openDesk(pdf, page = 1, highlight) {
    set((s) => ({
      view: 'desk',
      desk: { pdf: pdf ?? s.desk.pdf, page, highlight, nonce: s.desk.nonce + 1 },
    }))
  },

  async connectLoom() {
    const { loomUrl, loomToken } = useSettings.getState()
    if (!sync) return
    if (!loomUrl) {
      sync.disconnect()
      return
    }
    // Make sure every Thread has a CRDT so the whole vault reaches the Loom.
    for (const t of Object.values(get().threads)) await sync.track(t.path, t.raw)
    await sync.connect(loomUrl, loomToken)
    void syncAssets()
  },

  notify(text) {
    const id = Date.now()
    set({ toast: { id, text } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 2600)
  },
}))

/* ------------------------------------------------------------------ */

export function indexThread(path: string, raw: string, mtime: number): ThreadInfo {
  const { frontmatter, body } = splitFrontmatter(raw)
  const name = stem(path)
  return {
    path,
    name,
    title: (typeof frontmatter.title === 'string' && frontmatter.title) || firstHeading(body) || name,
    raw,
    body,
    head: raw.slice(0, raw.length - body.length),
    frontmatter,
    dyes: dyesOf(frontmatter),
    stitches: extractStitches(body),
    words: wordCount(body),
    mtime,
  }
}

export function resolveTarget(
  target: string,
  files: Record<string, FileInfo>,
  threads: Record<string, ThreadInfo>,
): string | null {
  const t = target.trim()
  if (!t) return null
  // A Project (folder) resolves to its dashboard Thread.
  const asFolder = (p: string) => (files[p]?.kind === 'folder' ? folderNote(p, threads) : p)
  if (files[t]) return asFolder(t)
  if (files[t + '.md']) return t + '.md'
  const lower = t.toLowerCase()
  const byName = (p: string) => {
    const b = basename(p).toLowerCase()
    return b === lower || b === lower + '.md'
  }
  const thread = Object.keys(threads).find(byName)
  if (thread) return thread
  const file = Object.keys(files).find((p) => files[p].kind !== 'folder' && (byName(p) || p.toLowerCase().endsWith('/' + lower)))
  if (file) return file
  const folder = Object.keys(files).find((p) => files[p].kind === 'folder' && basename(p).toLowerCase() === lower)
  if (folder && folderNote(folder, threads)) return folderNote(folder, threads)
  // Titles and `aliases:` are matched last.
  for (const th of Object.values(threads)) {
    if (th.title.toLowerCase() === lower) return th.path
    const aliases = th.frontmatter.aliases
    if (Array.isArray(aliases) && aliases.some((a) => String(a).toLowerCase() === lower)) return th.path
  }
  return null
}

export function folderNote(dir: string, threads: Record<string, ThreadInfo>) {
  const name = basename(dir)
  const candidates = [join(dir, `${name}.md`), join(dir, 'index.md'), join(dir, 'README.md')]
  return candidates.find((c) => threads[c]) ?? null
}

/**
 * Dye color lookup that re-renders the caller when Dye colors load or the
 * palette changes (the store's `dyeColor` function itself is stable).
 */
export function useDyeColor() {
  useStore((s) => s.dyeColors)
  useSettings((s) => s.palette)
  return useStore.getState().dyeColor
}

/** Threads whose stitches resolve to `path`. */
export function backlinksOf(path: string, s: Pick<State, 'files' | 'threads'>) {
  const out: { from: ThreadInfo; stitch: Stitch }[] = []
  for (const t of Object.values(s.threads)) {
    if (t.path === path) continue
    for (const st of t.stitches) {
      if (resolveTarget(st.target, s.files, s.threads) === path) out.push({ from: t, stitch: st })
    }
  }
  return out
}

function bump(path: string) {
  useStore.setState((s) => ({ revisions: { ...s.revisions, [path]: (s.revisions[path] ?? 0) + 1 } }))
}

async function applyRemote(path: string, text: string) {
  const s = useStore.getState()
  if (!s.adapter || s.threads[path]?.raw === text) return
  await s.adapter.writeText(path, text)
  const info = indexThread(path, text, Date.now())
  useStore.setState((st) => ({
    threads: { ...st.threads, [path]: info },
    files: { ...st.files, [path]: { path, kind: 'thread', size: text.length, mtime: info.mtime } },
  }))
  bump(path)
}

async function applyRemoteDelete(path: string) {
  const s = useStore.getState()
  if (!s.adapter || !s.files[path]) return
  await s.adapter.remove(path)
  await s.refresh()
  if (s.active === path) useStore.setState({ active: null, view: 'home' })
}

async function applyRemoteRename(from: string, to: string) {
  const s = useStore.getState()
  if (!s.adapter || !s.files[from]) return
  await s.adapter.rename(from, to)
  await s.refresh()
  if (s.active === from) useStore.setState({ active: to })
}

async function syncAssets() {
  const s = useStore.getState()
  if (!sync || !s.adapter) return
  // Wait for the socket before talking HTTP to the same host.
  for (let i = 0; i < 20 && !sync.isOnline; i++) await new Promise((r) => setTimeout(r, 250))
  if (!sync.isOnline) return
  try {
    const remote = await sync.manifest()
    const remoteSet = new Map(remote.map((r) => [r.path, r]))
    const localAll = new Map((await s.adapter.list()).map((e) => [e.path, e]))
    const ownLog = `${META_DIR}/activity/${deviceId()}.json`
    for (const r of remote) {
      // This device is the only writer of its own activity log.
      if (r.path === ownLog) continue
      const local = localAll.get(r.path)
      if (!local || (local.size !== r.size && r.mtime > local.mtime)) {
        await s.adapter.writeBinary(r.path, await sync.pullAsset(r.path))
      }
    }
    for (const f of await s.adapter.list()) {
      if (f.dir || kindOf(f.path) === 'thread' || f.path.endsWith('recent.json')) continue
      if (isHidden(f.path) && !f.path.startsWith(META_DIR + '/')) continue
      const r = remoteSet.get(f.path)
      if (!r || (r.size !== f.size && f.mtime > r.mtime)) await sync.pushAsset(f.path, await s.adapter.readBinary(f.path))
    }
    await s.refresh()
    useStore.setState({ dyeColors: await s.readMeta('dyes.json', s.dyeColors) })
    await loadActivity()
  } catch (e) {
    console.warn('[loom] asset sync failed', e)
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Unsaved editor bodies by path. Remote merges consume these first so a
 * keystroke in flight is folded into the CRDT before the remote update lands,
 * instead of being overwritten by it (or overwriting it).
 */
export const pendingEdits = new Map<string, string>()

/** The live editor, so other panes (the Desk) can stitch into it. */
export const editorBus: { insertQuote: ((quote: string, stitch: string) => void) | null } = { insertQuote: null }

export type { VaultEntry }
