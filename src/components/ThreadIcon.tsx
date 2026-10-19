// A Thread's own icon (from the Lineicons pack), drawn in its color.
import { useEffect } from 'react'
import { loadIconSet, parseIcon, threadColor, useIconSets, type IconStyle } from '../core/appearance'
import { useDyeColor, type ThreadInfo } from '../core/store'
import { Icon } from './Icon'

export function LineIcon({ style, name, size = 18, color }: { style: IconStyle; name: string; size?: number; color?: string }) {
  const entry = useIconSets((s) => s.sets[style]?.[name])
  const viewBox = useIconSets((s) => s.viewBox)
  useEffect(() => {
    void loadIconSet(style)
  }, [style])
  if (!entry) return <span style={{ width: size, height: size, display: 'inline-block', flex: 'none' }} />
  return (
    <svg
      className="icon line-icon"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      style={color ? { color } : undefined}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: entry.s }}
    />
  )
}

/** The Thread's chosen icon, or the generic file glyph (tinted) when it has none. */
export function ThreadIcon({ thread, size = 16, fallback = 'file' }: { thread?: ThreadInfo; size?: number; fallback?: string }) {
  const dyeColor = useDyeColor()
  if (!thread) return <Icon name={fallback} size={size} />
  const icon = parseIcon(thread.frontmatter.icon)
  const color = threadColor(thread.frontmatter, thread.dyes, dyeColor)
  if (!icon) return <span style={color && thread.frontmatter.color ? { color, display: 'contents' } : { display: 'contents' }}><Icon name={fallback} size={size} /></span>
  return <LineIcon style={icon.style} name={icon.name} size={size} color={color} />
}
