/** Stamp of the build that is running (see vite.config.ts). */
declare const __THREAD_BUILD__: { id: string; commit: string; time: number; entry?: string }
/** Where the newest THREAD is published; the desktop and Android apps update from here. */
declare const __THREAD_LIVE_URL__: string
type ThreadRelease = typeof __THREAD_BUILD__ & { entry: string; liveProtocol?: number }

interface Window {
  /** Set when an app is running the live build from __THREAD_LIVE_URL__ instead of its bundled one. */
  __THREAD_LIVE__?: { base: string; build: ThreadRelease }
  __THREAD_LIVE_ENTRY__?: string
  __THREAD_LIVE_BOOT__?: () => Promise<() => void>
}
