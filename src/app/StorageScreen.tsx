import { useEffect, useState, type ReactNode } from 'react'
import { Mark } from '@/app/Mark'
import { APP_ID } from '@/domain/constants'
import { formatDate, localDateOf } from '@/domain/dates'
import { applyUpdate, usePwaStore } from '@/features/pwa/sw'
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
  type SnapshotInfo,
} from '@/store/persistence'
import { Button, confirmDialog } from '@/ui'
import styles from './StorageScreen.module.css'

/**
 * Replaces the app while storage cannot be used (docs/SPEC.md §3.10): read-failed, newer-version,
 * damaged or conflict, each with what happened and the way out. Nothing is saved meanwhile.
 */
export function StorageScreen() {
  const phase = useStorageStatus((s) => s.phase)
  switch (phase) {
    case 'read-failed':
      return <ReadFailed />
    case 'newer-version':
      return (
        <Layout phase={phase} title="This data was saved by a newer version of the app." message="Reload to update.">
          <ReloadButton update />
        </Layout>
      )
    case 'damaged':
      return <Damaged />
    case 'conflict':
      return (
        <Layout phase={phase} title="The app was changed in another window." message="Reload to see the latest version.">
          <ReloadButton />
        </Layout>
      )
    default:
      return null
  }
}

interface LayoutProps {
  phase: string
  title: string
  message: string
  /** What went wrong with the last attempt, shown under the message. */
  error?: string | null
  children?: ReactNode
}

function Layout({ phase, title, message, error = null, children }: LayoutProps) {
  return (
    <main className={styles.screen} data-testid="storage-screen" data-phase={phase}>
      <div className={styles.body}>
        <Mark size={64} className={styles.mark} />
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.message}>{message}</p>
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={styles.actions}>{children}</div>
    </main>
  )
}

function ReloadButton({ update = false }: { update?: boolean }) {
  const updateReady = usePwaStore((s) => s.updateReady)
  const reload = (): void => {
    // A waiting new version has to be activated, or the reload brings back this one.
    if (update && updateReady) applyUpdate().catch(() => window.location.reload())
    else window.location.reload()
  }
  return (
    <Button variant="primary" size="lg" block onClick={reload}>
      Reload
    </Button>
  )
}

function ReadFailed() {
  return (
    <Layout phase="read-failed" title="The app couldn't open your data." message="Close it completely and open it again.">
      <Button variant="primary" size="lg" block onClick={() => void initStore()}>
        Try again
      </Button>
      <Button variant="plain" size="lg" block onClick={continueWithoutSaving}>
        Use without saving
      </Button>
    </Layout>
  )
}

/** The newest automatic copy, null without one; undefined while the copies are being read. */
function useNewestCopy(): SnapshotInfo | null | undefined {
  const [copy, setCopy] = useState<SnapshotInfo | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    listSnapshots().then(
      (copies) => {
        if (current) setCopy(copies.at(0) ?? null)
      },
      () => {
        if (current) setCopy(null)
      },
    )
    return () => {
      current = false
    }
  }, [])
  return copy
}

/** The raw stored value, read ahead so "Export raw data" can share it straight from the tap. */
function useRawData(): string | null {
  const [raw, setRaw] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    exportRawData().then(
      (text) => {
        if (current) setRaw(text)
      },
      () => {
        if (current) setRaw(null)
      },
    )
    return () => {
      current = false
    }
  }, [])
  return raw
}

function Damaged() {
  const copy = useNewestCopy()
  const raw = useRawData()
  const locale = useAppStore((s) => s.data.settings.locale)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restoreFailed, setRestoreFailed] = useState(false)

  const restore = async (key: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await restoreSnapshot(key)
    } catch {
      setRestoreFailed(true)
      setError("This copy couldn't be restored. Export the raw data, then start fresh.")
    } finally {
      setBusy(false)
    }
  }

  const exportRaw = (): void => {
    if (raw === null) return
    // Built and handed over in the tap itself, so the share sheet counts as started by the user.
    const name = `${APP_ID}-raw-${localDateOf(Date.now())}.json`
    saveFile(new File([raw], name, { type: 'application/json' })).catch(() =>
      setError("Couldn't export the raw data. Close the app completely and try again."),
    )
  }

  const startOver = async (): Promise<void> => {
    const confirmed = await confirmDialog({
      title: 'Start fresh?',
      message: 'This replaces the damaged data with an empty app. Export the raw data first if you might need it.',
      confirmLabel: 'Start fresh',
      destructive: true,
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      await startFresh()
    } catch {
      setError("Couldn't start fresh. Close the app completely and try again.")
      setBusy(false)
    }
  }

  if (copy === undefined) return <Layout phase="damaged" title="The app's data is damaged." message="Looking for an automatic copy…" />

  if (copy !== null && !restoreFailed) {
    const date = formatDate(localDateOf(copy.savedAt), locale, 'short')
    return (
      <Layout phase="damaged" title="The app's data is damaged." message="Restore the newest automatic copy to carry on." error={error}>
        <Button variant="primary" size="lg" block disabled={busy} onClick={() => void restore(copy.key)}>
          {`Restore copy from ${date}`}
        </Button>
      </Layout>
    )
  }

  return (
    <Layout
      phase="damaged"
      title="The app's data is damaged."
      message={
        copy === null
          ? "There's no automatic copy to restore. Export the raw data to keep it, then start fresh."
          : 'Export the raw data to keep it, then start fresh.'
      }
      error={error}
    >
      <Button variant="secondary" size="lg" block disabled={busy || raw === null} onClick={exportRaw}>
        Export raw data
      </Button>
      <Button variant="destructive" size="lg" block disabled={busy} onClick={() => void startOver()}>
        Start fresh
      </Button>
    </Layout>
  )
}
