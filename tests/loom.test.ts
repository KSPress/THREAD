// @vitest-environment node
// End-to-end: real Loom process + two Satellites with offline edits.
import 'fake-indexeddb/auto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LoomSync, type LoomStatus } from '../src/core/sync'

const PORT = 17000 + Math.floor(Math.random() * 1000)
const URL = `http://127.0.0.1:${PORT}`
const TOKEN = 'test-token'
let dir = ''
let loom: ChildProcess

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, ms = 5000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await wait(30)
  }
}

function satellite(name: string) {
  const texts = new Map<string, string>()
  let status: LoomStatus = 'disabled'
  let pending = 0
  const sync = new LoomSync(name, {
    onRemoteText: (p, t) => texts.set(p, t),
    onRemoteDelete: (p) => texts.delete(p),
    onRemoteRename: () => {},
    onStatus: (s, n) => {
      status = s
      pending = n
    },
  })
  return { sync, texts, status: () => status, pending: () => pending }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'loom-'))
  writeFileSync(join(dir, 'A.md'), 'Hello world\n')
  loom = spawn(process.execPath, ['loom/server.mjs'], { env: { ...process.env, LOOM_DIR: dir, PORT: String(PORT), LOOM_TOKEN: TOKEN, HOST: '127.0.0.1' } })
  await new Promise<void>((resolve, reject) => {
    loom.stdout!.on('data', (d) => {
      if (process.env.LOOM_DEBUG) process.stdout.write(String(d))
      if (String(d).includes('weaving')) resolve()
    })
    loom.on('exit', (c) => reject(new Error('loom exited ' + c)))
  })
})

afterAll(() => loom?.kill())

describe('the Loom', () => {
  it('rejects a wrong token', async () => {
    expect((await fetch(`${URL}/manifest`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401)
    expect((await fetch(`${URL}/health`)).status).toBe(200)
  })

  it('merges concurrent offline edits from two Satellites without overwriting', async () => {
    const s1 = satellite('one')
    const s2 = satellite('two')
    await s1.sync.connect(URL, TOKEN)
    await s2.sync.connect(URL, TOKEN)
    await until(() => s1.texts.get('A.md') === 'Hello world\n' && s2.texts.get('A.md') === 'Hello world\n')

    // Both go offline and edit the same line.
    s1.sync.disconnect()
    s2.sync.disconnect()
    await s1.sync.track('A.md', 'Hello brave world\n')
    await s2.sync.track('A.md', 'Hello world!\n')
    expect(await s1.sync.pendingCount()).toBeGreaterThan(0)

    // Back online: the outbox streams to the Host.
    await s1.sync.connect(URL, TOKEN)
    await until(() => s1.pending() === 0)
    await s2.sync.connect(URL, TOKEN)
    await until(() => s2.pending() === 0)
    await until(() => s1.texts.get('A.md') === 'Hello brave world!\n')
    expect(s2.texts.get('A.md')).toBe('Hello brave world!\n')
    await until(() => readFileSync(join(dir, 'A.md'), 'utf8') === 'Hello brave world!\n')
    expect(readFileSync(join(dir, '.loom/events.log'), 'utf8').trim().split('\n').length).toBeGreaterThanOrEqual(2)
    s1.sync.disconnect()
    s2.sync.disconnect()
  })

  it('does not duplicate a file both Satellites created with the same content', async () => {
    const s1 = satellite('three')
    const s2 = satellite('four')
    await s1.sync.track('B.md', '# Same\n')
    await s2.sync.track('B.md', '# Same\n')
    await s1.sync.connect(URL, TOKEN)
    await s2.sync.connect(URL, TOKEN)
    await until(() => s1.pending() === 0 && s2.pending() === 0)
    await until(() => existsSync(join(dir, 'B.md')))
    await wait(400)
    expect(readFileSync(join(dir, 'B.md'), 'utf8')).toBe('# Same\n')
    s1.sync.disconnect()
    s2.sync.disconnect()
  })

  it('folds external file edits on the Host into the CRDT and pushes them out', { timeout: 15000 }, async () => {
    const s = satellite('five')
    await s.sync.connect(URL, TOKEN)
    await until(() => s.texts.get('A.md') === 'Hello brave world!\n')
    writeFileSync(join(dir, 'A.md'), 'Hello brave new world!\n')
    await until(() => s.texts.get('A.md') === 'Hello brave new world!\n', 6000)
    s.sync.disconnect()
  })

  it('stores and serves assets, refusing path traversal', async () => {
    const put = await fetch(`${URL}/assets/Research/a.pdf`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` }, body: new Uint8Array([1, 2, 3]) })
    expect(put.status).toBe(204)
    const got = new Uint8Array(await (await fetch(`${URL}/assets/Research/a.pdf?token=${TOKEN}`)).arrayBuffer())
    expect([...got]).toEqual([1, 2, 3])
    const evil = await fetch(`${URL}/assets/..%2F..%2Fetc%2Fpasswd?token=${TOKEN}`)
    expect(evil.status).toBe(400)
    const manifest = await (await fetch(`${URL}/manifest?token=${TOKEN}`)).json()
    expect(manifest.map((m: { path: string }) => m.path)).toContain('Research/a.pdf')
  })
})
