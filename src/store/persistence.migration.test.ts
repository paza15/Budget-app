import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '@/domain/defaults'
import { NOW, sampleData, toRaw } from '@/domain/test-helpers/dataFixtures'
import { actions } from '@/store/actions'
import { getData } from '@/store/appStore'
import { KEYS, setKvBackend } from '@/store/db'
import { __resetPersistenceForTests, flushSaves, initStore, listSnapshots, useStorageStatus } from '@/store/persistence'
import { createTestBackend, settle, type TestBackend } from '@/store/test-helpers/backends'

// Schema 1 is the first, so no real data can need a migration yet. Stored data carrying
// `testMigratedFrom: N` is reported as migrated from schema N, as normalizeAppData will report
// it once MIGRATIONS has entries.
vi.mock('@/domain/normalize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/normalize')>()
  return {
    ...actual,
    normalizeAppData: (raw: unknown, now: number) => {
      const result = actual.normalizeAppData(raw, now)
      const from = actual.isRecord(raw) ? actual.ownValue(raw, 'testMigratedFrom') : undefined
      return typeof from === 'number' ? { ...result, report: { ...result.report, migratedFrom: from } } : result
    },
  }
})

const SAVED_AT = NOW - 3_600_000

let backend: TestBackend

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetPersistenceForTests()
  backend = createTestBackend()
  setKvBackend(backend)
  await backend.inner.set(KEYS.data, { ...toRaw(sampleData()), testMigratedFrom: 0 })
  await backend.inner.set(KEYS.meta, { rev: 3, savedAt: SAVED_AT, schemaVersion: 0 })
})

afterEach(() => {
  __resetPersistenceForTests()
  setKvBackend(null)
  vi.useRealTimers()
})

describe('copy before a migration (rule 6)', () => {
  it('writes snap:pre-v<N> with the first save after migrating, not on load', async () => {
    const raw = await backend.peek(KEYS.data)
    await initStore()
    expect(useStorageStatus.getState().phase).toBe('ok')
    expect(getData()).toEqual(sampleData())
    await settle()
    expect(backend.writes()).toBe(0)

    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    const [first] = backend.commits()
    expect(first?.map(([key]) => key)).toEqual(['snap:pre-v0', KEYS.data, KEYS.meta])
    expect(await backend.peek('snap:pre-v0')).toEqual({ savedAt: SAVED_AT, data: raw })
    expect(await backend.peek(KEYS.meta)).toEqual({ rev: 4, savedAt: NOW, schemaVersion: CURRENT_SCHEMA_VERSION })

    actions.updateSettings({ name: 'Bo' })
    await flushSaves()
    expect(backend.commits()[1]?.map(([key]) => key)).toEqual([KEYS.data, KEYS.meta])
  })

  it('keeps the copy for the retry when the first save fails', async () => {
    await initStore()
    backend.fail('commit', { times: 2 })
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect(useStorageStatus.getState().phase).toBe('write-failed')
    expect(await backend.peek('snap:pre-v0')).toBeUndefined()

    actions.updateSettings({ name: 'Bo' })
    await flushSaves()
    expect(backend.commits().at(-1)?.map(([key]) => key)).toEqual(['snap:pre-v0', KEYS.data, KEYS.meta])
    expect(useStorageStatus.getState().phase).toBe('ok')
  })

  it('lists the copy as "Before update"', async () => {
    await initStore()
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect(await listSnapshots()).toEqual([
      { key: 'snap:pre-v0', label: 'Before update', savedAt: SAVED_AT, transactions: sampleData().transactions.length },
    ])
  })
})
