// Where the app runs (docs/SPEC.md §1, §5.7). Both answers are fixed for a page's lifetime, and
// both are false outside a browser (tests, server rendering).

/** iOS sets this on navigator inside a Home Screen web app. */
interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

/** Running as the installed Home Screen app (docs/SPEC.md §5.7). */
export function isStandalone(): boolean {
  if (typeof navigator !== 'undefined' && (navigator as NavigatorWithStandalone).standalone === true) return true
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
}

/** An iPhone, iPod or iPad, including iPads that report a Mac user agent. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return true
  // iPadOS asks for desktop sites by default and then reports a Mac; only the iPad has a touch screen.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
}

/**
 * iOS outside the installed app, usually Safari: entries made here stay in the browser, so the
 * app asks to be installed first (the onboarding gate, §3.9 step 0) and shows the install banner
 * on Home (§3.10).
 */
export function needsInstall(): boolean {
  return isIOS() && !isStandalone()
}
