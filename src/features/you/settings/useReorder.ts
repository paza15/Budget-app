import { useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useReducedMotion } from '@/ui'
import { moveKey, placeMessage } from './order'

/**
 * Reordering with up and down buttons (docs/SPEC.md §3.7) for Home layout, Categories and Quick
 * add buttons: the new order, the two rows trading places in --dur-fade with --ease-standard
 * (transforms only, none with Reduce Motion; DESIGN.md §9.26 "Motion"), focus kept on an order
 * button, and a polite announcement of the new place.
 */

/** A CSS time token ("200ms", "0.2s") in milliseconds; 0 when unreadable. */
function toMs(value: string): number {
  const text = value.trim()
  const number = Number.parseFloat(text)
  if (!Number.isFinite(number)) return 0
  return text.endsWith('ms') ? number : text.endsWith('s') ? number * 1000 : number
}

export interface Reorder {
  /** The element holding the rows; each row carries data-id (ListRow forwards it to its root). */
  listRef: RefObject<HTMLDivElement | null>
  /** The last move in words, for a polite live region. */
  status: string
  /**
   * Moves `key` one place in `keys` and hands the new order to `commit`, which changes the data
   * (call it from the order button's click handler).
   */
  move<K extends string>(
    event: MouseEvent<HTMLButtonElement>,
    keys: readonly K[],
    key: K,
    delta: -1 | 1,
    name: string,
    commit: (next: K[]) => void,
  ): void
}

export function useReorder(): Reorder {
  const reduceMotion = useReducedMotion()
  const listRef = useRef<HTMLDivElement>(null)
  /** Row tops (by key) measured just before a move, read once by the layout effect after it. */
  const before = useRef<Map<string, number> | null>(null)
  const [status, setStatus] = useState('')

  // After the move has rendered: play each moved row from where it was (FLIP).
  useLayoutEffect(() => {
    const tops = before.current
    const list = listRef.current
    before.current = null
    if (tops === null || list === null) return
    const style = getComputedStyle(list)
    const duration = toMs(style.getPropertyValue('--dur-fade'))
    const easing = style.getPropertyValue('--ease-standard').trim() || 'ease'
    if (duration <= 0) return
    for (const row of list.querySelectorAll<HTMLElement>('[data-id]')) {
      const top = tops.get(row.dataset.id ?? '')
      if (top === undefined || typeof row.animate !== 'function') continue
      const shift = top - row.getBoundingClientRect().top
      if (Math.abs(shift) < 0.5) continue
      row.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration, easing })
    }
  })

  const move: Reorder['move'] = (event, keys, key, delta, name, commit) => {
    const index = keys.indexOf(key)
    const next = moveKey(keys, index, delta)
    if (index < 0 || next.every((item, i) => item === keys[i])) return
    const list = listRef.current
    if (!reduceMotion && list !== null) {
      const tops = new Map<string, number>()
      for (const row of list.querySelectorAll<HTMLElement>('[data-id]')) {
        tops.set(row.dataset.id ?? '', row.getBoundingClientRect().top)
      }
      before.current = tops
    }
    const button = event.currentTarget
    flushSync(() => commit(next))
    // At an end the button just used is disabled now: keep focus in the row, on its other button.
    if (button.disabled) {
      button.closest('[data-order-buttons]')?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }
    const message = placeMessage(name, next.indexOf(key) + 1, next.length)
    // The same words twice in a row would not be read again: vary them invisibly.
    setStatus((previous) => (previous === message ? `${message} ` : message))
  }

  return { listRef, status, move }
}
