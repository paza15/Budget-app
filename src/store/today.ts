import { useSyncExternalStore } from 'react'
import { todayISO } from '@/domain/dates'
import type { ISODate } from '@/domain/types'

/**
 * Today's local date (docs/SPEC.md §5.4). Components never call Date.now() or new Date() during
 * render; they use useToday(), a small external store that moves on at local midnight and when
 * the app becomes visible again (timers stop while an iPhone app is in the background).
 */

/** Wait this long past midnight, so the timer never fires a moment before the date changes. */
const MIDNIGHT_MARGIN_MS = 1000

let today: ISODate = todayISO()
const listeners = new Set<() => void>()
let midnightTimer: ReturnType<typeof setTimeout> | undefined

/** Re-reads the clock and tells subscribers when the date changed. */
function refresh(): void {
  const next = todayISO()
  if (next === today) return
  today = next
  for (const listener of listeners) listener()
}

/** Schedules a refresh just after the next local midnight (DST-safe: the Date constructor finds it). */
function scheduleMidnight(): void {
  clearTimeout(midnightTimer)
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  midnightTimer = setTimeout(() => {
    refresh()
    scheduleMidnight()
  }, midnight.getTime() - now.getTime() + MIDNIGHT_MARGIN_MS)
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return
  refresh()
  scheduleMidnight()
}

/** The timer and the listener run only while a component shows the date. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    scheduleMidnight()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
    refresh()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    clearTimeout(midnightTimer)
    midnightTimer = undefined
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** Without subscribers nothing keeps the date current, so it is read again. */
function getSnapshot(): ISODate {
  if (listeners.size === 0) today = todayISO()
  return today
}

/** Today's date; re-renders at local midnight and when the app becomes visible again. */
export function useToday(): ISODate {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Today's date for event handlers and actions, read from the clock. When it is ahead of what
 * components show (a timer that slept), they catch up right after the handler.
 */
export function getToday(): ISODate {
  const now = todayISO()
  if (now !== today && listeners.size > 0) queueMicrotask(refresh)
  return now
}
