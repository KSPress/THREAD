// Choosing, remembering and reopening vaults.
import { seedVault } from './seed'
import { useStore } from './store'
import { BrowserVault, FolderVault, isDesktopApp, isTauri, TauriVault, type VaultAdapter } from './vault'

const LAST = 'thread.lastVault'

type Last = { kind: 'tauri'; root: string } | { kind: 'browser'; name: string } | { kind: 'folder' }

export function lastVault(): Last | null {
  try {
    return JSON.parse(localStorage.getItem(LAST) ?? 'null')
  } catch {
    return null
  }
}

export async function openAdapter(adapter: VaultAdapter, opts: { seed?: boolean } = {}) {
  const entries = await adapter.list()
  if (opts.seed && entries.filter((e) => !e.path.startsWith('.')).length === 0) await seedVault(adapter)
  const last: Last =
    adapter instanceof TauriVault ? { kind: 'tauri', root: adapter.root } : adapter.kind === 'folder' ? { kind: 'folder' } : { kind: 'browser', name: adapter.name }
  localStorage.setItem(LAST, JSON.stringify(last))
  await useStore.getState().openVault(adapter)
}

/** Reopen the previous vault on launch when that needs no user gesture. */
export async function restoreVault() {
  try {
    await reopenLast()
  } catch (e) {
    // A vault that can't be reopened (moved folder, cleared storage) falls back to Welcome.
    console.warn('[boot] could not reopen the last vault', e)
  } finally {
    useStore.setState({ booting: false })
  }
}

async function reopenLast() {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const fromCli = await invoke<string | null>('startup_vault').catch(() => null)
    if (fromCli) return openAdapter(new TauriVault(fromCli), { seed: true })
  }
  const last = lastVault()
  if (!last) return
  if (last.kind === 'tauri' && isDesktopApp()) await openAdapter(new TauriVault(last.root))
  else if (last.kind === 'browser') await openAdapter(new BrowserVault(last.name))
}

export async function pickFolder(): Promise<boolean> {
  if (isDesktopApp()) {
    const v = await TauriVault.pick()
    if (!v) return false
    await openAdapter(v, { seed: true })
    return true
  }
  if (FolderVault.supported()) {
    const v = await FolderVault.pick()
    await openAdapter(v, { seed: true })
    return true
  }
  return false
}

export async function reopenFolder(): Promise<boolean> {
  const v = await FolderVault.restore()
  if (!v) return false
  await openAdapter(v)
  return true
}

export async function closeVault() {
  localStorage.removeItem(LAST)
  useStore.setState({ adapter: null, files: {}, threads: {}, active: null, view: 'home', panes: [] })
}
