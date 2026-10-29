// The first script THREAD runs. Inside the desktop and Android apps it starts
// the newest published build (GitHub Pages) when that is newer than the build
// the app shipped with, so every change reaches every device without a
// reinstall. It runs in the app's own origin, so the vault, settings and
// native features are the same either way. Offline, or if the live build
// cannot load, the bundled build starts.

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
const TIMEOUT = 2500

function liveAllowed() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').liveUpdates !== false
  } catch {
    return true
  }
}

async function newerLiveBuild() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(`${__THREAD_LIVE_URL__}version.json?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal })
    if (!res.ok) return null
    const live = (await res.json()) as typeof __THREAD_BUILD__
    return live.entry && live.time > __THREAD_BUILD__.time && live.id !== __THREAD_BUILD__.id ? live : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function runLive(build: typeof __THREAD_BUILD__): Promise<boolean> {
  window.__THREAD_LIVE__ = { base: __THREAD_LIVE_URL__, build }
  return new Promise((resolve) => {
    const s = document.createElement('script')
    s.type = 'module'
    s.src = new URL(build.entry!, __THREAD_LIVE_URL__).href
    s.onload = () => resolve(true)
    s.onerror = () => {
      delete window.__THREAD_LIVE__
      s.remove()
      resolve(false)
    }
    document.head.appendChild(s)
  })
}

async function start() {
  const inApp = '__TAURI_INTERNALS__' in window
  // The live build's own loader lands here too: it must start its app, not look again.
  if (import.meta.env.PROD && inApp && !window.__THREAD_LIVE__ && liveAllowed()) {
    const live = await newerLiveBuild()
    if (live && (await runLive(live))) return
  }
  await import('./main')
}

void start()
