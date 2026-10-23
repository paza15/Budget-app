import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests } from '@/app/nav'
import { makeData, makeTransaction, NOW } from '@/domain/test-helpers/dataFixtures'
import { exportBackup, exportCsv, importWithConfirm, type SaveResult } from '@/features/you/backupIO'
import { BackupScreen } from '@/features/you/BackupScreen'
import { useAppStore } from '@/store/appStore'
import { listSnapshots, restoreSnapshot, useStorageStatus, type SnapshotInfo } from '@/store/persistence'
import { ConfirmHost } from '@/ui'
import { currentToast, dismissToast } from '@/ui/toast'

vi.mock('@/features/you/backupIO', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/you/backupIO')>()
  return {
    ...actual,
    exportBackup: vi.fn<typeof actual.exportBackup>(),
    exportCsv: vi.fn<typeof actual.exportCsv>(),
    importWithConfirm: vi.fn<typeof actual.importWithConfirm>(),
  }
})
vi.mock('@/store/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/persistence')>()
  return {
    ...actual,
    listSnapshots: vi.fn<typeof actual.listSnapshots>(),
    restoreSnapshot: vi.fn<typeof actual.restoreSnapshot>(),
  }
})

const DAY = 86_400_000

const DAILY_COPY: SnapshotInfo = { key: 'snap:2026-10-13', label: 'End of Tue 13 Oct', savedAt: NOW - DAY, transactions: 214 }
const IMPORT_COPY: SnapshotInfo = { key: 'snap:pre-import', label: 'Before import', savedAt: NOW - 2 * DAY, transactions: 1 }

function show() {
  return render(
    <>
      <BackupScreen />
      <ConfirmHost />
    </>,
  )
}

/** A promise the test settles by hand, to look at the screen while a call is pending. */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  useAppStore.setState({
    data: makeData({
      transactions: [makeTransaction({ id: 'a' }), makeTransaction({ id: 'b' })],
      settings: { ...makeData().settings, lastBackupAt: NOW - 3 * DAY },
    }),
    status: 'ready',
  })
  useStorageStatus.setState({ phase: 'ok', persisted: true })
  vi.mocked(listSnapshots).mockResolvedValue([DAILY_COPY, IMPORT_COPY])
  vi.mocked(restoreSnapshot).mockResolvedValue()
  vi.mocked(exportBackup).mockResolvedValue('downloaded')
  vi.mocked(exportCsv).mockResolvedValue('downloaded')
  vi.mocked(importWithConfirm).mockResolvedValue(true)
  __resetNavForTests()
})

afterEach(() => {
  cleanup()
  const toast = currentToast()
  if (toast !== null) dismissToast(toast.id)
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  useStorageStatus.setState(useStorageStatus.getInitialState(), true)
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('BackupScreen (docs/SPEC.md §3.7)', () => {
  it('says when the last backup was, or that there is none', () => {
    const { unmount } = show()
    expect(screen.getByRole('heading', { name: 'Backup', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Last backup 3 days ago.')).toBeInTheDocument()
    unmount()

    useAppStore.setState({ data: makeData() })
    const { unmount: unmountNever } = show()
    expect(screen.getByText('Last backup never.')).toBeInTheDocument()
    unmountNever()

    // Right after an export (e2e/backup.spec.ts reads "Last backup just now").
    useAppStore.setState({ data: makeData({ settings: { ...makeData().settings, lastBackupAt: NOW } }) })
    show()
    expect(screen.getByText('Last backup just now.')).toBeInTheDocument()
  })

  it('exports a backup straight from the tap and says so, with the actions waiting meanwhile', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const saving = deferred<SaveResult>()
    vi.mocked(exportBackup).mockReturnValue(saving.promise)
    show()
    const exportButton = screen.getByRole('button', { name: 'Export backup' })
    await user.click(exportButton)
    expect(exportBackup).toHaveBeenCalledTimes(1)
    expect(exportButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export spending as CSV' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import backup' })).toBeDisabled()

    await act(async () => saving.resolve('shared'))
    expect(currentToast()).toMatchObject({ message: 'Backup exported', tone: 'success' })
    expect(exportButton).toBeEnabled()
  })

  it('says nothing when the share sheet was cancelled, and tells a failed export', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(exportBackup).mockResolvedValueOnce('cancelled')
    show()
    await user.click(screen.getByRole('button', { name: 'Export backup' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export backup' })).toBeEnabled())
    expect(currentToast()).toBeNull()

    vi.mocked(exportBackup).mockRejectedValueOnce(new Error('Out of memory'))
    await user.click(screen.getByRole('button', { name: 'Export backup' }))
    await waitFor(() => expect(currentToast()).toMatchObject({ tone: 'critical' }))
    expect(currentToast()?.message).toMatch(/^Couldn't export a backup\./)
  })

  it('exports the spending as CSV with its footnote', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    expect(screen.getByText('For spreadsheets. To keep everything, use Export backup.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Export spending as CSV' }))
    expect(exportCsv).toHaveBeenCalledTimes(1)
    expect(exportBackup).not.toHaveBeenCalled()
    await waitFor(() => expect(currentToast()).toMatchObject({ message: 'Spending exported as CSV' }))
  })

  it('imports the file chosen in the hidden backup-file-input, then lists the new copy', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    const input = screen.getByTestId('backup-file-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await user.click(screen.getByRole('button', { name: 'Import backup' }))
    expect(click).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(listSnapshots).toHaveBeenCalledTimes(1))
    const file = new File(['{}'], 'on-a-budget-backup-2026-10-14.json')
    fireEvent.change(input, { target: { files: [file] } })
    expect(importWithConfirm).toHaveBeenCalledWith(file)
    await waitFor(() => expect(listSnapshots).toHaveBeenCalledTimes(2))
  })

  it('lists the automatic copies, newest first, each with Restore', async () => {
    show()
    const daily = await screen.findByRole('button', { name: 'Restore End of Tue 13 Oct' })
    expect(screen.getByRole('heading', { name: 'Automatic copies on this iPhone' })).toBeInTheDocument()
    expect(screen.getByText('214 entries')).toBeInTheDocument()
    expect(screen.getByText('Before import, 12 Oct')).toBeInTheDocument()
    expect(screen.getByText('1 entry')).toBeInTheDocument()
    expect(daily).toHaveTextContent('Restore')
  })

  it('restores a copy after asking, with Undo', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await user.click(await screen.findByRole('button', { name: 'Restore End of Tue 13 Oct' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Restore this copy?' })
    expect(dialog).toHaveTextContent('“End of Tue 13 Oct” has 214 entries.')
    expect(dialog).toHaveTextContent('This iPhone has 2 entries now.')
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(restoreSnapshot).toHaveBeenCalledWith('snap:2026-10-13'))
    await waitFor(() => expect(currentToast()).toMatchObject({ message: 'Copy restored' }))
    expect(currentToast()?.action?.label).toBe('Undo')
    await waitFor(() => expect(listSnapshots).toHaveBeenCalledTimes(2))
  })

  it('tells when a copy cannot be restored', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(restoreSnapshot).mockRejectedValue(new Error('write failed'))
    show()
    await user.click(await screen.findByRole('button', { name: 'Restore End of Tue 13 Oct' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Restore this copy?' })
    await user.click(within(dialog).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(currentToast()).toMatchObject({ tone: 'critical' }))
    expect(currentToast()?.message).toMatch(/^Couldn't restore this copy, so nothing was replaced\./)
  })

  it('says when there are no copies yet, or when they cannot be read', async () => {
    vi.mocked(listSnapshots).mockResolvedValueOnce([])
    const { unmount } = show()
    expect(await screen.findByText('No copies yet.')).toBeInTheDocument()
    unmount()

    vi.mocked(listSnapshots).mockRejectedValueOnce(new Error('read failed'))
    show()
    expect(await screen.findByText(/Couldn't read the automatic copies\./)).toBeInTheDocument()
  })

  it('says whether iOS may clear the data, and where the entries live', () => {
    const { unmount } = show()
    expect(screen.getByText('Protected from automatic cleanup')).toBeInTheDocument()
    expect(screen.getByText(/^Your entries live only in this Home Screen app\./)).toBeInTheDocument()
    unmount()

    useStorageStatus.setState({ persisted: false })
    show()
    expect(screen.getByText('Not protected:')).toBeInTheDocument()
    expect(screen.getByText(/iOS may remove the app's data when storage runs low\. Keep a recent backup\./)).toBeInTheDocument()
  })
})
