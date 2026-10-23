import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { bandScale } from '@/ui/charts/scale'

/** Horizontal travel (px) before a press becomes a scrub instead of a tap. */
const SCRUB_SLOP = 6

interface Gesture {
  pointerId: number
  startX: number
  startKey: string
  /** The press began on the column whose tooltip is open: a tap closes it. */
  wasSelected: boolean
  scrubbing: boolean
}

export interface ColumnSelectionOptions {
  /** Column keys, left to right. */
  keys: readonly string[]
  /** Width of the plot the columns share, in CSS px from the plot element's left edge. */
  plotWidth: number
  /** Controlled selection; undefined lets the chart keep its own. */
  selectedKey?: string | null
  onSelect?(key: string | null): void
  /** Where the arrow keys start when nothing is selected, e.g. today's column. */
  startKey?: string
}

export interface ColumnSelection {
  /** The selected column's key, or null (also when the key is not among `keys`). */
  selected: string | null
  /** The chart's root: a press outside it closes the tooltip. */
  rootRef: RefObject<HTMLDivElement | null>
  plotHandlers: {
    onPointerDown(event: PointerEvent<HTMLDivElement>): void
    onPointerMove(event: PointerEvent<HTMLDivElement>): void
    onPointerUp(event: PointerEvent<HTMLDivElement>): void
    onPointerCancel(): void
  }
  /** For the focusable picture: arrow keys, Home and End move the selection; leaving closes it. */
  keyHandlers: {
    onKeyDown(event: KeyboardEvent<Element>): void
    onBlur(event: FocusEvent<Element>): void
  }
  /** Clears the selection, as a press outside the chart does: the tooltip's onDismiss. */
  clear(): void
}

/**
 * Tap, scrub and keyboard selection for the column charts (docs/DESIGN.md §9.22). A tap selects
 * the column under the finger (its whole slot is the target, so a day with nothing spent is still
 * tappable); a tap on the selected column, a press outside the chart or Escape clears it; a
 * horizontal drag scrubs across columns. The plot sets touch-action: pan-y, so a vertical drag
 * scrolls the page (pointercancel) without selecting anything. With the keyboard, the arrow keys
 * step through the columns, so the tooltip shows on focus as it does on tap.
 */
export function useColumnSelection({
  keys,
  plotWidth,
  selectedKey,
  onSelect,
  startKey,
}: ColumnSelectionOptions): ColumnSelection {
  const [ownKey, setOwnKey] = useState<string | null>(null)
  const current = selectedKey !== undefined ? selectedKey : ownKey
  const selected = current !== null && keys.includes(current) ? current : null
  const rootRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)

  const select = (key: string | null) => {
    if (key === selected) return
    setOwnKey(key)
    onSelect?.(key)
  }

  const keyAt = (event: PointerEvent<HTMLDivElement>): string | null => {
    const left = event.currentTarget.getBoundingClientRect().left
    return keys[bandScale(keys.length, plotWidth).indexAt(event.clientX - left)] ?? null
  }

  const plotHandlers: ColumnSelection['plotHandlers'] = {
    onPointerDown(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const key = keyAt(event)
      if (key === null) return
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startKey: key,
        wasSelected: key === selected,
        scrubbing: false,
      }
      // Keep the moves of a scrub that leaves the plot; not every engine supports capture.
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // The scrub then ends at the plot's edge.
      }
    },
    onPointerMove(event) {
      const active = gesture.current
      if (active === null || active.pointerId !== event.pointerId) return
      if (!active.scrubbing && Math.abs(event.clientX - active.startX) < SCRUB_SLOP) return
      active.scrubbing = true
      const key = keyAt(event)
      if (key !== null) select(key)
    },
    onPointerUp(event) {
      const active = gesture.current
      if (active === null || active.pointerId !== event.pointerId) return
      gesture.current = null
      if (active.scrubbing) return
      select(active.wasSelected ? null : active.startKey)
    },
    onPointerCancel() {
      gesture.current = null
    },
  }

  const keyHandlers: ColumnSelection['keyHandlers'] = {
    onKeyDown(event) {
      const last = keys.length - 1
      if (last < 0) return
      const at = selected === null ? -1 : keys.indexOf(selected)
      const start = startKey === undefined ? -1 : keys.indexOf(startKey)
      let next: number
      if (event.key === 'ArrowRight') next = at >= 0 ? Math.min(last, at + 1) : start >= 0 ? start : 0
      else if (event.key === 'ArrowLeft') next = at >= 0 ? Math.max(0, at - 1) : start >= 0 ? start : last
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = last
      else return
      event.preventDefault()
      select(keys[next] ?? null)
    },
    onBlur(event) {
      const root = rootRef.current
      const to = event.relatedTarget
      if (root !== null && to instanceof Node && root.contains(to)) return
      select(null)
    },
  }

  const closeOnOutsidePress = useEffectEvent((event: Event) => {
    const root = rootRef.current
    if (root !== null && event.target instanceof Node && root.contains(event.target)) return
    select(null)
  })
  const closeOnEscape = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key === 'Escape') select(null)
  })
  const open = selected !== null
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: Event) => closeOnOutsidePress(event)
    const onKeyDown = (event: globalThis.KeyboardEvent) => closeOnEscape(event)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return { selected, rootRef, plotHandlers, keyHandlers, clear: () => select(null) }
}
