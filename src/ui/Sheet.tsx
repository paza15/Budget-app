import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { confirmDialog, focusOrigin, isTopModalElement, openModalLayer, transitionMs } from '@/ui/dialogs'
import styles from '@/ui/Sheet.module.css'
import type { TestIdProps } from '@/ui/types'
import { useVisualViewport } from '@/ui/useVisualViewport'

/** Props of the Sheet component (named so it never clashes with SheetProps from app/nav). */
export interface ModalSheetProps extends TestIdProps {
  open: boolean
  /** Escape, the scrim or a drag asked to close (the sheet confirms first when dirty). */
  onClose(): void
  /** The close animation finished; the host may unmount the sheet. */
  onExited?(): void
  /** Accessible name of the dialog. */
  label: string
  /** Default 'auto'. */
  size?: 'auto' | 'large'
  /**
   * What the sheet is printed on. Default 'sheet' (--surface-sheet); 'paper' is statement paper
   * (--surface), for the month-end review (docs/design/EXTRAS.md §1.1). The SheetHeader inside
   * takes the same material.
   */
  material?: 'sheet' | 'paper'
  /** Unsaved changes: dismissing by Escape, scrim or drag asks before closing. */
  dirty?: boolean
  /** Title of that question (docs/SPEC.md §5.10). Default "Discard changes?". */
  discardTitle?: string
  /** The registered sheet name, for tests (SheetHost passes it). */
  'data-sheet'?: string
  children?: ReactNode
}

/**
 * Asks whether to drop unsaved changes, as a dirty sheet does before Escape, the scrim or a drag
 * closes it (docs/SPEC.md §5.10). SheetHost can ask the same after a system back.
 */
export function confirmDiscard(title = 'Discard changes?'): Promise<boolean> {
  return confirmDialog({ title, confirmLabel: 'Discard', cancelLabel: 'Keep editing', destructive: true })
}

/** A release past this share of the sheet's height closes it… */
const DISMISS_SHARE = 0.3
/** …and so does a flick faster than this, in px/ms. */
const DISMISS_SPEED = 0.5
/** Movement before a press becomes a drag, so taps on Cancel or a key still land. */
const DRAG_SLOP = 6
/** The release speed is measured over the last part of the drag. */
const SPEED_WINDOW_MS = 100
/** A drag that asked to close and was not closed by then springs back. */
const CLOSE_GRACE_MS = 700

interface Gesture {
  zone: 'handle' | 'content'
  x0: number
  y0: number
  mode: 'pending' | 'drag' | 'native'
  /** A pull down on the content, taken from the browser's scrolling on the first move. */
  claimed: boolean
  /** Where the drag started, so the sheet does not jump by the slop. */
  dragFrom: number
  offset: number
  samples: { t: number; y: number }[]
  pointerId: number | null
}

/** Puts a dragged sheet back (its transition springs it). */
function settle(panel: HTMLElement | null, layer: HTMLElement | null): void {
  panel?.style.setProperty('--drag', '0px')
  layer?.style.setProperty('--drag-share', '0')
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'month', 'time', 'datetime-local', 'week'])

function isTextEntry(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(element.type)
  return element.isContentEditable
}

/** Scrolls the sheet's content so `field` sits clear of the sticky header and the bottom edge. */
function reveal(field: HTMLElement, content: HTMLElement): void {
  const margin = 24
  const box = content.getBoundingClientRect()
  const header = content.querySelector<HTMLElement>('[data-sheet-header]')
  const top = box.top + (header?.offsetHeight ?? 0) + margin
  const bottom = box.bottom - margin
  const rect = field.getBoundingClientRect()
  if (rect.bottom > bottom) content.scrollTop += Math.min(rect.bottom - bottom, rect.top - top)
  else if (rect.top < top) content.scrollTop -= top - rect.top
}

/**
 * The document never scrolls in this app (docs/SPEC.md §7), but iOS scrolls it, or pans the visual
 * viewport, to show a focused field, and does not always undo that when the keyboard goes. The
 * fixed sheet then sits too high with a gap under it until the next touch. Put the page back.
 */
function settleDocumentScroll(): void {
  const vv = window.visualViewport
  const panned = vv !== null && vv.scale === 1 && (vv.offsetTop !== 0 || vv.offsetLeft !== 0)
  if (window.scrollX !== 0 || window.scrollY !== 0 || panned) window.scrollTo(0, 0)
}

/** Release speed in px/ms (positive is down), from the moves in the last SPEED_WINDOW_MS. */
function releaseSpeed(samples: Gesture['samples'], releasedAt: number): number {
  const last = samples.at(-1)
  if (last === undefined || releasedAt - last.t > SPEED_WINDOW_MS) return 0
  const first = samples.find((sample) => last.t - sample.t <= SPEED_WINDOW_MS) ?? last
  const elapsed = last.t - first.t
  return elapsed > 0 ? (last.y - first.y) / elapsed : 0
}

/**
 * A modal bottom sheet (docs/DESIGN.md §9.16, docs/SPEC.md §5.5, §5.8): the iOS 26 floating sheet
 * over a scrim, rendered into document.body. It is a dialog with aria-modal and a focus trap that
 * makes #app-root inert; only the top sheet reacts to Escape, the scrim and drags; a dirty sheet
 * asks before those close it. It follows the visual viewport, so the iOS keyboard never covers it.
 * After `open` turns false it plays its exit, then calls onExited.
 */
export function Sheet({
  open,
  onClose,
  onExited,
  label,
  size = 'auto',
  material = 'sheet',
  dirty = false,
  discardTitle,
  children,
  'data-testid': testId = 'sheet',
  'data-id': dataId,
  'data-sheet': sheetName,
}: ModalSheetProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDialogElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const confirming = useRef(false)
  const keyboardWasUp = useRef(false)
  const viewport = useVisualViewport()
  const keyboardUp = viewport.keyboard > 0

  // After `open` turns false the sheet stays until its exit has played (docs/SPEC.md §5.5).
  const [exited, setExited] = useState(!open)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setExited(false)
  }

  /** Escape, the scrim or a drag: close, after asking when there are unsaved changes. */
  const requestDismiss = (source: 'escape' | 'scrim' | 'drag') => {
    if (!open || confirming.current) {
      if (source === 'drag') settle(panelRef.current, layerRef.current)
      return
    }
    if (!dirty) {
      onClose()
      return
    }
    // The sheet goes back up while the question is on screen.
    if (source === 'drag') settle(panelRef.current, layerRef.current)
    confirming.current = true
    void confirmDiscard(discardTitle).then((discard) => {
      confirming.current = false
      if (discard) onClose()
    })
  }

  const onEscape = useEffectEvent(() => requestDismiss('escape'))
  /** True when the sheet goes at once (not dirty), so the drag keeps its offset into the exit. */
  const onDragDismiss = useEffectEvent((): boolean => {
    requestDismiss('drag')
    return !dirty
  })
  const onExitDone = useEffectEvent(() => {
    setExited(true)
    onExited?.()
  })

  // While open, the sheet is a layer of the modal stack: #app-root and the layers below are inert,
  // Escape and Tab go to the top layer, and focus returns to where it was when the sheet closes.
  useLayoutEffect(() => {
    const element = layerRef.current
    const panel = panelRef.current
    if (!open || element === null || panel === null) return
    const close = openModalLayer({ element, opener: focusOrigin(element), onEscape: () => onEscape() })
    // The dialog itself takes focus (VoiceOver reads its name), or the control its content marks
    // with data-autofocus (SheetHeader's focusCancel); a field would bring up the keyboard. Not
    // React's autoFocus: StrictMode's second run of this effect would put focus on the dialog.
    if (!panel.contains(document.activeElement)) {
      panel.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
      if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true })
    }
    return close
  }, [open])

  // A sheet that mounts closed has nothing to play.
  const mountedClosed = useRef(!open)
  useEffect(() => {
    if (mountedClosed.current) onExitDone()
  }, [])

  // Closing: wait for the panel's exit transition (or its duration, if no event comes).
  useEffect(() => {
    const panel = panelRef.current
    if (open || exited || panel === null) return
    let done = false
    const finish = () => {
      if (done) return
      done = true
      onExitDone()
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === panel) finish()
    }
    panel.addEventListener('transitionend', onEnd)
    const timer = window.setTimeout(finish, transitionMs(panel) + 60)
    return () => {
      done = true
      panel.removeEventListener('transitionend', onEnd)
      window.clearTimeout(timer)
    }
  }, [open, exited])

  // Drag to dismiss, by the grab handle or the header, or by the content when it is scrolled to the
  // top. Touch events, because only a cancelled first touchmove stops iOS from scrolling instead;
  // pointer events for the mouse.
  useEffect(() => {
    const layer = layerRef.current
    const panel = panelRef.current
    const content = contentRef.current
    if (!open || layer === null || panel === null || content === null) return
    let gesture: Gesture | null = null
    let suppressClicksUntil = 0
    let graceTimer = 0

    const zoneAt = (target: EventTarget | null): Gesture['zone'] | null => {
      if (!(target instanceof Element) || !panel.contains(target)) return null
      if (target.closest('[data-sheet-no-drag]') !== null) return null
      if (target.closest('[data-sheet-grab], [data-sheet-header]') !== null) return 'handle'
      if (!content.contains(target)) return null
      // Only at the top, and not inside a nested scroller that can still scroll up.
      for (let el: Element | null = target; el !== null && el !== panel; el = el.parentElement) {
        if (el.scrollTop > 0) return null
      }
      return 'content'
    }

    const begin = (x: number, y: number, target: EventTarget | null, pointerId: number | null) => {
      gesture = null
      if (!isTopModalElement(layer)) return
      const zone = zoneAt(target)
      if (zone === null) return
      gesture = { zone, x0: x, y0: y, mode: 'pending', claimed: false, dragFrom: y, offset: 0, samples: [], pointerId }
    }

    /** Follows a move; true when the sheet took it (the caller cancels the browser's own scroll). */
    const track = (x: number, y: number, t: number): boolean => {
      const g = gesture
      if (g === null || g.mode === 'native') return false
      const dx = x - g.x0
      const dy = y - g.y0
      if (g.mode === 'pending') {
        if (dx === 0 && dy === 0) return false
        const vertical = Math.abs(dy) >= Math.abs(dx)
        if (g.zone === 'content') {
          // iOS decides on the first move whether it scrolls: a pull down is claimed for the sheet,
          // anything else (up, or sideways along a chip row) scrolls as usual.
          if (!g.claimed) {
            if (dy <= 0 || !vertical) {
              g.mode = 'native'
              return false
            }
            g.claimed = true
          }
          if (Math.hypot(dx, dy) < DRAG_SLOP) return true
        } else {
          // On the handle and header a short wobble stays a tap on Cancel or Save.
          if (Math.hypot(dx, dy) < DRAG_SLOP) return false
          if (!vertical) {
            g.mode = 'native'
            return false
          }
        }
        g.mode = 'drag'
        g.dragFrom = y
        layer.dataset.dragging = ''
      }
      const pulled = y - g.dragFrom
      // Down follows the finger; up resists, since the sheet is already as high as it goes.
      g.offset = pulled >= 0 ? pulled : -Math.sqrt(-pulled) * 2
      panel.style.setProperty('--drag', `${g.offset}px`)
      layer.style.setProperty('--drag-share', String(Math.min(1, Math.max(0, g.offset / (panel.offsetHeight || 1)))))
      g.samples.push({ t, y })
      while (g.samples.length > 2 && t - (g.samples[0]?.t ?? t) > SPEED_WINDOW_MS) g.samples.shift()
      return true
    }

    const release = (t: number) => {
      const g = gesture
      gesture = null
      if (g === null || g.mode !== 'drag') return
      delete layer.dataset.dragging
      // A drag is not a tap on whatever it started on.
      suppressClicksUntil = t + 400
      const fast = releaseSpeed(g.samples, t) > DISMISS_SPEED
      if (g.offset > 0 && (g.offset > panel.offsetHeight * DISMISS_SHARE || fast)) {
        // Closing at once: the exit continues from where the finger let go.
        if (onDragDismiss()) {
          window.clearTimeout(graceTimer)
          graceTimer = window.setTimeout(() => settle(panel, layer), CLOSE_GRACE_MS)
        }
      } else {
        settle(panel, layer)
      }
    }

    const cancel = () => {
      const g = gesture
      gesture = null
      if (g?.mode !== 'drag') return
      delete layer.dataset.dragging
      settle(panel, layer)
    }

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (event.touches.length !== 1 || touch === undefined) {
        cancel()
        return
      }
      begin(touch.clientX, touch.clientY, event.target, null)
    }
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (gesture === null || touch === undefined) return
      if (track(touch.clientX, touch.clientY, event.timeStamp) && event.cancelable) event.preventDefault()
    }
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) release(event.timeStamp)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      begin(event.clientX, event.clientY, event.target, event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (gesture?.pointerId !== event.pointerId) return
      if (track(event.clientX, event.clientY, event.timeStamp)) event.preventDefault()
    }
    const onPointerUp = (event: PointerEvent) => {
      if (gesture?.pointerId === event.pointerId) release(event.timeStamp)
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (gesture?.pointerId === event.pointerId) cancel()
    }
    const onClickCapture = (event: globalThis.MouseEvent) => {
      if (event.timeStamp > suppressClicksUntil) return
      event.preventDefault()
      event.stopPropagation()
    }

    panel.addEventListener('touchstart', onTouchStart, { passive: true })
    panel.addEventListener('touchmove', onTouchMove, { passive: false })
    panel.addEventListener('touchend', onTouchEnd)
    panel.addEventListener('touchcancel', cancel)
    panel.addEventListener('pointerdown', onPointerDown)
    panel.addEventListener('click', onClickCapture, true)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      panel.removeEventListener('touchstart', onTouchStart)
      panel.removeEventListener('touchmove', onTouchMove)
      panel.removeEventListener('touchend', onTouchEnd)
      panel.removeEventListener('touchcancel', cancel)
      panel.removeEventListener('pointerdown', onPointerDown)
      panel.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.clearTimeout(graceTimer)
      delete layer.dataset.dragging
    }
  }, [open])

  // Keyboard (docs/SPEC.md §7): while it is up the frame is the visual viewport, so the panel sits
  // on the keyboard and its max-height shrinks to what is visible; keep the focused field in view
  // each time the visible height changes.
  const visibleHeight = viewport.height
  useLayoutEffect(() => {
    const content = contentRef.current
    const active = document.activeElement
    if (!open || !keyboardUp || visibleHeight <= 0 || content === null || !(active instanceof HTMLElement)) return
    if (content.contains(active) && isTextEntry(active)) reveal(active, content)
  }, [open, keyboardUp, visibleHeight])

  // The scroll-edge fade under the SheetHeader shows once the content has scrolled under it
  // (SheetHeader.module.css). An attribute, not state, so scrolling never re-renders the sheet.
  useEffect(() => {
    const content = contentRef.current
    if (!open || content === null) return
    const sync = () => content.toggleAttribute('data-sheet-scrolled', content.scrollTop > 0)
    sync()
    content.addEventListener('scroll', sync, { passive: true })
    return () => content.removeEventListener('scroll', sync)
  }, [open])

  // Moving between fields while the keyboard stays up does not resize anything, so reveal on focus.
  useEffect(() => {
    const content = contentRef.current
    if (!open || content === null) return
    let frame = 0
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !isTextEntry(target)) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => reveal(target, content))
    }
    content.addEventListener('focusin', onFocusIn)
    return () => {
      content.removeEventListener('focusin', onFocusIn)
      cancelAnimationFrame(frame)
    }
  }, [open])

  // After the keyboard: the frame goes back to the layout viewport (no stale keyboard-time size can
  // hold the sheet up), and the page goes back to the top, once now and once more after iOS has
  // finished its own re-layout of the closing keyboard.
  useEffect(() => {
    const wasUp = keyboardWasUp.current
    keyboardWasUp.current = keyboardUp
    if (!wasUp || keyboardUp) return
    settleDocumentScroll()
    const frame = requestAnimationFrame(settleDocumentScroll)
    return () => cancelAnimationFrame(frame)
  }, [keyboardUp])

  if (!open && exited) return null

  const frameStyle = keyboardUp
    ? ({ '--vv-top': `${viewport.top}px`, '--vv-height': `${viewport.height}px` } as CSSProperties)
    : undefined
  const onScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && layerRef.current !== null && isTopModalElement(layerRef.current)) {
      requestDismiss('scrim')
    }
  }

  return createPortal(
    <div
      ref={layerRef}
      className={styles.layer}
      data-state={open ? 'open' : 'closing'}
      data-keyboard={keyboardUp || undefined}
      style={frameStyle}
    >
      {/* Tapping outside closes, like Escape; keyboard and VoiceOver users have Cancel and Escape. */}
      <div className={styles.scrim} aria-hidden="true" data-sheet-scrim="" onClick={onScrimClick} />
      {/* Shown with `open`, not showModal(): the top layer would sit above toasts, which belong
          over sheets. The modal stack (dialogs.ts) does the modal part: inert, Escape, Tab. */}
      <dialog
        ref={panelRef}
        open
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={styles.panel}
        data-size={size}
        data-material={material}
        data-testid={testId}
        data-id={dataId}
        data-sheet={sheetName}
      >
        <div className={styles.grab} aria-hidden="true" data-sheet-grab="">
          <span className={styles.handle} />
        </div>
        <div ref={contentRef} className={styles.content}>
          {children}
        </div>
      </dialog>
    </div>,
    document.body,
  )
}
