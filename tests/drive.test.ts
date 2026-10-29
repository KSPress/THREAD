// Google Drive sync between two devices, against an in-memory fake Drive.
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { FOLDER_MIME, syncDrive, type DriveApi, type DriveFile, type DriveLink } from '../src/core/drive'
import { BrowserVault } from '../src/core/vault'

function fakeDrive() {
  let n = 0
  const files = new Map<string, DriveFile & { bytes?: Uint8Array; trashed?: boolean }>()
  const md5 = (b: Uint8Array) => `m${b.length}-${[...b].reduce((h, x) => (h * 31 + x) >>> 0, 7)}`
  files.set('root', { id: 'root', name: 'My Drive', mimeType: FOLDER_MIME })
  const api: DriveApi = {
    async children(id) {
      return [...files.values()].filter((f) => f.parents?.[0] === id && !f.trashed)
    },
    async find(name, parent, folder) {
      return [...files.values()].find((f) => f.name === name && f.parents?.[0] === parent && !f.trashed && (f.mimeType === FOLDER_MIME) === folder) ?? null
    },
    async createFolder(name, parent) {
      const f = { id: `f${++n}`, name, mimeType: FOLDER_MIME, parents: [parent] }
      files.set(f.id, f)
      return f
    },
    async upload(name, parent, bytes, mime) {
      const f = { id: `f${++n}`, name, mimeType: mime, parents: [parent], bytes, md5Checksum: md5(bytes) }
      files.set(f.id, f)
      return f
    },
    async update(id, bytes) {
      const f = files.get(id)!
      Object.assign(f, { bytes, md5Checksum: md5(bytes) })
      return f
    },
    async download(id) {
      return files.get(id)!.bytes!
    },
    async trash(id) {
      files.get(id)!.trashed = true
      for (const f of files.values()) if (f.parents?.[0] === id) await api.trash(f.id)
    },
    async startToken() {
      return '1'
    },
    async changedSince() {
      return { changed: true, next: '1' }
    },
  }
  return { api, files }
}

const text = async (v: BrowserVault, p: string) => (await v.exists(p) ? v.readText(p) : undefined)
const tick = () => new Promise((r) => setTimeout(r, 5))

describe('Google Drive sync', () => {
  it('mirrors a vault to Drive and back, both ways', async () => {
    const { api, files } = fakeDrive()
    const vault = await api.createFolder('Ashen', 'root')
    const a = new BrowserVault('drive-A')
    const b = new BrowserVault('drive-B')
    let linkA: DriveLink = { rootId: vault.id, folder: 'Ashen', files: {}, folders: {} }
    let linkB: DriveLink = { rootId: vault.id, folder: 'Ashen', files: {}, folders: {} }
    const syncA = async () => ((({ link: linkA } = await syncDrive(a, api, linkA, { device: 'A' })), linkA))
    const syncB = async () => {
      const r = await syncDrive(b, api, linkB, { device: 'B' })
      linkB = r.link
      return r.report
    }

    // Device A: a Project with a sub-thread and a PDF.
    await a.writeText('Reach/Reach.md', '# Reach\n')
    await a.writeText('Reach/Places/Emberfall.md', '# Emberfall\n')
    await a.writeText('Reach/Places/Emberfall/Market.md', '# Market\n')
    await a.writeBinary('Research/notes.pdf', new Uint8Array([37, 80, 68, 70, 1, 2, 3]))
    await syncA()
    const names = [...files.values()].filter((f) => !f.trashed).map((f) => f.name)
    expect(names).toEqual(expect.arrayContaining(['Reach', 'Places', 'Emberfall', 'Emberfall.md', 'Market.md', 'notes.pdf']))
    expect([...files.values()].find((f) => f.name === 'Emberfall')!.mimeType).toBe(FOLDER_MIME)

    // Device B pulls everything, folders included.
    const r1 = await syncB()
    expect(r1.downloaded.sort()).toEqual(['Reach/Places/Emberfall.md', 'Reach/Places/Emberfall/Market.md', 'Reach/Reach.md', 'Research/notes.pdf'])
    expect(await text(b, 'Reach/Places/Emberfall/Market.md')).toBe('# Market\n')
    expect([...(await b.readBinary('Research/notes.pdf'))]).toEqual([37, 80, 68, 70, 1, 2, 3])

    // Nothing to do when nothing changed.
    const idle = await syncB()
    expect([...idle.uploaded, ...idle.downloaded, ...idle.conflicts]).toEqual([])

    // An edit on B reaches A.
    await tick()
    await b.writeText('Reach/Reach.md', '# Reach\n\nEdited on B.\n')
    expect((await syncB()).uploaded).toEqual(['Reach/Reach.md'])
    await syncA()
    expect(await text(a, 'Reach/Reach.md')).toBe('# Reach\n\nEdited on B.\n')

    // A delete on A reaches B (and Drive's copy goes to the trash).
    await a.remove('Research/notes.pdf')
    await syncA()
    expect([...files.values()].find((f) => f.name === 'notes.pdf')!.trashed).toBe(true)
    expect((await syncB()).deletedLocal).toEqual(['Research/notes.pdf'])
    expect(await b.exists('Research/notes.pdf')).toBe(false)

    // Both edit the same Thread: nobody's words are lost.
    await tick()
    await a.writeText('Reach/Places/Emberfall.md', '# Emberfall\n\nA wrote this.\n')
    await b.writeText('Reach/Places/Emberfall.md', '# Emberfall\n\nB wrote this.\n')
    await syncA()
    const r2 = await syncDrive(b, api, linkB, { device: 'B', now: new Date(2026, 9, 29, 14, 5) })
    linkB = r2.link
    expect(r2.report.conflicts).toEqual(['Reach/Places/Emberfall (conflict B 2026-10-29 1405).md'])
    expect(await text(b, 'Reach/Places/Emberfall.md')).toBe('# Emberfall\n\nA wrote this.\n')
    expect(await text(b, 'Reach/Places/Emberfall (conflict B 2026-10-29 1405).md')).toBe('# Emberfall\n\nB wrote this.\n')
    await syncA()
    expect(await text(a, 'Reach/Places/Emberfall (conflict B 2026-10-29 1405).md')).toBe('# Emberfall\n\nB wrote this.\n')
  })

  it('leaves files that are being edited for the next round', async () => {
    const { api } = fakeDrive()
    const root = await api.createFolder('V', 'root')
    const v = new BrowserVault('drive-busy')
    await v.writeText('Draft.md', 'one')
    let link: DriveLink = { rootId: root.id, folder: 'V', files: {}, folders: {} }
    link = (await syncDrive(v, api, link, { device: 'X' })).link
    await tick()
    await v.writeText('Draft.md', 'two')
    const r = await syncDrive(v, api, link, { device: 'X', busy: (p) => p === 'Draft.md' })
    expect(r.report.skipped).toEqual(['Draft.md'])
    // Still seen as changed once the editor has saved.
    const r2 = await syncDrive(v, api, r.link, { device: 'X' })
    expect(r2.report.uploaded).toEqual(['Draft.md'])
  })

  it('mirrors folder deletions and keeps new empty folders', async () => {
    const { api, files } = fakeDrive()
    const root = await api.createFolder('V', 'root')
    const v = new BrowserVault('drive-folders')
    await v.writeText('Old/a.md', 'a')
    await v.mkdir('Empty')
    let link: DriveLink = { rootId: root.id, folder: 'V', files: {}, folders: {} }
    link = (await syncDrive(v, api, link, { device: 'X' })).link
    expect([...files.values()].some((f) => f.name === 'Empty' && f.mimeType === FOLDER_MIME)).toBe(true)
    await v.remove('Old')
    link = (await syncDrive(v, api, link, { device: 'X' })).link
    expect([...files.values()].find((f) => f.name === 'Old')!.trashed).toBe(true)
  })
})

describe('Google Drive in the app', () => {
  it('links the open vault to My Drive › THREAD › <vault> and applies remote edits to open Threads', async () => {
    const { useStore } = await import('../src/core/store')
    const gd = await import('../src/core/gdrive')
    const { api, files } = fakeDrive()
    gd.useDriveApi(api)
    sessionStorage.setItem('thread.gdrive.token', JSON.stringify({ access_token: 't', expires_at: Date.now() + 3600_000 }))
    const v = new BrowserVault('Linked Vault')
    await v.writeText('Plan.md', '# Plan\n')
    await useStore.getState().openVault(v)
    await gd.connectDrive()
    const top = [...files.values()].find((f) => f.name === 'THREAD')!
    const folder = [...files.values()].find((f) => f.name === 'Linked Vault')!
    expect(folder.parents).toEqual([top.id])
    const plan = [...files.values()].find((f) => f.name === 'Plan.md')!
    expect(new TextDecoder().decode(plan.bytes)).toBe('# Plan\n')
    expect(gd.useDrive.getState().status).toBe('idle')

    // Edited elsewhere (another device, or Drive itself): THREAD picks it up.
    await api.update(plan.id, new TextEncoder().encode('# Plan\n\nFrom my phone.\n'), 'text/markdown')
    const before = useStore.getState().revisions['Plan.md'] ?? 0
    await gd.syncNow()
    expect(useStore.getState().threads['Plan.md'].body).toContain('From my phone.')
    expect(useStore.getState().revisions['Plan.md']).toBe(before + 1)

    // A second device lists the vault and opens a synced copy of it.
    const list = await gd.listDriveVaults()
    expect(list.map((f) => f.name)).toEqual(['Linked Vault'])
  })
})

describe('Drive REST calls', () => {
  it('lists folders, uploads multipart and reports an expired sign-in', async () => {
    const { driveApi, driveHttp } = await import('../src/core/drive')
    const calls: { url: string; init: RequestInit }[] = []
    driveHttp.fetch = async (input, init = {}) => {
      const url = String(input)
      calls.push({ url, init })
      if ((init.headers as Record<string, string>).authorization !== 'Bearer ok') return new Response('{}', { status: 401 })
      if (url.includes('/upload/')) return new Response(JSON.stringify({ id: 'u1', name: 'A.md', mimeType: 'text/markdown', md5Checksum: 'x' }))
      return new Response(JSON.stringify({ files: [{ id: 'f1', name: "Aria's Notes", mimeType: FOLDER_MIME }] }))
    }
    const a = driveApi(async () => 'ok')
    const found = await a.find("Aria's Notes", 'root', true)
    expect(found?.id).toBe('f1')
    const q = new URL(calls[0].url).searchParams.get('q')!
    expect(q).toBe(`name='Aria\\'s Notes' and 'root' in parents and trashed=false and mimeType='${FOLDER_MIME}'`)
    await a.upload('A.md', 'f1', new TextEncoder().encode('# A\n'), 'text/markdown')
    const up = calls[1]
    expect(up.url).toContain('/upload/drive/v3/files?uploadType=multipart')
    const body = new TextDecoder().decode(up.init.body as Uint8Array)
    expect(body).toContain('{"name":"A.md","parents":["f1"],"mimeType":"text/markdown"}')
    expect(body).toContain('\r\n\r\n# A\n\r\n--thread')
    const expired = driveApi(async () => 'stale')
    await expect(expired.children('root')).rejects.toThrow(/sign-in expired/)
  })
})
