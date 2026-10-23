import { useState } from 'react'
import type { TxKind } from '@/domain/types'
import { Icon } from '@/ui/Icon'
import styles from '@/ui/PaidCheck.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface PaidCheckProps extends TestIdProps {
  paid: boolean
  /** The item's name, for the accessible name ("Mark Netflix as paid", "Netflix paid"). */
  name: string
  /** Income reads "received" instead of "paid" (docs/SPEC.md §3.5). */
  kind: TxKind
  onToggle(): void
}

/**
 * The light round paid check of a charge line (docs/DESIGN.md §9.8, §10), on Fixed and in Home's
 * Coming up: a 26px ring with a 44pt hit area, a 1.5px --mark ring while due, a 1.25px --ink-2
 * ring with a bold check once ticked. A tick presses it in like a bank stamp; with Reduce Motion
 * it only fades. data-testid defaults to "recurring-paid" (SPEC §9).
 */
export function PaidCheck({ paid, name, kind, onToggle, 'data-testid': testId = 'recurring-paid', 'data-id': dataId }: PaidCheckProps) {
  // The stamp plays only for a tick the user made, never when a paid row first shows.
  const [stamped, setStamped] = useState(false)
  const verb = kind === 'income' ? 'received' : 'paid'
  return (
    <button
      type="button"
      className={cx(styles.check, paid && styles.paid, paid && stamped && styles.stamp)}
      aria-pressed={paid}
      aria-label={paid ? `${name} ${verb}` : `Mark ${name} as ${verb}`}
      data-testid={testId}
      data-id={dataId}
      onClick={() => {
        setStamped(!paid)
        onToggle()
      }}
    >
      <Icon name="check" size={14} className={styles.mark} />
    </button>
  )
}
