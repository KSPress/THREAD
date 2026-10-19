// Images are stored as files in the vault and referenced with standard
// Markdown `![alt](attachments/x.png)`; the view resolves them to blob URLs.
import Image from '@tiptap/extension-image'
import { useStore } from '../core/store'

const cache = new Map<string, Promise<string>>()

export function vaultUrl(src: string): Promise<string> {
  if (/^(https?:|data:|blob:)/.test(src)) return Promise.resolve(src)
  const path = decodeURI(src)
  let p = cache.get(path)
  if (!p) {
    const adapter = useStore.getState().adapter
    if (!adapter) return Promise.resolve(src)
    p = adapter.readBinary(path).then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart])))
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p
}

export const VaultImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure')
      dom.className = 'vault-image'
      const img = document.createElement('img')
      img.alt = node.attrs.alt ?? ''
      dom.appendChild(img)
      void vaultUrl(node.attrs.src).then((url) => (img.src = url)).catch(() => dom.classList.add('is-missing'))
      return { dom }
    }
  },
}).configure({ inline: false, allowBase64: true })
