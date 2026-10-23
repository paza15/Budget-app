import { verifyBiometric } from '@/features/lock/biometric'

/**
 * The Face ID request in flight (docs/SPEC.md §3.8, §5.10 rule 3). One AbortController per
 * attempt: a new attempt aborts the previous one, and so do the first PIN key press, unlocking and
 * the app going hidden (abortFaceId). Module state, not component state, so StrictMode's second
 * run of an effect neither repeats nor cancels a prompt.
 */

let current: AbortController | null = null

/** Ends the Face ID request in flight, if any; it then resolves false. */
export function abortFaceId(): void {
  current?.abort()
  current = null
}

/**
 * Asks for Face ID with the stored passkey, after aborting any earlier request. True only when it
 * confirmed the owner and nothing aborted it meanwhile.
 */
export async function askFaceId(credentialId: string): Promise<boolean> {
  abortFaceId()
  const controller = new AbortController()
  current = controller
  try {
    const ok = await verifyBiometric(credentialId, controller.signal)
    return ok && !controller.signal.aborted
  } finally {
    if (current === controller) current = null
  }
}

/**
 * Lock episodes, and open verify sheets (by their route object), whose automatic Face ID prompt has
 * started. Automatic Face ID runs at most once for each: after a cancel or a failure the Face ID
 * key stays, but nothing asks again on its own until the next lock (§3.8).
 */
const startedEpisodes = new Set<number>()
const startedSheets = new WeakSet<object>()

/** True the first time for `key`, false after: the caller may start the automatic prompt. */
export function claimAutomaticFaceId(key: number | object): boolean {
  if (typeof key === 'number') {
    if (startedEpisodes.has(key)) return false
    startedEpisodes.add(key)
    return true
  }
  if (startedSheets.has(key)) return false
  startedSheets.add(key)
  return true
}

/** Whether the app has the focus a Face ID prompt needs to start on its own (§3.8). */
export function canPromptNow(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

/** Resets module state between tests. */
export function __resetFaceIdForTests(): void {
  abortFaceId()
  startedEpisodes.clear()
}
