// Line icon set, drawn on a 24px grid with a 1.6 stroke to match the
// thin-rule aesthetic of the reference panels.
const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h10',
  up: 'M6 15l6-6 6 6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  flame: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 3 3 0-2 0-4 0-6z',
  home: 'M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  canvas: 'M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5',
  tapestry: 'M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 6.5l8 .5M7 8l4 8.2M17 9l-4 7.2',
  desk: 'M3 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H3zM21 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z',
  compiler: 'M7 3h7l4 4v14H7zM4 6v15h11M10 10h5M10 13h5M10 16h3',
  pinboard: 'M4 4h16v16H4zM8 8h4v3H8zM14 13h3v3h-3zM12 9.5l2.5 4',
  search: 'M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-4.5-4.5',
  settings: 'M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1M16 4v4M10 10v4M18 16v4',
  folder: 'M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  pdf: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-5M14 11v5',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  dye: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  sync: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  cloud: 'M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18z',
  panelLeft: 'M4 4h16v16H4zM9 4v16',
  panelRight: 'M4 4h16v16H4zM15 4v16',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  check: 'M5 12l5 5 9-10',
  sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  stitch: 'M4 12h3M10 12h4M17 12h3M6 8l-2 4 2 4M18 8l2 4-2 4',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6',
  layers: 'M12 4l9 5-9 5-9-5zM3 14l9 5 9-5',
  rename: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  vault: 'M4 4h16v16H4zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 9V6M15 12h3',
  zoomIn: 'M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-4.5-4.5M8.5 11h5M11 8.5v5',
  zoomOut: 'M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-4.5-4.5M8.5 11h5',
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18, className }: { name: IconName | string; size?: number; className?: string }) {
  return (
    <svg
      className={'icon ' + (className ?? '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name] ?? PATHS.more} />
    </svg>
  )
}
