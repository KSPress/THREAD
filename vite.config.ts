import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri expects a fixed dev port and does not want the screen cleared.
export default defineConfig({
  // THREAD_BASE=/THREAD/ when hosted under a sub-path (GitHub Pages).
  base: process.env.THREAD_BASE ?? '/',
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  // Lazily imported heavy deps, pre-bundled so the dev server never reloads mid-session.
  optimizeDeps: {
    include: [
      'pdfjs-dist',
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
} as any)
