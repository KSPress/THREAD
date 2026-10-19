// Storage adapters. Every adapter speaks vault-relative POSIX paths and stores
// literal files: .md Threads, PDFs, images and the hidden `.thread/` metadata.
import { idbDelete, idbEntries, idbGet, idbSet } from './idb'
import { dirname, join } from './paths'

export interface VaultEntry {
  path: string
  dir: boolean
  size: number
  mtime: number
}

export interface VaultAdapter {
  readonly kind: 'tauri' | 'browser' | 'folder'
  readonly name: string
  list(): Promise<VaultEntry[]>
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  readBinary(path: string): Promise<Uint8Array>
  writeBinary(path: string, data: Uint8Array): Promise<void>
  remove(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
}

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/* ------------------------------------------------------------------ */
/* Browser vault — IndexedDB. Used on the web, iPad/mobile PWAs and as  */
/* the offline cache for Satellites that have no file system access.   */
/* ------------------------------------------------------------------ */

interface StoredFile {
  dir?: boolean
  text?: string
  bin?: Uint8Array
  mtime: number
}

export class BrowserVault implements VaultAdapter {
  readonly kind = 'browser' as const
  constructor(readonly name = 'Browser Vault') {}

  private key(path: string) {
    return `${this.name}::${path}`
  }

  async list(): Promise<VaultEntry[]> {
    const prefix = `${this.name}::`
    const out: VaultEntry[] = []
    for (const [k, v] of await idbEntries<StoredFile>('files')) {
      const key = String(k)
      if (!key.startsWith(prefix)) continue
      const size = v.text?.length ?? v.bin?.byteLength ?? 0
      out.push({ path: key.slice(prefix.length), dir: !!v.dir, size, mtime: v.mtime })
    }
    return out
  }
  async readText(path: string) {
    const f = await idbGet<StoredFile>('files', this.key(path))
    if (!f || f.dir) throw new Error(`Not found: ${path}`)
    return f.text ?? new TextDecoder().decode(f.bin)
  }
  async writeText(path: string, text: string) {
    await this.ensureParents(path)
    await idbSet('files', this.key(path), { text, mtime: Date.now() } satisfies StoredFile)
  }
  async readBinary(path: string) {
    const f = await idbGet<StoredFile>('files', this.key(path))
    if (!f || f.dir) throw new Error(`Not found: ${path}`)
    return f.bin ?? new TextEncoder().encode(f.text ?? '')
  }
  async writeBinary(path: string, bin: Uint8Array) {
    await this.ensureParents(path)
    await idbSet('files', this.key(path), { bin, mtime: Date.now() } satisfies StoredFile)
  }
  async remove(path: string) {
    const entries = await this.list()
    for (const e of entries) {
      if (e.path === path || e.path.startsWith(path + '/')) await idbDelete('files', this.key(e.path))
    }
  }
  async rename(from: string, to: string) {
    await this.ensureParents(to)
    for (const e of await this.list()) {
      if (e.path === from || e.path.startsWith(from + '/')) {
        const v = await idbGet<StoredFile>('files', this.key(e.path))
        await idbSet('files', this.key(to + e.path.slice(from.length)), v)
        await idbDelete('files', this.key(e.path))
      }
    }
  }
  async mkdir(path: string) {
    if (!path) return
    await this.ensureParents(path)
    if (!(await idbGet('files', this.key(path)))) await idbSet('files', this.key(path), { dir: true, mtime: Date.now() })
  }
  async exists(path: string) {
    return !!(await idbGet('files', this.key(path)))
  }
  private async ensureParents(path: string) {
    let dir = dirname(path)
    const missing: string[] = []
    while (dir && !(await idbGet('files', this.key(dir)))) {
      missing.push(dir)
      dir = dirname(dir)
    }
    for (const d of missing) await idbSet('files', this.key(d), { dir: true, mtime: Date.now() })
  }
}

/* ------------------------------------------------------------------ */
/* Folder vault — File System Access API (Chromium browsers). Opens a  */
/* real folder on disk, so the same vault works in Obsidian too.        */
/* ------------------------------------------------------------------ */

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>
  queryPermission?(o: { mode: string }): Promise<PermissionState>
  requestPermission?(o: { mode: string }): Promise<PermissionState>
}

export class FolderVault implements VaultAdapter {
  readonly kind = 'folder' as const
  readonly name: string
  constructor(private root: DirHandle) {
    this.name = root.name
  }

  static supported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window
  }

  static async pick(): Promise<FolderVault> {
    const handle = (await (window as any).showDirectoryPicker({ mode: 'readwrite' })) as DirHandle
    await idbSet('kv', 'folderHandle', handle)
    return new FolderVault(handle)
  }

  /** Re-open the last folder. Browsers require a user gesture to re-grant access. */
  static async restore(): Promise<FolderVault | null> {
    const handle = await idbGet<DirHandle>('kv', 'folderHandle')
    if (!handle) return null
    const perm = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'
    if (perm !== 'granted') {
      const req = await handle.requestPermission?.({ mode: 'readwrite' })
      if (req !== 'granted') return null
    }
    return new FolderVault(handle)
  }

  private async dir(path: string, create = false): Promise<DirHandle> {
    let cur = this.root
    for (const part of path.split('/').filter(Boolean)) cur = (await cur.getDirectoryHandle(part, { create })) as DirHandle
    return cur
  }
  private async file(path: string, create = false) {
    const d = await this.dir(dirname(path), create)
    return d.getFileHandle(path.split('/').pop()!, { create })
  }

  async list(): Promise<VaultEntry[]> {
    const out: VaultEntry[] = []
    const walk = async (dir: DirHandle, prefix: string) => {
      for await (const h of dir.values()) {
        const p = join(prefix, h.name)
        if (h.kind === 'directory') {
          if (h.name === 'node_modules' || h.name === '.git') continue
          out.push({ path: p, dir: true, size: 0, mtime: 0 })
          await walk(h as DirHandle, p)
        } else {
          const f = await (h as FileSystemFileHandle).getFile()
          out.push({ path: p, dir: false, size: f.size, mtime: f.lastModified })
        }
      }
    }
    await walk(this.root, '')
    return out
  }
  async readText(path: string) {
    return (await (await this.file(path)).getFile()).text()
  }
  async writeText(path: string, text: string) {
    const w = await (await this.file(path, true)).createWritable()
    await w.write(text)
    await w.close()
  }
  async readBinary(path: string) {
    return new Uint8Array(await (await (await this.file(path)).getFile()).arrayBuffer())
  }
  async writeBinary(path: string, data: Uint8Array) {
    const w = await (await this.file(path, true)).createWritable()
    await w.write(data as unknown as ArrayBuffer)
    await w.close()
  }
  async remove(path: string) {
    const parent = await this.dir(dirname(path))
    await parent.removeEntry(path.split('/').pop()!, { recursive: true })
  }
  async rename(from: string, to: string) {
    const entries = (await this.list()).filter((e) => e.path === from || e.path.startsWith(from + '/'))
    for (const e of entries) {
      const target = to + e.path.slice(from.length)
      if (e.dir) await this.mkdir(target)
      else await this.writeBinary(target, await this.readBinary(e.path))
    }
    await this.remove(from)
  }
  async mkdir(path: string) {
    await this.dir(path, true)
  }
  async exists(path: string) {
    try {
      await this.file(path)
      return true
    } catch {
      try {
        await this.dir(path)
        return true
      } catch {
        return false
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tauri vault — native file system through the Rust host commands.    */
/* ------------------------------------------------------------------ */

export class TauriVault implements VaultAdapter {
  readonly kind = 'tauri' as const
  readonly name: string
  constructor(readonly root: string) {
    this.name = root.split(/[\\/]/).filter(Boolean).pop() ?? root
  }
  private async call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(cmd, { root: this.root, ...args })
  }
  static async pick(): Promise<TauriVault | null> {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({ directory: true, title: 'Choose your Thread vault' })
    return typeof dir === 'string' ? new TauriVault(dir) : null
  }
  list() {
    return this.call<VaultEntry[]>('vault_list')
  }
  readText(path: string) {
    return this.call<string>('vault_read_text', { path })
  }
  writeText(path: string, text: string) {
    return this.call<void>('vault_write_text', { path, text })
  }
  async readBinary(path: string) {
    // Returned as a raw IPC response (ArrayBuffer), not a JSON number array.
    return new Uint8Array(await this.call<ArrayBuffer>('vault_read_binary', { path }))
  }
  async writeBinary(path: string, data: Uint8Array) {
    // Sent as a raw IPC body; root/path travel in headers.
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('vault_write_binary', data, {
      headers: { 'x-root': encodeURIComponent(this.root), 'x-path': encodeURIComponent(path) },
    })
  }
  remove(path: string) {
    return this.call<void>('vault_remove', { path })
  }
  rename(from: string, to: string) {
    return this.call<void>('vault_rename', { from, to })
  }
  mkdir(path: string) {
    return this.call<void>('vault_mkdir', { path })
  }
  exists(path: string) {
    return this.call<boolean>('vault_exists', { path })
  }
}
