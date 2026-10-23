import type { FormEvent } from 'react'
import styles from '@/features/you/data/EraseForm.module.css'
import { Button, Section, TextField } from '@/ui'

function dismissKeyboard(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault()
  const focused = document.activeElement
  if (focused instanceof HTMLElement && event.currentTarget.contains(focused)) focused.blur()
}

export interface EraseFormProps {
  /** "This deletes your entries, … Last backup: 3 days ago." */
  message: string
  typed: string
  onTypedChange(value: string): void
  /** The field says "erase". */
  canErase: boolean
  /** An export or the erase is running: every button waits. */
  busy: boolean
  /** Why the last erase failed, shown as an alert under the buttons. */
  error: string | null
  onErase(): void
  /** "Export backup first". */
  onExport(): void
}

/**
 * The body of the erase sheet (docs/SPEC.md §3.7): the question and what it deletes, the field
 * "Type erase to confirm", "Export backup first" and the destructive "Erase", which stays disabled
 * until the field says "erase".
 */
export function EraseForm({ message, typed, onTypedChange, canErase, busy, error, onErase, onExport }: EraseFormProps) {
  return (
    <div className={styles.form}>
      <div className={styles.intro}>
        <h3 className={styles.title}>Erase everything on this iPhone?</h3>
        <p className={styles.message}>{message}</p>
      </div>
      {/* "Done" on the iOS keyboard submits the form: the keyboard goes, so Erase is in view. It
          never erases by itself; that takes the button. */}
      <form className={styles.field} onSubmit={dismissKeyboard}>
        <Section context="sheet">
          {/* A labelled row (DESIGN.md §9.14): the instruction is the label, the answer goes after it. */}
          <TextField
            label="Type erase to confirm"
            value={typed}
            onChange={onTypedChange}
            // The word as typed: iOS would capitalise it (the check ignores case either way).
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="done"
            maxLength={20}
          />
        </Section>
      </form>
      <div className={styles.actions}>
        <Button variant="secondary" size="lg" block disabled={busy} onClick={onExport}>
          Export backup first
        </Button>
        <Button variant="destructive" filled size="lg" block disabled={busy || !canErase} onClick={onErase}>
          Erase
        </Button>
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
