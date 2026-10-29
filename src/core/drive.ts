// Google Drive as a Satellite target: a vault mirrored into a Drive folder,
// two ways. Folders stay folders (Projects, sub-threads), Threads stay .md
// files, PDFs and images stay themselves, so the folder is usable from
// Drive, from Obsidian via Drive for desktop, or from another THREAD.
//
// Sync compares each side with what was in step last time (kept per device):
//   changed on one side         → copy it across
//   deleted on one side         → delete on the other (unless it changed there)
//   changed on both sides       → keep both: the Drive copy wins the name,
//                                 this device's copy becomes "… (conflict …)"
// THREAD uses the drive.file scope: it sees only what it created itself.
import type { VaultAdapter } from './vault'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FIELDS = 'id,name,mimeType,md5Checksum,size,modifiedTime,parents'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  md5Checksum?: string
  size?: string
  modifiedTime?: string
  parents?: string[]
}

export interface DriveApi {
  /** Files and folders directly inside a folder (not trashed). */
  children(folderId: string): Promise<DriveFile[]>
  find(name: string, parentId: string, folder: boolean): Promise<DriveFile | null>
  createFolder(name: string, parentId: string): Promise<DriveFile>
  upload(name: string, parentId: string, bytes: Uint8Array, mime: string): Promise<DriveFile>
  update(id: string, bytes: Uint8Array, mime: string): Promise<DriveFile>
  download(id: string): Promise<Uint8Array>
  trash(id: string): Promise<void>
  /** Cheap remote-change check: a token now, and whether anything changed since one. */
  startToken(): Promise<string>
  changedSince(token: string): Promise<{ changed: boolean; next: string }>
}

/** Injected in tests. */
export const driveHttp = { fetch: (input: RequestInfo, init?: RequestInit) => fetch(input, init) }

export class DriveAuthError extends Error {}

export function driveApi(token: () => Promise<string>): DriveApi {
  const call = async (url: string, init: RequestInit = {}) => {
    const res = await driveHttp.fetch(url, { ...init, headers: { authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } })
    if (res.status === 401) throw new DriveAuthError('Google Drive sign-in expired — reconnect to keep syncing.')
    if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return res
  }
  const json = async <T>(url: string, init?: RequestInit) => (await (await call(url, init)).json()) as T
  const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const list = async (query: string) => {
    const out: DriveFile[] = []
    let page: string | undefined
    do {
      const u = new URL(`${API}/files`)
      u.searchParams.set('q', query)
      u.searchParams.set('fields', `nextPageToken,files(${FIELDS})`)
      u.searchParams.set('pageSize', '1000')
      u.searchParams.set('spaces', 'drive')
      if (page) u.searchParams.set('pageToken', page)
      const r = await json<{ files: DriveFile[]; nextPageToken?: string }>(u.toString())
      out.push(...r.files)
      page = r.nextPageToken
    } while (page)
    return out
  }
  const multipart = (meta: object, bytes: Uint8Array, mime: string) => {
    const boundary = 'thread' + Math.random().toString(36).slice(2)
    const head = new TextEncoder().encode(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`)
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`)
    const body = new Uint8Array(head.length + bytes.length + tail.length)
    body.set(head, 0)
    body.set(bytes, head.length)
    body.set(tail, head.length + bytes.length)
    return { body, type: `multipart/related; boundary=${boundary}` }
  }
  return {
    children: (id) => list(`'${q(id)}' in parents and trashed=false`),
    async find(name, parentId, folder) {
      const r = await list(`name='${q(name)}' and '${q(parentId)}' in parents and trashed=false and mimeType${folder ? '=' : '!='}'${FOLDER_MIME}'`)
      return r[0] ?? null
    },
    createFolder: (name, parentId) =>
      json<DriveFile>(`${API}/files?fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      }),
    async upload(name, parentId, bytes, mime) {
      const m = multipart({ name, parents: [parentId], mimeType: mime }, bytes, mime)
      return json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', headers: { 'content-type': m.type }, body: m.body as BodyInit })
    },
    update: (id, bytes, mime) =>
      json<DriveFile>(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`, { method: 'PATCH', headers: { 'content-type': mime }, body: bytes as BodyInit }),
    async download(id) {
      const res = await call(`${API}/files/${encodeURIComponent(id)}?alt=media`)
      return new Uint8Array(await res.arrayBuffer())
    },
    async trash(id) {
      await call(`${API}/files/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
    },
    async startToken() {
      return (await json<{ startPageToken: string }>(`${API}/changes/startPageToken`)).startPageToken
    },
    async changedSince(token) {
      let page: string | undefined = token
      let changed = false
      let next = token
      while (page) {
        const r: { changes: unknown[]; nextPageToken?: string; newStartPageToken?: string } = await json(
          `${API}/changes?pageToken=${encodeURIComponent(page)}&fields=nextPageToken,newStartPageToken,changes(fileId)&pageSize=100&spaces=drive`,
        )
        if (r.changes.length) changed = true
        page = r.nextPageToken
        if (r.newStartPageToken) next = r.newStartPageToken
      }
      return { changed, next }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Sync engine                                                         */
/* ------------------------------------------------------------------ */

interface FileState {
  id: string
  /** Drive's checksum when last in step. */
  md5?: string
  /** This device's copy when last in step. */
  lsize: number
  lmtime: number
  lhash: string
}

/** Per device and vault: where the vault lives in Drive and what was in step. */
export interface DriveLink {
  rootId: string
  folder: string
  files: Record<string, FileState>
  folders: Record<string, string>
  lastSync?: number
  changeToken?: string
}

export interface SyncReport {
  uploaded: string[]
  downloaded: string[]
  deletedLocal: string[]
  deletedRemote: string[]
  conflicts: string[]
  skipped: string[]
}

const IGNORE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.git|\.loom|node_modules)(\/|$)|\.thread-tmp$/

export function mimeOf(path: string) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return (
    {
      md: 'text/markdown',
      markdown: 'text/markdown',
      cord: 'application/json',
      json: 'application/json',
      pdf: 'application/pdf',
      epub: 'application/epub+zip',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      txt: 'text/plain',
    }[ext] ?? 'application/octet-stream'
  )
}
const isText = (path: string) => /\.(md|markdown|cord|json|txt|svg)$/i.test(path)

async function sha(bytes: Uint8Array) {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

export function conflictName(path: string, device: string, when = new Date()) {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  const [base, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, '']
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}${String(when.getMinutes()).padStart(2, '0')}`
  return `${base} (conflict ${device} ${stamp})${ext}`
}

/** Walk the Drive folder: every file and folder by vault path. */
async function remoteTree(api: DriveApi, rootId: string) {
  const files = new Map<string, DriveFile>()
  const folders = new Map<string, string>([['', rootId]])
  const queue: [string, string][] = [['', rootId]]
  while (queue.length) {
    const [path, id] = queue.shift()!
    for (const f of await api.children(id)) {
      const p = path ? `${path}/${f.name}` : f.name
      if (IGNORE.test(p)) continue
      if (f.mimeType === FOLDER_MIME) {
        if (folders.has(p)) continue
        folders.set(p, f.id)
        queue.push([p, f.id])
      } else if (f.mimeType.startsWith('application/vnd.google-apps')) {
        continue // Google Docs/Sheets have no bytes to sync.
      } else if (!files.has(p)) files.set(p, f)
    }
  }
  return { files, folders }
}

export async function syncDrive(
  adapter: VaultAdapter,
  api: DriveApi,
  link: DriveLink,
  opts: { device: string; busy?: (path: string) => boolean; now?: Date },
): Promise<{ link: DriveLink; report: SyncReport }> {
  const report: SyncReport = { uploaded: [], downloaded: [], deletedLocal: [], deletedRemote: [], conflicts: [], skipped: [] }
  const state: DriveLink = { ...link, files: { ...link.files }, folders: { ...link.folders } }
  const remote = await remoteTree(api, state.rootId)
  const localAll = (await adapter.list()).filter((e) => !IGNORE.test(e.path))
  const localFiles = new Map(localAll.filter((e) => !e.dir).map((e) => [e.path, e]))
  const localDirs = new Set(localAll.filter((e) => e.dir).map((e) => e.path))

  // Folders first, shallow to deep, so files have somewhere to go.
  const ensureRemoteFolder = async (path: string): Promise<string> => {
    if (remote.folders.has(path)) return remote.folders.get(path)!
    const parent = await ensureRemoteFolder(dirOf(path))
    const f = await api.createFolder(path.slice(path.lastIndexOf('/') + 1), parent)
    remote.folders.set(path, f.id)
    return f.id
  }
  for (const d of [...localDirs].sort((a, b) => a.split('/').length - b.split('/').length)) {
    // A folder deleted in Drive that's still empty here goes too (handled below); otherwise mirror it.
    if (!remote.folders.has(d) && state.folders[d] && ![...localFiles.keys()].some((p) => p.startsWith(d + '/'))) continue
    await ensureRemoteFolder(d)
  }
  for (const d of remote.folders.keys()) {
    if (!d || localDirs.has(d)) continue
    if (state.folders[d]) continue // deleted here; handled after the files
    await adapter.mkdir(d)
    localDirs.add(d)
  }

  const readLocal = (path: string) => adapter.readBinary(path)
  const writeLocal = async (path: string, bytes: Uint8Array) => {
    if (isText(path)) await adapter.writeText(path, new TextDecoder().decode(bytes))
    else await adapter.writeBinary(path, bytes)
  }
  const upload = async (path: string, bytes: Uint8Array, existing?: string) => {
    const f = existing ? await api.update(existing, bytes, mimeOf(path)) : await api.upload(path.slice(path.lastIndexOf('/') + 1), await ensureRemoteFolder(dirOf(path)), bytes, mimeOf(path))
    return f
  }
  const track = async (path: string, f: DriveFile, bytes: Uint8Array) => {
    state.files[path] = { id: f.id, md5: f.md5Checksum, lsize: -1, lmtime: -1, lhash: await sha(bytes) }
  }

  const paths = new Set([...localFiles.keys(), ...remote.files.keys(), ...Object.keys(state.files)])
  for (const path of [...paths].sort()) {
    if (opts.busy?.(path)) {
      report.skipped.push(path)
      continue
    }
    const s = state.files[path]
    const L = localFiles.get(path)
    const R = remote.files.get(path)
    // Has this device's copy changed since the last sync? Size/time first, then contents.
    let localBytes: Uint8Array | undefined
    const localChanged = async () => {
      if (!L) return false
      if (!s) return true
      if (L.size === s.lsize && L.mtime === s.lmtime) return false
      localBytes ??= await readLocal(path)
      if ((await sha(localBytes)) !== s.lhash) return true
      // Touched but identical: remember the new time so it isn't hashed again.
      state.files[path] = { ...s, lsize: L.size, lmtime: L.mtime }
      return false
    }
    const remoteChanged = () => !!R && (!s || R.md5Checksum !== s.md5)

    if (L && R) {
      if (!s) {
        // Both sides have it and we never synced it: identical means in step, otherwise keep both.
        localBytes ??= await readLocal(path)
        const rb = await api.download(R.id)
        if (same(localBytes, rb)) {
          await track(path, R, rb)
          continue
        }
        await keepBoth(path, R, rb, localBytes)
        continue
      }
      const lc = await localChanged()
      const rc = remoteChanged()
      if (lc && rc) {
        localBytes ??= await readLocal(path)
        const rb = await api.download(R.id)
        if (same(localBytes, rb)) await track(path, R, rb)
        else await keepBoth(path, R, rb, localBytes)
      } else if (lc) {
        localBytes ??= await readLocal(path)
        await track(path, await upload(path, localBytes, R.id), localBytes)
        report.uploaded.push(path)
      } else if (rc) {
        const rb = await api.download(R.id)
        await writeLocal(path, rb)
        await track(path, R, rb)
        report.downloaded.push(path)
      }
    } else if (L && !R) {
      if (s && !(await localChanged())) {
        // Deleted in Drive, untouched here: delete here too.
        await adapter.remove(path)
        delete state.files[path]
        report.deletedLocal.push(path)
      } else {
        localBytes ??= await readLocal(path)
        await track(path, await upload(path, localBytes), localBytes)
        report.uploaded.push(path)
      }
    } else if (!L && R) {
      if (s && !remoteChanged()) {
        // Deleted here, unchanged in Drive: move Drive's copy to the trash.
        await api.trash(R.id)
        delete state.files[path]
        report.deletedRemote.push(path)
      } else {
        const rb = await api.download(R.id)
        await writeLocal(path, rb)
        await track(path, R, rb)
        report.downloaded.push(path)
      }
    } else {
      delete state.files[path] // gone on both sides
    }
  }

  async function keepBoth(path: string, R: DriveFile, remoteBytes: Uint8Array, mine: Uint8Array) {
    const copy = conflictName(path, opts.device, opts.now)
    await writeLocal(copy, mine)
    await track(copy, await upload(copy, mine), mine)
    await writeLocal(path, remoteBytes)
    await track(path, R, remoteBytes)
    report.conflicts.push(copy)
    report.downloaded.push(path)
  }

  // Folders deleted on one side and now empty on the other.
  const after = (await adapter.list()).filter((e) => !IGNORE.test(e.path))
  const afterDirs = new Set(after.filter((e) => e.dir).map((e) => e.path))
  const hasFiles = (d: string) => after.some((e) => !e.dir && e.path.startsWith(d + '/'))
  for (const d of Object.keys(state.folders).sort((a, b) => b.length - a.length)) {
    if (!afterDirs.has(d) && remote.folders.has(d)) {
      if (![...remote.files.keys()].some((p) => p.startsWith(d + '/') && state.files[p])) {
        await api.trash(remote.folders.get(d)!)
        remote.folders.delete(d)
      }
    } else if (afterDirs.has(d) && !remote.folders.has(d) && !hasFiles(d)) {
      await adapter.remove(d)
      afterDirs.delete(d)
    }
  }
  state.folders = Object.fromEntries([...remote.folders.entries()].filter(([p]) => p && afterDirs.has(p)))

  // Remember the size and time of what this sync wrote or sent (never of
  // files it skipped: their edits must still look new next time).
  for (const e of after) {
    const s = state.files[e.path]
    if (s && !e.dir && s.lsize === -1) state.files[e.path] = { ...s, lsize: e.size, lmtime: e.mtime }
  }
  state.lastSync = (opts.now ?? new Date()).getTime()
  return { link: state, report }
}
