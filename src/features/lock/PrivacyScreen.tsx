import { useEffect, useRef, useState } from 'react'
import { useNav } from '@/app/nav'
import { AUTO_LOCK_OPTIONS } from '@/domain/catalog'
import { forgetBiometric, registerBiometric } from '@/features/lock/biometric'
import { clearPin, lockSupport } from '@/features/lock/pin'
import { verifyOwner } from '@/features/lock/verifyOwner'
import { actions } from '@/store/actions'
import { useSettings } from '@/store/hooks'
import { updateSecurity, useSecurityStore } from '@/store/securityStore'
import { useUiStore } from '@/store/uiStore'
import { ListRow, Screen, Section, SelectField, Toggle, toast, type SelectOption } from '@/ui'

const FACE_ID_NOTE =
  'Face ID unlock uses a passkey saved in your Passwords app. If Face ID fails, iOS lets you use your iPhone passcode instead, so anyone who knows your passcode can open the app.'

const EXPLANATION =
  "The lock keeps people who pick up your unlocked iPhone out of the app. It doesn't encrypt your entries: iOS already encrypts your iPhone while it's locked. If you forget your PIN, the only way back in is to erase the app's data and restore a backup. iOS may show your last screen in the app switcher; turn on Hide amounts to keep numbers out of it."

const LOCK_AFTER: SelectOption<number>[] = AUTO_LOCK_OPTIONS.map(({ minutes, label }) => ({ value: minutes, label }))

/** Lock after's choices, with a stored value that is not one of them kept as its own. */
function lockAfterOptions(minutes: number): SelectOption<number>[] {
  if (LOCK_AFTER.some((option) => option.value === minutes)) return LOCK_AFTER
  return [...LOCK_AFTER, { value: minutes, label: minutes === 1 ? '1 minute' : `${minutes} minutes` }]
}

/** The platform's last answer, so a second visit shows the Face ID group at once. */
let knownBiometric: boolean | null = null

/** Whether Face ID (a platform authenticator) can be used here; false until known. */
function useBiometricAvailable(): boolean {
  const [available, setAvailable] = useState(knownBiometric ?? false)
  useEffect(() => {
    let current = true
    void lockSupport()
      .biometric()
      .then((value) => {
        knownBiometric = value
        if (current) setAvailable(value)
      })
    return () => {
      current = false
    }
  }, [])
  return available
}

function onHideAmounts(hide: boolean): void {
  // Amounts shown with the eye button hide again too.
  if (hide) useUiStore.getState().setAmountsRevealed(false)
  actions.updateSettings({ hideAmounts: hide })
}

/** Creates the passkey and stores its id, replacing (and forgetting) an earlier one. */
async function enableFaceId(): Promise<boolean> {
  const id = await registerBiometric()
  if (id === null) return false
  const previous = useSecurityStore.getState().config.biometricCredentialId
  try {
    await updateSecurity({ biometricCredentialId: id })
  } catch (error) {
    forgetBiometric(id)
    throw error
  }
  if (previous !== null && previous !== id) forgetBiometric(previous)
  return true
}

/**
 * App lock settings (docs/SPEC.md §3.8), the route 'you.privacy' under settings: the App lock
 * switch (on opens PIN setup, off verifies first), Change PIN (verifies first), Unlock with Face ID
 * where a platform authenticator exists (on verifies the PIN first), Lock after, Hide amounts and
 * what the lock does and does not do.
 */
export function PrivacyScreen() {
  const config = useSecurityStore((s) => s.config)
  const { hideAmounts } = useSettings()
  const biometricAvailable = useBiometricAvailable()
  const [pending, setPending] = useState(false)
  /** Set at once, so a second tap before the re-render waits too. */
  const running = useRef(false)
  const pinSupported = lockSupport().pin
  const pinSet = config.pinHash !== null
  const faceIdOn = config.biometricCredentialId !== null

  /** One change at a time; a failure says so in a toast. */
  const run = async (task: () => Promise<void>, failure: string): Promise<void> => {
    if (running.current) return
    running.current = true
    setPending(true)
    try {
      await task()
    } catch {
      toast({ message: failure, tone: 'critical' })
    } finally {
      running.current = false
      setPending(false)
    }
  }

  const onLockChange = (on: boolean): void => {
    if (on) {
      useNav.getState().openSheet({ name: 'pinSetup', mode: 'enable' })
      return
    }
    void run(async () => {
      if (!(await verifyOwner('Turn off the app lock'))) return
      await clearPin()
      toast({ message: 'App lock is off' })
    }, "Couldn't turn off the app lock. Try again.")
  }

  const onChangePin = (): void => {
    void run(async () => {
      if (await verifyOwner('Change your PIN')) useNav.getState().openSheet({ name: 'pinSetup', mode: 'change' })
    }, "Couldn't change the PIN. Try again.")
  }

  const setUpFaceId = (reason: string): void => {
    void run(async () => {
      if (!(await verifyOwner(reason))) return
      if (await enableFaceId()) return
      // Safari may refuse a passkey once the tap that asked for it is long past: the toast's
      // button is a fresh tap, moments after the PIN was confirmed.
      toast({
        message: "Face ID wasn't set up.",
        action: {
          label: 'Try again',
          onClick: () => {
            void enableFaceId().then(
              (done) => {
                if (!done) toast({ message: "Face ID wasn't set up. Turn on Unlock with Face ID to try again." })
              },
              () => toast({ message: "Couldn't turn on Face ID. Try again.", tone: 'critical' }),
            )
          },
        },
      })
    }, "Couldn't turn on Face ID. Try again.")
  }

  const onFaceIdChange = (on: boolean): void => {
    if (on) {
      setUpFaceId('Turn on Face ID')
      return
    }
    void run(async () => {
      const id = useSecurityStore.getState().config.biometricCredentialId
      await updateSecurity({ biometricCredentialId: null })
      if (id !== null) forgetBiometric(id)
    }, "Couldn't turn off Face ID. Try again.")
  }

  const onLockAfter = (minutes: number): void => {
    void run(() => updateSecurity({ autoLockMinutes: minutes }), "Couldn't change Lock after. Try again.")
  }

  return (
    <Screen title="App lock" largeTitle onBack={() => useNav.getState().pop()} backLabel="You">
      <Section variant="form" footer={pinSupported ? undefined : "App lock needs the app's https:// address."}>
        <Toggle label="App lock" checked={pinSet} onChange={onLockChange} disabled={!pinSupported || pending} />
        {pinSet && <ListRow title="Change PIN" tinted onClick={onChangePin} disabled={pending} />}
      </Section>

      {pinSet && (biometricAvailable || faceIdOn) && (
        <Section variant="form" footer={FACE_ID_NOTE}>
          <Toggle label="Unlock with Face ID" checked={faceIdOn} onChange={onFaceIdChange} disabled={pending} />
          {faceIdOn && (
            // A passkey deleted in Passwords fails like a cancel; this makes a new one (§3.8).
            <ListRow
              title="Set up Face ID again"
              tinted
              onClick={() => setUpFaceId('Set up Face ID again')}
              disabled={pending}
            />
          )}
        </Section>
      )}

      {pinSet && (
        <Section variant="form">
          <SelectField
            label="Lock after"
            value={config.autoLockMinutes}
            options={lockAfterOptions(config.autoLockMinutes)}
            onChange={onLockAfter}
            disabled={pending}
          />
        </Section>
      )}

      <Section variant="form" footer={EXPLANATION}>
        <Toggle label="Hide amounts" checked={hideAmounts} onChange={onHideAmounts} />
      </Section>
    </Screen>
  )
}
