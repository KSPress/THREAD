// Updates: every running THREAD watches for a newer published build.
// - Browser: the build lives on the same host; reloading picks it up (the
//   service worker serves the app shell network-first).
// - Desktop / Android apps: the loader (src/loader.ts) starts the newest build
//   from GitHub Pages at launch; while running, a restart applies a newer one.
import { create } from 'zustand'
import { BASE } from './base'
import { useSettings } from './settings'
import { isTauri } from './vault'

export type BuildInfo = typeof __THREAD_BUILD__

export const BUILD: BuildInfo = window.__THREAD_LIVE__?.build ?? __THREAD_BUILD__
/** Bundled = the copy inside an app; live = loaded from the published site. */
export const runningLive = () => !!window.__THREAD_LIVE__
const source = () => (isTauri() ? __THREAD_LIVE_URL__ : BASE)

interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'offline'
  remote?: BuildInfo
  checkedAt?: number
  dismissed?: string
}
export const useUpdate = create<UpdateState>(() => ({ status: 'idle' }))

export async function checkForUpdate(): Promise<UpdateState['status']> {
  if (import.meta.env.DEV) return 'current'
  useUpdate.setState({ status: 'checking' })
  try {
    const res = await fetch(`${source()}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    const remote = (await res.json()) as BuildInfo
    const status = remote.id !== BUILD.id && remote.time > BUILD.time ? 'available' : 'current'
    useUpdate.setState({ status, remote, checkedAt: Date.now() })
    return status
  } catch {
    useUpdate.setState({ status: 'offline', checkedAt: Date.now() })
    return 'offline'
  }
}

/** Editors register a flush so nothing typed is lost when THREAD reloads. */
const flushers = new Set<() => unknown>()
export function onBeforeReload(fn: () => unknown) {
  flushers.add(fn)
  return () => void flushers.delete(fn)
}

export async function applyUpdate() {
  await Promise.allSettled([...flushers].map((f) => f()))
  // Let the vault writes land before the page goes away.
  await new Promise((r) => setTimeout(r, 300))
  if (!isTauri()) {
    const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
    await reg?.update().catch(() => {})
  }
  location.reload()
}

let started = false
export function startUpdateWatch() {
  if (started || import.meta.env.DEV) return
  started = true
  const check = () => {
    if (isTauri() && !useSettings.getState().liveUpdates) return
    void checkForUpdate()
  }
  setTimeout(check, 8000)
  setInterval(check, 15 * 60 * 1000)
  document.addEventListener('visibilitychange', () => {
    const last = useUpdate.getState().checkedAt ?? 0
    if (document.visibilityState === 'visible' && Date.now() - last > 60_000) check()
  })
}

export const buildLabel = (b: BuildInfo) =>
  `${b.commit} · ${new Date(b.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
