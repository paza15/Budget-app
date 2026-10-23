import { useState } from 'react'
import { useNav, type SheetProps } from '@/app/nav'
import { formatRelativeTime } from '@/domain/dates'
import { forgetBiometric } from '@/features/lock/biometric'
import { verifyOwner } from '@/features/lock/verifyOwner'
import { exportBackup } from '@/features/you/backupIO'
import { EraseForm } from '@/features/you/data/EraseForm'
import { useNow } from '@/features/you/data/useNow'
import { useData } from '@/store/hooks'
import { eraseEverything, STORAGE_MESSAGES } from '@/store/persistence'
import { hasPin, useSecurityStore } from '@/store/securityStore'
import { SheetHeader, toast } from '@/ui'

/** The word the field must hold, compared trimmed and lower-cased (§3.7). */
const CONFIRM_WORD = 'erase'

const VERIFY_FAILED_MESSAGE = "Couldn't check your PIN or Face ID, so nothing was erased. Try again."

/**
 * "Erase all data" (docs/SPEC.md §3.7), from About. "Export backup first" is offered, and the
 * destructive "Erase" waits for "erase" in the field; with a PIN set, the PIN or Face ID is checked
 * first. Erasing deletes all data, settings and the PIN (eraseEverything), tells iOS the Face ID
 * passkey is gone (§8), and starts over with onboarding from the top of a fresh navigation. (The
 * lock screen's "Forgot PIN?" erases in a view of its own: no sheet can open above the lock.)
 */
export function EraseSheet({ onClose }: SheetProps<'erase'>) {
  const lastBackupAt = useData((d) => d.settings.lastBackupAt)
  const now = useNow()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canErase = typed.trim().toLowerCase() === CONFIRM_WORD

  const exportFirst = (): void => {
    if (busy) return
    // First thing in the tap: the backup is built and handed to the share sheet before any await.
    const saving = exportBackup()
    setBusy(true)
    saving
      .then(
        (result) => {
          if (result !== 'cancelled') toast({ message: 'Backup exported', tone: 'success' })
        },
        () => {
          toast({
            message: "Couldn't export a backup. Close the app completely, open it again and try again.",
            tone: 'critical',
          })
        },
      )
      .finally(() => setBusy(false))
  }

  const erase = async (): Promise<void> => {
    if (busy || !canErase) return
    setError(null)
    setBusy(true)
    if (hasPin()) {
      let verified: boolean
      try {
        verified = await verifyOwner('Erase all data')
      } catch {
        setError(VERIFY_FAILED_MESSAGE)
        setBusy(false)
        return
      }
      if (!verified) {
        setBusy(false)
        return
      }
    }
    // Read before erasing: the erase resets the lock settings, passkey id included.
    const passkey = useSecurityStore.getState().config.biometricCredentialId
    try {
      await eraseEverything()
    } catch (failure) {
      setError(failure instanceof Error && failure.message !== '' ? failure.message : STORAGE_MESSAGES.eraseFailed)
      setBusy(false)
      return
    }
    if (passkey !== null) forgetPasskey(passkey)
    // Everything starts over: onboarding replaces the tabs, and when the tabs come back they open
    // on Home with no screens or sheets left over from before (this sheet included).
    useNav.getState().reset()
  }

  const lastBackup = lastBackupAt === null ? 'never' : formatRelativeTime(lastBackupAt, now)
  return (
    <>
      <SheetHeader title="Erase all data" onCancel={onClose} />
      <EraseForm
        message={`This deletes your entries, fixed costs, categories, settings and PIN. Last backup: ${lastBackup}.`}
        typed={typed}
        onTypedChange={(value) => {
          setTyped(value)
          setError(null)
        }}
        canErase={canErase}
        busy={busy}
        error={error}
        onErase={() => void erase()}
        onExport={exportFirst}
      />
    </>
  )
}

/** signalUnknownCredential, fire and forget (§8): a failure there must not undo the erase. */
function forgetPasskey(credentialId: string): void {
  try {
    forgetBiometric(credentialId)
  } catch {
    // The passkey stays in Passwords; the next "Unlock with Face ID" setup replaces it.
  }
}
