// Updates: every running THREAD watches for a newer published build.
// - Browser: the build lives on the same host; reloading picks it up (the
//   service worker serves the app shell network-first).
// - Desktop / Android apps: the loader (src/loader.ts) starts the newest build
//   from GitHub Pages at launch; while running, a restart applies a newer one.
import { create } from 'zustand'
import { BASE } from './base'
import { useSettings } from './settings'
import { isTauri } from './vault'
import { fetchRelease, isNewerRelease, UPDATE_REQUEST } from './release'

export type BuildInfo = typeof __THREAD_BUILD__

export const BUILD: BuildInfo = window.__THREAD_LIVE__?.build ?? __THREAD_BUILD__
/** Bundled = the copy inside an app; live = loaded from the published site. */
export const runningLive = () => !!window.__THREAD_LIVE__
const source = () => (isTauri() ? __THREAD_LIVE_URL__ : BASE)

interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'applying' | 'offline'
  remote?: BuildInfo
  checkedAt?: number
  dismissed?: string
  error?: string
}
export const useUpdate = create<UpdateState>(() => ({ status: 'idle' }))

export async function checkForUpdate(): Promise<UpdateState['status']> {
  if (import.meta.env.DEV) return 'current'
  const previous = useUpdate.getState().status
  if (previous === 'applying' || previous === 'checking') return previous
  useUpdate.setState({ status: 'checking', error: undefined })
  try {
    const remote = await fetchRelease(source())
    const supported = !isTauri() || remote.liveProtocol === 1
    const status = supported && isNewerRelease(BUILD, remote) ? 'available' : 'current'
    useUpdate.setState({ status, remote, checkedAt: Date.now() })
    return status
  } catch {
    useUpdate.setState({ status: 'offline', checkedAt: Date.now() })
    return 'offline'
  }
}

/** Editors register a flush so nothing typed is lost when THREAD reloads. */
const flushers = new Set<() => unknown>()
const editorSaves = new Set<Promise<unknown>>()
export function onBeforeReload(fn: () => unknown) {
  flushers.add(fn)
  return () => void flushers.delete(fn)
}

export async function flushOpenEditors() {
  await Promise.all([...editorSaves, ...[...flushers].map((f) => f())])
  while (editorSaves.size) await Promise.all(editorSaves)
}

export function trackEditorSave(save: Promise<unknown>) {
  editorSaves.add(save)
  const done = () => editorSaves.delete(save)
  void save.then(done, done)
  return save
}

export async function applyUpdate() {
  if (useUpdate.getState().status !== 'available') return
  useUpdate.setState({ status: 'applying', error: undefined })
  try {
    await flushOpenEditors()
    if (isTauri()) sessionStorage.setItem(UPDATE_REQUEST, '1')
    location.reload()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    useUpdate.setState({ status: 'available', error: `Could not prepare the update. ${message}` })
  }
}

let started = false
export function startUpdateWatch() {
  if (started || import.meta.env.DEV) return
  started = true
  const check = () => {
    if (isTauri() && !useSettings.getState().liveUpdates) return
    void checkForUpdate()
  }
  setTimeout(check, 2000)
  setInterval(check, 60_000)
  window.addEventListener('online', check)
  document.addEventListener('visibilitychange', () => {
    const last = useUpdate.getState().checkedAt ?? 0
    if (document.visibilityState === 'visible' && Date.now() - last > 60_000) check()
  })
}

export const buildLabel = (b: BuildInfo) =>
  `${b.commit} · ${new Date(b.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
