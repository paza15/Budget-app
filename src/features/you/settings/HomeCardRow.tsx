import type { MouseEvent } from 'react'
import { Toggle } from '@/ui'
import styles from './HomeCardRow.module.css'
import { OrderButtons } from './OrderButtons'

export interface HomeCardRowProps {
  /** The card's key, for the reorder motion. */
  cardKey: string
  /** HOME_CARDS name: the switch's name ("Where it went", "Show the sums above the total"). */
  name: string
  description: string
  shown: boolean
  first: boolean
  last: boolean
  onShow(shown: boolean): void
  onMove(event: MouseEvent<HTMLButtonElement>, delta: -1 | 1): void
}

/**
 * One Home card in You › Home layout (docs/SPEC.md §3.7): the kit's Toggle row with the card's
 * name and description (the whole text toggles, as on iOS), then its order buttons outside the
 * switch's hit area.
 */
export function HomeCardRow({ cardKey, name, description, shown, first, last, onShow, onMove }: HomeCardRowProps) {
  return (
    <div className={styles.row} data-row="" data-id={cardKey}>
      <Toggle label={name} description={description} checked={shown} onChange={onShow} className={styles.toggle} />
      <OrderButtons name={name} first={first} last={last} onMove={onMove} />
    </div>
  )
}
