import { afterEach, expect, it, vi } from 'vitest'
import { fetchRelease, isNewerRelease } from '../src/core/release'
import { flushOpenEditors, trackEditorSave } from '../src/core/update'

const base = 'https://example.test/THREAD/'
const release = { id: 'second', commit: 'abcdef0', time: 2000, entry: 'assets/index-abc.js', liveProtocol: 1 }

afterEach(() => vi.unstubAllGlobals())

it('reads a fresh release manifest under the deployed app path', async () => {
  const fetch = vi.fn(async () => Response.json(release))
  vi.stubGlobal('fetch', fetch)
  expect(await fetchRelease(base)).toEqual(release)
  expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/THREAD/version.json' }), expect.objectContaining({ cache: 'no-store' }))
  expect(isNewerRelease({ id: 'first', commit: 'abcdef1', time: 1000 }, release)).toBe(true)
  expect(isNewerRelease(release, release)).toBe(false)
})

it('rejects a manifest entry outside the release assets', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ ...release, entry: 'https://example.test/other.js' }))
  await expect(fetchRelease(base)).rejects.toThrow('Invalid update entry')
})

it('waits for ongoing editor saves and reports a write failure', async () => {
  let reject!: (error: Error) => void
  trackEditorSave(new Promise((_, onError) => { reject = onError }))
  const flushed = flushOpenEditors()
  reject(new Error('Vault write failed'))
  await expect(flushed).rejects.toThrow('Vault write failed')
  await expect(flushOpenEditors()).resolves.toBeUndefined()
})
