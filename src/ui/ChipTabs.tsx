import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import type { IconRef } from '@/domain/types'
import { CategoryIcon } from '@/ui/CategoryIcon'
import chipStyles from '@/ui/Chip.module.css'
import styles from '@/ui/ChipTabs.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'
import { useReducedMotion } from '@/ui/useReducedMotion'

export interface ChipTabItem<T> {
  value: T
  label: string
  icon?: IconRef
}

export interface ChipTabsProps<T> extends TestIdProps {
  /** NoInfer: T comes from `value`, so a union state type is kept (not widened to string). */
  items: ChipTabItem<NoInfer<T>>[]
  value: T
  onChange(value: NoInfer<T>): void
  /** Accessible name of the tab list. */
  label: string
  /** Test id put on every chip, with the item's value as data-id (e.g. 'category-chip'). */
  itemTestId?: string
  className?: string
}

/** Room kept beside the selected chip when it is scrolled into view: the side padding and the fade. */
const EDGE_START = 20
const EDGE_END = 28

/** Keeps the row's "can scroll further" flag current; the trailing fade shows only then. */
function updateOverflow(row: HTMLElement) {
  const more = row.scrollLeft + row.clientWidth < row.scrollWidth - 1
  row.toggleAttribute('data-more', more)
}

/**
 * A horizontally scrolling row of filter chips (docs/DESIGN.md §9.10): a tab list whose selected
 * chip is scrolled into view, with a 28px fade at the trailing edge while more chips follow.
 * Arrow keys, Home and End move the selection (one tab stop, roving tabindex).
 */
export function ChipTabs<T>({
  items,
  value,
  onChange,
  label,
  itemTestId,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: ChipTabsProps<T>) {
  const rowRef = useRef<HTMLDivElement>(null)
  const scrolledOnce = useRef(false)
  const reduceMotion = useReducedMotion()
  const selected = items.findIndex((item) => Object.is(item.value, value))

  // Scroll the row only, never the page: the chip comes into view inside the edges and the fade.
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const chip = selected < 0 ? undefined : row.querySelectorAll<HTMLElement>('[role="tab"]')[selected]
    if (chip) {
      const start = chip.offsetLeft - EDGE_START
      const end = chip.offsetLeft + chip.offsetWidth + EDGE_END - row.clientWidth
      const target = row.scrollLeft > start ? start : row.scrollLeft < end ? end : row.scrollLeft
      if (target !== row.scrollLeft) {
        const behavior = scrolledOnce.current && !reduceMotion ? 'smooth' : 'auto'
        if (typeof row.scrollTo === 'function') row.scrollTo({ left: Math.max(0, target), behavior })
        else row.scrollLeft = Math.max(0, target)
      }
    }
    scrolledOnce.current = true
    updateOverflow(row)
  }, [selected, reduceMotion])

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return undefined
    const onScroll = () => updateOverflow(row)
    row.addEventListener('scroll', onScroll, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll)
    observer?.observe(row)
    return () => {
      row.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [])

  const focusTab = (index: number) => {
    const item = items[index]
    if (!item) return
    onChange(item.value)
    rowRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return
    const current = selected < 0 ? 0 : selected
    const last = items.length - 1
    const next =
      event.key === 'ArrowRight'
        ? current === last ? 0 : current + 1
        : event.key === 'ArrowLeft'
          ? current === 0 ? last : current - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    focusTab(next)
  }

  return (
    <div
      ref={rowRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      // Focus lives on the tabs; the list itself is only focusable from script.
      tabIndex={-1}
      className={cx(styles.row, className)}
      onKeyDown={onKeyDown}
      data-testid={testId}
      data-id={dataId}
    >
      {items.map((item, index) => {
        const isSelected = index === selected
        return (
          <button
            key={typeof item.value === 'string' || typeof item.value === 'number' ? String(item.value) : index}
            type="button"
            role="tab"
            aria-selected={isSelected}
            // One tab stop: the selected chip (or the first when none is).
            tabIndex={isSelected || (selected < 0 && index === 0) ? 0 : -1}
            className={cx(chipStyles.chip, isSelected && chipStyles.selected)}
            onClick={() => onChange(item.value)}
            data-testid={itemTestId}
            data-id={itemTestId === undefined ? undefined : String(item.value)}
          >
            {item.icon !== undefined && <CategoryIcon icon={item.icon} size={17} />}
            <span className={chipStyles.label}>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
