// Per-Thread appearance, kept literally in the Thread's YAML frontmatter:
//
//   icon: duotone/rocket-5        Lineicons style + name
//   color: "#4F6D7A"              icon/accent color (default: the first Dye's color)
//   background: aurora            halftone | pixel | aurora | paper | "#hex" | attachments/x.jpg
import { create } from 'zustand'
import type { Frontmatter } from './markdown'

export type IconStyle = 'stroke' | 'solid' | 'duotone' | 'bulk'
export const ICON_STYLES: IconStyle[] = ['stroke', 'solid', 'duotone', 'bulk']

export interface IconEntry {
  /** category */
  c: string
  /** inner SVG markup using currentColor */
  s: string
}

interface IconState {
  sets: Partial<Record<IconStyle, Record<string, IconEntry>>>
  viewBox: string
}

export const useIconSets = create<IconState>(() => ({ sets: {}, viewBox: '0 0 25 24' }))

const loading = new Map<IconStyle, Promise<void>>()

export function loadIconSet(style: IconStyle): Promise<void> {
  if (useIconSets.getState().sets[style]) return Promise.resolve()
  let p = loading.get(style)
  if (!p) {
    const imports: Record<IconStyle, () => Promise<{ default: Record<string, IconEntry> }>> = {
      stroke: () => import('../assets/icons/stroke.json'),
      solid: () => import('../assets/icons/solid.json'),
      duotone: () => import('../assets/icons/duotone.json'),
      bulk: () => import('../assets/icons/bulk.json'),
    }
    p = Promise.all([imports[style](), import('../assets/icons/meta.json')]).then(([set, meta]) => {
      useIconSets.setState((s) => ({ sets: { ...s.sets, [style]: set.default }, viewBox: meta.default.viewBox || s.viewBox }))
    })
    loading.set(style, p)
  }
  return p
}

export function parseIcon(v: unknown): { style: IconStyle; name: string } | null {
  if (typeof v !== 'string' || !v) return null
  const [a, b] = v.includes('/') ? v.split('/', 2) : ['duotone', v]
  const style = (ICON_STYLES as string[]).includes(a) ? (a as IconStyle) : 'duotone'
  return { style, name: b }
}

export type Background =
  | { kind: 'generated'; preset: 'halftone' | 'pixel' | 'aurora' | 'paper' }
  | { kind: 'color'; color: string }
  | { kind: 'image'; path: string }

export function parseBackground(v: unknown): Background | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim()
  if (['halftone', 'pixel', 'aurora', 'paper'].includes(s)) return { kind: 'generated', preset: s as 'halftone' }
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return { kind: 'color', color: s }
  return { kind: 'image', path: s }
}

/** The Thread's accent: explicit color, else its first Dye, else nothing. */
export function threadColor(fm: Frontmatter, dyes: string[], dyeColor: (d: string) => string): string | undefined {
  if (typeof fm.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(fm.color)) return fm.color
  return dyes[0] ? dyeColor(dyes[0]) : undefined
}
