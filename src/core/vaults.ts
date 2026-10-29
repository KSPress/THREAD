// The vaults this device knows about, for the welcome screen's one list:
// kept inside THREAD (device), a folder on disk, a Loom Satellite, or kept in
// Google Drive. Recorded whenever a vault opens.
import { idbGet } from './idb'
import { BrowserVault } from './vault'

export type VaultKind = 'device' | 'folder' | 'tauri'

export interface KnownVault {
  name: string
  kind: VaultKind
  /** Desktop app: the folder's path. */
  root?: string
  /** The Loom this vault syncs with, if any. */
  loom?: string
  /** Kept in step with a Google Drive folder. */
  drive?: boolean
  opened: number
}

const KEY = 'thread.vaults'

function load(): KnownVault[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function rememberVault(v: Omit<KnownVault, 'opened'>) {
  const list = load().filter((x) => !(x.name === v.name && x.kind === v.kind && x.root === v.root))
  list.unshift({ ...v, opened: Date.now() })
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)))
  } catch {
    // Storage full or blocked: the list is a convenience.
  }
}

export function forgetVault(name: string, kind: VaultKind) {
  try {
    localStorage.setItem(KEY, JSON.stringify(load().filter((x) => !(x.name === name && x.kind === kind))))
  } catch {
    // ignore
  }
}

/** Everything to show: remembered vaults plus device vaults made before the list existed. */
export async function knownVaults(): Promise<KnownVault[]> {
  const list = load()
  let names: string[] = []
  try {
    names = await BrowserVault.names()
  } catch {
    // IndexedDB unavailable (private mode): only remembered vaults.
  }
  for (const n of names) if (!list.some((v) => v.kind === 'device' && v.name === n)) list.push({ name: n, kind: 'device', opened: 0 })
  // Device vaults that no longer exist here are dropped.
  const out = list.filter((v) => v.kind !== 'device' || names.includes(v.name))
  for (const v of out) if (v.kind === 'device') v.drive = !!(await idbGet('kv', `drive:${v.name}`).catch(() => null))
  return out.sort((a, b) => b.opened - a.opened)
}
