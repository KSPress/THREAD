import { zip, type Zippable } from 'fflate'
import { dayKey } from './activity'
import { safeName } from './paths'
import { saveFile } from './platform'
import { flushOpenEditors } from './update'
import type { VaultAdapter } from './vault'

const EXCLUDE = /(^|\/)(\.git|\.loom|node_modules|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|\.thread-tmp$/

/** A portable ZIP with vault-relative paths, including attachments and .thread metadata. */
export async function createVaultBackup(adapter: VaultAdapter): Promise<Uint8Array> {
  const files: Zippable = Object.create(null)
  for (const entry of await adapter.list()) {
    if (EXCLUDE.test(entry.path)) continue
    files[entry.dir ? entry.path + '/' : entry.path] = entry.dir ? new Uint8Array() : await adapter.readBinary(entry.path)
  }
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (error, bytes) => error ? reject(error) : resolve(bytes))
  })
}

export async function downloadVaultBackup(adapter: VaultAdapter) {
  await flushOpenEditors()
  const bytes = await createVaultBackup(adapter)
  return saveFile(`${safeName(adapter.name)} backup ${dayKey(new Date())}.zip`, bytes)
}
