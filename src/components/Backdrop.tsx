import { useEffect, useRef } from 'react'
import { renderBackdrop } from '../core/backdrops'
import { useSettings } from '../core/settings'
import { useIsDark } from '../core/theme'

export function Backdrop() {
  const { backdrop, backdropImage, backdropTint, accent, grain } = useSettings()
  const dark = useIsDark()
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (backdrop === 'image' && backdropImage) return
    const canvas = ref.current
    if (!canvas) return
    let timer: ReturnType<typeof setTimeout>
    const draw = () => {
      // Rendered at CSS-pixel resolution: the halftone screen is the texture.
      canvas.width = Math.round(window.innerWidth)
      canvas.height = Math.round(window.innerHeight)
      renderBackdrop(canvas, backdrop === 'image' ? 'halftone' : backdrop, { tint: backdropTint, accent, dark })
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
  }, [backdrop, backdropImage, backdropTint, accent, dark])

  return (
    <div className="backdrop" aria-hidden>
      {backdrop === 'image' && backdropImage ? <img src={backdropImage} alt="" /> : <canvas key={backdrop + dark} ref={ref} />}
      <div className="backdrop__veil" />
      {grain && <div className="backdrop__grain" />}
    </div>
  )
}

/** Small preview used by the personalization panel. */
export function BackdropThumb({ kind }: { kind: 'halftone' | 'pixel' | 'aurora' | 'paper' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { backdropTint, accent } = useSettings()
  const dark = useIsDark()
  useEffect(() => {
    if (!ref.current) return
    ref.current.width = 150
    ref.current.height = 165
    renderBackdrop(ref.current, kind, { tint: backdropTint, accent, dark })
  }, [kind, backdropTint, accent, dark])
  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}
