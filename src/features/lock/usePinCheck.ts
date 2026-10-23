import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeypadKey } from '@/domain/money'
import { abortFaceId } from '@/features/lock/faceId'
import { lockoutRemainingMs, verifyPin } from '@/features/lock/pin'
import { useSecurityStore } from '@/store/securityStore'

/** The countdown re-reads the clock this often; it re-renders only when the seconds change. */
const TICK_MS = 250

function secondsLeft(lockoutUntil: number | null): number {
  return Math.ceil(lockoutRemainingMs({ lockoutUntil }, Date.now()) / 1000)
}

/**
 * Whole seconds until PIN entry opens again, 0 when it is open. Counts down while a component
 * shows it (the clock is read by the store's snapshot, never in a render of its own).
 */
export function useLockoutSeconds(lockoutUntil: number | null): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (secondsLeft(lockoutUntil) === 0) return () => {}
      const timer = window.setInterval(() => {
        notify()
        if (secondsLeft(lockoutUntil) === 0) window.clearInterval(timer)
      }, TICK_MS)
      return () => window.clearInterval(timer)
    },
    [lockoutUntil],
  )
  const getSnapshot = useCallback(() => secondsLeft(lockoutUntil), [lockoutUntil])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** "0:30", "15:00". */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export type PinFeedback = 'wrong' | 'error' | null

export interface PinCheck {
  /** Digits entered so far, for the dots. */
  filled: number
  /** What the last check said: a wrong PIN, or that it could not check. */
  feedback: PinFeedback
  /** Counts wrong PINs: key the dots with it so each one shakes them again. */
  wrongCount: number
  /** Seconds of lockout left; the keypad is off while above 0. */
  lockoutSeconds: number
  onKey(key: KeypadKey): void
}

interface EntryState {
  filled: number
  feedback: PinFeedback
  wrongCount: number
}

const START: EntryState = { filled: 0, feedback: null, wrongCount: 0 }

/**
 * PIN entry checked against the stored PIN (docs/SPEC.md §3.8), for the lock screen and the verify
 * sheet. The digits live in a ref, never in React state: only their count renders, and the buffer
 * is emptied as soon as it is handed to verifyPin. A key press also ends a Face ID request in
 * flight. A wrong PIN clears the dots and says so; during a lockout keys do nothing and the
 * countdown runs. `onVerified` runs once the PIN matched.
 */
export function usePinCheck(length: number, onVerified: () => void): PinCheck {
  const digits = useRef<string[]>([])
  /** A check is running (or succeeded): further keys wait. Set at once, before any re-render. */
  const checking = useRef(false)
  const [entry, setEntry] = useState<EntryState>(START)
  const lockoutUntil = useSecurityStore((s) => s.config.lockoutUntil)
  const lockoutSeconds = useLockoutSeconds(lockoutUntil)

  // Nothing typed outlives the component.
  useEffect(() => {
    const buffer = digits.current
    return () => {
      buffer.length = 0
    }
  }, [])

  const check = async (pin: string): Promise<void> => {
    let result: Awaited<ReturnType<typeof verifyPin>> | 'error'
    try {
      result = await verifyPin(pin)
    } catch {
      result = 'error'
    }
    if (result === 'ok') {
      onVerified()
      return
    }
    checking.current = false
    setEntry((s) => ({
      filled: 0,
      feedback: result === 'wrong' ? 'wrong' : result === 'error' ? 'error' : null,
      wrongCount: result === 'wrong' ? s.wrongCount + 1 : s.wrongCount,
    }))
  }

  const onKey = (key: KeypadKey): void => {
    abortFaceId()
    const buffer = digits.current
    if (checking.current || key === '.') return
    if (lockoutRemainingMs(useSecurityStore.getState().config, Date.now()) > 0) return
    if (key === 'back') {
      buffer.pop()
      const filled = buffer.length
      setEntry((s) => ({ ...s, filled }))
      return
    }
    if (buffer.length >= length) return
    buffer.push(key)
    // Read now: updaters run later, after the buffer below is emptied.
    const filled = buffer.length
    setEntry((s) => ({ ...s, filled, feedback: null }))
    if (filled < length) return
    const pin = buffer.join('')
    buffer.length = 0
    checking.current = true
    void check(pin)
  }

  return { filled: entry.filled, feedback: entry.feedback, wrongCount: entry.wrongCount, lockoutSeconds, onKey }
}
