import { useEffect, useEffectEvent, useState } from 'react'
import type { SheetProps } from '@/app/nav'
import { askFaceId, canPromptNow, claimAutomaticFaceId } from '@/features/lock/faceId'
import { PinDots } from '@/features/lock/PinDots'
import { FaceIdKey, PinMessage } from '@/features/lock/PinMessage'
import { usePinCheck } from '@/features/lock/usePinCheck'
import { confirmOwner } from '@/features/lock/verifyOwner'
import styles from '@/features/lock/VerifyOwnerSheet.module.css'
import { useSecurityStore } from '@/store/securityStore'
import { Keypad, SheetHeader } from '@/ui'

/**
 * Asks for the PIN or Face ID before a protected change (docs/SPEC.md §3.8), opened by
 * verifyOwner(reason). The reason is the title. Face ID, when it is on, is asked for once on its
 * own as the sheet opens (and stays on the keypad's Face ID key); wrong PINs and lockouts work as
 * on the lock screen. Confirming resolves verifyOwner with true and closes the sheet.
 */
export function VerifyOwnerSheet({ route, onClose }: SheetProps<'verifyOwner'>) {
  const pinLength = useSecurityStore((s) => s.config.pinLength)
  // Face ID as it was when the sheet opened: turning Face ID on is itself verified here, and the
  // closing sheet must not then ask for the passkey it just made.
  const [credentialId] = useState(() => useSecurityStore.getState().config.biometricCredentialId)

  const confirmed = (): void => {
    confirmOwner(route)
    onClose()
  }
  const pin = usePinCheck(pinLength, confirmed)

  const confirmWithFaceId = (id: string): void => {
    void askFaceId(id).then((ok) => {
      if (ok) confirmed()
    })
  }

  // Face ID on its own once per opened sheet, when the app is in front with focus (§3.8).
  const startAutomatically = useEffectEvent((id: string) => confirmWithFaceId(id))
  useEffect(() => {
    if (credentialId === null) return undefined
    const attempt = (): void => {
      if (canPromptNow() && claimAutomaticFaceId(route)) startAutomatically(credentialId)
    }
    attempt()
    window.addEventListener('focus', attempt)
    return () => window.removeEventListener('focus', attempt)
  }, [credentialId, route])

  const faceIdKey =
    credentialId === null ? undefined : (
      <FaceIdKey
        label="Use Face ID"
        onPress={() => {
          claimAutomaticFaceId(route)
          confirmWithFaceId(credentialId)
        }}
      />
    )

  return (
    <>
      <SheetHeader title={route.reason} onCancel={onClose} />
      <div className={styles.body}>
        <p className={styles.prompt}>Enter your PIN</p>
        <PinDots
          key={pin.wrongCount}
          length={pinLength}
          filled={pin.filled}
          shake={pin.wrongCount > 0}
          className={styles.dots}
        />
        <PinMessage feedback={pin.feedback} lockoutSeconds={pin.lockoutSeconds} className={styles.message} />
        <Keypad
          variant="pin"
          decimalSeparator={null}
          label="PIN"
          onKey={pin.onKey}
          disabled={pin.lockoutSeconds > 0}
          leftKey={faceIdKey}
          className={styles.keypad}
        />
      </div>
    </>
  )
}
