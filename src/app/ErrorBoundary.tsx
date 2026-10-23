import { Component, useState, type ReactNode } from 'react'
import { exportBackupFromShell } from '@/app/backupAction'
import { useSecurityStore } from '@/store/securityStore'
import styles from './ErrorBoundary.module.css'

export interface ErrorBoundaryProps {
  /**
   * app: the whole app, offers Reload. screen: one screen, offers Go back (Reload for a tab root,
   * which has nowhere to go back to). sheet: one sheet, offers Close. silent: shows nothing, for
   * optional extras such as banners.
   */
  level: 'app' | 'screen' | 'sheet' | 'silent'
  /** Go back (screen) or close (sheet) from the fallback. */
  onDismiss?: () => void
  children?: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * Catches render errors below it and shows a fallback that never includes error text or data
 * (docs/SPEC.md §3.10). React already reports the error to the console.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  override render() {
    if (!this.state.failed) return this.props.children
    const { level, onDismiss } = this.props
    if (level === 'silent') return null
    return <ErrorFallback level={level} onDismiss={onDismiss} />
  }
}

function reload(): void {
  window.location.reload()
}

interface ErrorFallbackProps {
  level: 'app' | 'screen' | 'sheet'
  onDismiss?: () => void
}

/**
 * Plain elements and the module's own styles only: the fallback must still render when the UI
 * kit is what failed.
 */
function ErrorFallback({ level, onDismiss }: ErrorFallbackProps) {
  const locked = useSecurityStore((s) => s.locked)
  const [exporting, setExporting] = useState(false)

  const exportNow = async (): Promise<void> => {
    setExporting(true)
    await exportBackupFromShell()
    setExporting(false)
  }

  const dismissLabel = level === 'sheet' ? 'Close' : 'Go back'
  const primary =
    level !== 'app' && onDismiss !== undefined ? { label: dismissLabel, onClick: onDismiss } : { label: 'Reload', onClick: reload }

  return (
    <div role="alert" className={styles.fallback} data-level={level}>
      <p className={styles.title}>Something went wrong.</p>
      <p className={styles.message}>Your entries are still saved on this iPhone.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={primary.onClick}>
          {primary.label}
        </button>
        {!locked && (
          <button type="button" className={styles.secondary} disabled={exporting} onClick={() => void exportNow()}>
            Export backup
          </button>
        )}
      </div>
    </div>
  )
}
