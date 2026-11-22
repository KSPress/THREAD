// The first script THREAD runs. Inside the desktop and Android apps it starts
// the newest published build (GitHub Pages) when that is newer than the build
// the app shipped with, so every change reaches every device without a
// reinstall. It runs in the app's own origin, so the vault, settings and
// native features are the same either way. Offline, or if the live build
// cannot load, the bundled build starts.

import { fetchRelease, isNewerRelease, releaseEntry, UPDATE_REQUEST } from './core/release'

// Small polyfills for older web views (Android System WebView, older Safari),
// installed before any app code runs.
if (!('withResolvers' in Promise)) {
  ;(Promise as any).withResolvers = function () {
    let resolve!: (v: unknown) => void
    let reject!: (e: unknown) => void
    const promise = new Promise((a, b) => ((resolve = a), (reject = b)))
    return { promise, resolve, reject }
  }
}
if (!Array.prototype.findLast) {
  Object.defineProperty(Array.prototype, 'findLast', {
    configurable: true,
    writable: true,
    value: function <T>(this: T[], fn: (v: T, i: number, a: T[]) => unknown) {
      for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return this[i]
      return undefined
    },
  })
}
if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', { configurable: true, writable: true, value: (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k) })
}

const SETTINGS_KEY = 'thread.settings.v1'
function liveAllowed() {
  try {
    if (sessionStorage.getItem(UPDATE_REQUEST)) {
      sessionStorage.removeItem(UPDATE_REQUEST)
      return true
    }
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').liveUpdates !== false
  } catch {
    return true
  }
}

async function runLive(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const build = await fetchRelease(__THREAD_LIVE_URL__)
    if (!isNewerRelease(__THREAD_BUILD__, build) || build.liveProtocol !== 1) return false
    const url = releaseEntry(__THREAD_LIVE_URL__, build.entry)
    window.__THREAD_LIVE_ENTRY__ = url.href
    window.__THREAD_LIVE__ = { base: __THREAD_LIVE_URL__, build }
    const load = async () => {
      await import(/* @vite-ignore */ url.href)
      const boot = window.__THREAD_LIVE_BOOT__
      if (!boot) throw new Error('Update bootstrap is missing')
      return boot()
    }
    const mount = await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Update load timed out')), 8000)
      }),
    ])
    mount()
    return true
  } catch {
    delete window.__THREAD_LIVE__
    return false
  } finally {
    clearTimeout(timer)
    delete window.__THREAD_LIVE_BOOT__
  }
}

async function loadMain() {
  return (await import('./main')).mountThread
}

async function start() {
  const inApp = '__TAURI_INTERNALS__' in window
  // The live build's own loader lands here too: it must start its app, not look again.
  if (import.meta.env.PROD && inApp && !window.__THREAD_LIVE__ && liveAllowed()) {
    if (await runLive()) return
  }
  const mount = await loadMain()
  mount()
}

// Use the canonical URL because the app's chunks can also import this entry.
// Keeping the marker after a timeout prevents a late module from mounting.
// Older installers do not set it and use the ordinary startup path.
if (window.__THREAD_LIVE_ENTRY__ === import.meta.url) {
  if (window.__THREAD_LIVE__) window.__THREAD_LIVE_BOOT__ = loadMain
} else {
  void start()
}
