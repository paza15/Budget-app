import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_ERROR_MESSAGES, createBackup, parseBackup, serializeBackup } from '@/domain/backup'
import { CURRENT_SCHEMA_VERSION } from '@/domain/defaults'
import { DataError } from '@/domain/normalize'
import { makeData, makeRecurring, makeTransaction, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import {
  BackupFileInput,
  exportBackup,
  exportCsv,
  IMPORT_FAILED_MESSAGE,
  importWithConfirm,
  READ_FAILED_MESSAGE,
  readBackupFile,
  REVOKE_AFTER_MS,
  saveFile,
} from '@/features/you/backupIO'
import { SYSTEM_SHEET_GRACE_MS } from '@/features/you/data/systemSheet'
import { getData, useAppStore } from '@/store/appStore'
import { importData } from '@/store/persistence'
import { useUiStore } from '@/store/uiStore'
import { answerDialog, currentDialog, removeDialog, type DialogRequest } from '@/ui/dialogs'
import { currentToast, dismissToast } from '@/ui/toast'

vi.mock('@/store/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/persistence')>()
  return { ...actual, importData: vi.fn<typeof actual.importData>() }
})

const HOUR = 3_600_000
/** When the backups in these tests were exported: an hour before NOW. */
const EXPORTED_AT = NOW - HOUR

interface ShareStub {
  share: ReturnType<typeof vi.fn<(data: ShareData) => Promise<void>>>
  canShare: ReturnType<typeof vi.fn<(data?: ShareData) => boolean>>
}

/** navigator.share and canShare, which jsdom lacks. */
function stubShare(share: (data: ShareData) => Promise<void>, canShare = true): ShareStub {
  const stub: ShareStub = {
    share: vi.fn<(data: ShareData) => Promise<void>>(share),
    canShare: vi.fn<(data?: ShareData) => boolean>(() => canShare),
  }
  Object.defineProperty(navigator, 'share', { value: stub.share, configurable: true, writable: true })
  Object.defineProperty(navigator, 'canShare', { value: stub.canShare, configurable: true, writable: true })
  return stub
}

function sharedFile(stub: ShareStub): File {
  const file = stub.share.mock.calls[0]?.[0].files?.[0]
  if (file === undefined) throw new Error('Nothing was shared')
  return file
}

function abortError(): Error {
  const error = new Error('The user cancelled the share.')
  error.name = 'AbortError'
  return error
}

/** Links clicked to download, as they were at the click. */
let downloads: { href: string; download: string; inPage: boolean }[] = []

function backupData(): AppData {
  return makeData({
    transactions: [makeTransaction({ id: 'tx-a' }), makeTransaction({ id: 'tx-b', amount: 1290, note: 'Pizza' })],
    recurring: [makeRecurring({ id: 'rent' })],
    settings: { ...makeData().settings, name: 'Sam', onboarded: true, lastBackupAt: null },
  })
}

function backupFile(data: AppData = backupData(), o: { type?: string; exportedAt?: number } = {}): File {
  const text = serializeBackup(createBackup(data, o.exportedAt ?? EXPORTED_AT))
  return new File([text], 'on-a-budget-backup-2026-10-14.json', { type: o.type ?? '' })
}

/** The open confirmation, once importWithConfirm has read the file and asked. */
async function waitForDialog(): Promise<DialogRequest> {
  return vi.waitFor(() => {
    const dialog = currentDialog()
    if (dialog === null || dialog.closing) throw new Error('No dialog yet')
    return dialog
  })
}

/** Answers the dialog and takes it off the queue (ConfirmHost would after its exit). */
function answer(dialog: DialogRequest, yes: boolean): void {
  answerDialog(dialog.id, yes)
  removeDialog(dialog.id)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  const old = NOW - 2 * HOUR
  useAppStore.setState({
    data: makeData({ transactions: [makeTransaction({ id: 'here-1', createdAt: old, updatedAt: old })] }),
    status: 'ready',
  })
  vi.mocked(importData).mockImplementation((data) => {
    useAppStore.setState({ data })
    return Promise.resolve()
  })
  downloads = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, download: this.download, inPage: this.isConnected })
  })
  // jsdom has no object URLs.
  const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:on-a-budget/1')
  const revokeObjectURL = vi.fn<(url: string) => void>()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  const dialog = currentDialog()
  if (dialog !== null) answer(dialog, false)
  const toast = currentToast()
  if (toast !== null) dismissToast(toast.id)
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
  useUiStore.setState({ systemSheetOpen: false })
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('saveFile (docs/SPEC.md §5.7)', () => {
  it('hands the file to the share sheet, and only the file, when it can take files', async () => {
    const stub = stubShare(() => Promise.resolve())
    const file = new File(['{}'], 'a.json', { type: 'application/json' })
    const saving = saveFile(file)
    // Called before saveFile's first await, so it still belongs to the tap.
    expect(stub.share).toHaveBeenCalledWith({ files: [file] })
    expect(stub.canShare).toHaveBeenCalledWith({ files: [file] })
    expect(useUiStore.getState().systemSheetOpen).toBe(true)

    await expect(saving).resolves.toBe('shared')
    expect(downloads).toEqual([])
    // The flag outlives the sheet by a moment, so its closing never counts as a resume.
    expect(useUiStore.getState().systemSheetOpen).toBe(true)
    vi.advanceTimersByTime(SYSTEM_SHEET_GRACE_MS)
    expect(useUiStore.getState().systemSheetOpen).toBe(false)
  })

  it('resolves cancelled when the share sheet is dismissed, without downloading', async () => {
    stubShare(() => Promise.reject(abortError()))
    await expect(saveFile(new File(['{}'], 'a.json'))).resolves.toBe('cancelled')
    expect(downloads).toEqual([])
    vi.advanceTimersByTime(SYSTEM_SHEET_GRACE_MS)
    expect(useUiStore.getState().systemSheetOpen).toBe(false)
  })

  it('downloads instead when sharing fails for another reason', async () => {
    const notAllowed = new Error('No user activation')
    notAllowed.name = 'NotAllowedError'
    stubShare(() => Promise.reject(notAllowed))
    await expect(saveFile(new File(['{}'], 'a.json'))).resolves.toBe('downloaded')
    expect(downloads).toEqual([{ href: 'blob:on-a-budget/1', download: 'a.json', inPage: true }])
  })

  it('downloads through a temporary link when the share sheet cannot take files, and revokes the URL after 60 s', async () => {
    stubShare(() => Promise.resolve(), false)
    const file = new File(['date\r\n'], 'on-a-budget-spending-2026-10-14.csv', { type: 'text/csv' })
    await expect(saveFile(file)).resolves.toBe('downloaded')

    expect(navigator.share).not.toHaveBeenCalled()
    expect(URL.createObjectURL).toHaveBeenCalledWith(file)
    expect(downloads).toEqual([{ href: 'blob:on-a-budget/1', download: 'on-a-budget-spending-2026-10-14.csv', inPage: true }])
    expect(document.querySelector('a[download]')).toBeNull()
    expect(useUiStore.getState().systemSheetOpen).toBe(false)

    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:on-a-budget/1')
  })

  it('downloads where the browser has no share sheet at all', async () => {
    await expect(saveFile(new File(['{}'], 'a.json'))).resolves.toBe('downloaded')
    expect(downloads).toHaveLength(1)
  })
})

describe('exportBackup and exportCsv (docs/SPEC.md §3.7, §4.7)', () => {
  it('builds the dated backup file in the tap and shares it before any await', async () => {
    const stub = stubShare(() => Promise.resolve())
    const data = getData()
    const exporting = exportBackup()
    expect(stub.share).toHaveBeenCalledTimes(1)

    const file = sharedFile(stub)
    expect(file.name).toBe('on-a-budget-backup-2026-10-14.json')
    expect(file.type).toBe('application/json')
    const parsed = parseBackup(await file.text(), NOW)
    expect(parsed.exportedAt).toBe(new Date(NOW).toISOString())
    expect(parsed.data).toEqual(data)

    await expect(exporting).resolves.toBe('shared')
    expect(getData().settings.lastBackupAt).toBe(NOW)
  })

  it('marks the backup done after a download too', async () => {
    await expect(exportBackup()).resolves.toBe('downloaded')
    expect(downloads[0]?.download).toBe('on-a-budget-backup-2026-10-14.json')
    expect(getData().settings.lastBackupAt).toBe(NOW)
  })

  it('leaves the last backup alone when the share sheet is cancelled', async () => {
    stubShare(() => Promise.reject(abortError()))
    const before = getData()
    await expect(exportBackup()).resolves.toBe('cancelled')
    expect(getData()).toBe(before)
    expect(getData().settings.lastBackupAt).toBeNull()
  })

  it('leaves the last backup alone when the export fails', async () => {
    stubShare(() => Promise.resolve(), false)
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new Error('Out of memory')
    })
    await expect(exportBackup()).rejects.toThrow('Out of memory')
    expect(getData().settings.lastBackupAt).toBeNull()
  })

  it('exports every entry as a dated CSV file without marking a backup', async () => {
    useAppStore.setState({ data: backupData() })
    const stub = stubShare(() => Promise.resolve())
    await expect(exportCsv()).resolves.toBe('shared')
    const file = sharedFile(stub)
    expect(file.name).toBe('on-a-budget-spending-2026-10-14.csv')
    expect(file.type).toBe('text/csv')
    // UTF-8 with a byte order mark, so Excel and Numbers read the accents (Blob.text() drops the mark).
    expect([...new Uint8Array(await file.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = await file.text()
    expect(text.startsWith('date,type,category,note,amount,currency')).toBe(true)
    expect(text.split('\r\n')).toHaveLength(2 + 2)
    expect(getData().settings.lastBackupAt).toBeNull()
  })
})

describe('readBackupFile (docs/SPEC.md §4.7)', () => {
  it('reads a backup whatever type the system reports', async () => {
    const data = backupData()
    for (const type of ['', 'text/plain', 'application/octet-stream', 'application/json']) {
      const parsed = await readBackupFile(backupFile(data, { type }))
      expect(parsed.data).toEqual(data)
      expect(parsed.exportedAt).toBe(new Date(EXPORTED_AT).toISOString())
    }
  })

  it('reads a backup that an editor saved with a byte order mark', async () => {
    const text = `\u{FEFF}${serializeBackup(createBackup(backupData(), EXPORTED_AT))}`
    const parsed = await readBackupFile(new File([text], 'backup.json'))
    expect(parsed.data.transactions).toHaveLength(2)
  })

  it('rejects a file of another app or format as not a backup', async () => {
    for (const text of ['{"hello":"world"}', 'date,type,category\r\n', '']) {
      const error = await readBackupFile(new File([text], 'notes.json')).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(DataError)
      expect(error).toMatchObject({ code: 'not-backup', message: BACKUP_ERROR_MESSAGES['not-backup'] })
    }
  })

  it('rejects a damaged backup: cut short, or with data that cannot be used', async () => {
    const full = serializeBackup(createBackup(backupData(), EXPORTED_AT))
    const cutShort = new File([full.slice(0, full.length / 2)], 'backup.json')
    await expect(readBackupFile(cutShort)).rejects.toMatchObject({ code: 'damaged', message: BACKUP_ERROR_MESSAGES.damaged })

    const wrecked = JSON.stringify({ app: 'on-a-budget', kind: 'backup', schemaVersion: 1, exportedAt: 'soon', data: {} })
    await expect(readBackupFile(new File([wrecked], 'backup.json'))).rejects.toMatchObject({ code: 'damaged' })
  })

  it('rejects a backup from a newer version of the app', async () => {
    const backup = createBackup(backupData(), EXPORTED_AT)
    const newer = { ...backup, schemaVersion: CURRENT_SCHEMA_VERSION + 1, data: { ...backup.data, schemaVersion: CURRENT_SCHEMA_VERSION + 1 } }
    await expect(readBackupFile(new File([JSON.stringify(newer)], 'backup.json'))).rejects.toMatchObject({
      code: 'newer-version',
      message: BACKUP_ERROR_MESSAGES['newer-version'],
    })
  })

  it('says it could not open a file it cannot read', async () => {
    const file = new File(['{}'], 'backup.json')
    Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('NotReadableError')) })
    const error = await readBackupFile(file).catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(DataError)
    expect(error).toMatchObject({ message: READ_FAILED_MESSAGE })
  })

  it('does not read a file far bigger than any backup', async () => {
    const file = new File(['{}'], 'video.json')
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 })
    const text = vi.spyOn(file, 'text')
    await expect(readBackupFile(file)).rejects.toMatchObject({ code: 'not-backup' })
    expect(text).not.toHaveBeenCalled()
  })
})

describe('importWithConfirm (docs/SPEC.md §3.7)', () => {
  it('asks first, then replaces everything and offers Undo for 10 seconds', async () => {
    const before = getData()
    const importing = importWithConfirm(backupFile())
    const dialog = await waitForDialog()
    expect(dialog.kind).toBe('confirm')
    expect(dialog.options).toMatchObject({
      title: 'Replace everything on this iPhone?',
      confirmLabel: 'Replace',
      destructive: true,
    })
    expect(dialog.options.message).toBe(
      'The backup from 14 Oct has 2 entries and 1 fixed cost or income item. This iPhone has 1 entry. Settings and categories are replaced too.',
    )
    expect(importData).not.toHaveBeenCalled()

    answer(dialog, true)
    await expect(importing).resolves.toBe(true)
    expect(importData).toHaveBeenCalledTimes(1)
    expect(getData().settings.name).toBe('Sam')
    expect(getData().transactions.map((tx) => tx.id)).toEqual(['tx-a', 'tx-b'])

    const toast = currentToast()
    expect(toast).toMatchObject({ message: 'Backup restored', leaving: false })
    expect(toast?.action?.label).toBe('Undo')
    vi.advanceTimersByTime(9999)
    expect(currentToast()?.leaving).toBe(false)
    toast?.action?.onClick()
    expect(getData()).toEqual(before)
  })

  it('offers Undo for exactly 10 seconds', async () => {
    const importing = importWithConfirm(backupFile())
    answer(await waitForDialog(), true)
    await importing
    vi.advanceTimersByTime(9999)
    expect(currentToast()?.leaving).toBe(false)
    vi.advanceTimersByTime(1)
    expect(currentToast()?.leaving).toBe(true)
  })

  it('counts the last backup from the export, so the restored data is not due a backup', async () => {
    const importing = importWithConfirm(backupFile())
    answer(await waitForDialog(), true)
    await importing
    expect(getData().settings.lastBackupAt).toBe(EXPORTED_AT)
  })

  it('keeps onboarding open when onboarding restores the backup', async () => {
    const data = backupData()
    expect(data.settings.onboarded).toBe(true)
    const importing = importWithConfirm(backupFile(data), { continueOnboarding: true })
    answer(await waitForDialog(), true)
    await expect(importing).resolves.toBe(true)
    expect(getData().settings.onboarded).toBe(false)
    expect(getData().transactions).toHaveLength(2)
  })

  it('changes nothing when the user says no', async () => {
    const before = getData()
    const importing = importWithConfirm(backupFile())
    answer(await waitForDialog(), false)
    await expect(importing).resolves.toBe(false)
    expect(importData).not.toHaveBeenCalled()
    expect(getData()).toBe(before)
    expect(currentToast()).toBeNull()
  })

  it('tells what is wrong with a foreign or damaged file, without asking', async () => {
    await expect(importWithConfirm(new File(['{"hello":"world"}'], 'notes.json'))).resolves.toBe(false)
    expect(currentToast()).toMatchObject({ message: BACKUP_ERROR_MESSAGES['not-backup'], tone: 'critical' })

    const full = serializeBackup(createBackup(backupData(), EXPORTED_AT))
    await expect(importWithConfirm(new File([full.slice(0, 200)], 'backup.json'))).resolves.toBe(false)
    expect(currentToast()).toMatchObject({ message: BACKUP_ERROR_MESSAGES.damaged, tone: 'critical' })

    expect(currentDialog()).toBeNull()
    expect(importData).not.toHaveBeenCalled()
  })

  it('says nothing was replaced when the import fails', async () => {
    const before = getData()
    vi.mocked(importData).mockRejectedValue(new Error("The app can't save right now, so nothing was replaced."))
    const importing = importWithConfirm(backupFile())
    answer(await waitForDialog(), true)
    await expect(importing).resolves.toBe(false)
    expect(getData()).toBe(before)
    expect(currentToast()).toMatchObject({ message: IMPORT_FAILED_MESSAGE, tone: 'critical' })
  })
})

describe('BackupFileInput (docs/SPEC.md §5.7, §9)', () => {
  it('is a hidden file input for JSON files with the backup-file-input test id', () => {
    const ref = createRef<HTMLInputElement>()
    render(<BackupFileInput ref={ref} onFile={() => {}} />)
    const input = screen.getByTestId('backup-file-input')
    expect(ref.current).toBe(input)
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', '.json,application/json')
    expect(input).toHaveAttribute('tabindex', '-1')
    expect(input).toHaveClass('visually-hidden')
  })

  it('hands over the chosen file and can take the same file again', () => {
    const onFile = vi.fn<(file: File) => void>()
    render(<BackupFileInput onFile={onFile} data-testid="restore-input" />)
    const input = screen.getByTestId('restore-input') as HTMLInputElement
    const file = backupFile()
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFile).toHaveBeenCalledWith(file)
    expect(input.value).toBe('')
  })

  it('keeps systemSheetOpen up while the picker is open, until a file or a cancel', () => {
    render(<BackupFileInput onFile={() => {}} />)
    const input = screen.getByTestId('backup-file-input')

    fireEvent.click(input)
    expect(useUiStore.getState().systemSheetOpen).toBe(true)
    fireEvent.change(input, { target: { files: [backupFile()] } })
    expect(useUiStore.getState().systemSheetOpen).toBe(true)
    act(() => vi.advanceTimersByTime(SYSTEM_SHEET_GRACE_MS))
    expect(useUiStore.getState().systemSheetOpen).toBe(false)

    fireEvent.click(input)
    expect(useUiStore.getState().systemSheetOpen).toBe(true)
    fireEvent(input, new Event('cancel'))
    act(() => vi.advanceTimersByTime(SYSTEM_SHEET_GRACE_MS))
    expect(useUiStore.getState().systemSheetOpen).toBe(false)
  })

  it('lowers systemSheetOpen when the window gets its focus back without an answer', () => {
    render(<BackupFileInput onFile={() => {}} />)
    fireEvent.click(screen.getByTestId('backup-file-input'))
    expect(useUiStore.getState().systemSheetOpen).toBe(true)
    fireEvent.focus(window)
    act(() => vi.advanceTimersByTime(1000 + SYSTEM_SHEET_GRACE_MS))
    expect(useUiStore.getState().systemSheetOpen).toBe(false)
  })
})
