// Procedural atmospheric backdrops: halftone-printed clouds, pixel-mosaic
// clouds and soft radial "aurora" blurs. Generated locally so nothing has to
// be downloaded and every user can retint them.
import type { BackdropKind } from './settings'

function hashNoise(seed: number) {
  const perm = new Uint8Array(512)
  const p = new Uint8Array(256).map((_, i) => i)
  let s = seed >>> 0 || 1
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const grad = (h: number) => (h / 255) * 2 - 1
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const X = xi & 255
    const Y = yi & 255
    const a = grad(perm[perm[X] + Y])
    const b = grad(perm[perm[X + 1] + Y])
    const c = grad(perm[perm[X] + Y + 1])
    const d = grad(perm[perm[X + 1] + Y + 1])
    const u = fade(xf)
    const v = fade(yf)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  return (x: number, y: number, oct = 5) => {
    let sum = 0
    let amp = 0.5
    let f = 1
    for (let o = 0; o < oct; o++) {
      sum += amp * noise(x * f, y * f)
      f *= 2.03
      amp *= 0.5
    }
    return sum
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const mix = (a: [number, number, number], b: [number, number, number], t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Cloud density in [0,1] — billowing up from the lower right. */
function cloudField(fbm: ReturnType<typeof hashNoise>, w: number, h: number) {
  const scale = 3.2 / Math.max(w, h)
  return (x: number, y: number) => {
    const nx = x * scale
    const ny = y * scale
    const warp = fbm(nx * 0.7 + 11, ny * 0.7 + 3, 3) * 0.9
    const n = fbm(nx + warp, ny * 1.25 + warp, 5)
    // Diagonal band: denser towards the bottom and the right.
    const band = (x / w) * 0.45 + (y / h) * 0.75 - 0.35
    const d = smooth(0.0, 0.42, n + band * 0.55)
    // Light from the top-left: compare with a sample offset towards the light.
    const n2 = fbm(nx - 0.02 + warp, ny * 1.25 - 0.03 + warp, 5)
    const lit = Math.max(0, Math.min(1, 0.55 + (n - n2) * 14))
    return { d, lit }
  }
}

export function renderBackdrop(
  canvas: HTMLCanvasElement,
  kind: BackdropKind,
  opts: { tint: string; accent: string; dark: boolean; seed?: number },
) {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  const fbm = hashNoise(opts.seed ?? 7)
  const tint = hexToRgb(opts.tint)
  const cream: [number, number, number] = [244, 238, 211]

  if (kind === 'halftone') {
    ctx.fillStyle = mix(tint, [12, 18, 30], opts.dark ? 0.55 : 0.12)
    ctx.fillRect(0, 0, w, h)
    const field = cloudField(fbm, w, h)
    const step = Math.max(4, Math.round(Math.min(w, h) / 190))
    const ang = Math.PI / 4
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const diag = Math.hypot(w, h)
    ctx.fillStyle = mix(cream, tint, opts.dark ? 0.35 : 0.04)
    for (let gy = -diag; gy < diag; gy += step) {
      for (let gx = -diag; gx < diag; gx += step) {
        const x = gx * cos - gy * sin + w / 2
        const y = gx * sin + gy * cos + h / 2
        if (x < -step || y < -step || x > w + step || y > h + step) continue
        const { d, lit } = field(x, y)
        const sky = 0.05 + 0.06 * (1 - y / h)
        const b = Math.max(sky, d * (0.35 + 0.65 * lit))
        const r = Math.sqrt(b) * step * 0.6
        if (r < 0.35) continue
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    return
  }

  if (kind === 'pixel') {
    const skyTop = mix([150, 172, 178], tint, 0.25)
    ctx.fillStyle = opts.dark ? mix([52, 66, 70], tint, 0.2) : skyTop
    ctx.fillRect(0, 0, w, h)
    const field = cloudField(fbm, w, h)
    const block = Math.max(6, Math.round(Math.min(w, h) / 110))
    const skyA: [number, number, number] = opts.dark ? [58, 74, 78] : [158, 180, 184]
    const skyB: [number, number, number] = opts.dark ? [72, 88, 90] : [176, 194, 194]
    const shade: [number, number, number] = opts.dark ? [120, 112, 92] : [205, 190, 152]
    const light: [number, number, number] = opts.dark ? [176, 164, 132] : [236, 222, 186]
    for (let y = 0; y < h; y += block) {
      for (let x = 0; x < w; x += block) {
        const { d, lit } = field(x + block / 2, y + block / 2)
        let col: string
        if (d < 0.25) col = mix(skyA, skyB, d * 3 + (y / h) * 0.3)
        else if (d < 0.55) col = mix(skyB, shade, (d - 0.25) / 0.3)
        else col = mix(shade, light, Math.min(1, lit * 1.2))
        ctx.fillStyle = col
        ctx.fillRect(x, y, block - 1, block - 1)
        // Inner square: the LED-mosaic texture.
        if ((x / block + y / block) % 2 === 0 && d > 0.2) {
          ctx.fillStyle = 'rgba(255,255,255,0.07)'
          ctx.fillRect(x + block * 0.25, y + block * 0.25, block * 0.5, block * 0.5)
        }
      }
    }
    return
  }

  if (kind === 'aurora') {
    const base = opts.dark ? '#141815' : '#efe8d0'
    ctx.fillStyle = base
    ctx.fillRect(0, 0, w, h)
    const accent = hexToRgb(opts.accent)
    const blobs: [number, number, number, [number, number, number], number][] = [
      [0.22, 0.3, 0.45, accent, 0.85],
      [0.75, 0.25, 0.38, [231, 197, 164], 0.9],
      [0.6, 0.8, 0.5, tint, 0.55],
      [0.1, 0.85, 0.3, [219, 204, 177], 0.8],
      [0.9, 0.65, 0.28, accent, 0.5],
    ]
    ctx.filter = `blur(${Math.round(Math.min(w, h) / 14)}px)`
    for (const [bx, by, br, c, a] of blobs) {
      const g = ctx.createRadialGradient(bx * w, by * h, 0, bx * w, by * h, br * Math.max(w, h))
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${opts.dark ? a * 0.6 : a})`)
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    ctx.filter = 'none'
    return
  }

  // paper
  ctx.fillStyle = opts.dark ? '#171b18' : '#ece6cc'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = opts.dark ? 'rgba(244,238,211,0.05)' : 'rgba(48,56,48,0.08)'
  const gap = 22
  for (let y = gap; y < h; y += gap) for (let x = gap; x < w; x += gap) ctx.fillRect(x, y, 1.4, 1.4)
}
