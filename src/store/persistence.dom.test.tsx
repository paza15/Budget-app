import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LS_KEYS } from '@/domain/constants'
import { NOW, sampleData, toRaw } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { actions } from '@/store/actions'
import { KEYS, setKvBackend } from '@/store/db'
import { __resetPersistenceForTests, flushSaves, initStore, useStorageStatus } from '@/store/persistence'
import { createTestBackend, type TestBackend } from '@/store/test-helpers/backends'

let backend: TestBackend

function saveState(): string | undefined {
  return document.documentElement.dataset.saveState
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

async function storedName(): Promise<string> {
  return ((await backend.peek(KEYS.data)) as AppData).settings.name
}

/** Leaves the store with a change that failed to save and is still pending. */
async function failOneChange(name: string): Promise<void> {
  backend.failAlways('commit')
  actions.updateSettings({ name })
  await flushSaves()
  expect(useStorageStatus.getState().phase).toBe('write-failed')
  backend.heal()
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetPersistenceForTests()
  localStorage.clear()
  backend = createTestBackend()
  setKvBackend(backend)
  await backend.inner.set(KEYS.data, toRaw(sampleData()))
  await backend.inner.set(KEYS.meta, { rev: 3, savedAt: NOW - 1000, schemaVersion: 1 })
})

afterEach(() => {
  __resetPersistenceForTests()
  setKvBackend(null)
  Reflect.deleteProperty(document, 'visibilityState')
  localStorage.clear()
  vi.useRealTimers()
})

describe('data-save-state on the root element (rule 10)', () => {
  it('follows loading, saving, failing and recovering', async () => {
    expect(saveState()).toBeUndefined()
    await initStore()
    expect(saveState()).toBe('saved')

    actions.updateSettings({ name: 'Ana' })
    expect(saveState()).toBe('saving')
    await flushSaves()
    expect(saveState()).toBe('saved')

    await failOneChange('Bo')
    expect(saveState()).toBe('error')
    actions.updateSettings({ name: 'Cy' })
    await flushSaves()
    expect(saveState()).toBe('saved')
  })

  it('says error while storage is blocked', async () => {
    backend.failAlways('get')
    await initStore()
    expect(saveState()).toBe('error')
  })

  it('is removed between test sessions', async () => {
    await initStore()
    __resetPersistenceForTests()
    expect(saveState()).toBeUndefined()
  })
})

describe('page lifecycle', () => {
  it('saves what is pending when the page is hidden', async () => {
    await initStore()
    await failOneChange('Hidden')
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(useStorageStatus.getState().phase).toBe('ok'))
    expect(await storedName()).toBe('Hidden')
  })

  it('saves what is pending on pagehide', async () => {
    await initStore()
    await failOneChange('Closing')
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(useStorageStatus.getState().phase).toBe('ok'))
    expect(await storedName()).toBe('Closing')
  })

  it('retries a failed write when the page becomes visible again', async () => {
    await initStore()
    await failOneChange('Back')
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(useStorageStatus.getState().phase).toBe('ok'))
    expect(await storedName()).toBe('Back')
    expect(localStorage.getItem(LS_KEYS.rescue)).toBeNull()
  })

  it('stops listening after a reset', async () => {
    await initStore()
    await failOneChange('Ignored')
    __resetPersistenceForTests()
    const commits = backend.count('commit')
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(backend.count('commit')).toBe(commits)
  })
})
