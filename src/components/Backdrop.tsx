import { useEffect, useRef, useState } from 'react'
import { parseBackground, threadColor, type Background } from '../core/appearance'
import { renderBackdrop } from '../core/backdrops'
import { useSettings } from '../core/settings'
import { useDyeColor, useStore } from '../core/store'
import { useIsDark } from '../core/theme'
import { vaultUrl } from '../editor/VaultImage'

/** The background of the open Thread, if it sets one (Canvas only). */
function useThreadBackground(): { bg: Background; tint?: string } | null {
  const view = useStore((s) => s.view)
  const thread = useStore((s) => (s.active ? s.threads[s.active] : undefined))
  const dyeColor = useDyeColor()
  if (!thread || view !== 'canvas') return null
  const bg = parseBackground(thread.frontmatter.background)
  if (!bg) return null
  return { bg, tint: threadColor(thread.frontmatter, thread.dyes, dyeColor) }
}

export function Backdrop() {
  const { backdrop, backdropImage, backdropTint, accent, grain } = useSettings()
  const dark = useIsDark()
  const ref = useRef<HTMLCanvasElement>(null)
  const own = useThreadBackground()
  const [ownImage, setOwnImage] = useState<string>('')

  // What to paint: the Thread's own background wins over the app's.
  const kind = own?.bg.kind === 'generated' ? own.bg.preset : own ? null : backdrop === 'image' && backdropImage ? null : backdrop === 'image' ? 'halftone' : backdrop
  const tint = own?.bg.kind === 'generated' && own.tint ? own.tint : backdropTint
  const ownPath = own?.bg.kind === 'image' ? own.bg.path : ''

  useEffect(() => {
    if (!ownPath) return setOwnImage('')
    let live = true
    void vaultUrl(encodeURI(ownPath)).then((u) => live && setOwnImage(u))
    return () => {
      live = false
    }
  }, [ownPath])

  useEffect(() => {
    if (!kind) return
    const canvas = ref.current
    if (!canvas) return
    let timer: ReturnType<typeof setTimeout>
    const draw = () => {
      // Rendered at CSS-pixel resolution: the halftone screen is the texture.
      canvas.width = Math.round(window.innerWidth)
      canvas.height = Math.round(window.innerHeight)
      renderBackdrop(canvas, kind, { tint, accent, dark })
    }
    draw()
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(draw, 250)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [kind, tint, accent, dark])

  let layer
  if (own?.bg.kind === 'color') layer = <div className="backdrop__solid" style={{ background: own.bg.color }} />
  else if (own?.bg.kind === 'image') layer = ownImage ? <img key={ownImage} src={ownImage} alt="" /> : <div className="backdrop__solid" />
  else if (!kind) layer = <img src={backdropImage} alt="" />
  else layer = <canvas key={kind + dark + tint} ref={ref} />

  return (
    <div className="backdrop" aria-hidden>
      {layer}
      <div className="backdrop__veil" />
      {grain && <div className="backdrop__grain" />}
    </div>
  )
}

/** Small preview used by the personalization panel and Thread style. */
export function BackdropThumb({ kind, tint }: { kind: 'halftone' | 'pixel' | 'aurora' | 'paper'; tint?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { backdropTint, accent } = useSettings()
  const dark = useIsDark()
  useEffect(() => {
    if (!ref.current) return
    ref.current.width = 150
    ref.current.height = 165
    renderBackdrop(ref.current, kind, { tint: tint ?? backdropTint, accent, dark })
  }, [kind, tint, backdropTint, accent, dark])
  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}
