import 'fake-indexeddb/auto'
import { strFromU8, unzipSync } from 'fflate'
import { expect, it } from 'vitest'
import { createVaultBackup } from '../src/core/backup'
import { BrowserVault } from '../src/core/vault'

it('round-trips a portable vault backup with original paths and bytes', async () => {
  const vault = new BrowserVault('backup-test')
  const markdown = '# Une idée\r\n\r\n[[Field Notes.pdf]]\r\n'
  const attachment = Uint8Array.of(37, 80, 68, 70, 0, 255)
  await vault.writeText('Project/Draft.md', markdown)
  await vault.writeText('Project/Chapter.cord', '{"title":"Chapter"}')
  await vault.writeBinary('Project/Field Notes.pdf', attachment)
  await vault.writeText('.thread/manuscripts.json', '{"example":[]}')
  await vault.mkdir('Empty')
  await vault.writeText('.loom/events.log', 'replication state')

  const files = unzipSync(await createVaultBackup(vault))
  expect(strFromU8(files['Project/Draft.md'])).toBe(markdown)
  expect(strFromU8(files['Project/Chapter.cord'])).toBe('{"title":"Chapter"}')
  expect(files['Project/Field Notes.pdf']).toEqual(attachment)
  expect(strFromU8(files['.thread/manuscripts.json'])).toBe('{"example":[]}')
  expect(files['Empty/']).toHaveLength(0)
  expect(files['.loom/events.log']).toBeUndefined()
})
