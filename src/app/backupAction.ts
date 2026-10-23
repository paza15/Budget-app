import { exportBackup } from '@/features/you/backupIO'
import { toast } from '@/ui'

/**
 * "Export backup" from shell surfaces (error fallbacks, the storage and nudge banners). Call it
 * first thing in the tap handler: exportBackup builds the file synchronously, so the share sheet
 * still counts as started by the tap (docs/SPEC.md §3.7). Toasts the outcome; never rejects.
 * exportBackup itself marks the backup done for 'shared' and 'downloaded'.
 */
export async function exportBackupFromShell(): Promise<void> {
  try {
    const result = await exportBackup()
    if (result !== 'cancelled') toast({ message: 'Backup exported', tone: 'success' })
  } catch {
    toast({ message: "Couldn't export a backup. Try again from Backup in Settings.", tone: 'critical' })
  }
}
