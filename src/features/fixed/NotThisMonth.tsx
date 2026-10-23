import { useId, useState } from 'react'
import type { CategoryDisplay } from '@/domain/queries'
import { notThisMonthLabel } from '@/domain/recurring'
import type { MonthKey, Recurring } from '@/domain/types'
import { RecurringRow, RowGroup } from '@/features/fixed/FixedList'
import { itemAmount } from '@/features/fixed/fixedModel'
import styles from '@/features/fixed/NotThisMonth.module.css'
import { ListRow } from '@/ui'

export interface NotThisMonthProps {
  /** Items with no line in the period, in the order to show them. */
  items: readonly Recurring[]
  month: MonthKey
  startDay: number
  locale: string
  /** The coin of each row, where rows are not filtered to one category. */
  coinFor?(r: Recurring): CategoryDisplay
  onOpen(r: Recurring): void
}

/**
 * The collapsed "Not this month" group (docs/SPEC.md §3.5): items that count nothing in the
 * period, each saying why ("Starts November", "Ended October", "Next: Mon 15 Mar"), with the amount
 * of its next (or last) charge in --ink-2. A disclosure row with the count heads the group
 * (DESIGN.md §9.8); it opens the rows under it in the same group, and they open their sheet.
 */
export function NotThisMonth({ items, month, startDay, locale, coinFor, onOpen }: NotThisMonthProps) {
  const [open, setOpen] = useState(false)
  const groupId = useId()
  if (items.length === 0) return null
  const count = `${items.length} ${items.length === 1 ? 'item' : 'items'}`
  return (
    <RowGroup className={styles.group}>
      <ListRow
        title="Not this month"
        detail={items.length}
        chevron="down"
        expanded={open}
        controls={groupId}
        label={`Not this month ${count}`}
        onClick={() => setOpen(!open)}
      />
      {/* One row for the hairline under the head; the rows inside keep their own. */}
      <div id={groupId} hidden={!open} data-row="">
        {items.map((r) => (
          <RecurringRow
            key={r.id}
            item={r}
            subtitle={notThisMonthLabel(r, month, startDay, locale)}
            amount={itemAmount(r, month)}
            tone="muted"
            check={null}
            coin={coinFor?.(r)}
            onOpen={() => onOpen(r)}
          />
        ))}
      </div>
    </RowGroup>
  )
}
