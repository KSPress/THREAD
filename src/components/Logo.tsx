// The THREAD mark: weft threads run horizontally, bend through a diagonal
// weave and drop into vertical warp threads. Line-only, geometric.
export function Mark({ size = 24, stroke = 1.7 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} aria-hidden>
      <defs>
        <clipPath id="thread-mark-clip">
          <rect x="1" y="10" width="22" height="13" />
        </clipPath>
      </defs>
      <path d="M1 2h22M1 5.5h22M1 9h22" strokeLinecap="butt" />
      <g clipPath="url(#thread-mark-clip)">
        <path d="M1 13.5l4.5-3.5M1 18l9-7M1 22.5l11-8.6V23M5.5 23l9-7V23" strokeLinecap="butt" strokeLinejoin="miter" />
        <path d="M17 10v13M20.5 10v13" />
      </g>
    </svg>
  )
}

export function Logo({ size = 22, word = true }: { size?: number; word?: boolean }) {
  return (
    <span className="logo">
      <Mark size={size} />
      {word && (
        <span className="logo__word" style={{ fontSize: size * 0.95 }}>
          THREAD
        </span>
      )}
    </span>
  )
}
