// Host integration: saving exported files and running Pandoc.
import { isTauri } from './vault'

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  epub: 'application/epub+zip',
}

/** Save bytes through the native dialog (Tauri) or a browser download. */
export async function saveFile(name: string, data: Uint8Array | string): Promise<boolean> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const ext = name.split('.').pop() ?? ''
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const target = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (!target) return false
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('save_export', bytes, { headers: { 'x-path': encodeURIComponent(target) } })
    return true
  }
  const blob = new Blob([bytes as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return true
}

/** Pandoc is only reachable from the desktop host. */
export async function pandocAvailable(): Promise<boolean> {
  if (!isTauri()) return false
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<boolean>('pandoc_available').catch(() => false)
}

export async function pandocConvert(markdown: string, format: 'pdf' | 'docx' | 'epub' | 'odt'): Promise<Uint8Array> {
  const { invoke } = await import('@tauri-apps/api/core')
  const buf = await invoke<ArrayBuffer>('pandoc_convert', { markdown, format })
  return new Uint8Array(buf)
}
