import type { MouseEvent } from 'react'
import { IconButton } from '@/ui'
import styles from './OrderButtons.module.css'

export interface OrderButtonsProps {
  /** The item's name, for the buttons' names: "Move Recent up". */
  name: string
  /** The item is first: its up button is disabled. */
  first: boolean
  /** The item is last: its down button is disabled. */
  last: boolean
  /**
   * 'stack' (default): up over down in a 44pt column, for rows of 88 or more, like the Wallet's
   * goal rows (DESIGN.md §9.26). 'row': side by side, for one- and two-line rows.
   */
  layout?: 'stack' | 'row'
  onMove(event: MouseEvent<HTMLButtonElement>, delta: -1 | 1): void
}

/**
 * The up and down buttons that reorder a row (docs/SPEC.md §3.7): 44pt targets with regular 17px
 * arrows in --ink-3, like the goal order buttons (DESIGN.md §8, §9.26). At an end the button stays
 * in place, disabled, so nothing shifts. They reach 8 into the row's trailing padding.
 */
export function OrderButtons({ name, first, last, layout = 'stack', onMove }: OrderButtonsProps) {
  return (
    <div className={layout === 'stack' ? styles.stack : styles.row} data-order-buttons="">
      <IconButton
        icon="arrow-up"
        weight="regular"
        iconSize={17}
        label={`Move ${name} up`}
        className={styles.arrow}
        disabled={first}
        onClick={(event) => onMove(event, -1)}
      />
      <IconButton
        icon="arrow-down"
        weight="regular"
        iconSize={17}
        label={`Move ${name} down`}
        className={styles.arrow}
        disabled={last}
        onClick={(event) => onMove(event, 1)}
      />
    </div>
  )
}
