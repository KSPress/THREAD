export function releaseEntry(base: string, entry: string) {
  if (!/^assets\/[\w.-]+\.js$/.test(entry)) throw new Error('Invalid update entry')
  return new URL(entry, base)
}

export async function fetchRelease(base: string): Promise<ThreadRelease> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const url = new URL('version.json', base)
    url.searchParams.set('t', String(Date.now()))
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error(`Update server returned ${response.status}`)
    const release = await response.json() as ThreadRelease
    if (!release || typeof release.id !== 'string' || !release.id || typeof release.commit !== 'string' || !Number.isFinite(release.time)) {
      throw new Error('Invalid update manifest')
    }
    releaseEntry(base, release.entry)
    return release
  } finally {
    clearTimeout(timer)
  }
}

export const isNewerRelease = (current: typeof __THREAD_BUILD__, candidate: ThreadRelease) =>
  candidate.id !== current.id && candidate.time > current.time
export const UPDATE_REQUEST = 'thread.update.requested'

