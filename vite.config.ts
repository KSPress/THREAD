import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Every build is stamped, so a running THREAD can tell when a newer one is live.
const commit = (() => {
  try {
    return (process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()).trim().slice(0, 7)
  } catch {
    return 'local'
  }
})()
const BUILD = { id: `${commit}-${Date.now().toString(36)}`, commit, time: Date.now() }
// Where the newest THREAD is published (GitHub Pages); the apps update from here.
const LIVE_URL = process.env.THREAD_LIVE_URL ?? 'https://kspress.github.io/THREAD/'

/** Emit version.json: the build stamp plus the entry script, for the updaters. */
function versionFile(): Plugin {
  return {
    name: 'thread-version',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry)
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ ...BUILD, entry: entry?.fileName }) + '\n' })
    },
  }
}

// Tauri expects a fixed dev port and does not want the screen cleared.
export default defineConfig(({ command }) => ({
  // Relative asset paths: the same build runs at a site root, under /THREAD/ on
  // GitHub Pages, inside the desktop/Android apps, and loaded live by those apps.
  base: command === 'serve' ? '/' : './',
  define: {
    __THREAD_BUILD__: JSON.stringify(BUILD),
    __THREAD_LIVE_URL__: JSON.stringify(LIVE_URL),
  },
  plugins: [react(), versionFile()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  // Lazily imported heavy deps, pre-bundled so the dev server never reloads mid-session.
  optimizeDeps: {
    include: [
      'pdfjs-dist/legacy/build/pdf.mjs',
      'pdfmake/build/pdfmake',
      'pdfmake/build/vfs_fonts',
      'docx',
      '@excalidraw/excalidraw',
      '@tauri-apps/api/core',
      '@tauri-apps/plugin-dialog',
      '@tauri-apps/plugin-notification',
    ],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
})) as any
