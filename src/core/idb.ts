// Tiny promise wrapper around IndexedDB. Satellites use it for the offline
// vault cache, the Yjs document states and the outgoing event log.
const DB_NAME = 'thread'
const DB_VERSION = 1
export const STORES = ['files', 'ydocs', 'outbox', 'kv'] as const
export type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, s === 'outbox' ? { autoIncrement: true } : undefined)
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
