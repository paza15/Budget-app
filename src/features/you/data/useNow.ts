import { useSyncExternalStore } from 'react'

/**
 * The time for relative labels such as "Last backup 5 minutes ago", to the minute. Components never
 * read the clock during render (CLAUDE.md), so like useToday this is a small external store: it is
 * read again every few seconds while a component shows it and when the app becomes visible again
 * (timers stop while an iPhone app is in the background).
 */

const MINUTE_MS = 60_000
/** How often the clock is read while subscribed; the minute shown is at most this late. */
const TICK_MS = 15_000

/** The current minute: stable for a whole minute, so React sees the same snapshot within a render. */
function readMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS
}

let now = readMinute()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function refresh(): void {
  const next = readMinute()
  if (next === now) return
  now = next
  for (const listener of listeners) listener()
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') refresh()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    timer = setInterval(refresh, TICK_MS)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
    refresh()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    clearInterval(timer)
    timer = undefined
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** Without subscribers nothing keeps the minute current, so it is read again. */
function getSnapshot(): number {
  if (listeners.size === 0) now = readMinute()
  return now
}

/** Epoch ms of the current minute's start; re-renders when the minute changes. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
