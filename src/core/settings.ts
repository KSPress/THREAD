// "Make your THREAD your own" — per-device personalization.
import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'auto'
export type BackdropKind = 'halftone' | 'pixel' | 'aurora' | 'paper' | 'image'
export type FontChoice = 'inter' | 'jost' | 'literata' | 'mono'
export type PaletteId = 'earth' | 'signal' | 'loom'
export type CornerStyle = 'round' | 'diagonal' | 'square'

export interface Settings {
  theme: ThemeMode
  backdrop: BackdropKind
  /** Data URL of a user supplied background image. */
  backdropImage: string
  /** Sky tint used by the generated backdrops. */
  backdropTint: string
  /** 0–100: strength of the radial blur glow behind modular cards. */
  blur: number
  /** 0–100: opacity of the canvas card over the backdrop. */
  glass: number
  grain: boolean
  bodyFont: FontChoice
  displayFont: FontChoice
  palette: PaletteId
  /** Window/card corners: radial (rounded), diagonal (chamfered) or square cut. */
  corners: CornerStyle
  accent: string
  editorWidth: number
  loomUrl: string
  loomToken: string
  spellcheck: boolean
  /** Show system notifications for deadline reminders. */
  notifications: boolean
  /** Reminders used when a Thread doesn't set `remind:` (e.g. `1d`, `2h`, 0). */
  defaultReminders: (string | number)[]
  /** Google OAuth client id (Web client for browsers; Desktop client for the app). */
  gcalClientId: string
  /** Only for the desktop app's "Desktop app" OAuth client (Google calls it a secret; it isn't one). */
  gcalClientSecret: string
  gcalCalendarName: string
  gcalAutoSync: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  backdrop: 'halftone',
  backdropImage: '',
  backdropTint: '#2f5784',
  blur: 60,
  glass: 92,
  grain: true,
  bodyFont: 'inter',
  displayFont: 'jost',
  palette: 'earth',
  corners: 'round',
  accent: '#FF5F45',
  editorWidth: 760,
  loomUrl: '',
  loomToken: '',
  spellcheck: true,
  notifications: false,
  defaultReminders: ['1d', 0],
  gcalClientId: '',
  gcalClientSecret: '',
  gcalCalendarName: 'THREAD',
  gcalAutoSync: true,
}

/** Dye palettes, from the reference boards. */
export const PALETTES: Record<PaletteId, { name: string; colors: string[] }> = {
  earth: {
    name: 'Earth',
    colors: ['#FF5F45', '#C9A27A', '#7D8F69', '#4F6D7A', '#B5714E', '#8C6A9E', '#D9A441', '#5E7F73'],
  },
  signal: {
    name: 'Signal',
    colors: ['#E8772E', '#1FA3E0', '#6D5BD0', '#22A04A', '#D8CBB8', '#E04848', '#F2B33D', '#5A6B66'],
  },
  loom: {
    name: 'Loom',
    colors: ['#1BA3C6', '#8BC37A', '#F08A24', '#E8434F', '#F7C948', '#B98BC9', '#4B7BEC', '#2CB5A0'],
  },
}

const KEY = 'thread.settings.v1'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    // Private mode or corrupted storage: fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS }
}

interface SettingsStore extends Settings {
  set(patch: Partial<Settings>): void
  reset(): void
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch)
    persist(get())
  },
  reset() {
    set({ ...DEFAULT_SETTINGS })
    persist(get())
  },
}))

function persist(s: SettingsStore) {
  const out: Partial<Settings> = {}
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) (out as any)[k] = s[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(out))
  } catch {
    // Quota exceeded (large background image) — keep the in-memory value.
  }
}

export const FONT_STACKS: Record<FontChoice, string> = {
  inter: "'Inter', system-ui, sans-serif",
  jost: "'Jost', 'Futura', system-ui, sans-serif",
  literata: "'Literata', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
}
