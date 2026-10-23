/**
 * Confirmation dialogs and iOS-style action sheets (docs/SPEC.md §5.8), rendered by ConfirmHost,
 * and the stack of modal layers (sheets and these dialogs) that decides which one is on top.
 */

import type { IconRef } from '@/domain/types'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel: string
  /** Default "Cancel". */
  cancelLabel?: string
  /** Shows the confirm button as destructive. */
  destructive?: boolean
}

export interface ChooseOption<T extends string> {
  value: T
  label: string
  destructive?: boolean
  /**
   * A category glyph or emoji at the row's leading edge, e.g. a quick add's (docs/DESIGN.md §9.1).
   * Decorative: the label names the option.
   */
  icon?: IconRef
}

export interface ChooseOptions<T extends string> {
  title: string
  message?: string
  options: ChooseOption<T>[]
  /** Default "Cancel". */
  cancelLabel?: string
}

// ── Dialog queue ──────────────────────────────────────────────────────────────────────────────

/** A dialog waiting for an answer. ConfirmHost shows the oldest one. */
export type DialogRequest =
  | { readonly id: number; readonly kind: 'confirm'; readonly options: ConfirmOptions; readonly closing: boolean }
  | {
      readonly id: number
      readonly kind: 'choose'
      readonly options: ChooseOptions<string>
      readonly closing: boolean
    }

/** true or false for confirmDialog; the chosen value, or null for cancel, for chooseDialog. */
export type DialogAnswer = boolean | string | null

let queue: readonly DialogRequest[] = []
const settlers = new Map<number, (answer: DialogAnswer) => void>()
const dialogListeners = new Set<() => void>()
let nextDialogId = 1

function setQueue(next: readonly DialogRequest[]): void {
  queue = next
  for (const listener of dialogListeners) listener()
}

/** Resolves true when confirmed, false when cancelled. */
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextDialogId++
    settlers.set(id, (answer) => resolve(answer === true))
    setQueue([...queue, { id, kind: 'confirm', options: o, closing: false }])
  })
}

/** An action sheet. Resolves the chosen option's value, or null when cancelled. */
export function chooseDialog<T extends string>(o: ChooseOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const id = nextDialogId++
    settlers.set(id, (answer) => resolve(o.options.find((option) => option.value === answer)?.value ?? null))
    setQueue([...queue, { id, kind: 'choose', options: o, closing: false }])
  })
}

/** For ConfirmHost (useSyncExternalStore). */
export function subscribeDialogs(listener: () => void): () => void {
  dialogListeners.add(listener)
  return () => {
    dialogListeners.delete(listener)
  }
}

/** The dialog on screen: the oldest in the queue, possibly still fading out. */
export function currentDialog(): DialogRequest | null {
  return queue[0] ?? null
}

/** Settles a dialog's promise at once; ConfirmHost then plays its exit and calls removeDialog. */
export function answerDialog(id: number, answer: DialogAnswer): void {
  const settle = settlers.get(id)
  if (!settle) return
  settlers.delete(id)
  setQueue(queue.map((request) => (request.id === id ? { ...request, closing: true } : request)))
  settle(answer)
}

/** Takes an answered dialog off the screen so the next one in the queue can show. */
export function removeDialog(id: number): void {
  if (queue.some((request) => request.id === id)) setQueue(queue.filter((request) => request.id !== id))
}

// ── Modal layers ──────────────────────────────────────────────────────────────────────────────
//
// Every open sheet and dialog registers here in the order it opened. Only the top layer reacts to
// Escape and keeps Tab inside itself. While any layer is open #app-root is inert (layers render
// into document.body, outside it), and every layer below the top one is inert too, so stacked
// sheets and a dialog over a sheet behave as one modal stack (docs/SPEC.md §5.5, §5.8).

export interface ModalLayer {
  /** The layer's root element, outside #app-root. */
  readonly element: HTMLElement
  /** Escape was pressed while this layer is on top. */
  onEscape(): void
  /** Where focus returns when the layer closes, if anywhere. */
  opener: HTMLElement | null
}

const layers: ModalLayer[] = []
/** #app-root's own inert state (App sets it while the lock screen is up), kept while layers are open. */
let appRootInert: boolean | null = null
let rootObserver: MutationObserver | null = null
let observedRoot: HTMLElement | null = null
/** The layers are hidden under the lock screen. */
let lockedLayers = false

/** Registers an open layer on top of the stack; the returned function removes it again. */
export function openModalLayer(layer: ModalLayer): () => void {
  layers.push(layer)
  if (layers.length === 1) document.addEventListener('keydown', onKeyDown)
  syncLayers()
  let removed = false
  return () => {
    if (removed) return
    removed = true
    const index = layers.indexOf(layer)
    if (index === -1) return
    const wasTop = index === layers.length - 1
    layers.splice(index, 1)
    // A closing layer keeps playing its exit but takes no more input or focus.
    layer.element.toggleAttribute('inert', true)
    // Layers opened from inside this one return focus to where this one came from.
    for (const other of layers) {
      if (other.opener !== null && layer.element.contains(other.opener)) other.opener = layer.opener
    }
    if (layers.length === 0) document.removeEventListener('keydown', onKeyDown)
    syncLayers()
    if (!wasTop) return
    restoreFocus(layer.opener)
    // Layers close from a layout-effect cleanup, inside a React commit. At the end of the commit
    // React puts focus back on the element that had it before, which can be inside this layer (it
    // stays mounted while it plays its exit). Browsers refuse that because the layer is inert by
    // now; where inert is missing, move focus out again once the commit is over. A layer that
    // opened again meanwhile on the same element (StrictMode runs effects twice) keeps its focus.
    queueMicrotask(() => {
      const reopened = layers.some((other) => other.element === layer.element)
      if (!reopened && layer.element.contains(document.activeElement)) restoreFocus(layer.opener)
    })
  }
}

/** True while `element` belongs to the top layer, which alone reacts to Escape, the scrim and drags. */
export function isTopModalElement(element: Element): boolean {
  const top = layers.at(-1)
  return top !== undefined && top.element === element && !element.hasAttribute('inert')
}

function syncLayers(): void {
  const root = document.getElementById('app-root')
  // App hides #app-root while the lock screen is up (§3.8); the layers above it hide with it.
  const locked = root?.getAttribute('aria-hidden') === 'true'
  const unlocked = lockedLayers && !locked
  lockedLayers = locked && layers.length > 0
  const top = layers.at(-1)
  for (const layer of layers) layer.element.toggleAttribute('inert', locked || layer !== top)
  // Back from the lock screen: focus returns to the sheet or dialog that was open under it.
  if (unlocked && top !== undefined && !top.element.contains(document.activeElement)) {
    dialogOf(top.element).focus({ preventScroll: true })
  }
  if (layers.length === 0 || root === null) {
    // The last layer closed: hand #app-root back as App left it.
    if (root !== null && root === observedRoot && appRootInert !== null) root.toggleAttribute('inert', appRootInert)
    unwatchRoot()
    return
  }
  // A root not touched yet (the first layer, or App mounted a new one): its inert state is App's.
  if (root !== observedRoot) watchRoot(root)
  root.toggleAttribute('inert', true)
  // Our own writes are not App's.
  rootObserver?.takeRecords()
}

/**
 * React sets inert and aria-hidden on #app-root when the app locks and unlocks. If that happens
 * while a sheet is open, remember App's value for when the last layer closes and keep the root inert
 * until then.
 */
function watchRoot(root: HTMLElement): void {
  unwatchRoot()
  observedRoot = root
  appRootInert = root.hasAttribute('inert')
  rootObserver = new MutationObserver((records) => {
    if (layers.length === 0 || observedRoot === null) return
    if (records.some((record) => record.attributeName === 'inert')) {
      appRootInert = observedRoot.hasAttribute('inert')
    }
    syncLayers()
  })
  rootObserver.observe(root, { attributes: true, attributeFilter: ['inert', 'aria-hidden'] })
}

function unwatchRoot(): void {
  rootObserver?.disconnect()
  rootObserver = null
  observedRoot = null
  appRootInert = null
}

function onKeyDown(event: KeyboardEvent): void {
  const top = layers.at(-1)
  if (top === undefined || event.defaultPrevented || event.isComposing) return
  if (top.element.hasAttribute('inert')) return
  if (event.key === 'Escape') {
    event.preventDefault()
    top.onEscape()
  } else if (event.key === 'Tab') {
    trapTab(event, top.element)
  }
}

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',')

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.closest('[inert], [hidden]') === null &&
      // Not in jsdom; there everything counts as visible.
      (typeof element.checkVisibility !== 'function' || element.checkVisibility()),
  )
}

/** The dialog element of a layer (it has tabIndex -1), or the layer itself. */
function dialogOf(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('dialog, [role="dialog"], [role="alertdialog"]') ?? root
}

/** Tab and Shift+Tab cycle through the top layer's controls and never leave it. */
function trapTab(event: KeyboardEvent, root: HTMLElement): void {
  event.preventDefault()
  const items = tabbables(root)
  const first = items[0]
  const last = items.at(-1)
  if (first === undefined || last === undefined) {
    dialogOf(root).focus({ preventScroll: true })
    return
  }
  const active = document.activeElement
  let next: HTMLElement
  if (!(active instanceof HTMLElement) || !root.contains(active)) {
    next = event.shiftKey ? last : first
  } else {
    const index = items.indexOf(active)
    if (index !== -1) {
      next = (event.shiftKey ? items[index - 1] : items[index + 1]) ?? (event.shiftKey ? last : first)
    } else {
      // Focus is on something that is not a stop, such as the dialog itself: go to its neighbours.
      const following = items.findIndex(
        (element) => (active.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      )
      if (event.shiftKey) next = (following === -1 ? last : items[following - 1]) ?? last
      else next = following === -1 ? first : (items[following] ?? first)
    }
  }
  next.focus()
}

function restoreFocus(opener: HTMLElement | null): void {
  if (opener !== null && opener.isConnected && opener.closest('[inert]') === null) {
    opener.focus({ preventScroll: true })
    return
  }
  const top = layers.at(-1)
  if (top !== undefined && !top.element.contains(document.activeElement)) {
    dialogOf(top.element).focus({ preventScroll: true })
  }
}

// Where focus came from, for layers whose content takes focus while they mount (autoFocus).
let lastFocusTarget: EventTarget | null = null
let lastFocusSource: EventTarget | null = null
// The control pressed last, and when (performance.now()). WebKit does not focus a button that is
// tapped or clicked, so when a tap opens a layer nothing outside it has focus.
let lastPressed: HTMLElement | null = null
let lastPressedAt = 0
/** A press this recent opened the layer; the add button's long press opens one after 500ms. */
const PRESS_WINDOW_MS = 1500
const CONTROL = 'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [tabindex]'

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (event) => {
      lastFocusTarget = event.target
      lastFocusSource = event.relatedTarget
    },
    true,
  )
  const onPress = (event: Event) => {
    lastPressed = event.target instanceof Element ? event.target.closest<HTMLElement>(CONTROL) : null
    lastPressedAt = performance.now()
  }
  document.addEventListener('pointerdown', onPress, true)
  document.addEventListener('click', onPress, true)
}

/** The element focus should return to when a layer that has just mounted in `element` closes. */
export function focusOrigin(element: HTMLElement): HTMLElement | null {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) {
    if (!element.contains(active)) return active
    // The layer's content took focus as it mounted: return to where that focus came from.
    const source = lastFocusTarget === active ? lastFocusSource : null
    if (source instanceof HTMLElement && !element.contains(source)) return source
  }
  // Nothing outside had focus (a tapped button): return to the control that was just pressed.
  const pressed = lastPressed
  if (
    pressed !== null &&
    pressed.isConnected &&
    !element.contains(pressed) &&
    performance.now() - lastPressedAt <= PRESS_WINDOW_MS
  ) {
    return pressed
  }
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

function toMs(value: string): number {
  const trimmed = value.trim()
  const amount = Number.parseFloat(trimmed)
  if (!Number.isFinite(amount)) return 0
  return trimmed.endsWith('ms') ? amount : amount * 1000
}

/** The longest transition (duration plus delay) set on an element, in ms; 0 without CSS (tests). */
export function transitionMs(element: Element): number {
  const style = getComputedStyle(element)
  const durations = style.transitionDuration.split(',')
  const delays = style.transitionDelay.split(',')
  let longest = 0
  durations.forEach((duration, i) => {
    longest = Math.max(longest, toMs(duration) + toMs(delays[i] ?? delays[0] ?? '0s'))
  })
  return longest
}
