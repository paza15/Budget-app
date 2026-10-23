import { clear, createStore, delMany, get, keys, promisifyRequest, set, type UseStore } from 'idb-keyval'
import { isValidISODate } from '@/domain/dates'
import type { ISODate } from '@/domain/types'

/**
 * The only module that touches IndexedDB (docs/SPEC.md §5.4). All values live in one idb-keyval
 * store ('onabudget', 'kv') behind the KvBackend interface, so tests can inject memory, failing or
 * slow backends.
 */

/** A key-value store. Production wraps idb-keyval; tests use createMemoryBackend. */
export interface KvBackend {
  get(key: string): Promise<unknown>
  keys(): Promise<string[]>
  set(key: string, value: unknown): Promise<void>
  del(keys: string[]): Promise<void>
  clear(): Promise<void>
  /**
   * One readwrite transaction: read KEYS.meta; if (meta?.rev ?? null) !== expectedRev reject with
   * ConflictError; else put every entry.
   */
  commit(expectedRev: number | null, entries: [string, unknown][]): Promise<void>
  /** One readwrite transaction: read `key`, put update(old). */
  update(key: string, update: (old: unknown) => unknown): Promise<void>
}

/** The value stored under KEYS.meta, written in the same transaction as the data it describes. */
export interface StoredMeta {
  /** Increases by one with every save; a mismatch means another window saved (ConflictError). */
  rev: number
  /** Epoch ms. */
  savedAt: number
  schemaVersion: number
}

/** The stored revision is not the one this window loaded: another window saved in between. */
export class ConflictError extends Error {
  constructor(message = 'The data was changed in another window.') {
    super(message)
    this.name = 'ConflictError'
  }
}

/**
 * Keys of the kv store. Automatic copies use 'snap:<YYYY-MM-DD>', 'snap:pre-import',
 * 'snap:pre-restore' and 'snap:pre-v<N>' (see the snapshot helpers below).
 */
export const KEYS = { data: 'data', meta: 'meta', security: 'security', quarantine: 'quarantine' } as const

/** Database and object store of the app; part of the stored format, so never renamed. */
const DB_NAME = 'onabudget'
const STORE_NAME = 'kv'

/**
 * The revision a stored meta value records: its `rev` when that is a whole number, else null (no
 * meta, or one this build cannot read). commit() and the loader both read it this way, so a meta
 * value the loader could not read never blocks saving.
 */
export function storedRev(meta: unknown): number | null {
  if (typeof meta !== 'object' || meta === null || !Object.hasOwn(meta, 'rev')) return null
  const rev: unknown = (meta as { rev: unknown }).rev
  return Number.isSafeInteger(rev) ? (rev as number) : null
}

// ---------------------------------------------------------------------------------------------
// Automatic copies (docs/SPEC.md §5.4, persistence rule 6)

const SNAPSHOT_PREFIX = 'snap:'

/** Keys of the copies taken before replacing the data. */
export const SNAPSHOT_KEYS = { preImport: 'snap:pre-import', preRestore: 'snap:pre-restore' } as const

const DAILY_SNAPSHOT_KEY = /^snap:(\d{4}-\d{2}-\d{2})$/
const MIGRATION_SNAPSHOT_KEY = /^snap:pre-v(\d+)$/

/** 'snap:<date>': the data as it was at the end of that local day. */
export function dailySnapshotKey(date: ISODate): string {
  return `${SNAPSHOT_PREFIX}${date}`
}

/** 'snap:pre-v<N>': the stored data as it was before it was migrated from schema N. */
export function migrationSnapshotKey(fromVersion: number): string {
  return `${SNAPSHOT_PREFIX}pre-v${fromVersion}`
}

/** The day of a daily copy's key ('snap:2026-10-17' → '2026-10-17'), or null for any other key. */
export function dailySnapshotDate(key: string): ISODate | null {
  const date = DAILY_SNAPSHOT_KEY.exec(key)?.[1]
  return isValidISODate(date) ? date : null
}

/** True for the key of an automatic copy: daily, pre-import, pre-restore or pre-v<N>. */
export function isSnapshotKey(key: string): boolean {
  return (
    dailySnapshotDate(key) !== null ||
    key === SNAPSHOT_KEYS.preImport ||
    key === SNAPSHOT_KEYS.preRestore ||
    MIGRATION_SNAPSHOT_KEY.test(key)
  )
}

// ---------------------------------------------------------------------------------------------
// IndexedDB

/**
 * The idb-keyval handle, opened lazily. A transaction that fails for any reason other than a
 * conflict drops it, so the next operation opens a fresh connection: iOS sometimes closes the
 * connection of an app that was in the background, and every later transaction on it fails.
 */
let handle: UseStore | null = null

function currentHandle(): UseStore {
  handle ??= createStore(DB_NAME, STORE_NAME)
  return handle
}

/** Runs one operation on the current handle and drops the handle when the operation fails. */
async function withHandle<T>(operation: (store: UseStore) => Promise<T>): Promise<T> {
  const store = currentHandle()
  try {
    return await operation(store)
  } catch (error) {
    if (!(error instanceof ConflictError) && handle === store) handle = null
    throw error
  }
}

/**
 * Reads `key` and continues with its value inside one readwrite transaction. `write` puts what it
 * needs and returns nothing, or returns an error to abort the transaction with: then nothing is
 * written and the promise rejects with that error. The promise resolves once the transaction has
 * committed, so a value is on disk when it resolves.
 */
function readThenWrite(
  store: UseStore,
  key: string,
  write: (objectStore: IDBObjectStore, value: unknown) => unknown,
): Promise<void> {
  return store(
    'readwrite',
    (objectStore) =>
      new Promise<void>((resolve, reject) => {
        const transaction = objectStore.transaction
        const request = objectStore.get(key)
        request.addEventListener('success', () => {
          let failure: unknown
          try {
            failure = write(objectStore, request.result)
          } catch (error) {
            // A value that cannot be stored (DataCloneError) or a throwing update callback.
            failure = error
          }
          if (failure !== undefined) {
            transaction.abort()
            reject(failure)
            return
          }
          promisifyRequest(transaction).then(() => resolve(), reject)
        })
        request.addEventListener('error', () => reject(request.error))
      }),
  )
}

/** The production backend: idb-keyval on createStore('onabudget', 'kv'). */
const idbBackend: KvBackend = {
  get: (key) => withHandle((store) => get<unknown>(key, store)),
  keys: () =>
    withHandle(async (store) => (await keys(store)).filter((key): key is string => typeof key === 'string')),
  set: (key, value) => withHandle((store) => set(key, value, store)),
  del: (list) => withHandle((store) => delMany(list, store)),
  clear: () => withHandle((store) => clear(store)),
  commit: (expectedRev, entries) =>
    withHandle((store) =>
      readThenWrite(store, KEYS.meta, (objectStore, meta) => {
        if (storedRev(meta) !== expectedRev) return new ConflictError()
        for (const [key, value] of entries) objectStore.put(value, key)
        return undefined
      }),
    ),
  update: (key, update) =>
    withHandle((store) =>
      readThenWrite(store, key, (objectStore, old) => {
        objectStore.put(update(old), key)
        return undefined
      }),
    ),
}

// ---------------------------------------------------------------------------------------------
// Backend selection

/** A backend injected by a test, or null for IndexedDB. */
let injected: KvBackend | null = null

/** The current backend: idb-keyval createStore('onabudget', 'kv'), or the one a test injected. */
export function getKv(): KvBackend {
  return injected ?? idbBackend
}

/**
 * Drops the cached IndexedDB handle so the next operation opens a fresh one (after a failed
 * transaction). An injected backend is left as it is.
 */
export function resetKv(): void {
  handle = null
}

/** Injects a backend for tests; null restores the default. */
export function setKvBackend(b: KvBackend | null): void {
  injected = b
}

// ---------------------------------------------------------------------------------------------
// Memory backend

/** Runs `operation` in a later microtask, after operations issued earlier, like an IndexedDB request. */
async function run<T>(operation: () => T): Promise<T> {
  await Promise.resolve()
  return operation()
}

/**
 * An in-memory backend with the same semantics as the IndexedDB one, for tests:
 * - every operation completes asynchronously, in call order, and on its own (like a transaction);
 * - values are stored and returned as structured clones, so callers never share objects with it,
 *   and a value that cannot be cloned rejects (DataCloneError) without storing anything;
 * - commit compares the stored meta's revision and writes all entries or none;
 * - update reads and writes in one step, and a throwing callback changes nothing;
 * - keys come back sorted, as IndexedDB returns them.
 */
export function createMemoryBackend(): KvBackend {
  const values = new Map<string, unknown>()
  return {
    get: (key) => run(() => structuredClone(values.get(key))),
    keys: () => run(() => [...values.keys()].toSorted()),
    set: (key, value) =>
      run(() => {
        values.set(key, structuredClone(value))
      }),
    del: (list) =>
      run(() => {
        for (const key of list) values.delete(key)
      }),
    clear: () =>
      run(() => {
        values.clear()
      }),
    commit: (expectedRev, entries) =>
      run(() => {
        if (storedRev(values.get(KEYS.meta)) !== expectedRev) throw new ConflictError()
        // Clone everything before storing anything, so a failing entry leaves the store as it was.
        const copies = entries.map(([key, value]): [string, unknown] => [key, structuredClone(value)])
        for (const [key, copy] of copies) values.set(key, copy)
      }),
    update: (key, update) =>
      run(() => {
        const next = structuredClone(update(structuredClone(values.get(key))))
        values.set(key, next)
      }),
  }
}
