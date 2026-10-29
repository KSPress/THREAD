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

// Excalidraw (Pinboards) loads its fonts from here; served locally for offline use.
;(window as any).EXCALIDRAW_ASSET_PATH = `${BASE}excalidraw/`

// Installable, offline-capable PWA on phones/tablets (not inside the desktop app).
if (import.meta.env.PROD && 'serviceWorker' in navigator && !('__TAURI_INTERNALS__' in window)) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${BASE}sw.js`))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
