import { useEffect } from 'react'
import { abortFaceId } from '@/features/lock/faceId'
import { hasPin, lockApp, useSecurityStore } from '@/store/securityStore'
import { useUiStore } from '@/store/uiStore'

const MINUTE_MS = 60_000

/**
 * Leaving the app while a system sheet it started is open (share sheet, file picker, Face ID) is
 * not treated as leaving it (§3.8), unless it stays away at least this long: then it locks as
 * usual, so a share sheet left open is not a way around the lock.
 */
const SYSTEM_SHEET_GRACE_MINUTES = 1

function autoLockMinutes(): number {
  return useSecurityStore.getState().config.autoLockMinutes
}

/**
 * Locks the app after it has been hidden for settings' autoLockMinutes (docs/SPEC.md §3.8):
 * - hidden (visibilitychange, pagehide): note when, hide revealed amounts again, end a Face ID
 *   request, and lock at once when Lock after is Immediately;
 * - visible: lock when a PIN is set and Lock after is Immediately, the app was away at least that
 *   long, or the clock went back meanwhile.
 * Settings are read when the event comes. It never locks on blur: Face ID, the share sheet and
 * the file picker blur the page. Called once, by App, before anything else renders.
 */
export function useAutoLock(): void {
  useEffect(() => {
    /** When the app went into the background, or null while it is in front. */
    let hiddenAt: number | null = null
    /** A system sheet the app started was open as it went. */
    let leftUnderSystemSheet = false

    const onHidden = (): void => {
      abortFaceId()
      // pagehide after visibilitychange: the first moment counts.
      if (hiddenAt !== null) return
      hiddenAt = Date.now()
      leftUnderSystemSheet = useUiStore.getState().systemSheetOpen
      if (leftUnderSystemSheet) return
      if (useUiStore.getState().amountsRevealed) useUiStore.getState().setAmountsRevealed(false)
      if (hasPin() && autoLockMinutes() === 0) lockApp()
    }

    const onVisible = (): void => {
      const at = hiddenAt
      const underSystemSheet = leftUnderSystemSheet || useUiStore.getState().systemSheetOpen
      hiddenAt = null
      leftUnderSystemSheet = false
      if (at === null || !hasPin()) return
      const now = Date.now()
      const minutes = underSystemSheet ? Math.max(autoLockMinutes(), SYSTEM_SHEET_GRACE_MINUTES) : autoLockMinutes()
      if (minutes === 0 || now - at >= minutes * MINUTE_MS || now < at) lockApp()
    }

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') onHidden()
      else onVisible()
    }
    // A page restored from the back-forward cache comes back with pageshow.
    const onPageShow = (): void => {
      if (document.visibilityState === 'visible') onVisible()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onHidden)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onHidden)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])
}
