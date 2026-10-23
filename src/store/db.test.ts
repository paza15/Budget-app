import { createStore } from 'idb-keyval'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConflictError,
  createMemoryBackend,
  dailySnapshotDate,
  dailySnapshotKey,
  getKv,
  isSnapshotKey,
  KEYS,
  migrationSnapshotKey,
  resetKv,
  setKvBackend,
  SNAPSHOT_KEYS,
  storedRev,
  type KvBackend,
} from '@/store/db'

// Counts how often a fresh IndexedDB handle is opened; the store itself is idb-keyval's.
vi.mock('idb-keyval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('idb-keyval')>()
  return { ...actual, createStore: vi.fn<typeof actual.createStore>(actual.createStore) }
})

/** Handles opened so far. */
function handlesOpened(): number {
  return vi.mocked(createStore).mock.calls.length
}

/** A value structured clone cannot copy: storing it must fail and store nothing. */
const UNCLONEABLE = { run: () => 1 }

/**
 * The KvBackend contract (docs/SPEC.md §5.4), run against the memory backend and against
 * IndexedDB (fake-indexeddb, from src/test/setup.ts), so tests on the memory backend mean what
 * they say about production.
 */
function backendContract(name: string, open: () => KvBackend): void {
  describe(`${name} backend`, () => {
    let kv: KvBackend

    beforeEach(async () => {
      kv = open()
      await kv.clear()
    })

    it('reads undefined for a missing key', async () => {
      expect(await kv.get('missing')).toBeUndefined()
    })

    it('stores structured clones, never the caller’s objects', async () => {
      const value = { a: [1, 2], when: new Date(0) }
      await kv.set('k', value)
      value.a.push(3)
      const read = (await kv.get('k')) as typeof value
      expect(read).toEqual({ a: [1, 2], when: new Date(0) })
      expect(read).not.toBe(value)
      read.a.push(4)
      expect(await kv.get('k')).toEqual({ a: [1, 2], when: new Date(0) })
    })

    it('lists string keys in sorted order', async () => {
      await kv.set('snap:2026-10-02', 1)
      await kv.set('data', 2)
      await kv.set('snap:2026-09-30', 3)
      expect(await kv.keys()).toEqual(['data', 'snap:2026-09-30', 'snap:2026-10-02'])
    })

    it('deletes the listed keys only and ignores missing ones', async () => {
      await kv.set('a', 1)
      await kv.set('b', 2)
      await kv.del(['a', 'missing'])
      expect(await kv.keys()).toEqual(['b'])
    })

    it('clears everything', async () => {
      await kv.set('a', 1)
      await kv.set(KEYS.meta, { rev: 1 })
      await kv.clear()
      expect(await kv.keys()).toEqual([])
    })

    it('runs operations in call order', async () => {
      const writing = kv.set('a', 1)
      const reading = kv.get('a')
      await writing
      expect(await reading).toBe(1)
    })

    it('rejects storing a value that cannot be cloned and keeps the old value', async () => {
      await kv.set('k', 'old')
      await expect(kv.set('k', UNCLONEABLE)).rejects.toMatchObject({ name: 'DataCloneError' })
      expect(await kv.get('k')).toBe('old')
    })

    describe('commit', () => {
      it('writes every entry when nothing is stored and the expected revision is null', async () => {
        await kv.commit(null, [
          [KEYS.data, { n: 1 }],
          [KEYS.meta, { rev: 1, savedAt: 5, schemaVersion: 1 }],
        ])
        expect(await kv.get(KEYS.data)).toEqual({ n: 1 })
        expect(await kv.get(KEYS.meta)).toEqual({ rev: 1, savedAt: 5, schemaVersion: 1 })
      })

      it('writes when the stored revision matches', async () => {
        await kv.set(KEYS.meta, { rev: 4 })
        await kv.commit(4, [
          [KEYS.data, 'new'],
          [KEYS.meta, { rev: 5 }],
        ])
        expect(await kv.get(KEYS.data)).toBe('new')
        expect(storedRev(await kv.get(KEYS.meta))).toBe(5)
      })

      it('rejects with ConflictError and writes nothing when the revision differs', async () => {
        await kv.set(KEYS.meta, { rev: 5 })
        await kv.set(KEYS.data, 'theirs')
        const attempt = kv.commit(4, [
          [KEYS.data, 'mine'],
          [KEYS.meta, { rev: 5 }],
        ])
        await expect(attempt).rejects.toBeInstanceOf(ConflictError)
        expect(await kv.get(KEYS.data)).toBe('theirs')
        expect(await kv.get(KEYS.meta)).toEqual({ rev: 5 })
      })

      it('treats an expected null as a conflict once a revision is stored', async () => {
        await kv.set(KEYS.meta, { rev: 1 })
        await expect(kv.commit(null, [[KEYS.data, 'x']])).rejects.toBeInstanceOf(ConflictError)
        expect(await kv.get(KEYS.data)).toBeUndefined()
      })

      it('writes all entries or none', async () => {
        await kv.set(KEYS.data, 'old')
        await expect(
          kv.commit(null, [
            [KEYS.data, 'new'],
            ['other', UNCLONEABLE],
          ]),
        ).rejects.toMatchObject({ name: 'DataCloneError' })
        expect(await kv.get(KEYS.data)).toBe('old')
        expect(await kv.get('other')).toBeUndefined()
      })

      it('reads an unreadable revision as null on both sides', async () => {
        await kv.set(KEYS.meta, { rev: 'seven' })
        await kv.commit(null, [[KEYS.data, 'x']])
        expect(await kv.get(KEYS.data)).toBe('x')
      })
    })

    describe('update', () => {
      it('passes the old value and stores the result', async () => {
        await kv.set('n', 1)
        await kv.update('n', (old) => (old as number) + 1)
        await kv.update('fresh', (old) => ({ old }))
        expect(await kv.get('n')).toBe(2)
        expect(await kv.get('fresh')).toEqual({ old: undefined })
      })

      it('rejects with the callback’s error and changes nothing', async () => {
        await kv.set('n', 1)
        const boom = new RangeError('boom')
        await expect(
          kv.update('n', () => {
            throw boom
          }),
        ).rejects.toBe(boom)
        expect(await kv.get('n')).toBe(1)
      })

      it('applies concurrent updates one after the other', async () => {
        await kv.set('n', 0)
        await Promise.all(Array.from({ length: 5 }, () => kv.update('n', (old) => (old as number) + 1)))
        expect(await kv.get('n')).toBe(5)
      })
    })
  })
}

backendContract('memory', () => createMemoryBackend())
backendContract('IndexedDB', () => getKv())

describe('backend selection', () => {
  afterEach(() => {
    setKvBackend(null)
  })

  it('uses IndexedDB unless a backend is injected, and null restores it', () => {
    const production = getKv()
    const memory = createMemoryBackend()
    setKvBackend(memory)
    expect(getKv()).toBe(memory)
    resetKv()
    expect(getKv()).toBe(memory)
    setKvBackend(null)
    expect(getKv()).toBe(production)
  })

  it('keeps one memory backend per call, so two backends never share values', async () => {
    const a = createMemoryBackend()
    const b = createMemoryBackend()
    await a.set('k', 1)
    expect(await b.get('k')).toBeUndefined()
  })

  it("stores everything in the 'onabudget' database's 'kv' store", async () => {
    await getKv().set('probe', 1)
    expect(vi.mocked(createStore)).toHaveBeenCalledWith('onabudget', 'kv')
    expect((await indexedDB.databases()).map(({ name }) => name)).toContain('onabudget')
  })
})

describe('IndexedDB handle', () => {
  beforeEach(async () => {
    setKvBackend(null)
    resetKv()
    await getKv().clear()
  })

  it('reuses one handle while operations succeed', async () => {
    const opened = handlesOpened()
    await getKv().set('a', 1)
    await getKv().get('a')
    await getKv().keys()
    expect(handlesOpened()).toBe(opened)
  })

  it('opens a fresh handle after resetKv, on the same data', async () => {
    await getKv().set('a', 1)
    const opened = handlesOpened()
    resetKv()
    expect(await getKv().get('a')).toBe(1)
    expect(handlesOpened()).toBe(opened + 1)
  })

  it('opens a fresh handle after a failed transaction', async () => {
    await getKv().set('a', 1)
    const opened = handlesOpened()
    await expect(getKv().set('a', UNCLONEABLE)).rejects.toMatchObject({ name: 'DataCloneError' })
    expect(await getKv().get('a')).toBe(1)
    expect(handlesOpened()).toBe(opened + 1)
  })

  it('keeps the handle after a conflict, which is no storage failure', async () => {
    await getKv().set(KEYS.meta, { rev: 2 })
    const opened = handlesOpened()
    await expect(getKv().commit(1, [])).rejects.toBeInstanceOf(ConflictError)
    await getKv().get(KEYS.meta)
    expect(handlesOpened()).toBe(opened)
  })
})

describe('storedRev', () => {
  it.each([
    [{ rev: 3, savedAt: 1 }, 3],
    [{ rev: 0 }, 0],
    [undefined, null],
    [null, null],
    ['meta', null],
    [{}, null],
    [{ rev: '3' }, null],
    [{ rev: 1.5 }, null],
    [{ rev: Number.NaN }, null],
    [Object.create({ rev: 3 }) as object, null],
  ])('reads %j as %j', (meta, rev) => {
    expect(storedRev(meta)).toBe(rev)
  })
})

describe('snapshot keys', () => {
  it('names daily, migration and replacement copies', () => {
    expect(dailySnapshotKey('2026-10-17')).toBe('snap:2026-10-17')
    expect(migrationSnapshotKey(1)).toBe('snap:pre-v1')
    expect(SNAPSHOT_KEYS).toEqual({ preImport: 'snap:pre-import', preRestore: 'snap:pre-restore' })
  })

  it('reads the date of daily copies only', () => {
    expect(dailySnapshotDate('snap:2026-10-17')).toBe('2026-10-17')
    expect(dailySnapshotDate('snap:2026-02-30')).toBeNull()
    expect(dailySnapshotDate('snap:pre-import')).toBeNull()
    expect(dailySnapshotDate('data')).toBeNull()
  })

  it.each([
    ['snap:2026-10-17', true],
    ['snap:pre-import', true],
    ['snap:pre-restore', true],
    ['snap:pre-v1', true],
    ['snap:pre-v12', true],
    ['snap:2026-13-01', false],
    ['snap:pre-v', false],
    ['snap:latest', false],
    [KEYS.data, false],
    [KEYS.meta, false],
    [KEYS.security, false],
    [KEYS.quarantine, false],
  ])('%s is a snapshot key: %s', (key, expected) => {
    expect(isSnapshotKey(key)).toBe(expected)
  })
})
