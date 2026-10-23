import { createMemoryBackend, type KvBackend } from '@/store/db'

/**
 * Test doubles for the store: a kv backend that records, fails and holds operations on request,
 * and an in-memory localStorage. Both are plain objects, injected with setKvBackend and
 * vi.stubGlobal.
 */

export type Operation = keyof KvBackend

/** Operations that change what is stored. */
const WRITE_OPERATIONS: ReadonlySet<Operation> = new Set<Operation>(['set', 'del', 'clear', 'commit', 'update'])

export interface RecordedCall {
  op: Operation
  args: unknown[]
}

/** A memory backend that records every call and can fail or hold operations. */
export interface TestBackend extends KvBackend {
  /** Every operation started, in order. */
  readonly calls: RecordedCall[]
  /** Number of calls of `op`. */
  count(op: Operation): number
  /** Number of calls that write: set, del, clear, commit, update. */
  writes(): number
  /** The entries of every commit call, in order. */
  commits(): [string, unknown][][]
  /** The next `times` (default 1) calls of `op` reject with `error` (default an Error) and change nothing. */
  fail(op: Operation, o?: { times?: number; error?: unknown }): void
  /** Every call of `ops` rejects until heal(). */
  failAlways(ops: Operation | readonly Operation[] | 'all', error?: unknown): void
  /** Ends failAlways and pending fail() calls. */
  heal(): void
  /** Holds every operation until the returned function is called. */
  hold(): () => void
  /** The stored value, read without being recorded. */
  peek(key: string): Promise<unknown>
  /** The stored keys, read without being recorded. */
  peekKeys(): Promise<string[]>
  /** The backend behind this one; another test backend can share it (a second window). */
  readonly inner: KvBackend
}

export function createTestBackend(inner: KvBackend = createMemoryBackend()): TestBackend {
  const calls: RecordedCall[] = []
  const failures = new Map<Operation, { times: number; error: unknown }>()
  let always: { ops: ReadonlySet<Operation> | 'all'; error: unknown } | null = null
  let gate: Promise<void> | null = null

  /** The error the next call of `op` must reject with, if any. */
  const failureFor = (op: Operation): unknown => {
    if (always !== null && (always.ops === 'all' || always.ops.has(op))) return always.error
    const failure = failures.get(op)
    if (failure === undefined) return undefined
    failure.times -= 1
    if (failure.times <= 0) failures.delete(op)
    return failure.error
  }

  const wrap =
    <A extends unknown[], R>(op: Operation, run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      calls.push({ op, args })
      if (gate !== null) await gate
      const error = failureFor(op)
      if (error !== undefined) throw error
      return run(...args)
    }

  return {
    get: wrap('get', (key: string) => inner.get(key)),
    keys: wrap('keys', () => inner.keys()),
    set: wrap('set', (key: string, value: unknown) => inner.set(key, value)),
    del: wrap('del', (keys: string[]) => inner.del(keys)),
    clear: wrap('clear', () => inner.clear()),
    commit: wrap('commit', (expectedRev: number | null, entries: [string, unknown][]) => inner.commit(expectedRev, entries)),
    update: wrap('update', (key: string, update: (old: unknown) => unknown) => inner.update(key, update)),
    calls,
    count: (op) => calls.filter((call) => call.op === op).length,
    writes: () => calls.filter((call) => WRITE_OPERATIONS.has(call.op)).length,
    commits: () =>
      calls.filter((call) => call.op === 'commit').map((call) => call.args[1] as [string, unknown][]),
    fail(op, o = {}) {
      failures.set(op, { times: o.times ?? 1, error: o.error ?? new Error(`${op} failed`) })
    },
    failAlways(ops, error = new Error('Storage failed')) {
      always = { ops: ops === 'all' ? 'all' : new Set(typeof ops === 'string' ? [ops] : ops), error }
    },
    heal() {
      always = null
      failures.clear()
    },
    hold() {
      let open: (() => void) | undefined
      gate = new Promise<void>((resolve) => {
        open = resolve
      })
      return () => {
        gate = null
        open?.()
      }
    },
    peek: (key) => inner.get(key),
    peekKeys: () => inner.keys(),
    inner,
  }
}

/** A DOMException-like error with the name IndexedDB uses when storage is full. */
export function quotaError(): Error {
  const error = new Error('The quota has been exceeded.')
  error.name = 'QuotaExceededError'
  return error
}

/** An in-memory Storage (localStorage) for node tests. */
export function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map<string, string>(Object.entries(initial))
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, String(value))
    },
  }
}

/** Lets every queued microtask and pending memory-backend operation run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
