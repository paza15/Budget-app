import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNav } from '@/app/nav'
import { formatRelativeTime } from '@/domain/dates'
import type { KeypadKey } from '@/domain/money'
import { forgetBiometric } from '@/features/lock/biometric'
import { cx } from '@/features/lock/cx'
import { abortFaceId, askFaceId, canPromptNow, claimAutomaticFaceId } from '@/features/lock/faceId'
import styles from '@/features/lock/LockScreen.module.css'
import { clearFailedAttempts } from '@/features/lock/pin'
import { PinDots } from '@/features/lock/PinDots'
import { FaceIdKey, PinMessage } from '@/features/lock/PinMessage'
import { PinSetupFlow } from '@/features/lock/PinSetupFlow'
import { usePinCheck } from '@/features/lock/usePinCheck'
import { useAppStore } from '@/store/appStore'
import { eraseEverything } from '@/store/persistence'
import { unlockApp, useSecurityStore } from '@/store/securityStore'
import { Button, Engraving, Icon, Keypad, Section, SheetHeader, TextField, toast } from '@/ui'

/**
 * Full-screen PIN and Face ID entry above the app (docs/SPEC.md §3.8, DESIGN.md §9.24): the vault
 * (the engraved rosette with the mark), "Enter your PIN", the dots, the PIN keypad with Face ID
 * at its bottom left, and "Forgot PIN?". Opaque, above everything but the privacy cover.
 *
 * Sheets and dialogs sit below the lock (and turn inert under it), so Forgot PIN's steps are
 * views of the lock screen itself: Face ID then a new PIN, or erasing everything. Each lock
 * episode starts afresh: a new episode remounts the session, so nothing typed survives a relock.
 */
export function LockScreen() {
  const failed = useSecurityStore((s) => s.status === 'error')
  const episode = useSecurityStore((s) => s.lockEpisode)
  return (
    <div className={styles.lock} data-testid="lock-screen">
      {failed ? <LockFailed /> : <LockSession key={episode} episode={episode} />}
    </div>
  )
}

/**
 * The lock settings could not be read (status 'error'): the app stays locked (fail closed) and no
 * PIN can be checked. Reopening may help; erasing is the way out when it does not.
 */
function LockFailed() {
  const [erasingSince, setErasingSince] = useState<number | null>(null)
  if (erasingSince !== null) return <EraseView openedAt={erasingSince} onCancel={() => setErasingSince(null)} />
  return <FailedView onErase={() => setErasingSince(Date.now())} />
}

type View = { name: 'pin' } | { name: 'forgot' } | { name: 'newPin' } | { name: 'erase'; openedAt: number }

function LockSession({ episode }: { episode: number }) {
  const [view, setView] = useState<View>({ name: 'pin' })
  const credentialId = useSecurityStore((s) => s.config.biometricCredentialId)
  const backToPin = (): void => setView({ name: 'pin' })
  const toErase = (): void => setView({ name: 'erase', openedAt: Date.now() })

  if (view.name === 'erase') return <EraseView openedAt={view.openedAt} onCancel={backToPin} />
  if (view.name === 'newPin') return <NewPinView episode={episode} onCancel={backToPin} />
  if (view.name === 'forgot' && credentialId !== null) {
    return (
      <ForgotView
        credentialId={credentialId}
        onVerified={() => setView({ name: 'newPin' })}
        onErase={toErase}
        onCancel={backToPin}
      />
    )
  }
  return (
    <PinView
      episode={episode}
      credentialId={credentialId}
      // With Face ID it first offers a new PIN; erasing is the last resort (§3.8).
      onForgot={credentialId === null ? toErase : () => setView({ name: 'forgot' })}
    />
  )
}

/** Face ID, then unlock if this lock episode is still the current one. */
async function unlockWithFaceId(credentialId: string, episode: number): Promise<void> {
  if (!(await askFaceId(credentialId))) return
  const { locked, lockEpisode } = useSecurityStore.getState()
  if (!locked || lockEpisode !== episode) return
  void clearFailedAttempts()
  unlockApp()
}

/** The engraved rosette with the app mark at its centre (DESIGN.md §3.1, §9.24). Decorative. */
function Vault() {
  return (
    <div className={styles.vault} aria-hidden="true">
      <Engraving kind="rosette" className={styles.rosette} />
      <Icon name="logo" size={64} className={styles.mark} />
    </div>
  )
}

/** The view's title takes focus as it appears, so VoiceOver starts there. */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return ref
}

const DIGIT = /^[0-9]$/

interface PinViewProps {
  episode: number
  credentialId: string | null
  onForgot(): void
}

function PinView({ episode, credentialId, onForgot }: PinViewProps) {
  const pinLength = useSecurityStore((s) => s.config.pinLength)
  const title = useFocusOnMount<HTMLHeadingElement>()

  const unlock = (): void => {
    // A relock while the PIN was being checked starts a new episode, which needs its own PIN.
    if (useSecurityStore.getState().lockEpisode !== episode) return
    abortFaceId()
    unlockApp()
  }
  const pin = usePinCheck(pinLength, unlock)

  // Face ID on its own, once per lock episode, only while the app is in front with focus;
  // otherwise on the next focus (§3.8). A cancel or failure leaves the Face ID key for retries.
  useEffect(() => {
    if (credentialId === null) return undefined
    const attempt = (): void => {
      if (canPromptNow() && claimAutomaticFaceId(episode)) void unlockWithFaceId(credentialId, episode)
    }
    attempt()
    window.addEventListener('focus', attempt)
    document.addEventListener('visibilitychange', attempt)
    return () => {
      window.removeEventListener('focus', attempt)
      document.removeEventListener('visibilitychange', attempt)
    }
  }, [credentialId, episode])

  // A hardware keyboard types digits and deletes too.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    let key: KeypadKey | null = null
    if (DIGIT.test(event.key)) key = event.key as KeypadKey
    else if (event.key === 'Backspace') key = 'back'
    if (key === null) return
    event.preventDefault()
    pin.onKey(key)
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => onKeyDown(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])

  const faceIdKey =
    credentialId === null ? undefined : (
      <FaceIdKey
        onPress={() => {
          claimAutomaticFaceId(episode)
          void unlockWithFaceId(credentialId, episode)
        }}
      />
    )

  return (
    <div className={styles.view}>
      <Vault />
      <h1 ref={title} tabIndex={-1} className={styles.title}>
        Enter your PIN
      </h1>
      <PinDots
        key={pin.wrongCount}
        length={pinLength}
        filled={pin.filled}
        shake={pin.wrongCount > 0}
        className={styles.dots}
      />
      <PinMessage feedback={pin.feedback} lockoutSeconds={pin.lockoutSeconds} className={styles.message} />
      <div className={styles.pad}>
        <Keypad
          variant="pin"
          decimalSeparator={null}
          label="PIN"
          onKey={pin.onKey}
          disabled={pin.lockoutSeconds > 0}
          leftKey={faceIdKey}
        />
      </div>
      <Button variant="plain" className={styles.forgot} onClick={onForgot} data-testid="lock-forgot">
        Forgot PIN?
      </Button>
    </div>
  )
}

interface ForgotViewProps {
  credentialId: string
  onVerified(): void
  onErase(): void
  onCancel(): void
}

/** Forgot PIN with Face ID on: Face ID, then a new PIN; erasing is the last resort (§3.8). */
function ForgotView({ credentialId, onVerified, onErase, onCancel }: ForgotViewProps) {
  const [state, setState] = useState<'idle' | 'asking' | 'failed'>('idle')
  const title = useFocusOnMount<HTMLHeadingElement>()

  const confirmWithFaceId = async (): Promise<void> => {
    setState('asking')
    if (await askFaceId(credentialId)) onVerified()
    else setState('failed')
  }

  return (
    <div className={styles.view}>
      <Vault />
      <h1 ref={title} tabIndex={-1} className={styles.title}>
        Forgot your PIN?
      </h1>
      <p className={styles.text}>
        Confirm it&apos;s you with Face ID, then choose a new PIN. Without Face ID, the only way back in is to
        erase the app&apos;s data and restore a backup.
      </p>
      <output className={styles.note}>
        {state === 'failed' ? "Face ID didn't confirm it's you. Try again, or erase the app's data." : null}
      </output>
      <div className={styles.actions}>
        <Button size="lg" block disabled={state === 'asking'} onClick={() => void confirmWithFaceId()}>
          Use Face ID to choose a new PIN
        </Button>
        <Button variant="destructive" block onClick={onErase}>
          Erase all data
        </Button>
        <Button variant="plain" block onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** After Face ID: a new PIN without the old one, then the app opens (§3.8). */
function NewPinView({ episode, onCancel }: { episode: number; onCancel(): void }) {
  const done = (): void => {
    if (useSecurityStore.getState().lockEpisode !== episode) return
    toast({ message: 'PIN changed' })
    unlockApp()
  }
  return (
    <div className={cx(styles.view, styles.page, styles.newPin)}>
      <SheetHeader title="New PIN" onCancel={onCancel} className={styles.pageHeader} />
      <PinSetupFlow mode="change" onDone={done} onCancel={onCancel} layout="fill" />
    </div>
  )
}

/**
 * Erase everything (docs/SPEC.md §3.7 "Erase all data", from Forgot PIN): the same text, field
 * and destructive Erase as the EraseSheet, shown here because no sheet can open above the lock.
 */
function EraseView({ openedAt, onCancel }: { openedAt: number; onCancel(): void }) {
  const lastBackupAt = useAppStore((s) => s.data.settings.lastBackupAt)
  const question = useFocusOnMount<HTMLHeadingElement>()
  const [typed, setTyped] = useState('')
  const [state, setState] = useState<'idle' | 'erasing' | 'failed'>('idle')
  const confirmed = typed.trim().toLowerCase() === 'erase'
  const lastBackup = lastBackupAt === null ? 'never' : formatRelativeTime(lastBackupAt, openedAt)

  const erase = async (): Promise<void> => {
    if (!confirmed || state === 'erasing') return
    const credentialId = useSecurityStore.getState().config.biometricCredentialId
    setState('erasing')
    try {
      await eraseEverything()
    } catch {
      setState('failed')
      return
    }
    // Erasing unlocked the app and took the passkey's id with it: tell Passwords, start at Home.
    if (credentialId !== null) forgetBiometric(credentialId)
    useNav.getState().reset()
  }

  return (
    <div className={cx(styles.view, styles.page)}>
      <SheetHeader title="Erase all data" onCancel={onCancel} className={styles.pageHeader} />
      <div className={styles.erase}>
        <h3 ref={question} tabIndex={-1} className={styles.question}>
          Erase everything on this iPhone?
        </h3>
        <p className={styles.eraseText}>
          This deletes your entries, fixed costs, categories, settings and PIN. Last backup: {lastBackup}.
        </p>
        <Section variant="form" title="Type erase to confirm">
          <TextField
            label="Type erase to confirm"
            hideLabel
            value={typed}
            onChange={setTyped}
            placeholder="erase"
            // The word as typed: iOS would capitalise it (the check ignores case either way).
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="done"
            maxLength={20}
          />
        </Section>
        <p className={styles.error} role="alert">
          {state === 'failed' ? "Couldn't erase the app's data. Close it completely and try again." : null}
        </p>
        <div className={styles.eraseAction}>
          <Button
            variant="destructive"
            filled
            size="lg"
            block
            disabled={!confirmed || state === 'erasing'}
            onClick={() => void erase()}
          >
            Erase
          </Button>
        </div>
      </div>
    </div>
  )
}

function FailedView({ onErase }: { onErase(): void }) {
  const title = useFocusOnMount<HTMLHeadingElement>()
  return (
    <div className={styles.view}>
      <Vault />
      <h1 ref={title} tabIndex={-1} className={styles.title}>
        Couldn&apos;t read the app lock settings
      </h1>
      <p className={styles.text}>
        Close the app completely and open it again. If this keeps happening, erase the app&apos;s data and
        restore a backup.
      </p>
      <div className={styles.actions}>
        <Button size="lg" block onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button variant="destructive" block onClick={onErase}>
          Erase all data
        </Button>
      </div>
    </div>
  )
}
