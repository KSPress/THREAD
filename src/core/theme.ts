import { useEffect, useState } from 'react'
import { FONT_STACKS, useSettings } from './settings'

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function useIsDark() {
  const theme = useSettings((s) => s.theme)
  const [sysDark, setSysDark] = useState(media?.matches ?? false)
  useEffect(() => {
    if (!media) return
    const on = () => setSysDark(media.matches)
    media.addEventListener('change', on)
    return () => media.removeEventListener('change', on)
  }, [])
  return theme === 'dark' || (theme === 'auto' && sysDark)
}

/** Push personalization into CSS custom properties on <html>. */
export function useApplyTheme() {
  const s = useSettings()
  const dark = useIsDark()
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = dark ? 'dark' : 'light'
    root.style.setProperty('--accent', s.accent)
    root.style.setProperty('--font-body', FONT_STACKS[s.bodyFont])
    root.style.setProperty('--font-editor', FONT_STACKS[s.bodyFont])
    root.style.setProperty('--font-display', FONT_STACKS[s.displayFont])
    root.style.setProperty('--blur', String(s.blur))
    root.style.setProperty('--glass', String(s.glass / 100))
    root.style.setProperty('--editor-w', `${s.editorWidth}px`)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111412' : '#303830')
  }, [dark, s.accent, s.bodyFont, s.displayFont, s.blur, s.glass, s.editorWidth])
}
