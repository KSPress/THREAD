#!/usr/bin/env node
// The Loom — THREAD's Host.
//
// Holds the master directory of .md files, PDFs and images. Satellites stream
// immutable Yjs update events over a WebSocket; the Loom merges them with CRDT
// semantics (no overwrites), writes the merged Markdown back to disk, appends
// every event to an audit log and fans the update out to the other Satellites.
//
//   LOOM_DIR    master vault directory          (default ./loom-data/vault)
//   LOOM_TOKEN  shared access token             (strongly recommended)
//   PORT        listen port                     (default 7878)
//   HOST        listen address                  (default 0.0.0.0)
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import YAML from 'yaml'
import { applyTextDiff, baselineUpdate, fromBase64, TEXT_KEY, toBase64 } from '../shared/ytext.js'
import { extractDeadlines, toICS } from '../shared/deadlines.js'

const ROOT = path.resolve(process.env.LOOM_DIR ?? './loom-data/vault')
const STATE = path.join(ROOT, '.loom')
const TOKEN = process.env.LOOM_TOKEN ?? ''
const PORT = Number(process.env.PORT ?? 7878)
const HOST = process.env.HOST ?? '0.0.0.0'
const WRITE_DELAY = 250
/** Where THREAD is served (e.g. https://thread.example.com) so feed events can link back. */
const APP_URL = (process.env.LOOM_APP_URL ?? '').replace(/\/$/, '')

/** @type {Map<string, { doc: Y.Doc, timer?: NodeJS.Timeout }>} */
const docs = new Map()
/** Content the Loom itself last wrote, so the watcher ignores its own writes. */
const ownWrites = new Map()
/** @type {Set<import('ws').WebSocket>} */
const clients = new Set()

const log = (...a) => console.log(new Date().toISOString(), '[loom]', ...a)

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

function safePath(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new Error('bad path')
  const norm = path.posix.normalize(rel.replace(/\\/g, '/'))
  if (norm.startsWith('..') || path.posix.isAbsolute(norm) || norm.split('/').some((p) => p === '..' || p === '.loom')) {
    throw new Error('path escapes vault')
  }
  return { rel: norm, abs: path.join(ROOT, norm) }
}
const isThread = (p) => /\.(md|markdown)$/i.test(p)
const stateFile = (rel) => path.join(STATE, 'state', encodeURIComponent(rel) + '.bin')

async function walk(dir = ROOT, prefix = '') {
  const out = []
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name === '.loom' || e.name === '.git' || e.name === 'node_modules') continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)))
    else out.push(rel)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

async function loadDoc(rel) {
  const existing = docs.get(rel)
  if (existing) return existing.doc
  const doc = new Y.Doc()
  const { abs } = safePath(rel)
  const [state, text] = await Promise.all([fs.readFile(stateFile(rel)).catch(() => null), fs.readFile(abs, 'utf8').catch(() => null)])
  if (state) Y.applyUpdate(doc, new Uint8Array(state), 'load')
  else if (text !== null) Y.applyUpdate(doc, baselineUpdate(rel, text), 'load')
  if (docs.has(rel)) return docs.get(rel).doc
  docs.set(rel, { doc })
  if (text !== null) ownWrites.set(rel, text)
  // The file changed while the Loom was down: fold it in as an edit.
  if (state && text !== null && doc.getText(TEXT_KEY).toString() !== text) {
    const sv = Y.encodeStateVector(doc)
    applyTextDiff(doc.getText(TEXT_KEY), text)
    broadcast({ type: 'update', path: rel, update: toBase64(Y.encodeStateAsUpdate(doc, sv)) })
  }
  return doc
}

function scheduleWrite(rel) {
  const entry = docs.get(rel)
  if (!entry) return
  clearTimeout(entry.timer)
  entry.timer = setTimeout(async () => {
    try {
      const { abs } = safePath(rel)
      // Someone edited the file on disk since our last write: merge it first
      // so this write never clobbers it.
      const disk = await fs.readFile(abs, 'utf8').catch(() => null)
      if (disk !== null && ownWrites.has(rel) && disk !== ownWrites.get(rel)) await ingestExternal(rel)
      const text = entry.doc.getText(TEXT_KEY).toString()
      await fs.mkdir(path.dirname(abs), { recursive: true })
      ownWrites.set(rel, text)
      await fs.writeFile(abs, text)
      await fs.mkdir(path.dirname(stateFile(rel)), { recursive: true })
      await fs.writeFile(stateFile(rel), Y.encodeStateAsUpdate(entry.doc))
    } catch (e) {
      log('write failed', rel, e.message)
    }
  }, WRITE_DELAY)
}

async function appendEvent(ev, client) {
  const line = JSON.stringify({ at: Date.now(), client, ...ev }) + '\n'
  await fs.appendFile(path.join(STATE, 'events.log'), line).catch(() => {})
}

function broadcast(msg, except) {
  const data = JSON.stringify(msg)
  for (const ws of clients) if (ws !== except && ws.readyState === 1) ws.send(data)
}

/* ------------------------------------------------------------------ */
/* Sync protocol                                                       */
/* ------------------------------------------------------------------ */

async function handle(ws, msg, clientId) {
  switch (msg.type) {
    case 'hello': {
      const states = msg.states ?? {}
      for (const rel of (await walk()).filter(isThread)) {
        const doc = await loadDoc(rel)
        const sv = states[rel] ? fromBase64(states[rel]) : undefined
        const update = Y.encodeStateAsUpdate(doc, sv)
        // An empty update encodes to two zero bytes.
        if (update.length > 2) ws.send(JSON.stringify({ type: 'update', path: rel, update: toBase64(update) }))
      }
      return
    }
    case 'update': {
      const { rel } = safePath(msg.path)
      if (!isThread(rel)) throw new Error('updates are for Threads only')
      const doc = await loadDoc(rel)
      Y.applyUpdate(doc, fromBase64(msg.update), clientId)
      scheduleWrite(rel)
      await appendEvent({ type: 'update', path: rel, update: msg.update, ts: msg.ts }, clientId)
      broadcast({ type: 'update', path: rel, update: msg.update }, ws)
      break
    }
    case 'delete': {
      const { rel, abs } = safePath(msg.path)
      docs.get(rel)?.doc.destroy()
      docs.delete(rel)
      ownWrites.set(rel, null)
      await fs.rm(abs, { force: true, recursive: true })
      await fs.rm(stateFile(rel), { force: true })
      await appendEvent({ type: 'delete', path: rel, ts: msg.ts }, clientId)
      broadcast({ type: 'delete', path: rel }, ws)
      break
    }
    case 'rename': {
      const from = safePath(msg.from)
      const to = safePath(msg.to)
      await fs.mkdir(path.dirname(to.abs), { recursive: true })
      await fs.rename(from.abs, to.abs).catch(() => {})
      for (const [rel, entry] of [...docs]) {
        if (rel === from.rel || rel.startsWith(from.rel + '/')) {
          const next = to.rel + rel.slice(from.rel.length)
          docs.delete(rel)
          docs.set(next, entry)
          await fs.mkdir(path.dirname(stateFile(next)), { recursive: true })
          await fs.rename(stateFile(rel), stateFile(next)).catch(() => {})
        }
      }
      await appendEvent({ type: 'rename', from: from.rel, to: to.rel, ts: msg.ts }, clientId)
      broadcast({ type: 'rename', from: from.rel, to: to.rel }, ws)
      break
    }
    default:
      throw new Error(`unknown message ${msg.type}`)
  }
  if (msg.id !== undefined) ws.send(JSON.stringify({ type: 'ack', id: msg.id }))
}

/* ------------------------------------------------------------------ */
/* HTTP: health, manifest, assets                                       */
/* ------------------------------------------------------------------ */

function authorized(req, url) {
  if (!TOKEN) return true
  const given = url.searchParams.get('token') ?? (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(given)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function cors(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'authorization, content-type')
  res.setHeader('access-control-allow-methods', 'GET, PUT, OPTIONS')
}

const MAX_ASSET = 512 * 1024 * 1024

const server = createServer(async (req, res) => {
  cors(res)
  const url = new URL(req.url ?? '/', 'http://loom')
  try {
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return void res.end(JSON.stringify({ ok: true, name: 'thread-loom', docs: docs.size, satellites: clients.size }))
    }
    if (!authorized(req, url)) return void res.writeHead(401).end('unauthorized')

    if (url.pathname === '/calendar.ics' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-cache' })
      return void res.end(await calendarFeed())
    }

    if (url.pathname === '/manifest' && req.method === 'GET') {
      const out = []
      for (const rel of await walk()) {
        // App metadata (.thread/: Dye colors, highlights, manuscripts) syncs too.
        if (isThread(rel) || (rel.split('/').some((p) => p.startsWith('.')) && !rel.startsWith('.thread/'))) continue
        const st = await fs.stat(path.join(ROOT, rel))
        out.push({ path: rel, size: st.size, mtime: st.mtimeMs })
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return void res.end(JSON.stringify(out))
    }

    if (url.pathname.startsWith('/assets/')) {
      const rel = decodeURIComponent(url.pathname.slice('/assets/'.length))
      const { abs } = safePath(rel)
      if (isThread(rel)) return void res.writeHead(400).end('Threads sync over /sync')
      if (req.method === 'GET') {
        const st = await fs.stat(abs).catch(() => null)
        if (!st?.isFile()) return void res.writeHead(404).end()
        res.writeHead(200, { 'content-length': st.size, 'content-type': 'application/octet-stream' })
        return void createReadStream(abs).pipe(res)
      }
      if (req.method === 'PUT') {
        const chunks = []
        let size = 0
        for await (const c of req) {
          size += c.length
          if (size > MAX_ASSET) return void res.writeHead(413).end()
          chunks.push(c)
        }
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, Buffer.concat(chunks))
        await appendEvent({ type: 'asset', path: rel, size }, 'http')
        return void res.writeHead(204).end()
      }
    }
    res.writeHead(404).end()
  } catch (e) {
    res.writeHead(400).end(String(e.message ?? e))
  }
})

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 })
let nextClient = 1

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://loom')
  if (url.pathname !== '/sync' || !authorized(req, url)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return socket.destroy()
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const clientId = `sat-${nextClient++}`
    clients.add(ws)
    log(`${clientId} connected (${clients.size} online)`)
    ws.send(JSON.stringify({ type: 'welcome', host: 'thread-loom' }))
    // Messages are processed strictly in order per Satellite.
    let chain = Promise.resolve()
    ws.on('message', (data) => {
      chain = chain.then(async () => {
        let msg
        try {
          msg = JSON.parse(String(data))
          await handle(ws, msg, clientId)
        } catch (e) {
          log(clientId, 'rejected', e.message)
          ws.send(JSON.stringify({ type: 'error', message: e.message, id: msg?.id }))
        }
      })
    })
    ws.on('close', () => {
      clients.delete(ws)
      log(`${clientId} left (${clients.size} online)`)
    })
  })
})

/* ------------------------------------------------------------------ */
/* Calendar feed: every deadline in the vault as iCalendar             */
/* ------------------------------------------------------------------ */

async function calendarFeed() {
  const items = []
  for (const rel of (await walk()).filter((p) => isThread(p) && !p.split('/').some((x) => x.startsWith('.')))) {
    const raw = docs.get(rel)?.doc.getText(TEXT_KEY).toString() ?? (await fs.readFile(path.join(ROOT, rel), 'utf8').catch(() => ''))
    let frontmatter = {}
    let body = raw
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
    if (m) {
      try {
        frontmatter = YAML.parse(m[1]) ?? {}
      } catch {
        frontmatter = {}
      }
      body = raw.slice(m[0].length)
    }
    const title = (typeof frontmatter.title === 'string' && frontmatter.title) || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.posix.basename(rel, '.md')
    items.push(...extractDeadlines(rel, title, frontmatter, body))
  }
  return toICS(items, { name: `THREAD — ${path.basename(ROOT)}`, link: APP_URL ? (p) => `${APP_URL}/#open=${encodeURIComponent(p)}` : undefined })
}

/* ------------------------------------------------------------------ */
/* Watch the master directory for edits made outside THREAD             */
/* ------------------------------------------------------------------ */

async function ingestExternal(rel) {
  const text = await fs.readFile(path.join(ROOT, rel), 'utf8').catch(() => null)
  if (text === null || ownWrites.get(rel) === text) return
  const doc = await loadDoc(rel)
  const sv = Y.encodeStateVector(doc)
  ownWrites.set(rel, text)
  if (!applyTextDiff(doc.getText(TEXT_KEY), text)) return
  const update = toBase64(Y.encodeStateAsUpdate(doc, sv))
  await fs.mkdir(path.dirname(stateFile(rel)), { recursive: true })
  await fs.writeFile(stateFile(rel), Y.encodeStateAsUpdate(doc))
  await appendEvent({ type: 'update', path: rel, update, source: 'filesystem' }, 'fs')
  broadcast({ type: 'update', path: rel, update })
  log('external edit merged', rel)
}

const visible = (rel) => isThread(rel) && !rel.split('/').some((p) => p.startsWith('.'))

function startWatcher() {
  const pending = new Map()
  const queue = (rel) => {
    clearTimeout(pending.get(rel))
    pending.set(rel, setTimeout(() => void ingestExternal(rel), 300))
  }
  // Fast path: inotify. Recursive watching can miss events on some
  // platforms, so a cheap mtime scan below backs it up.
  try {
    watch(ROOT, { recursive: true }, (_ev, file) => {
      if (!file) return
      const rel = file.split(path.sep).join('/')
      if (visible(rel)) queue(rel)
    }).on('error', (e) => log('watcher error:', e.message))
  } catch (e) {
    log('file watching unavailable:', e.message)
  }
  const mtimes = new Map()
  const scan = async () => {
    for (const rel of (await walk()).filter(visible)) {
      const st = await fs.stat(path.join(ROOT, rel)).catch(() => null)
      if (!st) continue
      const prev = mtimes.get(rel)
      mtimes.set(rel, st.mtimeMs)
      if (prev !== undefined && prev !== st.mtimeMs) queue(rel)
      else if (prev === undefined && !docs.has(rel)) queue(rel)
    }
    setTimeout(() => void scan(), 2000)
  }
  void scan()
}

await fs.mkdir(path.join(STATE, 'state'), { recursive: true })
for (const rel of (await walk()).filter(isThread)) await loadDoc(rel)
startWatcher()
server.listen(PORT, HOST, () => {
  log(`weaving ${ROOT} — ${docs.size} Threads — http://${HOST}:${PORT}`)
  if (!TOKEN) log('WARNING: LOOM_TOKEN is not set; anyone who can reach this port can read and write the vault.')
})

export { server }
