import { useSyncExternalStore } from 'react'

/** The visible part of the page, which shrinks while the iOS keyboard is open. */
export interface VisualViewportState {
  /** visualViewport.offsetTop in px. */
  top: number
  /** visualViewport.height in px. */
  height: number
  /** Keyboard height: layout viewport minus visual viewport, in px (0 while closed). */
  keyboard: number
}

/**
 * A smaller gap between the layout and the visual viewport is rounding or a scrollbar, not a
 * keyboard. The smallest real one, iPad's shortcut bar above a hardware keyboard, is about 55px.
 */
const KEYBOARD_MIN = 40

/**
 * When a field gains or loses focus the keyboard slides for about 300ms, and iOS does not always
 * send a resize with the final size at the end (the keyboard then seems to stay up, and a sheet
 * that follows it leaves a gap at the bottom). Measure again once the slide is over.
 */
const SETTLE_MS = [120, 400, 800] as const

const SERVER_STATE: VisualViewportState = Object.freeze({ top: 0, height: 0, keyboard: 0 })

let snapshot: VisualViewportState = SERVER_STATE
const listeners = new Set<() => void>()
let frame = 0
let settleTimers: ReturnType<typeof setTimeout>[] = []

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function measure(): VisualViewportState {
  const vv = window.visualViewport
  // iOS keeps the layout viewport (innerHeight, the html box) as it is while the keyboard is up
  // and shrinks only the visual viewport. Older WebKit shrank innerHeight too, so take the larger.
  const layout = Math.max(window.innerHeight, document.documentElement.clientHeight)
  if (!vv) return { top: 0, height: layout, keyboard: 0 }
  // Pinch zoom shrinks vv.height by vv.scale; that is not a keyboard.
  const covered = layout - vv.height * vv.scale
  return {
    top: round(vv.offsetTop),
    height: round(vv.height),
    keyboard: covered >= KEYBOARD_MIN ? Math.round(covered) : 0,
  }
}

/** Re-reads the viewport; keeps the old object when nothing moved (useSyncExternalStore). */
function refresh(): boolean {
  const next = measure()
  if (next.top === snapshot.top && next.height === snapshot.height && next.keyboard === snapshot.keyboard) {
    return false
  }
  snapshot = next
  return true
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** resize and scroll fire many times a frame while the keyboard slides; measure once per frame. */
function onViewportChange(): void {
  if (frame !== 0) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (refresh()) notify()
  })
}

function clearSettleTimers(): void {
  for (const timer of settleTimers) clearTimeout(timer)
  settleTimers = []
}

/** Focus moved, so the keyboard may be coming or going: check again after its slide (SETTLE_MS). */
function onFocusChange(): void {
  clearSettleTimers()
  settleTimers = SETTLE_MS.map((ms) => setTimeout(onViewportChange, ms))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    window.visualViewport?.addEventListener('resize', onViewportChange)
    window.visualViewport?.addEventListener('scroll', onViewportChange)
    window.addEventListener('resize', onViewportChange)
    document.addEventListener('focusin', onFocusChange)
    document.addEventListener('focusout', onFocusChange)
    // The viewport may have moved while nobody listened.
    refresh()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    window.visualViewport?.removeEventListener('resize', onViewportChange)
    window.visualViewport?.removeEventListener('scroll', onViewportChange)
    window.removeEventListener('resize', onViewportChange)
    document.removeEventListener('focusin', onFocusChange)
    document.removeEventListener('focusout', onFocusChange)
    clearSettleTimers()
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
  }
}

function getSnapshot(): VisualViewportState {
  // Without listeners nothing keeps the snapshot current, so read it now (it is cheap).
  if (listeners.size === 0) refresh()
  return snapshot
}

function getServerSnapshot(): VisualViewportState {
  return SERVER_STATE
}

/**
 * The visual viewport, updated on its resize and scroll events at most once a frame (docs/SPEC.md
 * §5.8), and once more after each keyboard slide. Sheets, dialogs and toasts follow it while the
 * keyboard is up, so the iOS keyboard never covers them (§7).
 */
export function useVisualViewport(): VisualViewportState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
