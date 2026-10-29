// The in-memory index of a vault plus every action the UI can take on it.
import { create } from 'zustand'
import {
  normalizeDye,
  deepAnchor,
  dyesOf,
  extractStitches,
  formatStitch,
  firstHeading,
  joinFrontmatter,
  splitFrontmatter,
  wordCount,
  type Frontmatter,
  type Stitch,
} from './markdown'
import { basename, dirname, extname, isHidden, join, kindOf, META_DIR, safeName, stem, type FileKind } from './paths'
import { LoomSync, type LoomStatus } from './sync'
import { uid } from './table'
import { PALETTES, useSettings } from './settings'
import { deviceId, loadActivity, recordActivity, renameActivity } from './activity'
import { cordToMarkdown, isCordPath, newCord, parseCord, renameStitchTargets, serializeCord } from '../cord/model'
import type { VaultAdapter, VaultEntry } from './vault'

export type View = 'home' | 'canvas' | 'tapestry' | 'compiler'

export interface ThreadInfo {
  path: string
  /** 'cord' for word-processor documents (.cord); body is then their Markdown rendering. */
  kind: 'thread' | 'cord'
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

/** One document open side by side on the Canvas: a Thread, a Cord or a PDF. */
export interface Pane {
  id: string
  path: string
  /** PDFs: where to scroll, and the highlight to flash. */
  page?: number
  highlight?: string
  /** Bumped to force a scroll even when the same target is requested twice. */
  nonce: number
}

/** At most this many documents side by side. */
export const MAX_PANES = 4

interface State {
  adapter: VaultAdapter | null
  loading: boolean
  files: Record<string, FileInfo>
  threads: Record<string, ThreadInfo>
  dyeColors: Record<string, string>
  active: string | null
  view: View
  /** Documents open on the Canvas, left to right. `active` is the focused Thread among them. */
  panes: Pane[]
  /** Ask the Canvas to show its "open beside" picker (e.g. from the / menu). */
  pickerOpen: boolean
  /** Bumped per PDF whenever its highlights change, so open readers reload them. */
  highlightRev: Record<string, number>
  /** Per-path counter bumped when a Thread changes outside the editor. */
  revisions: Record<string, number>
  /** Manual Spool order: folder path ('' = vault root) → entry names in order (.thread/order.json). */
  order: Record<string, string[]>
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
  /** Re-read the vault. `also` lands in the same update (e.g. panes following a rename). */
  refresh(also?: (s: State) => Partial<State>): Promise<void>
  open(path: string): void
  openStitch(target: string, anchor?: string): void
  resolve(target: string): string | null
  setView(v: View): void
  saveThread(path: string, raw: string): Promise<void>
  saveBody(path: string, body: string): Promise<void>
  setFrontmatter(path: string, fm: Frontmatter): Promise<void>
  createThread(dir: string, name: string, body?: string, fm?: Frontmatter): Promise<string>
  createProject(name: string, parent?: string): Promise<string>
  /** A Thread nested under another: stored in a folder named after the parent, next to it. */
  createSubThread(parent: string, name: string, opts?: { stitch?: boolean }): Promise<string>
  /** A new Cord (word-processor document); optionally converted from a Thread's content. */
  createCord(dir: string, name: string, from?: string): Promise<string>
  renameDye(from: string, to: string): Promise<void>
  deleteDye(dye: string): Promise<void>
  toggleDye(path: string, dye: string): Promise<void>
  renamePath(from: string, to: string): Promise<void>
  /** Move a file or folder into `dir` (created if needed), keeping its name unique there. Returns the new path. */
  movePath(from: string, dir: string): Promise<string>
  /** Notion-style: a Thread named after its title (or still "Untitled") is renamed when its title changes. */
  followTitle(path: string, titleBefore: string): Promise<void>
  setOrder(dir: string, names: string[]): Promise<void>
  deletePath(path: string): Promise<void>
  importFiles(dir: string, files: File[]): Promise<string[]>
  dyeColor(dye: string): string
  setDyeColor(dye: string, color: string): Promise<void>
  readMeta<T>(name: string, fallback: T): Promise<T>
  writeMeta(name: string, value: unknown): Promise<void>
  highlights(pdf: string): Promise<Highlight[]>
  saveHighlights(pdf: string, list: Highlight[]): Promise<void>
  /** Record a PDF passage as a highlight (reusing an identical one) and, given a Thread, quote it there with its Deep Stitch. */
  weaveQuote(q: QuoteDrag, thread: string | null): Promise<string>
  /** Open a document beside the others on the Canvas (or scroll the pane already showing it). */
  openPane(path: string, opts?: { index?: number; page?: number; highlight?: string; focus?: boolean }): void
  closePane(id: string): void
  /** Open a PDF beside the active Thread, optionally at a page and highlight. */
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
  panes: [],
  pickerOpen: false,
  highlightRev: {},
  revisions: {},
  order: {},
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
    set({ adapter, loading: true, files: {}, threads: {}, active: null, view: 'home', recent: [], panes: [], order: {} })
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
    const order = await get().readMeta<Record<string, string[]>>('order.json', {})
    set({ dyeColors, recent, order, loading: false })
    await loadActivity()
    await get().connectLoom()
  },

  async refresh(also) {
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
    set((s) => ({ files, threads, ...(also ? also(s) : {}) }))
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
    // Already open in a pane: focus it. Otherwise the focused Thread's pane shows it.
    const panes = get().panes
    let next = panes
    if (!panes.some((p) => p.path === path)) {
      const i = panes.findIndex((p) => p.path === get().active)
      const at = i >= 0 ? i : panes.findIndex((p) => kindOf(p.path) === 'thread')
      next = at >= 0 ? panes.map((p, j) => (j === at ? { id: paneId(), path, nonce: 0 } : p)) : [...panes, { id: paneId(), path, nonce: 0 }]
    }
    set({ active: path, recent, view: 'canvas', panes: next })
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
    set(isCompact() ? { view, spoolOpen: false, stitchingOpen: false, pickerOpen: false } : { view, pickerOpen: false })
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
    if (!useSettings.getState().loomUrl) return
    // Cords are structured JSON: synced whole (like PDFs), not merged character by character.
    if (info.kind === 'cord') await sync?.pushAsset(path, new TextEncoder().encode(raw))
    else await sync?.track(path, raw)
  },

  async saveBody(path, body) {
    const t = get().threads[path]
    await get().saveThread(path, t ? t.head + body : body)
  },

  async setFrontmatter(path, fm) {
    const t = get().threads[path]
    if (!t) return
    if (t.kind === 'cord') {
      const cord = parseCord(t.raw)
      cord.meta = Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== undefined))
      await get().saveThread(path, serializeCord(cord))
    } else await get().saveThread(path, joinFrontmatter(fm, t.body))
    bump(path)
  },

  async createThread(dir, name, body, fm) {
    const adapter = get().adapter!
    const base = safeName(name)
    // Unique across the vault, not just the folder: Stitches link by name.
    const taken = new Set(Object.keys(get().threads).map((p) => stem(p).toLowerCase()))
    let path = join(dir, `${base}.md`)
    for (let i = 2; get().files[path] || taken.has(stem(path).toLowerCase()) || (await adapter.exists(path)); i++) path = join(dir, `${base} ${i}.md`)
    const content = joinFrontmatter(fm ?? {}, body ?? `# ${stem(path)}\n\n`)
    await get().saveThread(path, content)
    return path
  },

  async createSubThread(parent, name, opts = {}) {
    const dir = subThreadDir(parent)
    const adapter = get().adapter!
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir)
    const path = await get().createThread(dir, name)
    if (opts.stitch) {
      const child = stem(path)
      if (editorBus.insertStitch && get().active === parent) editorBus.insertStitch(child)
      else {
        const t = get().threads[parent]
        if (t) {
          await get().saveBody(parent, `${t.body.trimEnd()}\n\n[[${child}]]\n`)
          bump(parent)
        }
      }
    }
    await get().refresh()
    return path
  },

  async createCord(dir, name, from) {
    const adapter = get().adapter!
    const base = safeName(name)
    let path = join(dir, `${base}.cord`)
    for (let i = 2; get().files[path] || (await adapter.exists(path)); i++) path = join(dir, `${base} ${i}.cord`)
    const cord = newCord(base)
    const src = from ? get().threads[from] : undefined
    if (src && src.kind === 'thread') {
      const { markdownToCordDoc } = await import('../cord/convert')
      cord.doc = await markdownToCordDoc(src.body)
      cord.meta = { ...src.frontmatter, title: src.title }
    }
    await get().saveThread(path, serializeCord(cord))
    return path
  },

  async renameDye(from, to) {
    const a = normalizeDye(from)
    const b = normalizeDye(to)
    if (!a || !b || a === b) return
    for (const t of Object.values(get().threads)) {
      if (!t.dyes.includes(a)) continue
      const fm: Frontmatter = { ...t.frontmatter }
      delete fm.tags
      fm.dyes = [...new Set(t.dyes.map((d) => (d === a ? b : d)))]
      await get().setFrontmatter(t.path, fm)
    }
    // Keep its color (unless the new name already had one).
    const colors = { ...get().dyeColors }
    if (colors[a] && !colors[b]) colors[b] = colors[a]
    delete colors[a]
    set({ dyeColors: colors, dyeFilter: get().dyeFilter === a ? b : get().dyeFilter })
    await get().writeMeta('dyes.json', colors)
    await rewriteHighlightDyes((d) => (d === a ? b : d))
    get().notify(`Dye “${a}” is now “${b}”`)
  },

  async deleteDye(dye) {
    const a = normalizeDye(dye)
    for (const t of Object.values(get().threads)) {
      if (!t.dyes.includes(a)) continue
      const fm: Frontmatter = { ...t.frontmatter }
      delete fm.tags
      const rest = t.dyes.filter((d) => d !== a)
      fm.dyes = rest.length ? rest : undefined
      await get().setFrontmatter(t.path, fm)
    }
    const colors = { ...get().dyeColors }
    delete colors[a]
    set({ dyeColors: colors, dyeFilter: get().dyeFilter === a ? null : get().dyeFilter })
    await get().writeMeta('dyes.json', colors)
  },

  async toggleDye(path, dye) {
    const t = get().threads[path]
    const d = normalizeDye(dye)
    if (!t || !d) return
    const fm: Frontmatter = { ...t.frontmatter }
    delete fm.tags
    const next = t.dyes.includes(d) ? t.dyes.filter((x) => x !== d) : [...t.dyes, d]
    fm.dyes = next.length ? next : undefined
    await get().setFrontmatter(path, fm)
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
    let retitled = false
    // A page titled with its own name keeps them in step (renaming "Untitled" retitles it).
    const t = get().threads[from]
    if (t && t.kind === 'thread' && stem(from) !== stem(to)) {
      const re = new RegExp(`^# ${escapeRe(stem(from))}[ \\t]*$`, 'm')
      if (re.test(t.body)) {
        await get().saveThread(from, t.head + t.body.replace(re, `# ${stem(to)}`))
        retitled = true
      }
    }
    await adapter.rename(from, to)
    renamedTo.set(from, to)
    const pending = pendingEdits.get(from)
    if (pending !== undefined) {
      pendingEdits.delete(from)
      pendingEdits.set(to, pending)
    }
    // A Thread's sub-threads travel with it.
    if (!isFolder && kindOf(from) === 'thread') {
      const fromDir = subThreadDir(from)
      if (get().files[fromDir]?.kind === 'folder') await adapter.rename(fromDir, subThreadDir(to))
    }
    // Keep Stitches intact: rewrite [[Old]] to [[New]] across the vault.
    if (!isFolder && kindOf(from) === 'thread' && stem(from) !== stem(to)) {
      const oldName = stem(from)
      const newName = stem(to)
      const re = new RegExp(`\\[\\[${escapeRe(oldName)}(?=[#|\\]])`, 'g')
      for (const t of Object.values(get().threads)) {
        if (t.kind === 'cord') {
          const cord = parseCord(t.raw)
          if (t.path !== from && renameStitchTargets(cord.doc, oldName, newName)) {
            await get().saveThread(t.path, serializeCord(cord))
            bump(t.path)
          }
          continue
        }
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
    await rekeyOrder(from, to)
    const moved = (p: string) => {
      if (p === from || p.startsWith(from + '/')) return to + p.slice(from.length)
      const sub = kindOf(from) === 'thread' && !isFolder ? subThreadDir(from) : null
      if (sub && p.startsWith(sub + '/')) return subThreadDir(to) + p.slice(sub.length)
      return p
    }
    // Panes follow in the same update as the file list, so open editors stay mounted.
    await get().refresh((s) => ({ panes: s.panes.map((p) => ({ ...p, path: moved(p.path) })), active: s.active ? moved(s.active) : s.active }))
    // An open editor shows the new title.
    if (retitled) bump(to)
  },

  async movePath(from, dir) {
    const adapter = get().adapter!
    if (dirname(from) === dir) return from
    if (dir && get().files[dir]?.kind !== 'folder' && !(await adapter.exists(dir))) await adapter.mkdir(dir)
    const ext = get().files[from]?.kind === 'folder' ? '' : extname(from)
    const base = ext ? basename(from).slice(0, -ext.length) : basename(from)
    let to = join(dir, basename(from))
    for (let i = 2; get().files[to] || (await adapter.exists(to)); i++) to = join(dir, `${base} ${i}${ext}`)
    await get().renamePath(from, to)
    return to
  },

  async followTitle(path, titleBefore) {
    const t = get().threads[path]
    if (!t || t.kind !== 'thread' || typeof t.frontmatter.title === 'string') return
    const title = firstHeading(t.body)
    if (!title) return
    const name = stem(path)
    const following = name === titleBefore || name === safeName(titleBefore) || /^Untitled( \d+)?$/.test(name)
    const next = safeName(title)
    if (!following || next === name || next === 'Untitled') return
    const adapter = get().adapter!
    const ext = extname(path)
    let to = join(dirname(path), next + ext)
    for (let i = 2; get().files[to] || (await adapter.exists(to)); i++) to = join(dirname(path), `${next} ${i}${ext}`)
    await get().renamePath(path, to)
  },

  async setOrder(dir, names) {
    set((s) => ({ order: { ...s.order, [dir]: names } }))
    await get().writeMeta('order.json', get().order)
  },

  async deletePath(path) {
    const adapter = get().adapter!
    await adapter.remove(path)
    // Deleting a Thread unravels its sub-threads too.
    if (kindOf(path) === 'thread' && get().files[subThreadDir(path)]?.kind === 'folder') await adapter.remove(subThreadDir(path))
    for (const p of Object.keys(get().threads)) if (p === path || p.startsWith(path + '/')) await sync?.remove(p)
    const active = get().active
    await get().refresh()
    const gone = (p: string) => p === path || p.startsWith(path + '/') || (kindOf(path) === 'thread' && p.startsWith(subThreadDir(path) + '/'))
    set((s) => ({ panes: s.panes.filter((p) => !gone(p.path)) }))
    if (active && gone(active)) {
      const next = get().panes.find((p) => kindOf(p.path) === 'thread')?.path ?? null
      set({ active: next, ...(next ? {} : { view: 'home' as View }) })
    }
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
    set((s) => ({ highlightRev: { ...s.highlightRev, [pdf]: (s.highlightRev[pdf] ?? 0) + 1 } }))
  },

  async weaveQuote(q, thread) {
    const list = await get().highlights(q.pdf)
    // The same passage dragged into several Threads is one highlight with several Stitches.
    let h = list.find((x) => x.page === q.page && x.text === q.text)
    if (!h) {
      h = { id: uid('h').slice(0, 9), page: q.page, rects: q.rects, text: q.text, dye: q.dye, created: Date.now(), thread: thread ?? undefined }
      await get().saveHighlights(q.pdf, [...list, h])
    }
    const stitch = formatStitch({ target: basename(q.pdf), anchor: deepAnchor(q.page, h.id) })
    if (thread) {
      const ed = editors.get(thread)
      const t = get().threads[thread]
      if (ed) ed.insertQuote(q.text, stitch)
      else if (t && t.kind === 'thread') await get().saveBody(thread, `${t.body.trimEnd()}\n\n> ${q.text}\n> ${stitch}\n`)
    }
    get().notify(`Cross-stitched · p.${q.page}${thread ? ` → ${get().threads[thread]?.name ?? ''}` : ''}`)
    return stitch
  },

  openPane(path, opts = {}) {
    const f = get().files[path]
    if (!f || f.kind === 'folder') return
    const isThread = f.kind === 'thread'
    let panes = get().panes
    const hit = panes.find((p) => p.path === path)
    if (hit) {
      panes = panes.map((p) => (p === hit ? { ...p, page: opts.page ?? p.page, highlight: opts.highlight, nonce: p.nonce + 1 } : p))
    } else {
      const pane: Pane = { id: paneId(), path, page: opts.page, highlight: opts.highlight, nonce: 0 }
      panes = [...panes]
      panes.splice(Math.max(0, Math.min(opts.index ?? panes.length, panes.length)), 0, pane)
      // Too many: let go of the oldest pane that isn't the focused Thread.
      while (panes.length > MAX_PANES) {
        const drop = panes.findIndex((p) => p !== pane && p.path !== get().active)
        panes.splice(drop < 0 ? 0 : drop, 1)
      }
    }
    const recent = isThread ? [path, ...get().recent.filter((p) => p !== path)].slice(0, 30) : get().recent
    set({ panes, view: 'canvas', recent, ...(isThread && opts.focus !== false ? { active: path } : {}) })
    if (isCompact()) set({ spoolOpen: false, stitchingOpen: false })
  },

  closePane(id) {
    const panes = get().panes.filter((p) => p.id !== id)
    const active = get().active
    const stillOpen = panes.some((p) => p.path === active)
    set({ panes, ...(stillOpen ? {} : { active: panes.find((p) => kindOf(p.path) === 'thread')?.path ?? null }) })
  },

  openDesk(pdf, page = 1, highlight) {
    if (!pdf) {
      set({ view: 'canvas', pickerOpen: true })
      return
    }
    // Beside the focused Thread, on its left (reading on the left, writing on the right).
    const at = get().panes.findIndex((p) => p.path === get().active)
    get().openPane(pdf, { page, highlight, index: at >= 0 ? at : 0, focus: false })
  },

  async connectLoom() {
    const { loomUrl, loomToken } = useSettings.getState()
    if (!sync) return
    if (!loomUrl) {
      sync.disconnect()
      return
    }
    // Make sure every Thread has a CRDT so the whole vault reaches the Loom.
    for (const t of Object.values(get().threads)) if (t.kind === 'thread') await sync.track(t.path, t.raw)
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
  if (isCordPath(path)) {
    const cord = parseCord(raw)
    const body = cordToMarkdown(cord.doc)
    const name = stem(path)
    return {
      path,
      kind: 'cord',
      name,
      title: (typeof cord.meta.title === 'string' && cord.meta.title) || firstHeading(body) || name,
      raw,
      body,
      head: '',
      frontmatter: cord.meta,
      dyes: dyesOf(cord.meta),
      stitches: extractStitches(body),
      words: wordCount(body),
      mtime,
    }
  }
  const { frontmatter, body } = splitFrontmatter(raw)
  const name = stem(path)
  return {
    path,
    kind: 'thread',
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
  if (files[t + '.cord']) return t + '.cord'
  const lower = t.toLowerCase()
  const byName = (p: string) => {
    const b = basename(p).toLowerCase()
    return b === lower || b === lower + '.md' || b === lower + '.cord'
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

/** Where a Thread's sub-threads live: `Places/Emberfall.md` → `Places/Emberfall/`. */
export function subThreadDir(path: string) {
  return join(dirname(path), stem(path))
}

export function folderNote(dir: string, threads: Record<string, ThreadInfo>) {
  const name = basename(dir)
  // Inside (Project dashboards), or beside it (a Thread with sub-threads).
  const candidates = [join(dir, `${name}.md`), join(dir, 'index.md'), join(dir, 'README.md'), `${dir}.md`]
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

let paneSeq = 0
const paneId = () => `pane-${Date.now().toString(36)}-${++paneSeq}`

/** Keep the manual Spool order in step with a rename or move. */
async function rekeyOrder(from: string, to: string) {
  const s = useStore.getState()
  const order: Record<string, string[]> = {}
  let changed = false
  const moveKey = (k: string) => {
    for (const root of [from, kindOf(from) === 'thread' ? subThreadDir(from) : null]) {
      if (!root) continue
      const dest = root === from ? to : subThreadDir(to)
      if (k === root || k.startsWith(root + '/')) return dest + k.slice(root.length)
    }
    return k
  }
  for (const [k, names] of Object.entries(s.order)) {
    const nk = moveKey(k)
    let list = names
    if (k === dirname(from)) {
      list = dirname(to) === k ? names.map((n) => (n === basename(from) ? basename(to) : n)) : names.filter((n) => n !== basename(from))
    }
    if (nk !== k || list !== names) changed = true
    order[nk] = list
  }
  if (!changed) return
  useStore.setState({ order })
  await s.writeMeta('order.json', order)
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
      if (f.dir || (kindOf(f.path) === 'thread' && !isCordPath(f.path)) || f.path.endsWith('recent.json')) continue
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
/** Recent renames (old path → new), so an open editor can follow its file. */
export const renamedTo = new Map<string, string>()

/** The live editor, so other panes (the Desk) can stitch into it. */
/** The focused Thread's editor (for the / menu, the Stitching panel, sub-thread buttons). */
export const editorBus: {
  insertQuote: ((quote: string, stitch: string) => void) | null
  insertStitch: ((target: string) => void) | null
} = { insertQuote: null, insertStitch: null }

/** Every open editor by path, so a quote can go to a particular pane's Thread. */
export const editors = new Map<string, { insertQuote: (quote: string, stitch: string) => void }>()

/** What a PDF selection carries when dragged into a Thread. */
export const QUOTE_MIME = 'application/x-thread-quote'
export interface QuoteDrag {
  pdf: string
  text: string
  page: number
  rects: Highlight['rects']
  dye: string
}

export type { VaultEntry }

/** Apply a Dye rename/removal to every PDF highlight in the vault. */
async function rewriteHighlightDyes(map: (d: string) => string) {
  const s = useStore.getState()
  if (!s.adapter) return
  for (const e of await s.adapter.list()) {
    const m = /^\.thread\/highlights\/(.+)\.json$/.exec(e.path)
    if (!m) continue
    const list = await s.highlights(m[1])
    if (!list.some((h) => map(h.dye) !== h.dye)) continue
    await s.saveHighlights(m[1], list.map((h) => ({ ...h, dye: map(h.dye) })))
  }
}
