import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Progress } from '@/features/onboarding/Progress'
import styles from '@/features/onboarding/StepFrame.module.css'
import { Button, Screen, useVisualViewport } from '@/ui'
import { cx } from '@/ui/text'

/** A button pinned under a step. */
export interface StepAction {
  label: string
  onClick(): void
  disabled?: boolean
}

export interface StepFrameProps {
  /** The large title, also the screen's name. */
  title: string
  /** The short name in the compact header once the title has scrolled away ("Money in"). */
  compactTitle: string
  /** A sentence under the title, in --ink-2. */
  lead?: ReactNode
  /** Position of this step among the steps that apply, for the progress ruler. */
  progress: { index: number; count: number }
  onBack(): void
  /** The pinned primary button ("Continue", "Start budgeting"). */
  primary?: StepAction
  /** The plain button under it ("Skip for now", "Not now"). Hidden while the keyboard is up. */
  secondary?: StepAction
  /** Slide in from the side the user is going to; null on the first render. */
  direction: 'forward' | 'back' | null
  children?: ReactNode
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'month'])

function isTextEntry(element: Element): element is HTMLElement {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(element.type)
  return element instanceof HTMLElement && element.isContentEditable
}

/** Scrolls the step so `field` sits clear of the sticky nav row and of the bottom edge. */
function reveal(field: HTMLElement, scroller: HTMLElement): void {
  const margin = 24
  const box = scroller.getBoundingClientRect()
  const nav = scroller.querySelector('header')
  const top = box.top + (nav?.offsetHeight ?? 0) + margin
  const bottom = box.bottom - margin
  const rect = field.getBoundingClientRect()
  if (rect.bottom > bottom) scroller.scrollTop += Math.min(rect.bottom - bottom, rect.top - top)
  else if (rect.top < top) scroller.scrollTop -= top - rect.top
}

/**
 * iOS scrolls the page, or pans the visual viewport, to show a focused field and does not always
 * undo it when the keyboard goes; the document never scrolls in this app (docs/SPEC.md §7).
 */
function settleDocumentScroll(): void {
  const vv = window.visualViewport
  const panned = vv !== null && vv.scale === 1 && (vv.offsetTop !== 0 || vv.offsetLeft !== 0)
  if (window.scrollX !== 0 || window.scrollY !== 0 || panned) window.scrollTo(0, 0)
}

/**
 * The layout of onboarding steps 2 to 7 (docs/DESIGN.md §9.25): the kit's Screen with "‹ Back"
 * and the progress ruler in its nav row, a left-aligned large title and form groups, and the
 * buttons pinned above the bottom safe area.
 *
 * Keyboard (docs/SPEC.md §7): while it is up the frame is the visual viewport, so the primary
 * button sits on the keyboard and nothing hides behind it; the focused field is scrolled into view
 * whenever focus moves or the visible height changes. Each step mounts its own frame, and focus
 * moves to the new title so VoiceOver reads where the user is.
 */
export function StepFrame({
  title,
  compactTitle,
  lead,
  progress,
  onBack,
  primary,
  secondary,
  direction,
  children,
}: StepFrameProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const keyboardWasUp = useRef(false)
  const viewport = useVisualViewport()
  const keyboardUp = viewport.keyboard > 0

  // Keep the focused field in view each time the visible height changes with the keyboard up.
  const visibleHeight = viewport.height
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const active = document.activeElement
    if (!keyboardUp || visibleHeight <= 0 || scroller === null || active === null) return
    if (scroller.contains(active) && isTextEntry(active)) reveal(active, scroller)
  }, [keyboardUp, visibleHeight])

  // Moving between fields while the keyboard stays up resizes nothing, so reveal on focus too.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    let frame = 0
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !isTextEntry(target)) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => reveal(target, scroller))
    }
    scroller.addEventListener('focusin', onFocusIn)
    return () => {
      scroller.removeEventListener('focusin', onFocusIn)
      cancelAnimationFrame(frame)
    }
  }, [])

  // After the keyboard: back to the layout viewport, and the page back to the top, now and once
  // more after iOS has finished laying out the closing keyboard.
  useEffect(() => {
    const wasUp = keyboardWasUp.current
    keyboardWasUp.current = keyboardUp
    if (!wasUp || keyboardUp) return
    settleDocumentScroll()
    const frame = requestAnimationFrame(settleDocumentScroll)
    return () => cancelAnimationFrame(frame)
  }, [keyboardUp])

  const frameStyle = keyboardUp
    ? ({ '--vv-top': `${viewport.top}px`, '--vv-height': `${viewport.height}px` } as CSSProperties)
    : undefined
  const showSecondary = secondary !== undefined && !keyboardUp

  return (
    <div
      className={cx(styles.frame, direction === 'forward' && styles.forward, direction === 'back' && styles.back)}
      data-keyboard={keyboardUp || undefined}
      style={frameStyle}
    >
      <div className={styles.screen}>
        <Screen
          title={title}
          compactTitle={compactTitle}
          largeTitle
          onBack={onBack}
          headerRight={<Progress index={progress.index} count={progress.count} />}
          tabBar={false}
          // Announce the new step: its title takes focus as the step mounts.
          focusTitle
          scrollRef={scrollRef}
        >
          {lead !== undefined && <p className={styles.lead}>{lead}</p>}
          {children}
        </Screen>
      </div>
      {(primary !== undefined || showSecondary) && (
        <div className={styles.actions}>
          {primary !== undefined && (
            <Button variant="primary" size="lg" block onClick={primary.onClick} disabled={primary.disabled}>
              {primary.label}
            </Button>
          )}
          {showSecondary && (
            <Button variant="plain" size="lg" block onClick={secondary.onClick} disabled={secondary.disabled}>
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
