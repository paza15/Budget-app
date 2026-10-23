import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCENTS } from '@/domain/catalog'
import { LS_KEYS } from '@/domain/constants'
import { createDefaultSecurity, createInitialData, CURRENT_SCHEMA_VERSION } from '@/domain/defaults'
import { DataError } from '@/domain/normalize'
import { makeData, NOW, sampleData, toRaw } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { actions } from '@/store/actions'
import { getData, useAppStore } from '@/store/appStore'
import { ConflictError, createMemoryBackend, getKv, KEYS, setKvBackend, SNAPSHOT_KEYS, storedRev, type KvBackend } from '@/store/db'
import {
  __resetPersistenceForTests,
  continueWithoutSaving,
  eraseEverything,
  exportRawData,
  flushSaves,
  importData,
  initStore,
  isBlockingPhase,
  listSnapshots,
  restoreSnapshot,
  startFresh,
  STORAGE_MESSAGES,
  useStorageStatus,
  useWithoutSaving,
  type StoragePhase,
} from '@/store/persistence'
import { __resetSecurityForTests, initSecurity, useSecurityStore } from '@/store/securityStore'
import {
  createMemoryStorage,
  createTestBackend,
  quotaError,
  settle,
  type RecordedCall,
  type TestBackend,
} from '@/store/test-helpers/backends'
import { useUiStore } from '@/store/uiStore'

const HOUR = 3_600_000
const DAY = 24 * HOUR

let backend: TestBackend
let storage: Storage

function meta(rev: number, savedAt = NOW - HOUR, schemaVersion = CURRENT_SCHEMA_VERSION) {
  return { rev, savedAt, schemaVersion }
}

/** Stores data (and meta) as a previous session left them, without recording the writes. */
async function seed(data: unknown, storedMeta: unknown = meta(3)): Promise<void> {
  if (data !== undefined) await backend.inner.set(KEYS.data, data)
  if (storedMeta !== undefined) await backend.inner.set(KEYS.meta, storedMeta)
}

function phase(): StoragePhase {
  return useStorageStatus.getState().phase
}

async function storedData(): Promise<AppData> {
  return (await backend.peek(KEYS.data)) as AppData
}

/** First-run data as this test environment creates it. */
function firstRunData(now: number): AppData {
  return createInitialData(now, navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone)
}

function isWrite(call: RecordedCall): boolean {
  return call.op !== 'get' && call.op !== 'keys'
}

/** Writes in order: the key for set, the operation for the others. */
function writeLog(): string[] {
  return backend.calls.filter(isWrite).map((call) => (call.op === 'set' ? String(call.args[0]) : call.op))
}

function renamed(name: string, data: AppData = sampleData()): AppData {
  return { ...data, settings: { ...data.settings, name } }
}

/** Sends a message as another window of the app would. */
function announceFromElsewhere(channel: BroadcastChannel, message: unknown): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel takes no target origin.
  channel.postMessage(message)
}

/**
 * Holds the write of the erase's revision marker, the only meta written outside a commit, until
 * the returned function is called. Everything else goes through `backend` at once.
 */
function holdEraseMarker(): () => void {
  let release: (() => void) | undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  setKvBackend({
    ...backend,
    set: async (key, value) => {
      if (key === KEYS.meta) await held
      await backend.set(key, value)
    },
  })
  return () => release?.()
}

/** A second window: its own copy of every store module, on the same stored data. */
async function openSecondWindow(kv: (db: typeof import('@/store/db')) => KvBackend) {
  vi.resetModules()
  const db = await import('@/store/db')
  const persistence = await import('@/store/persistence')
  const secondActions = await import('@/store/actions')
  const appStore = await import('@/store/appStore')
  db.setKvBackend(kv(db))
  return { db, persistence, actions: secondActions.actions, appStore }
}

/** A second window on the backend `shared`, whose conflicts it reports with its own ConflictError. */
function openSecondWindowOn(shared: KvBackend) {
  return openSecondWindow((db) => ({
    ...shared,
    commit: (rev, entries) =>
      shared.commit(rev, entries).catch((error: unknown) => {
        throw error instanceof ConflictError ? new db.ConflictError() : error
      }),
  }))
}

/** One memory backend for two windows, holding the sample data at revision 3. */
async function sharedBackend(): Promise<KvBackend> {
  const shared = createMemoryBackend()
  setKvBackend(shared)
  await shared.set(KEYS.data, toRaw(sampleData()))
  await shared.set(KEYS.meta, meta(3))
  return shared
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetPersistenceForTests()
  __resetSecurityForTests()
  backend = createTestBackend()
  setKvBackend(backend)
  storage = createMemoryStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  __resetPersistenceForTests()
  __resetSecurityForTests()
  useUiStore.setState(useUiStore.getInitialState(), true)
  setKvBackend(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('isBlockingPhase', () => {
  it.each<[StoragePhase, boolean]>([
    ['loading', false],
    ['ok', false],
    ['write-failed', false],
    ['memory-only', false],
    ['read-failed', true],
    ['newer-version', true],
    ['damaged', true],
    ['conflict', true],
  ])('%s blocks the app: %s', (p, blocking) => {
    expect(isBlockingPhase(p)).toBe(blocking)
  })
})

describe('loading (rule 1)', () => {
  it('starts a first run with fresh data and writes nothing until the first change', async () => {
    expect(useAppStore.getState().status).toBe('loading')
    await initStore()
    expect(phase()).toBe('ok')
    expect(useAppStore.getState().status).toBe('ready')
    expect(getData()).toEqual(firstRunData(NOW))
    await settle()
    expect(backend.writes()).toBe(0)

    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    const commit = backend.calls.find((call) => call.op === 'commit')
    expect(commit?.args[0]).toBeNull()
    expect(await backend.peek(KEYS.meta)).toEqual({ rev: 1, savedAt: NOW, schemaVersion: CURRENT_SCHEMA_VERSION })
    expect(await storedData()).toEqual(getData())
  })

  it('loads and normalises the stored data without writing', async () => {
    await seed(toRaw(sampleData()))
    await initStore()
    expect(getData()).toEqual(sampleData())
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', error: null, droppedOnLoad: 0, saving: false })
    await settle()
    expect(backend.writes()).toBe(0)
  })

  it('reads meta before data', async () => {
    await initStore()
    expect(backend.calls.slice(0, 2)).toEqual([
      { op: 'get', args: [KEYS.meta] },
      { op: 'get', args: [KEYS.data] },
    ])
  })

  it('is idempotent', async () => {
    const first = initStore()
    expect(initStore()).toBe(first)
    await first
    expect(initStore()).toBe(first)
    expect(backend.count('get')).toBe(2)
  })

  it('never writes after a rejected first read (§9)', async () => {
    await seed(toRaw(sampleData()))
    const rescue = JSON.stringify({ basedOnRev: 3, data: toRaw(sampleData()) })
    storage.setItem(LS_KEYS.rescue, rescue)
    backend.failAlways('get')
    await initStore()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'read-failed', error: STORAGE_MESSAGES.readFailed })
    expect(useAppStore.getState().status).toBe('ready')

    actions.updateSettings({ name: 'Lost' })
    actions.addTransaction({ kind: 'expense', amount: 350, categoryId: 'cat-coffee', date: '2026-10-14' })
    await flushSaves()
    await settle()
    expect(backend.writes()).toBe(0)
    expect(storage.getItem(LS_KEYS.rescue)).toBe(rescue)
  })

  it('tries again after a failed read, showing the loading screen meanwhile', async () => {
    await seed(toRaw(sampleData()))
    backend.fail('get')
    await initStore()
    expect(phase()).toBe('read-failed')

    const retry = initStore()
    expect(useAppStore.getState().status).toBe('loading')
    expect(phase()).toBe('loading')
    await retry
    expect(phase()).toBe('ok')
    expect(getData().settings.name).toBe('Alex')
  })

  it('continues in memory without saving after a failed read', async () => {
    backend.failAlways('get')
    await initStore()
    expect(useWithoutSaving).toBe(continueWithoutSaving)
    continueWithoutSaving()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'memory-only', error: null })
    expect(getData()).toEqual(firstRunData(NOW))

    actions.updateSettings({ name: 'Temporary' })
    await flushSaves()
    await settle()
    expect(backend.writes()).toBe(0)
    expect(getData().settings.name).toBe('Temporary')
  })

  it('ignores continueWithoutSaving unless the read failed', async () => {
    await initStore()
    continueWithoutSaving()
    expect(phase()).toBe('ok')
  })

  it('keeps data of a newer version byte-identical through a session with actions (§9)', async () => {
    const raw = { ...toRaw(sampleData()), schemaVersion: 99, future: { field: true } }
    await seed(raw, meta(7, NOW - DAY, 99))
    const before = JSON.stringify(await backend.peek(KEYS.data))
    await initStore()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'newer-version', error: STORAGE_MESSAGES.newerVersion })
    expect(useAppStore.getState().status).toBe('ready')

    actions.updateSettings({ name: 'Other', theme: 'light' })
    actions.addTransaction({ kind: 'expense', amount: 100, categoryId: 'cat-coffee', date: '2026-10-14' })
    await flushSaves()
    await settle()
    expect(backend.writes()).toBe(0)
    expect(JSON.stringify(await backend.peek(KEYS.data))).toBe(before)
    expect(await backend.peek(KEYS.meta)).toEqual(meta(7, NOW - DAY, 99))
    expect(storage.getItem(LS_KEYS.theme)).toBeNull()
  })

  it('treats newer data under an older meta as a newer version too', async () => {
    await seed({ ...toRaw(sampleData()), schemaVersion: 2 }, meta(3))
    await initStore()
    expect(phase()).toBe('newer-version')
    await settle()
    expect(backend.writes()).toBe(0)
  })

  it('quarantines damaged data and writes nothing else', async () => {
    const raw = { schemaVersion: 1, settings: {}, transactions: 'lost' }
    await seed(raw)
    await initStore()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'damaged', error: "This data is damaged and can't be opened." })
    expect(await backend.peek(KEYS.quarantine)).toEqual(raw)
    expect(await backend.peek(KEYS.data)).toEqual(raw)
    expect(writeLog()).toEqual([KEYS.quarantine])

    actions.updateSettings({ name: 'Ignored' })
    await flushSaves()
    await settle()
    expect(writeLog()).toEqual([KEYS.quarantine])
  })

  it('writes the original of a load that dropped rows to the quarantine with the first save', async () => {
    const raw = toRaw(sampleData())
    ;(raw.transactions as unknown[]).push({ id: 'tx-bad', kind: 'expense', amount: -5, date: 'soon' }, 'garbage')
    await seed(raw)
    await initStore()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', droppedOnLoad: 2 })
    await settle()
    expect(backend.writes()).toBe(0)

    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect(backend.commits().map((entries) => entries.map(([key]) => key))).toEqual([[KEYS.quarantine, KEYS.data, KEYS.meta]])
    expect(await backend.peek(KEYS.quarantine)).toEqual(raw)

    actions.updateSettings({ name: 'Bo' })
    await flushSaves()
    expect(backend.commits()[1]?.map(([key]) => key)).toEqual([KEYS.data, KEYS.meta])
  })

  it('never writes before the data has loaded, and loading replaces early changes', async () => {
    await seed(toRaw(sampleData()))
    actions.updateSettings({ name: 'Too early' })
    const loading = initStore()
    actions.updateSettings({ name: 'Still too early' })
    await loading
    await settle()
    expect(backend.writes()).toBe(0)
    expect(getData().settings.name).toBe('Alex')
  })
})

describe('saving (rules 2–3)', () => {
  beforeEach(async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
  })

  it('saves a change as one commit of data and meta on the loaded revision', async () => {
    actions.addTransaction({ kind: 'expense', amount: 450, categoryId: 'cat-eating', date: '2026-10-14', note: 'Mensa' })
    expect(useStorageStatus.getState().saving).toBe(true)
    await flushSaves()

    const commits = backend.calls.filter((call) => call.op === 'commit')
    expect(commits).toHaveLength(1)
    expect(commits[0]?.args).toEqual([
      3,
      [
        [KEYS.data, getData()],
        [KEYS.meta, { rev: 4, savedAt: NOW, schemaVersion: CURRENT_SCHEMA_VERSION }],
      ],
    ])
    expect(await storedData()).toEqual(getData())
    expect(useStorageStatus.getState().saving).toBe(false)

    actions.updateSettings({ name: 'Next' })
    await flushSaves()
    expect(backend.calls.filter((call) => call.op === 'commit')[1]?.args[0]).toBe(4)
  })

  it('writes 50 synchronous changes in at most 2 writes, the last holding the final data (§9)', async () => {
    for (let i = 1; i <= 50; i += 1) actions.updateSettings({ name: `Name ${i}` })
    await flushSaves()
    expect(backend.count('commit')).toBeGreaterThan(0)
    expect(backend.count('commit')).toBeLessThanOrEqual(2)
    expect((await storedData()).settings.name).toBe('Name 50')
    expect(await storedData()).toEqual(getData())
  })

  it('keeps at most one write in flight and writes the newest data next', async () => {
    const release = backend.hold()
    actions.updateSettings({ name: 'A' })
    await settle()
    expect(backend.count('commit')).toBe(1)

    actions.updateSettings({ name: 'B' })
    actions.updateSettings({ name: 'C' })
    await settle()
    expect(backend.count('commit')).toBe(1)
    expect(useStorageStatus.getState().saving).toBe(true)

    release()
    await flushSaves()
    expect(backend.count('commit')).toBe(2)
    expect((await storedData()).settings.name).toBe('C')
    expect(useStorageStatus.getState().saving).toBe(false)
  })

  it('writes changes made across many ticks without overlapping writes', async () => {
    let inFlight = 0
    let most = 0
    const counting: KvBackend = {
      ...backend,
      commit: async (rev, entries) => {
        inFlight += 1
        most = Math.max(most, inFlight)
        try {
          await backend.commit(rev, entries)
        } finally {
          inFlight -= 1
        }
      },
    }
    setKvBackend(counting)
    for (let i = 1; i <= 20; i += 1) {
      actions.updateSettings({ name: `Tick ${i}` })
      await Promise.resolve()
    }
    await flushSaves()
    expect(most).toBe(1)
    expect((await storedData()).settings.name).toBe('Tick 20')
  })

  it('resolves flushSaves at once when nothing is pending', async () => {
    await flushSaves()
    expect(backend.writes()).toBe(0)
  })

  it('does not save when an action changes nothing', async () => {
    actions.updateSettings({ name: 'Alex' })
    await flushSaves()
    await settle()
    expect(backend.writes()).toBe(0)
  })
})

describe('write failures and the rescue copy (rule 4)', () => {
  beforeEach(async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
  })

  it('retries a failed commit once and succeeds without an error', async () => {
    backend.fail('commit')
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect(backend.count('commit')).toBe(2)
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', error: null })
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()
    expect((await storedData()).settings.name).toBe('Ana')
  })

  it('clears the error when a failed write succeeds later (§9)', async () => {
    backend.fail('commit', { times: 2 })
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect(useStorageStatus.getState()).toMatchObject({
      phase: 'write-failed',
      error: STORAGE_MESSAGES.writeFailed,
      saving: true,
    })
    expect(JSON.parse(storage.getItem(LS_KEYS.rescue) ?? 'null')).toEqual({ basedOnRev: 3, data: toRaw(getData()) })

    actions.updateSettings({ name: 'Bo' })
    await flushSaves()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', error: null, saving: false })
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()
    expect((await storedData()).settings.name).toBe('Bo')
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 4 })
  })

  it('retries what is pending when flushSaves runs again', async () => {
    backend.fail('commit', { times: 2 })
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect(phase()).toBe('write-failed')
    await flushSaves()
    expect(phase()).toBe('ok')
    expect((await storedData()).settings.name).toBe('Ana')
  })

  it('keeps the newest unsaved data in the rescue copy while writes keep failing', async () => {
    backend.failAlways('commit')
    actions.updateSettings({ name: 'First' })
    await flushSaves()
    actions.updateSettings({ name: 'Second' })
    await flushSaves()
    const rescue = JSON.parse(storage.getItem(LS_KEYS.rescue) ?? 'null') as { basedOnRev: number; data: AppData }
    expect(rescue.basedOnRev).toBe(3)
    expect(rescue.data.settings.name).toBe('Second')
    expect(await storedData()).toEqual(toRaw(sampleData()))
  })

  it('says the iPhone is out of storage on QuotaExceededError', async () => {
    backend.failAlways('commit', quotaError())
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'write-failed', error: STORAGE_MESSAGES.outOfSpace })
  })

  it('keeps going when the rescue copy cannot be written either', async () => {
    vi.stubGlobal('localStorage', {
      ...storage,
      setItem: () => {
        throw quotaError()
      },
    })
    backend.failAlways('commit')
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect(phase()).toBe('write-failed')
    backend.heal()
    actions.updateSettings({ name: 'Bo' })
    await flushSaves()
    expect(phase()).toBe('ok')
  })
})

describe('the rescue copy at load (rule 1)', () => {
  it('uses a copy based on the stored revision, saves it and then removes it', async () => {
    await seed(toRaw(sampleData()), meta(3))
    storage.setItem(LS_KEYS.rescue, JSON.stringify({ basedOnRev: 3, data: renamed('Rescued') }))
    await initStore()
    expect(getData().settings.name).toBe('Rescued')
    await flushSaves()
    expect(backend.count('commit')).toBe(1)
    expect((await storedData()).settings.name).toBe('Rescued')
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()
  })

  it('uses a copy from a first run when nothing was ever stored', async () => {
    storage.setItem(LS_KEYS.rescue, JSON.stringify({ basedOnRev: null, data: renamed('First run') }))
    await initStore()
    expect(getData().settings.name).toBe('First run')
    await flushSaves()
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 1 })
  })

  it('moves a stale copy to the quarantine', async () => {
    await seed(toRaw(sampleData()), meta(3))
    const stale = { basedOnRev: 2, data: toRaw(renamed('Stale')) }
    storage.setItem(LS_KEYS.rescue, JSON.stringify(stale))
    await initStore()
    expect(getData().settings.name).toBe('Alex')
    expect(await backend.peek(KEYS.quarantine)).toEqual(stale)
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()
    await settle()
    expect(backend.count('commit')).toBe(0)
  })

  it('moves an unreadable copy to the quarantine', async () => {
    storage.setItem(LS_KEYS.rescue, '{"basedOnRev": 3, "data"')
    await initStore()
    expect(await backend.peek(KEYS.quarantine)).toBe('{"basedOnRev": 3, "data"')
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()
  })

  it('moves a copy with unusable data to the quarantine', async () => {
    await seed(toRaw(sampleData()), meta(3))
    const unusable = { basedOnRev: 3, data: { schemaVersion: 1 } }
    storage.setItem(LS_KEYS.rescue, JSON.stringify(unusable))
    await initStore()
    expect(getData().settings.name).toBe('Alex')
    expect(await backend.peek(KEYS.quarantine)).toEqual(unusable)
  })

  it('keeps a stale copy in localStorage when the quarantine cannot be written', async () => {
    await seed(toRaw(sampleData()), meta(3))
    const stale = JSON.stringify({ basedOnRev: 1, data: toRaw(sampleData()) })
    storage.setItem(LS_KEYS.rescue, stale)
    backend.fail('set')
    await initStore()
    expect(storage.getItem(LS_KEYS.rescue)).toBe(stale)
    actions.updateSettings({ name: 'Saved' })
    await flushSaves()
    expect(storage.getItem(LS_KEYS.rescue)).toBe(stale)
  })
})

describe('conflicts (rule 5)', () => {
  beforeEach(async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
  })

  it('stops at a conflict when another window saved, leaving its data alone', async () => {
    const theirs = toRaw(renamed('Theirs'))
    await backend.inner.commit(3, [
      [KEYS.data, theirs],
      [KEYS.meta, meta(4, NOW)],
    ])
    actions.updateSettings({ name: 'Mine' })
    await flushSaves()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'conflict', error: STORAGE_MESSAGES.conflict, saving: false })
    expect(await storedData()).toEqual(theirs)

    actions.updateSettings({ name: 'Again' })
    await flushSaves()
    await settle()
    expect(backend.count('commit')).toBe(1)
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()
    expect(await storedData()).toEqual(theirs)
  })

  it('goes to conflict at once when another window announces a newer revision', async () => {
    const other = new BroadcastChannel('onabudget')
    try {
      announceFromElsewhere(other, { rev: 4 })
      await vi.waitFor(() => expect(phase()).toBe('conflict'))
    } finally {
      other.close()
    }
    actions.updateSettings({ name: 'Never saved' })
    await flushSaves()
    await settle()
    expect(backend.count('commit')).toBe(0)
  })

  it('stays in conflict when its write in flight then fails, keeping and rescuing nothing (review)', async () => {
    const release = backend.hold()
    actions.updateSettings({ name: 'Mine' })
    await settle()
    expect(backend.count('commit')).toBe(1)

    const theirs = toRaw(renamed('Theirs'))
    await backend.inner.commit(3, [
      [KEYS.data, theirs],
      [KEYS.meta, meta(4, NOW)],
    ])
    const other = new BroadcastChannel('onabudget')
    try {
      announceFromElsewhere(other, { rev: 4 })
      await vi.waitFor(() => expect(phase()).toBe('conflict'))
    } finally {
      other.close()
    }

    // The held commit fails both attempts with a storage error, not with a conflict.
    backend.fail('commit', { times: 2 })
    release()
    await flushSaves()
    await settle()
    expect(backend.count('commit')).toBe(2)
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'conflict', error: STORAGE_MESSAGES.conflict, saving: false })
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()

    actions.updateSettings({ name: 'Typed after' })
    await flushSaves()
    await settle()
    expect(phase()).toBe('conflict')
    expect(backend.count('commit')).toBe(2)
    expect(await storedData()).toEqual(theirs)
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()
  })

  it('ignores announcements of older or unreadable revisions', async () => {
    const other = new BroadcastChannel('onabudget')
    try {
      announceFromElsewhere(other, { rev: 3 })
      announceFromElsewhere(other, { rev: '9' })
      announceFromElsewhere(other, '9')
      await new Promise((resolve) => setTimeout(resolve, 30))
    } finally {
      other.close()
    }
    expect(phase()).toBe('ok')
  })

  it('announces its own saves', async () => {
    const other = new BroadcastChannel('onabudget')
    const received: unknown[] = []
    other.addEventListener('message', (event: MessageEvent<unknown>) => received.push(event.data))
    try {
      actions.updateSettings({ name: 'Ana' })
      await flushSaves()
      await vi.waitFor(() => expect(received).toEqual([{ rev: 4 }]))
    } finally {
      other.close()
    }
  })
})

describe('two clients on one backend (§9)', () => {
  it('on one memory backend, the stale client gets conflict and the stored data is unchanged', async () => {
    const shared = await sharedBackend()
    await initStore()
    const second = await openSecondWindowOn(shared)
    try {
      await second.persistence.initStore()
      expect(second.persistence.useStorageStatus.getState().phase).toBe('ok')

      actions.updateSettings({ name: 'From A' })
      await flushSaves()
      second.actions.updateSettings({ name: 'From B' })
      await second.persistence.flushSaves()

      await vi.waitFor(() => expect(second.persistence.useStorageStatus.getState().phase).toBe('conflict'))
      expect(phase()).toBe('ok')
      expect(((await shared.get(KEYS.data)) as AppData).settings.name).toBe('From A')
      expect(storedRev(await shared.get(KEYS.meta))).toBe(4)
    } finally {
      second.persistence.__resetPersistenceForTests()
    }
  })

  it('on IndexedDB, the stale window stops even before it saves', async () => {
    setKvBackend(null)
    await getKv().clear()
    await getKv().set(KEYS.data, toRaw(sampleData()))
    await getKv().set(KEYS.meta, meta(3))
    await initStore()

    const second = await openSecondWindow((db) => db.getKv())
    try {
      await second.persistence.initStore()
      expect(second.appStore.getData().settings.name).toBe('Alex')

      actions.updateSettings({ name: 'From A' })
      await flushSaves()
      await vi.waitFor(() => expect(second.persistence.useStorageStatus.getState().phase).toBe('conflict'))

      second.actions.updateSettings({ name: 'From B' })
      await second.persistence.flushSaves()
      expect(((await getKv().get(KEYS.data)) as AppData).settings.name).toBe('From A')
      expect(storedRev(await getKv().get(KEYS.meta))).toBe(4)
    } finally {
      second.persistence.__resetPersistenceForTests()
      await getKv().clear()
    }
  })

  it('stops a window that loaded the data before another window erased it, at once and for good (review)', async () => {
    const shared = await sharedBackend()
    await initStore()
    const second = await openSecondWindowOn(shared)
    try {
      await second.persistence.initStore()
      await eraseEverything()
      await vi.waitFor(() => expect(second.persistence.useStorageStatus.getState().phase).toBe('conflict'))

      for (let i = 1; i <= 3; i += 1) {
        actions.updateSettings({ name: `After erase ${i}` })
        await flushSaves()
      }
      second.actions.updateSettings({ name: 'Stale window B' })
      await second.persistence.flushSaves()
      expect(second.persistence.useStorageStatus.getState().phase).toBe('conflict')
      expect(((await shared.get(KEYS.data)) as AppData).settings.name).toBe('After erase 3')
      expect(storedRev(await shared.get(KEYS.meta))).toBe(7)
      expect(phase()).toBe('ok')
    } finally {
      second.persistence.__resetPersistenceForTests()
    }
  })

  it('keeps revisions going after an erase and a relaunch, so a window that heard nothing stops at its save (review)', async () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const shared = await sharedBackend()
    await initStore()
    const second = await openSecondWindowOn(shared)
    try {
      await second.persistence.initStore()
      await eraseEverything()
      // Closed and opened again before anything new was saved.
      __resetPersistenceForTests()
      await initStore()
      expect(getData()).toEqual(firstRunData(NOW))

      for (let i = 1; i <= 3; i += 1) {
        actions.updateSettings({ name: `After erase ${i}` })
        await flushSaves()
      }
      expect(second.persistence.useStorageStatus.getState().phase).toBe('ok')
      second.actions.updateSettings({ name: 'Stale window B' })
      await second.persistence.flushSaves()
      expect(second.persistence.useStorageStatus.getState().phase).toBe('conflict')
      expect(((await shared.get(KEYS.data)) as AppData).settings.name).toBe('After erase 3')
      expect(storedRev(await shared.get(KEYS.meta))).toBe(7)
    } finally {
      second.persistence.__resetPersistenceForTests()
    }
  })

  it('goes on from the newest stored revision when the erasing window was behind (review)', async () => {
    const shared = await sharedBackend()
    await initStore()
    const second = await openSecondWindowOn(shared)
    try {
      await second.persistence.initStore()
      second.actions.updateSettings({ name: 'From B' })
      await second.persistence.flushSaves()
      await vi.waitFor(() => expect(phase()).toBe('conflict'))

      // This window still holds revision 3; the stored data is at 4.
      await eraseEverything()
      expect(phase()).toBe('ok')
      await vi.waitFor(() => expect(second.persistence.useStorageStatus.getState().phase).toBe('conflict'))
      second.actions.updateSettings({ name: 'Stale window B' })
      await second.persistence.flushSaves()
      expect(await shared.get(KEYS.data)).toBeUndefined()
      expect(storedRev(await shared.get(KEYS.meta))).toBe(5)

      actions.updateSettings({ name: 'After erase' })
      await flushSaves()
      expect(((await shared.get(KEYS.data)) as AppData).settings.name).toBe('After erase')
      expect(storedRev(await shared.get(KEYS.meta))).toBe(6)
    } finally {
      second.persistence.__resetPersistenceForTests()
    }
  })
})

describe('automatic copies (rule 6)', () => {
  it('copies the previous day’s data before the first save of a new day', async () => {
    const yesterday = NOW - DAY
    await seed(toRaw(sampleData()), meta(3, yesterday))
    await initStore()
    actions.updateSettings({ name: 'Today' })
    await flushSaves()
    expect(backend.commits()[0]?.map(([key]) => key)).toEqual(['snap:2026-10-13', KEYS.data, KEYS.meta])
    expect(await backend.peek('snap:2026-10-13')).toEqual({ savedAt: yesterday, data: toRaw(sampleData()) })

    actions.updateSettings({ name: 'Later today' })
    await flushSaves()
    expect(backend.commits()[1]?.map(([key]) => key)).toEqual([KEYS.data, KEYS.meta])
  })

  it('copies data as stored, also when the load repaired it', async () => {
    const raw = toRaw(sampleData())
    ;(raw.settings as Record<string, unknown>).theme = 'neon'
    await seed(raw, meta(3, NOW - 2 * DAY))
    await initStore()
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect(await backend.peek('snap:2026-10-12')).toEqual({ savedAt: NOW - 2 * DAY, data: raw })
  })

  it('keeps the newest seven daily copies and every other copy', async () => {
    await backend.inner.set(SNAPSHOT_KEYS.preImport, { savedAt: NOW - 30 * DAY, data: toRaw(makeData()) })
    await initStore()
    for (let day = 0; day < 10; day += 1) {
      vi.setSystemTime(NOW + day * DAY)
      actions.updateSettings({ name: `Day ${day}` })
      await flushSaves()
    }
    const keys = await backend.peekKeys()
    expect(keys.filter((key) => key.startsWith('snap:'))).toEqual([
      'snap:2026-10-16',
      'snap:2026-10-17',
      'snap:2026-10-18',
      'snap:2026-10-19',
      'snap:2026-10-20',
      'snap:2026-10-21',
      'snap:2026-10-22',
      SNAPSHOT_KEYS.preImport,
    ])
    const lastCopy = (await backend.peek('snap:2026-10-22')) as { data: AppData }
    expect(lastCopy.data.settings.name).toBe('Day 8')
  })

  it('lists copies newest first with their labels and entry counts', async () => {
    await seed(toRaw(sampleData()), meta(3))
    const endOfMonday = Date.UTC(2026, 9, 12, 20)
    await backend.inner.set('snap:2026-10-12', { savedAt: endOfMonday, data: toRaw(sampleData()) })
    await backend.inner.set(SNAPSHOT_KEYS.preImport, { savedAt: NOW - 1000, data: toRaw(makeData()) })
    await backend.inner.set(SNAPSHOT_KEYS.preRestore, { savedAt: NOW - 2000, data: toRaw(makeData()) })
    await backend.inner.set('snap:pre-v1', { savedAt: NOW - 5 * DAY, data: { transactions: [1, 2] } })
    await backend.inner.set('snap:2026-10-11', 'not a copy record')
    await backend.inner.set('snapshot', { savedAt: NOW, data: {} })
    await initStore()
    expect(await listSnapshots()).toEqual([
      { key: SNAPSHOT_KEYS.preImport, label: 'Before import', savedAt: NOW - 1000, transactions: 0 },
      { key: SNAPSHOT_KEYS.preRestore, label: 'Before restore', savedAt: NOW - 2000, transactions: 0 },
      { key: 'snap:2026-10-12', label: 'End of Mon 12 Oct', savedAt: endOfMonday, transactions: 9 },
      { key: 'snap:pre-v1', label: 'Before update', savedAt: NOW - 5 * DAY, transactions: 2 },
    ])

    actions.updateSettings({ locale: 'en-US' })
    expect((await listSnapshots()).find(({ key }) => key === 'snap:2026-10-12')?.label).toBe('End of Mon, Oct 12')
  })

  it('imports: flush, copy to snap:pre-import, replace, save', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    actions.updateSettings({ name: 'Unsaved' })
    const beforeImport = getData()
    const imported = renamed('Imported', makeData())

    await importData(imported)
    expect(getData()).toBe(imported)
    expect(await storedData()).toEqual(imported)
    expect(await backend.peek(SNAPSHOT_KEYS.preImport)).toEqual({ savedAt: NOW, data: toRaw(beforeImport) })
    expect(writeLog()).toEqual(['commit', SNAPSHOT_KEYS.preImport, 'commit'])
    expect(phase()).toBe('ok')
  })

  it('imports on a first run without a copy of the empty data', async () => {
    await initStore()
    await importData(sampleData())
    expect(await backend.peek(SNAPSHOT_KEYS.preImport)).toBeUndefined()
    expect(await storedData()).toEqual(sampleData())
  })

  it('replaces nothing when the copy before an import cannot be written', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    const before = getData()
    backend.fail('set')
    await expect(importData(makeData())).rejects.toThrow('set failed')
    expect(getData()).toBe(before)
  })

  it('imports into memory when saving is off, and refuses while storage is blocked', async () => {
    backend.failAlways('get')
    await initStore()
    await expect(importData(sampleData())).rejects.toThrow("The app can't save right now, so nothing was replaced.")
    continueWithoutSaving()
    const data = sampleData()
    await importData(data)
    expect(getData()).toBe(data)
    expect(backend.writes()).toBe(0)
  })

  it('restores a copy after copying the current data to snap:pre-restore', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await backend.inner.set('snap:2026-10-12', { savedAt: NOW - 2 * DAY, data: toRaw(renamed('Older')) })
    await initStore()
    await restoreSnapshot('snap:2026-10-12')
    expect(getData().settings.name).toBe('Older')
    expect(await storedData()).toEqual(getData())
    expect(await backend.peek(SNAPSHOT_KEYS.preRestore)).toEqual({ savedAt: NOW, data: toRaw(sampleData()) })

    // The copy taken before the restore can itself be restored (undoing the restore).
    await restoreSnapshot(SNAPSHOT_KEYS.preRestore)
    expect(getData().settings.name).toBe('Alex')
    expect(((await backend.peek(SNAPSHOT_KEYS.preRestore)) as { data: AppData }).data.settings.name).toBe('Older')
  })

  it('rejects restoring what is no copy, a missing copy and a damaged copy', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await backend.inner.set('snap:2026-10-10', { savedAt: NOW - 4 * DAY, data: { nope: true } })
    await initStore()
    const before = getData()
    await expect(restoreSnapshot(KEYS.data)).rejects.toBeInstanceOf(RangeError)
    await expect(restoreSnapshot('snap:2026-01-01')).rejects.toBeInstanceOf(DataError)
    await expect(restoreSnapshot('snap:2026-10-10')).rejects.toBeInstanceOf(DataError)
    expect(getData()).toBe(before)
  })
})

describe('leaving the damaged phase', () => {
  const damaged = { schemaVersion: 1, settings: {}, categories: 'broken' }

  it('starts fresh, keeping the quarantine and saving the fresh data', async () => {
    await seed(damaged, meta(3))
    await initStore()
    expect(phase()).toBe('damaged')
    vi.setSystemTime(NOW + 1000)
    await startFresh()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', error: null })
    expect(getData()).toEqual(firstRunData(NOW + 1000))
    expect(await backend.peek(KEYS.quarantine)).toEqual(damaged)
    expect(await storedData()).toEqual(getData())
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 4 })

    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect((await storedData()).settings.name).toBe('Ana')
  })

  it('writes the quarantine before overwriting when that failed during the load', async () => {
    await seed(damaged, meta(3))
    backend.fail('set')
    await initStore()
    expect(await backend.peek(KEYS.quarantine)).toBeUndefined()
    await startFresh()
    expect(await backend.peek(KEYS.quarantine)).toEqual(damaged)
    expect(writeLog()).toEqual([KEYS.quarantine, KEYS.quarantine, 'commit'])
  })

  it('restores the newest copy instead', async () => {
    await seed(damaged, meta(3))
    await backend.inner.set('snap:2026-10-13', { savedAt: NOW - DAY, data: toRaw(sampleData()) })
    await initStore()
    const [newest] = await listSnapshots()
    expect(newest?.key).toBe('snap:2026-10-13')
    await restoreSnapshot('snap:2026-10-13')
    expect(phase()).toBe('ok')
    expect(getData()).toEqual(sampleData())
    expect(await storedData()).toEqual(sampleData())
    expect(await backend.peek(KEYS.quarantine)).toEqual(damaged)
    expect(await backend.peek(SNAPSHOT_KEYS.preRestore)).toBeUndefined()
  })

  it('uses a rescue copy based on the damaged revision, keeping the damaged original in the quarantine (review)', async () => {
    await seed(damaged, meta(3))
    storage.setItem(LS_KEYS.rescue, JSON.stringify({ basedOnRev: 3, data: toRaw(renamed('Rescued')) }))
    await initStore()
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', error: null })
    expect(getData().settings.name).toBe('Rescued')
    await flushSaves()
    expect((await storedData()).settings.name).toBe('Rescued')
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 4 })
    expect(await backend.peek(KEYS.quarantine)).toEqual(damaged)
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()

    // The next launch loads the rescued data and leaves the quarantine alone.
    __resetPersistenceForTests()
    await initStore()
    expect(getData().settings.name).toBe('Rescued')
    expect(await backend.peek(KEYS.quarantine)).toEqual(damaged)
  })

  it('writes the damaged original to the quarantine with the rescued data when that failed during the load', async () => {
    await seed(damaged, meta(3))
    storage.setItem(LS_KEYS.rescue, JSON.stringify({ basedOnRev: 3, data: toRaw(renamed('Rescued')) }))
    backend.fail('set')
    await initStore()
    await flushSaves()
    // The failed write during the load was the only one outside a save.
    expect(writeLog()).toEqual([KEYS.quarantine, 'commit'])
    expect(backend.commits()[0]?.map(([key]) => key)).toEqual([KEYS.quarantine, KEYS.data, KEYS.meta])
    expect(await backend.peek(KEYS.quarantine)).toEqual(damaged)
    expect((await storedData()).settings.name).toBe('Rescued')
  })

  it.each([
    ['a stale rescue copy', 'startFresh', { basedOnRev: 2, data: toRaw(renamed('Stale')) }],
    ['an unusable rescue copy', 'restoreSnapshot', { basedOnRev: 3, data: { schemaVersion: 1 } }],
  ] as const)('keeps the damaged original in the quarantine through %s, %s and a relaunch (review)', async (_name, leave, copy) => {
    await seed(damaged, meta(3))
    await backend.inner.set('snap:2026-10-13', { savedAt: NOW - DAY, data: toRaw(sampleData()) })
    const rescue = JSON.stringify(copy)
    storage.setItem(LS_KEYS.rescue, rescue)
    await initStore()
    expect(phase()).toBe('damaged')
    expect(await backend.peek(KEYS.quarantine)).toEqual(damaged)
    expect(storage.getItem(LS_KEYS.rescue)).toBe(rescue)

    await (leave === 'startFresh' ? startFresh() : restoreSnapshot('snap:2026-10-13'))
    expect(phase()).toBe('ok')
    // The first save of the new data disposes of the copy.
    expect(storage.getItem(LS_KEYS.rescue)).toBeNull()

    __resetPersistenceForTests()
    await initStore()
    expect(phase()).toBe('ok')
    expect(await backend.peek(KEYS.quarantine)).toEqual(damaged)
  })

  it('exports the raw stored value', async () => {
    await seed(damaged, meta(3))
    await initStore()
    expect(await exportRawData()).toBe(JSON.stringify(damaged, null, 2))
  })

  it('rejects startFresh in any other phase', async () => {
    await initStore()
    await expect(startFresh()).rejects.toThrow('Only damaged data can be replaced with a fresh start.')
  })
})

describe('exportRawData', () => {
  it('is null when nothing is stored', async () => {
    expect(await exportRawData()).toBeNull()
  })

  it('falls back to the quarantine', async () => {
    await backend.inner.set(KEYS.quarantine, { kept: true })
    expect(await exportRawData()).toBe('{\n  "kept": true\n}')
  })

  it('writes BigInt values and cycles as text', async () => {
    const cyclic: Record<string, unknown> = { n: 10n }
    cyclic.self = cyclic
    await backend.inner.set(KEYS.data, cyclic)
    const json = (await exportRawData()) ?? ''
    expect(JSON.parse(json)).toEqual({ n: '10', self: '[Circular]' })
  })
})

describe('persisted storage (rule 7)', () => {
  it('asks once, after the first successful save, while storage is not persisted', async () => {
    const persist = vi.fn<() => Promise<boolean>>(async () => true)
    vi.stubGlobal('navigator', { language: 'de-DE', storage: { persisted: async () => false, persist } })
    await initStore()
    await settle()
    expect(useStorageStatus.getState().persisted).toBe(false)
    expect(persist).not.toHaveBeenCalled()

    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    await settle()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(useStorageStatus.getState().persisted).toBe(true)

    actions.updateSettings({ name: 'Bo' })
    await flushSaves()
    await settle()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('asks only once per launch, also when the answer is no', async () => {
    const persist = vi.fn<() => Promise<boolean>>(async () => false)
    vi.stubGlobal('navigator', { language: 'de-DE', storage: { persisted: async () => false, persist } })
    await initStore()
    for (const name of ['A', 'B', 'C']) {
      actions.updateSettings({ name })
      await flushSaves()
      await settle()
    }
    expect(persist).toHaveBeenCalledTimes(1)
    expect(useStorageStatus.getState().persisted).toBe(false)
  })

  it('never asks when storage is persisted already', async () => {
    const persist = vi.fn<() => Promise<boolean>>(async () => true)
    vi.stubGlobal('navigator', { language: 'de-DE', storage: { persisted: async () => true, persist } })
    await initStore()
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    await settle()
    expect(useStorageStatus.getState().persisted).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('stays unknown without the storage API', async () => {
    vi.stubGlobal('navigator', { language: 'de-DE' })
    await initStore()
    await settle()
    expect(useStorageStatus.getState().persisted).toBeNull()
    expect(getData().settings.locale).toBe('de-DE')
  })
})

describe('eraseEverything (rule 8)', () => {
  it('deletes everything stored and starts over without saving', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await backend.inner.set(KEYS.security, { ...createDefaultSecurity(), pinHash: 'hash', pinSalt: 'salt' })
    await backend.inner.set('snap:2026-10-12', { savedAt: NOW - 2 * DAY, data: toRaw(sampleData()) })
    await backend.inner.set(KEYS.quarantine, 'old')
    storage.setItem(LS_KEYS.draft, '{}')
    storage.setItem(LS_KEYS.onboardingStep, '3')
    storage.setItem('another-app:key', 'keep')
    await initStore()
    await initSecurity()
    expect(useSecurityStore.getState().locked).toBe(true)
    useUiStore.setState({ amountsRevealed: true })

    vi.setSystemTime(NOW + 1000)
    await eraseEverything()
    // Only the revision marker stays: no data, copies, quarantine or security settings.
    expect(await backend.peekKeys()).toEqual([KEYS.meta])
    expect(await backend.peek(KEYS.meta)).toEqual(meta(4, NOW + 1000))
    expect(storage.getItem(LS_KEYS.draft)).toBeNull()
    expect(storage.getItem(LS_KEYS.onboardingStep)).toBeNull()
    expect(storage.getItem(LS_KEYS.theme)).toBeNull()
    expect(storage.getItem('another-app:key')).toBe('keep')
    expect(getData()).toEqual(firstRunData(NOW + 1000))
    expect(useSecurityStore.getState()).toMatchObject({
      config: createDefaultSecurity(),
      status: 'ready',
      locked: false,
      unlockedOnce: true,
    })
    expect(useUiStore.getState().amountsRevealed).toBe(false)
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', error: null, droppedOnLoad: 0, saving: false })

    await settle()
    expect(await backend.peekKeys()).toEqual([KEYS.meta])

    // Revisions go on from the marker instead of starting over.
    actions.updateSettings({ name: 'New start' })
    await flushSaves()
    expect(backend.calls.filter((call) => call.op === 'commit').at(-1)?.args[0]).toBe(4)
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 5 })
  })

  it('leaves nothing behind when a save was scheduled just before (§9)', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    actions.addTransaction({ kind: 'expense', amount: 350, categoryId: 'cat-coffee', date: '2026-10-14' })
    await eraseEverything()
    await flushSaves()
    await settle()
    // No data and no trace of the save: only the revision marker.
    expect(await backend.peekKeys()).toEqual([KEYS.meta])
    expect(await backend.peek(KEYS.meta)).toEqual(meta(4, NOW))
    expect(backend.count('commit')).toBe(0)
  })

  it('waits for the write in flight, then clears', async () => {
    await initStore()
    const release = backend.hold()
    actions.updateSettings({ name: 'In flight' })
    await settle()
    const erasing = eraseEverything()
    release()
    await erasing
    // The write in flight landed as revision 1, so the marker is 2.
    expect(await backend.peekKeys()).toEqual([KEYS.meta])
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 2 })
    expect(backend.calls.map(({ op }) => op).filter((op) => op === 'commit' || op === 'clear')).toEqual(['commit', 'clear'])
  })

  it('announces the erase, so windows still showing the erased data stop at once', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    const other = new BroadcastChannel('onabudget')
    const received: unknown[] = []
    other.addEventListener('message', (event: MessageEvent<unknown>) => received.push(event.data))
    try {
      await eraseEverything()
      await vi.waitFor(() => expect(received).toEqual([{ rev: 4 }]))
    } finally {
      other.close()
    }
  })

  it('erases also when the stored revision cannot be read, going on from its own', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    backend.fail('get')
    await eraseEverything()
    expect(await backend.peekKeys()).toEqual([KEYS.meta])
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 4 })
  })

  it('erases also when the revision marker cannot be written; revisions then start over', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    backend.fail('set')
    await eraseEverything()
    expect(await backend.peekKeys()).toEqual([])
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', error: null })

    actions.updateSettings({ name: 'New start' })
    await flushSaves()
    expect(backend.calls.filter((call) => call.op === 'commit').at(-1)?.args[0]).toBeNull()
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 1 })
  })

  it('saves changes made while the revision marker is written, on top of it', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    const writeMarker = holdEraseMarker()
    const erasing = eraseEverything()
    // The data is reset as soon as the store is cleared, while the marker is still being written.
    await vi.waitFor(() => expect(getData().settings.name).toBe(''))
    expect(backend.count('clear')).toBe(1)
    actions.updateSettings({ name: 'Right away' })
    await settle()
    expect(backend.count('commit')).toBe(0)

    writeMarker()
    await erasing
    await flushSaves()
    expect(backend.commits()).toHaveLength(1)
    expect((await storedData()).settings.name).toBe('Right away')
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 5 })
  })

  it('ignores announcements of saves from before the erase that arrive while the marker is written', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    const writeMarker = holdEraseMarker()
    const erasing = eraseEverything()
    await vi.waitFor(() => expect(getData().settings.name).toBe(''))
    const other = new BroadcastChannel('onabudget')
    try {
      announceFromElsewhere(other, { rev: 3 })
      await new Promise((resolve) => setTimeout(resolve, 30))
    } finally {
      other.close()
    }
    writeMarker()
    await erasing
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', error: null })
  })

  it('imports after an erase without a copy of the empty data', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    await eraseEverything()
    await importData(renamed('Imported', makeData()))
    expect(await backend.peek(SNAPSHOT_KEYS.preImport)).toBeUndefined()
    expect((await storedData()).settings.name).toBe('Imported')
    expect(await backend.peek(KEYS.meta)).toMatchObject({ rev: 5 })
  })

  it('changes nothing but the error when clearing fails, and saving goes on', async () => {
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    backend.fail('clear')
    actions.updateSettings({ name: 'Kept' })
    const before = getData()
    await expect(eraseEverything()).rejects.toThrow(STORAGE_MESSAGES.eraseFailed)
    expect(useStorageStatus.getState()).toMatchObject({ phase: 'ok', error: STORAGE_MESSAGES.eraseFailed })
    expect(getData()).toBe(before)
    await flushSaves()
    expect((await storedData()).settings.name).toBe('Kept')
    // The message stays for the erase sheet; a later successful erase clears it.
    expect(useStorageStatus.getState().error).toBe(STORAGE_MESSAGES.eraseFailed)
    await eraseEverything()
    expect(useStorageStatus.getState().error).toBeNull()
  })

  it('starts over with saving on from a blocking phase', async () => {
    await seed({ schemaVersion: 1 }, meta(3))
    await initStore()
    expect(phase()).toBe('damaged')
    await eraseEverything()
    expect(phase()).toBe('ok')
    actions.updateSettings({ name: 'Ana' })
    await flushSaves()
    expect((await storedData()).settings.name).toBe('Ana')
  })
})

describe('theme mirror (rule 9)', () => {
  it('mirrors theme and accent to localStorage on load and on change', async () => {
    const { settings } = sampleData()
    await seed(toRaw(sampleData()), meta(3))
    await initStore()
    expect(storage.getItem(LS_KEYS.theme)).toBe(settings.theme)
    expect(storage.getItem(LS_KEYS.accent)).toBe(settings.accent)

    const accent = ACCENTS.find(({ key }) => key !== settings.accent)?.key ?? settings.accent
    actions.updateSettings({ theme: 'light', accent })
    expect(storage.getItem(LS_KEYS.theme)).toBe('light')
    expect(storage.getItem(LS_KEYS.accent)).toBe(accent)
  })

  it('mirrors the defaults on a first run', async () => {
    await initStore()
    const { settings } = firstRunData(NOW)
    expect(storage.getItem(LS_KEYS.theme)).toBe(settings.theme)
    expect(storage.getItem(LS_KEYS.accent)).toBe(settings.accent)
  })
})
