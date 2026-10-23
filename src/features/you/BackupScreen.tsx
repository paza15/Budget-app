import { useRef, useState } from 'react'
import { useNav } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { formatRelativeTime } from '@/domain/dates'
import { DataError } from '@/domain/normalize'
import {
  BackupFileInput,
  exportBackup,
  exportCsv,
  IMPORT_UNDO_MS,
  importWithConfirm,
  type SaveResult,
} from '@/features/you/backupIO'
import { entriesPhrase } from '@/features/you/data/importMessage'
import { NoteRow } from '@/features/you/data/NoteRow'
import { snapshotSubtitle, snapshotTitle, useSnapshots } from '@/features/you/data/snapshots'
import { StatusRow } from '@/features/you/data/StatusRow'
import { StorageProtection } from '@/features/you/data/StorageProtection'
import { useNow } from '@/features/you/data/useNow'
import { getData } from '@/store/appStore'
import { useData } from '@/store/hooks'
import { restoreSnapshot, type SnapshotInfo } from '@/store/persistence'
import { Button, confirmDialog, ListRow, Screen, Section, toast } from '@/ui'

const PRIVACY_FOOTER =
  'Your entries live only in this Home Screen app. Removing it from your Home Screen deletes them, and a new install starts empty. Backups and CSV files are plain text: anyone with the file can read it. Keep them in your own iCloud Drive or Files.'

const RESTORE_FAILED_MESSAGE =
  "Couldn't restore this copy, so nothing was replaced. Close the app completely, open it again and try again."

/**
 * You → Backup (docs/SPEC.md §3.7): export a backup or the spending as CSV, import a backup,
 * restore an automatic copy, and how safe the data is right now. Exports build their file inside
 * the tap, so the share sheet opens from the tap itself (§5.7).
 */
export function BackupScreen() {
  const lastBackupAt = useData((d) => d.settings.lastBackupAt)
  const locale = useData((d) => d.settings.locale)
  const now = useNow()
  // An export, an import or a restore is running: every action waits until it is done.
  const [busy, setBusy] = useState(false)
  const { snapshots, reload: reloadSnapshots } = useSnapshots()
  const fileInput = useRef<HTMLInputElement>(null)

  const exportFile = (kind: 'backup' | 'csv'): void => {
    if (busy) return
    // First thing in the tap: the file is built and handed to the share sheet before any await.
    const saving: Promise<SaveResult> = kind === 'backup' ? exportBackup() : exportCsv()
    setBusy(true)
    saving
      .then(
        (result) => {
          if (result === 'cancelled') return
          toast({ message: kind === 'backup' ? 'Backup exported' : 'Spending exported as CSV', tone: 'success' })
        },
        () => {
          const what = kind === 'backup' ? 'a backup' : 'the CSV file'
          toast({ message: `Couldn't export ${what}. Close the app completely, open it again and try again.`, tone: 'critical' })
        },
      )
      .finally(() => setBusy(false))
  }

  const importFile = (file: File): void => {
    if (busy) return
    setBusy(true)
    importWithConfirm(file)
      .then((imported) => {
        // The import kept the old data as an automatic copy ("Before import").
        if (imported) reloadSnapshots()
      })
      .finally(() => setBusy(false))
  }

  const restore = async (copy: SnapshotInfo): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const title = snapshotTitle(copy, locale)
      const confirmed = await confirmDialog({
        title: 'Restore this copy?',
        message: `“${title}” has ${entriesPhrase(copy.transactions)}. It replaces everything on this iPhone, settings and categories too. This iPhone has ${entriesPhrase(getData().transactions.length)} now.`,
        confirmLabel: 'Restore',
        destructive: true,
      })
      if (!confirmed) return
      await withUndo('Copy restored', () => restoreSnapshot(copy.key), { durationMs: IMPORT_UNDO_MS })
      // The restore kept the data it replaced as a copy ("Before restore").
      reloadSnapshots()
    } catch (error) {
      toast({ message: error instanceof DataError ? error.message : RESTORE_FAILED_MESSAGE, tone: 'critical' })
    } finally {
      setBusy(false)
    }
  }

  const lastBackup = `Last backup ${lastBackupAt === null ? 'never' : formatRelativeTime(lastBackupAt, now)}.`

  return (
    <Screen title="Backup" largeTitle onBack={() => useNav.getState().pop()} backLabel="You">
      <Section footer={lastBackup}>
        <ListRow title="Export backup" tinted disabled={busy} onClick={() => exportFile('backup')} />
      </Section>

      <Section footer="For spreadsheets. To keep everything, use Export backup.">
        <ListRow title="Export spending as CSV" tinted disabled={busy} onClick={() => exportFile('csv')} />
      </Section>

      <Section footer="Replaces everything on this iPhone with the backup you choose. The app lock stays as it is.">
        <ListRow title="Import backup" tinted disabled={busy} onClick={() => fileInput.current?.click()} />
      </Section>
      <BackupFileInput ref={fileInput} onFile={importFile} />

      {snapshots.status !== 'loading' && (
        <Section
          variant="form"
          title="Automatic copies on this iPhone"
          footer="The app keeps a copy at the end of each of the last 7 days you used it, and one before each import or restore. Copies stay on this iPhone, so keep exporting backups too."
        >
          {snapshots.status === 'failed' ? (
            <StatusRow tone="warning">
              {"Couldn't read the automatic copies. Close the app completely and open it again."}
            </StatusRow>
          ) : snapshots.copies.length === 0 ? (
            <NoteRow>No copies yet.</NoteRow>
          ) : (
            snapshots.copies.map((copy) => {
              const title = snapshotTitle(copy, locale)
              return (
                <ListRow
                  key={copy.key}
                  title={title}
                  subtitle={snapshotSubtitle(copy)}
                  trailing={
                    <Button
                      variant="plain"
                      size="sm"
                      disabled={busy}
                      aria-label={`Restore ${title}`}
                      onClick={() => void restore(copy)}
                    >
                      Restore
                    </Button>
                  }
                />
              )
            })
          )}
        </Section>
      )}

      <Section variant="form" title="Storage" footer={PRIVACY_FOOTER}>
        <StorageProtection />
      </Section>
    </Screen>
  )
}
