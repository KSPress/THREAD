// Tiny promise wrapper around IndexedDB. Satellites use it for the offline
// vault cache, the Yjs document states and the outgoing event log.
const DB_NAME = 'thread'
const DB_VERSION = 2
// 'index' mirrors 'files' without the contents ({ dir, size, mtime }), so a
// vault can be listed without reading every PDF into memory (phones crashed).
export const STORES = ['files', 'ydocs', 'outbox', 'kv', 'index'] as const
export type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (ev) => {
      const db = req.result
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, s === 'outbox' ? { autoIncrement: true } : undefined)
        }
      }
      // Build the index for vaults saved before it existed, one record at a time.
      if (ev.oldVersion >= 1 && ev.oldVersion < 2) {
        const tx = req.transaction!
        const index = tx.objectStore('index')
        const cursor = tx.objectStore('files').openCursor()
        cursor.onsuccess = () => {
          const c = cursor.result
          if (!c) return
          const v = c.value as { dir?: boolean; text?: string; bin?: Uint8Array; mtime: number }
          index.put({ dir: !!v.dir, size: v.text?.length ?? v.bin?.byteLength ?? 0, mtime: v.mtime }, c.key)
          c.continue()
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGet<T = unknown>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await open()
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>
}

export async function idbSet(store: StoreName, key: IDBValidKey | undefined, value: unknown): Promise<IDBValidKey> {
  const db = await open()
  const os = db.transaction(store, 'readwrite').objectStore(store)
  return wrap(key === undefined ? os.add(value) : os.put(value, key))
}

export async function idbDelete(store: StoreName, key: IDBValidKey | IDBKeyRange): Promise<void> {
  const db = await open()
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key))
}

export async function idbEntries<T = unknown>(store: StoreName): Promise<[IDBValidKey, T][]> {
  const db = await open()
  const os = db.transaction(store).objectStore(store)
  const [keys, values] = await Promise.all([wrap(os.getAllKeys()), wrap(os.getAll())])
  return keys.map((k, i) => [k, values[i] as T])
}

export async function idbClear(store: StoreName): Promise<void> {
  const db = await open()
  await wrap(db.transaction(store, 'readwrite').objectStore(store).clear())
}

/** Entries whose key starts with `prefix` (keys are strings). */
export async function idbEntriesWithPrefix<T = unknown>(store: StoreName, prefix: string): Promise<[string, T][]> {
  const db = await open()
  const os = db.transaction(store).objectStore(store)
  const range = IDBKeyRange.bound(prefix, prefix + '\uffff')
  const [keys, values] = await Promise.all([wrap(os.getAllKeys(range)), wrap(os.getAll(range))])
  return keys.map((k, i) => [String(k), values[i] as T])
}

export async function idbKeys(store: StoreName): Promise<IDBValidKey[]> {
  const db = await open()
  return wrap(db.transaction(store).objectStore(store).getAllKeys())
}
