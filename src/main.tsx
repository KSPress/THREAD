import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jost/400.css'
import '@fontsource/jost/500.css'
import '@fontsource/jost/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/literata/400.css'
import '@fontsource/literata/400-italic.css'
import '@fontsource/literata/600.css'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './App'
import { BASE } from './core/base'

export function mountThread() {
  // Excalidraw (Pinboards) loads its fonts relative to the running build.
  ;(window as any).EXCALIDRAW_ASSET_PATH = `${BASE}excalidraw/`
  if (import.meta.env.PROD && 'serviceWorker' in navigator && !('__TAURI_INTERNALS__' in window)) {
    void navigator.serviceWorker.register(`${BASE}sw.js`).catch((err) => console.warn('[thread] Offline setup failed', err))
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
