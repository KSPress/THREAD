// Google Drive in the app: signing in, linking the open vault to a folder
// ("My Drive › THREAD › <vault>"), and keeping the two in step while THREAD
// is open — shortly after you stop typing, when Drive reports a change, and
// when THREAD goes to the background. The sync itself lives in drive.ts.
import { create } from 'zustand'
import { deviceId } from './activity'
import { openAdapter } from './boot'
import { driveApi, DriveAuthError, DRIVE_SCOPE, FOLDER_MIME, syncDrive, type DriveApi, type DriveFile, type DriveLink, type SyncReport } from './drive'
import { createGoogleAuth } from './google'
import { idbDelete, idbGet, idbSet } from './idb'
import { kindOf } from './paths'
import { bumpPaths, pendingEdits, useStore } from './store'
import { BrowserVault } from './vault'

const TOP_FOLDER = 'THREAD'
const auth = createGoogleAuth({ key: 'thread.gdrive.token', scope: DRIVE_SCOPE, what: 'Google Drive' })
let api: DriveApi = driveApi(() => auth.accessToken())
/** Tests swap in a fake Drive. */
export function useDriveApi(fake: DriveApi) {
  api = fake
}

type Status = 'off' | 'connecting' | 'idle' | 'syncing' | 'error' | 'expired' | 'offline'
interface DriveState {
  status: Status
  folder?: string
  rootId?: string
  lastSync?: number
  report?: SyncReport
  conflicts: string[]
  error?: string
}
export const useDrive = create<DriveState>(() => ({ status: 'off', conflicts: [] }))

const linkKey = () => `drive:${useStore.getState().adapter?.name ?? ''}`
const loadLink = () => idbGet<DriveLink>('kv', linkKey())
const saveLink = (l: DriveLink) => idbSet('kv', linkKey(), l)

/** A readable name for conflict copies: "Android 3f2a", "Mac 91c0"… */
export function deviceLabel() {
  const ua = navigator.userAgent
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device'
  return `${os} ${deviceId().slice(-4)}`
}

export const driveSignedIn = () => auth.connected()

/** My Drive › THREAD (created on first use). */
async function topFolder() {
  return (await api.find(TOP_FOLDER, 'root', true)) ?? (await api.createFolder(TOP_FOLDER, 'root'))
}

/** Link the open vault to My Drive › THREAD › <vault name> and sync it. Call from a click. */
export async function connectDrive() {
  useDrive.setState({ status: 'connecting', error: undefined })
  try {
    if (!auth.connected()) await auth.connect()
    const name = useStore.getState().adapter!.name
    const top = await topFolder()
    const folder = (await api.find(name, top.id, true)) ?? (await api.createFolder(name, top.id))
    await saveLink({ rootId: folder.id, folder: name, files: {}, folders: {} })
    useDrive.setState({ status: 'idle', folder: name, rootId: folder.id })
    startDriveAutoSync()
    await syncNow()
  } catch (e) {
    useDrive.setState({ status: 'error', error: String((e as Error).message ?? e) })
    throw e
  }
}

/** Sign in, then list the vaults kept in My Drive › THREAD (for a new device). */
export async function listDriveVaults(): Promise<DriveFile[]> {
  if (!auth.connected()) await auth.connect()
  const top = await api.find(TOP_FOLDER, 'root', true)
  if (!top) return []
  return (await api.children(top.id)).filter((f) => f.mimeType === FOLDER_MIME).sort((a, b) => a.name.localeCompare(b.name))
}

/** Open a vault from Drive on this device: a local copy, kept in step. */
export async function openFromDrive(folder: DriveFile) {
  await openAdapter(new BrowserVault(folder.name))
  const existing = await loadLink()
  if (!existing || existing.rootId !== folder.id) await saveLink({ rootId: folder.id, folder: folder.name, files: {}, folders: {} })
  useDrive.setState({ status: 'idle', folder: folder.name, rootId: folder.id })
  startDriveAutoSync()
  await syncNow()
}

/** Stop syncing this vault. Files stay where they are, here and in Drive. */
export async function disconnectDrive() {
  stopTimers()
  await idbDelete('kv', linkKey())
  useDrive.setState({ status: 'off', folder: undefined, rootId: undefined, report: undefined, conflicts: [], error: undefined })
}

export function signOutDrive() {
  auth.disconnect()
  useDrive.setState({ status: useDrive.getState().folder ? 'expired' : 'off' })
}

let running: Promise<void> | null = null
let again = false

/** Sync now (or right after the current run, if one is going). */
export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = run().finally(() => {
    running = null
    if (again) {
      again = false
      void syncNow()
    }
  })
  return running
}

async function run() {
  const s = useStore.getState()
  const adapter = s.adapter
  const link = adapter && (await loadLink())
  if (!adapter || !link) return
  if (!auth.connected()) {
    useDrive.setState({ status: 'expired', folder: link.folder, rootId: link.rootId })
    return
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    useDrive.setState({ status: 'offline', folder: link.folder, rootId: link.rootId })
    return
  }
  useDrive.setState({ status: 'syncing', folder: link.folder, rootId: link.rootId, error: undefined })
  try {
    // Unsaved typing waits for the next round rather than racing the editor.
    const { link: next, report } = await syncDrive(adapter, api, link, { device: deviceLabel(), busy: (p) => pendingEdits.has(p) })
    if (!next.changeToken) next.changeToken = await api.startToken().catch(() => undefined)
    if (useStore.getState().adapter !== adapter) return // switched vaults mid-sync
    await saveLink(next)
    const touched = [...report.downloaded, ...report.deletedLocal, ...report.conflicts]
    if (touched.length) {
      await useStore.getState().refresh()
      bumpPaths(report.downloaded.filter((p) => kindOf(p) === 'thread'))
    }
    if (report.conflicts.length) useStore.getState().notify(`Google Drive: kept both versions of ${report.conflicts.length} file${report.conflicts.length === 1 ? '' : 's'} edited in two places`)
    const conflicts = [...new Set([...useDrive.getState().conflicts, ...report.conflicts])].filter((p) => useStore.getState().files[p])
    useDrive.setState({ status: 'idle', lastSync: next.lastSync, report, conflicts })
  } catch (e) {
    if (e instanceof DriveAuthError) {
      auth.save(null)
      useDrive.setState({ status: 'expired', error: e.message })
    } else useDrive.setState({ status: navigator.onLine === false ? 'offline' : 'error', error: String((e as Error).message ?? e) })
  }
}

/* ------------------------------------------------------------------ */
/* Keeping in step while THREAD is open                                */
/* ------------------------------------------------------------------ */

let timers: ReturnType<typeof setInterval>[] = []
let unsubscribe: (() => void) | null = null
let localTimer: ReturnType<typeof setTimeout> | undefined
const onHide = () => document.visibilityState === 'hidden' && void syncNow()
const onOnline = () => void syncNow()

function stopTimers() {
  timers.forEach(clearInterval)
  timers = []
  unsubscribe?.()
  unsubscribe = null
  clearTimeout(localTimer)
  document.removeEventListener('visibilitychange', onHide)
  window.removeEventListener('online', onOnline)
}

/** Called when a vault opens: if it's linked to Drive, keep it in step. */
export async function startDriveAutoSync() {
  stopTimers()
  const link = await loadLink()
  if (!link) {
    useDrive.setState({ status: 'off', folder: undefined, rootId: undefined, conflicts: [] })
    return
  }
  useDrive.setState({ status: auth.connected() ? 'idle' : 'expired', folder: link.folder, rootId: link.rootId, lastSync: link.lastSync })
  // Local edits: sync a few seconds after the vault stops changing.
  unsubscribe = useStore.subscribe((st, prev) => {
    if (st.files === prev.files || useDrive.getState().status === 'syncing') return
    clearTimeout(localTimer)
    localTimer = setTimeout(() => void syncNow(), 5000)
  })
  // Remote edits: one cheap "anything new?" call a minute.
  timers.push(
    setInterval(async () => {
      const l = await loadLink()
      if (!l || !auth.connected() || running) return
      if (!l.changeToken) return void syncNow()
      try {
        const { changed, next } = await api.changedSince(l.changeToken)
        if (changed) {
          await saveLink({ ...l, changeToken: next })
          void syncNow()
        } else if (next !== l.changeToken) await saveLink({ ...l, changeToken: next })
      } catch {
        // Offline or expired: the next full sync reports it.
      }
    }, 60_000),
  )
  // And a full pass every ten minutes in case a change notice was missed.
  timers.push(setInterval(() => void syncNow(), 600_000))
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('online', onOnline)
  setTimeout(() => void syncNow(), 1500)
}
