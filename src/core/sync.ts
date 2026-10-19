// Satellite side of the Core/Host architecture.
//
// Every local change to a Thread is captured as an immutable Yjs update and
// appended to the outbox (IndexedDB). When the Loom is reachable the outbox is
// streamed to it; the Host merges with CRDT semantics and fans the merged
// updates back out to every other Satellite. Offline, nothing is lost: the
// outbox simply grows until the next connection.
import * as Y from 'yjs'
import { applyTextDiff, baselineUpdate, fromBase64, TEXT_KEY, toBase64 } from '../../shared/ytext.js'
import { idbDelete, idbEntries, idbGet, idbSet } from './idb'

export type LoomStatus = 'disabled' | 'offline' | 'connecting' | 'online' | 'error'

type OutboxEvent =
  | { vault: string; type: 'update'; path: string; update: string; ts: number }
  | { vault: string; type: 'delete'; path: string; ts: number }
  | { vault: string; type: 'rename'; from: string; to: string; ts: number }

type HostMessage =
  | { type: 'welcome'; host: string }
  | { type: 'ack'; id: number }
  | { type: 'update'; path: string; update: string }
  | { type: 'delete'; path: string }
  | { type: 'rename'; from: string; to: string }
  | { type: 'error'; message: string }

export interface SyncCallbacks {
  /** Remote text arrived for a Thread (already merged). */
  onRemoteText(path: string, text: string): void
  onRemoteDelete(path: string): void
  onRemoteRename(from: string, to: string): void
  onStatus(status: LoomStatus, pending: number, detail?: string): void
  /** Unsaved local text for a path, folded in before a remote update. */
  takePendingLocal?(path: string): string | null
}

export class LoomSync {
  private docs = new Map<string, Y.Doc>()
  private ws: WebSocket | null = null
  private status: LoomStatus = 'disabled'
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pending = 0
  private url = ''
  private token = ''
  private stopped = true

  constructor(
    private vault: string,
    private cb: SyncCallbacks,
  ) {}

  private key(path: string) {
    return `${this.vault}::${path}`
  }

  /** Load (or create) the CRDT for a path, folding in the current file content. */
  async track(path: string, content: string): Promise<void> {
    const doc = await this.doc(path, content)
    applyTextDiff(doc.getText(TEXT_KEY), content)
  }

  private async doc(path: string, initial: string): Promise<Y.Doc> {
    let doc = this.docs.get(path)
    if (doc) return doc
    doc = new Y.Doc()
    const stored = await idbGet<Uint8Array>('ydocs', this.key(path))
    // A concurrent call may have created it while we awaited.
    const existing = this.docs.get(path)
    if (existing) return existing
    Y.applyUpdate(doc, stored ?? baselineUpdate(path, initial), 'load')
    this.docs.set(path, doc)
    if (!stored && initial) {
      // First time this device tracks the file: the baseline itself is an event.
      await this.enqueue({ vault: this.vault, type: 'update', path, update: toBase64(Y.encodeStateAsUpdate(doc)), ts: Date.now() })
      this.persist(path, doc)
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.persist(path, doc!)
      if (origin === 'remote' || origin === 'load') return
      void this.enqueue({ vault: this.vault, type: 'update', path, update: toBase64(update), ts: Date.now() })
    })
    return doc
  }

  async remove(path: string) {
    this.docs.get(path)?.destroy()
    this.docs.delete(path)
    await idbDelete('ydocs', this.key(path))
    await this.enqueue({ vault: this.vault, type: 'delete', path, ts: Date.now() })
  }

  async rename(from: string, to: string) {
    const doc = this.docs.get(from)
    if (doc) {
      this.docs.delete(from)
      doc.destroy()
    }
    const state = await idbGet<Uint8Array>('ydocs', this.key(from))
    if (state) {
      await idbSet('ydocs', this.key(to), state)
      await idbDelete('ydocs', this.key(from))
    }
    await this.enqueue({ vault: this.vault, type: 'rename', from, to, ts: Date.now() })
  }

  private persist(path: string, doc: Y.Doc) {
    clearTimeout(this.persistTimers.get(path))
    this.persistTimers.set(
      path,
      setTimeout(() => void idbSet('ydocs', this.key(path), Y.encodeStateAsUpdate(doc)), 300),
    )
  }

  private async enqueue(ev: OutboxEvent) {
    const id = (await idbSet('outbox', undefined, ev)) as number
    this.pending++
    this.emit()
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ ...ev, id }))
  }

  private async outbox(): Promise<[number, OutboxEvent][]> {
    return (await idbEntries<OutboxEvent>('outbox'))
      .filter(([, e]) => e.vault === this.vault)
      .map(([k, e]) => [Number(k), e])
  }

  async pendingCount() {
    return (await this.outbox()).length
  }

  /* --------------------------- connection ---------------------------- */

  async connect(url: string, token: string) {
    this.disconnect()
    this.url = url.replace(/\/$/, '')
    this.token = token
    this.stopped = false
    this.pending = await this.pendingCount()
    if (!this.url) {
      this.setStatus('disabled')
      return
    }
    this.open()
  }

  disconnect() {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.ws?.close()
    this.ws = null
    this.setStatus('disabled')
  }

  private open() {
    if (this.stopped) return
    this.setStatus('connecting')
    let ws: WebSocket
    try {
      const wsUrl = this.url.replace(/^http/, 'ws') + `/sync?token=${encodeURIComponent(this.token)}`
      ws = new WebSocket(wsUrl)
    } catch (e) {
      this.setStatus('error', String(e))
      return
    }
    this.ws = ws
    ws.onopen = async () => {
      this.retry = 0
      // Tell the Host what we have, so it can send only what we are missing.
      const states: Record<string, string> = {}
      for (const [k, v] of await idbEntries<Uint8Array>('ydocs')) {
        const key = String(k)
        if (!key.startsWith(this.vault + '::')) continue
        states[key.slice(this.vault.length + 2)] = toBase64(Y.encodeStateVectorFromUpdate(v))
      }
      ws.send(JSON.stringify({ type: 'hello', states }))
      for (const [id, ev] of await this.outbox()) ws.send(JSON.stringify({ ...ev, id }))
      this.setStatus('online')
    }
    ws.onmessage = (e) => void this.handle(JSON.parse(String(e.data)) as HostMessage)
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.stopped) return
      this.setStatus('offline')
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++)
      this.retryTimer = setTimeout(() => this.open(), delay)
    }
    ws.onerror = () => this.setStatus('error', 'Cannot reach the Loom')
  }

  private async handle(msg: HostMessage) {
    switch (msg.type) {
      case 'ack':
        await idbDelete('outbox', msg.id)
        this.pending = Math.max(0, this.pending - 1)
        this.emit()
        break
      case 'update': {
        const doc = await this.doc(msg.path, '')
        const local = this.cb.takePendingLocal?.(msg.path)
        if (local != null) applyTextDiff(doc.getText(TEXT_KEY), local)
        Y.applyUpdate(doc, fromBase64(msg.update), 'remote')
        this.cb.onRemoteText(msg.path, doc.getText(TEXT_KEY).toString())
        break
      }
      case 'delete':
        this.docs.get(msg.path)?.destroy()
        this.docs.delete(msg.path)
        await idbDelete('ydocs', this.key(msg.path))
        this.cb.onRemoteDelete(msg.path)
        break
      case 'rename': {
        const state = await idbGet<Uint8Array>('ydocs', this.key(msg.from))
        this.docs.get(msg.from)?.destroy()
        this.docs.delete(msg.from)
        if (state) {
          await idbSet('ydocs', this.key(msg.to), state)
          await idbDelete('ydocs', this.key(msg.from))
        }
        this.cb.onRemoteRename(msg.from, msg.to)
        break
      }
      case 'error':
        this.setStatus('error', msg.message)
        break
    }
  }

  /* ----------------------------- assets ------------------------------ */

  /** PDFs and images are synced whole (last writer wins) over HTTP. */
  async pushAsset(path: string, data: Uint8Array) {
    if (this.status !== 'online') return
    await fetch(`${this.url}/assets/${encodePath(path)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${this.token}` },
      body: data as unknown as BodyInit,
    }).catch(() => {})
  }

  async manifest(): Promise<{ path: string; size: number; mtime: number }[]> {
    const res = await fetch(`${this.url}/manifest`, { headers: { authorization: `Bearer ${this.token}` } })
    if (!res.ok) throw new Error(`Manifest failed: ${res.status}`)
    return res.json()
  }

  async pullAsset(path: string): Promise<Uint8Array> {
    const res = await fetch(`${this.url}/assets/${encodePath(path)}`, { headers: { authorization: `Bearer ${this.token}` } })
    if (!res.ok) throw new Error(`Asset failed: ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }

  get isOnline() {
    return this.status === 'online'
  }

  private setStatus(s: LoomStatus, detail?: string) {
    this.status = s
    this.emit(detail)
  }
  private emit(detail?: string) {
    this.cb.onStatus(this.status, this.pending, detail)
  }
}

function encodePath(p: string) {
  return p.split('/').map(encodeURIComponent).join('/')
}
