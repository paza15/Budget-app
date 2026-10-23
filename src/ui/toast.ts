/** Toasts (docs/SPEC.md §5.8): one at a time, above sheets, announced through role=status. */

export interface ToastAction {
  label: string
  onClick(): void
}

export interface ToastOptions {
  message: string
  /** e.g. Undo. */
  action?: ToastAction
  /** Default 'default'. */
  tone?: 'default' | 'success' | 'critical'
  /** Default 4000 ms, or 6000 ms with an action. */
  durationMs?: number
}

export interface ToastHandle {
  dismiss(): void
}

/** The toast on screen, as ToastHost renders it. */
export interface ToastState {
  readonly id: number
  readonly message: string
  readonly action: ToastAction | undefined
  readonly tone: 'default' | 'success' | 'critical'
  /** Fading out; gone after the fade. */
  readonly leaving: boolean
}

const DEFAULT_MS = 4000
const WITH_ACTION_MS = 6000
/** The leave fade: --dur-fade in tokens.css (Reduce Motion keeps it). */
const LEAVE_MS = 200
/** After the pointer or focus leaves a paused toast it stays at least this long. */
const AFTER_PAUSE_MS = 1500
/** setTimeout fires at once for anything longer. */
const MAX_TIMEOUT = 2_147_483_647

let current: ToastState | null = null
const listeners = new Set<() => void>()
let nextId = 1
let timer: ReturnType<typeof setTimeout> | undefined
/** Time left before the current toast leaves, while it is not paused. */
let remaining = 0
let startedAt = 0
let paused = false

function emit(): void {
  for (const listener of listeners) listener()
}

function clearTimer(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}

function startTimer(id: number): void {
  clearTimer()
  // A duration of Infinity keeps the toast until it is dismissed.
  if (!Number.isFinite(remaining)) return
  startedAt = Date.now()
  timer = setTimeout(() => dismissToast(id), Math.min(Math.max(0, remaining), MAX_TIMEOUT))
}

/** Shows a toast, replacing the current one. Call only from event handlers. */
export function toast(o: ToastOptions): ToastHandle {
  const id = nextId++
  current = { id, message: o.message, action: o.action, tone: o.tone ?? 'default', leaving: false }
  remaining = o.durationMs ?? (o.action ? WITH_ACTION_MS : DEFAULT_MS)
  paused = false
  startTimer(id)
  emit()
  return { dismiss: () => dismissToast(id) }
}

/** Fades the toast out if it is still the one on screen (a replaced toast's handle does nothing). */
export function dismissToast(id: number): void {
  if (current === null || current.id !== id || current.leaving) return
  clearTimer()
  paused = false
  current = { ...current, leaving: true }
  emit()
  timer = setTimeout(() => {
    timer = undefined
    if (current?.id !== id) return
    current = null
    emit()
  }, LEAVE_MS)
}

/** Holds the toast while the pointer is on it or focus is inside it (WCAG 2.2.1). */
export function pauseToast(id: number): void {
  if (current === null || current.id !== id || current.leaving || paused) return
  paused = true
  clearTimer()
  remaining -= Date.now() - startedAt
}

export function resumeToast(id: number): void {
  if (current === null || current.id !== id || current.leaving || !paused) return
  paused = false
  remaining = Math.max(remaining, AFTER_PAUSE_MS)
  startTimer(id)
}

/** For ToastHost (useSyncExternalStore). */
export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function currentToast(): ToastState | null {
  return current
}
