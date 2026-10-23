import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageScreen } from '@/app/StorageScreen'
import { makeData, NOW } from '@/domain/test-helpers/dataFixtures'
import { saveFile } from '@/features/you/backupIO'
import { useAppStore } from '@/store/appStore'
import {
  continueWithoutSaving,
  exportRawData,
  initStore,
  listSnapshots,
  restoreSnapshot,
  startFresh,
  useStorageStatus,
  type StoragePhase,
} from '@/store/persistence'
import { ConfirmHost } from '@/ui'

vi.mock('@/store/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/persistence')>()
  return {
    ...actual,
    initStore: vi.fn<typeof actual.initStore>(() => Promise.resolve()),
    continueWithoutSaving: vi.fn<typeof actual.continueWithoutSaving>(),
    listSnapshots: vi.fn<typeof actual.listSnapshots>(() => Promise.resolve([])),
    restoreSnapshot: vi.fn<typeof actual.restoreSnapshot>(() => Promise.resolve()),
    startFresh: vi.fn<typeof actual.startFresh>(() => Promise.resolve()),
    exportRawData: vi.fn<typeof actual.exportRawData>(() => Promise.resolve('{"raw":true}')),
  }
})
vi.mock('@/features/you/backupIO', () => ({
  saveFile: vi.fn<(file: File) => Promise<'shared' | 'downloaded' | 'cancelled'>>(() => Promise.resolve('downloaded')),
}))

const COPY = { key: 'snap:2026-10-12', label: 'End of Mon 12 Oct', savedAt: NOW - 2 * 86_400_000, transactions: 42 }

function show(phase: StoragePhase) {
  useStorageStatus.setState({ phase })
  return render(
    <>
      <StorageScreen />
      <ConfirmHost />
    </>,
  )
}

beforeEach(() => {
  vi.mocked(listSnapshots).mockResolvedValue([])
  vi.mocked(restoreSnapshot).mockResolvedValue()
  vi.mocked(saveFile).mockClear()
  useAppStore.setState({ data: makeData(), status: 'ready' })
})

afterEach(() => {
  cleanup()
  useStorageStatus.setState(useStorageStatus.getInitialState(), true)
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('StorageScreen (docs/SPEC.md §3.10)', () => {
  it('lets the user try again or carry on without saving after a failed read', async () => {
    const user = userEvent.setup()
    show('read-failed')
    expect(screen.getByRole('heading', { name: "The app couldn't open your data." })).toBeInTheDocument()
    expect(screen.getByText('Close it completely and open it again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(initStore).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Use without saving' }))
    expect(continueWithoutSaving).toHaveBeenCalledTimes(1)
  })

  it('asks for a reload when a newer version saved the data, or another window changed it', () => {
    const { unmount } = show('newer-version')
    expect(screen.getByRole('heading', { name: 'This data was saved by a newer version of the app.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    unmount()

    show('conflict')
    expect(screen.getByRole('heading', { name: 'The app was changed in another window.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('offers the newest automatic copy of damaged data', async () => {
    const user = userEvent.setup()
    vi.mocked(listSnapshots).mockResolvedValue([COPY])
    show('damaged')
    const restore = await screen.findByRole('button', { name: 'Restore copy from 12 Oct' })
    await user.click(restore)
    expect(restoreSnapshot).toHaveBeenCalledWith('snap:2026-10-12')
  })

  it('falls back to exporting the raw data when the copy cannot be restored', async () => {
    const user = userEvent.setup()
    vi.mocked(listSnapshots).mockResolvedValue([COPY])
    vi.mocked(restoreSnapshot).mockRejectedValueOnce(new Error('damaged'))
    show('damaged')
    await user.click(await screen.findByRole('button', { name: /^Restore copy from/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent("This copy couldn't be restored.")
    expect(screen.getByRole('button', { name: 'Export raw data' })).toBeInTheDocument()
  })

  it('exports the raw data or starts fresh after asking, when there is no copy', async () => {
    const user = userEvent.setup()
    show('damaged')
    expect(await screen.findByText(/There's no automatic copy to restore/)).toBeInTheDocument()
    const exportRaw = screen.getByRole('button', { name: 'Export raw data' })
    await waitFor(() => expect(exportRaw).toBeEnabled())
    expect(exportRawData).toHaveBeenCalled()
    await user.click(exportRaw)
    const file = vi.mocked(saveFile).mock.calls[0]?.[0]
    expect(file?.name).toMatch(/^on-a-budget-raw-\d{4}-\d{2}-\d{2}\.json$/)
    expect(await file?.text()).toBe('{"raw":true}')

    await user.click(screen.getByRole('button', { name: 'Start fresh' }))
    const question = await screen.findByRole('alertdialog', { name: 'Start fresh?' })
    await user.click(within(question).getByRole('button', { name: 'Start fresh' }))
    await waitFor(() => expect(startFresh).toHaveBeenCalledTimes(1))
  })
})
