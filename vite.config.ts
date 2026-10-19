import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri expects a fixed dev port and does not want the screen cleared.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
} as any)
