export function basename(path: string) {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

export function dirname(path: string) {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

export function extname(path: string) {
  const b = basename(path)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i).toLowerCase() : ''
}

export function stem(path: string) {
  const b = basename(path)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(0, i) : b
}

export function join(...parts: string[]) {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
}

/** Strip characters that are invalid in file names on any major OS. */
export function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled'
}

export type FileKind = 'thread' | 'pdf' | 'epub' | 'image' | 'other'

export function kindOf(path: string): FileKind {
  const ext = extname(path)
  // Cords (.cord) are Threads with a word processor; they index and link like Threads.
  if (ext === '.md' || ext === '.markdown' || ext === '.cord') return 'thread'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.epub') return 'epub'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'].includes(ext)) return 'image'
  return 'other'
}

/** Hidden app metadata lives here, like Obsidian's `.obsidian`. */
export const META_DIR = '.thread'

export function isHidden(path: string) {
  return path.split('/').some((p) => p.startsWith('.'))
}
