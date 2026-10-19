// Lazily loaded: Excalidraw is large, so it only arrives when a Pinboard opens.
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { useSettings } from '../core/settings'
import type { PinboardScene } from './Pinboard'


export default function PinboardCanvas({ scene, onChange }: { scene: PinboardScene; onChange: (s: PinboardScene) => void }) {
  const theme = useSettings((s) => s.theme)
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <div className="pinboard-overlay__canvas">
      <Excalidraw
        theme={dark ? 'dark' : 'light'}
        initialData={{
          elements: scene.elements,
          appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor ?? (dark ? '#1e221f' : '#F4EED3') },
          files: scene.files ?? {},
          scrollToContent: true,
        }}
        onChange={(elements, appState, files) => {
          onChange({
            elements: elements.filter((e) => !e.isDeleted) as any[],
            appState: { viewBackgroundColor: appState.viewBackgroundColor },
            files: files as Record<string, any>,
          })
        }}
      />
    </div>
  )
}
