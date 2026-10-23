import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function mediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const mql = mediaQuery()
  mql?.addEventListener('change', onChange)
  return () => mql?.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return mediaQuery()?.matches ?? false
}

function getServerSnapshot(): boolean {
  return false
}

/**
 * True while the system asks for reduced motion. Components use it where CSS alone cannot drop a
 * motion (the odometer, the segmented thumb); everything else follows the motion tokens.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
