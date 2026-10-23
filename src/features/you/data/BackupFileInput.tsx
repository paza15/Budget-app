import { useEffect, useImperativeHandle, useRef, type ChangeEvent, type Ref } from 'react'
import { holdSystemSheet } from '@/features/you/data/systemSheet'

export interface BackupFileInputProps {
  /** Called with the chosen file; choosing the same file again calls it again. */
  onFile(file: File): void
  /** Default "backup-file-input" (docs/SPEC.md §9). */
  'data-testid'?: string
  /** The input element, so a button can open the system file picker: `ref.current?.click()`. */
  ref?: Ref<HTMLInputElement>
}

/**
 * When the picker reports neither a file nor a cancel, the window getting its focus back ends the
 * system sheet; the change event may still follow, so the release waits this long.
 */
const FOCUS_RELEASE_DELAY_MS = 1000

/**
 * The hidden file input that picks a backup (docs/SPEC.md §3.7, §5.7). It is invisible and out of
 * the tab order: a visible button opens it with `ref.current.click()` from its tap handler, and
 * e2e tests set its files directly. It accepts JSON files, though readBackupFile never trusts the
 * file's type. While the system picker is open, systemSheetOpen keeps the auto-lock from locking.
 *
 * It is visually hidden rather than display: none, because iOS may refuse to open the picker of an
 * input that is not rendered.
 */
export function BackupFileInput({ onFile, 'data-testid': testId = 'backup-file-input', ref }: BackupFileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  /** Ends the current hold on systemSheetOpen; null while the picker is closed. */
  const releaseRef = useRef<(() => void) | null>(null)

  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, [])

  // The picker's "cancel" event has no React prop on inputs, so it is a native listener. Unmounting
  // ends a hold that is still open.
  useEffect(() => {
    const input = inputRef.current
    const onCancel = (): void => endHold(releaseRef)
    input?.addEventListener('cancel', onCancel)
    return () => {
      input?.removeEventListener('cancel', onCancel)
      endHold(releaseRef)
    }
  }, [])

  const onClick = (): void => {
    endHold(releaseRef)
    const release = holdSystemSheet()
    releaseRef.current = release
    // Browsers without the cancel event: the window gets its focus back when the picker closes.
    // Releasing twice does nothing, so a change or cancel that comes first is fine.
    window.addEventListener('focus', () => setTimeout(release, FOCUS_RELEASE_DELAY_MS), { once: true })
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    endHold(releaseRef)
    const input = event.currentTarget
    const file = input.files?.[0]
    // Cleared, so picking the same file again (after fixing it, or after cancelling) fires again.
    input.value = ''
    if (file !== undefined) onFile(file)
  }

  return (
    <input
      ref={inputRef}
      type="file"
      accept=".json,application/json"
      className="visually-hidden"
      tabIndex={-1}
      aria-hidden="true"
      data-testid={testId}
      onClick={onClick}
      onChange={onChange}
    />
  )
}

function endHold(releaseRef: { current: (() => void) | null }): void {
  releaseRef.current?.()
  releaseRef.current = null
}
