import { formatRelativeDue } from '@/domain/dates'
import { sumCents } from '@/domain/money'
import { categoryDisplay } from '@/domain/queries'
import type { RecurringLine } from '@/domain/recurring'
import type { ISODate } from '@/domain/types'
import { useCategoryMap, useSettings } from '@/store/hooks'
import { CategoryBadge, ListRow, Money, PaidCheck, Section } from '@/ui'

export interface ComingUpCardProps {
  /** upcomingFixed(summary, today): unpaid, unskipped charges due from today to the period's end. */
  lines: RecurringLine[]
  today: ISODate
  /** Opens the fixed cost. */
  onOpen(line: RecurringLine): void
  /** Ticks the charge off as paid. */
  onPaid(line: RecurringLine): void
}

/**
 * Coming up (docs/SPEC.md §3.1), current period only: the fixed costs still due, at most four, each
 * with its category coin, the due day ("Today", "Tomorrow", "In 5 days", "Sun 25 Oct"), the amount
 * and the paid check of DESIGN.md §9.8. The section meta adds them up.
 */
export function ComingUpCard({ lines, today, onOpen, onPaid }: ComingUpCardProps) {
  const categories = useCategoryMap()
  const { locale } = useSettings()
  return (
    <Section title="Coming up" meta={<Money cents={sumCents(lines.map((line) => line.amount))} />}>
      {lines.map((line) => {
        const item = line.recurring
        const category = categoryDisplay(item.categoryId, categories)
        return (
          <ListRow
            key={item.id}
            leading={<CategoryBadge icon={category.icon} color={category.color} />}
            title={item.name}
            subtitle={line.dueDate === null ? undefined : formatRelativeDue(line.dueDate, today, locale)}
            value={<Money cents={line.amount} />}
            onClick={() => onOpen(line)}
            // A paid charge leaves the card (the Undo toast brings it back), so the check is never ticked here.
            trailing={<PaidCheck paid={false} name={item.name} kind="expense" onToggle={() => onPaid(line)} data-id={item.id} />}
            data-id={item.id}
          />
        )
      })}
    </Section>
  )
}
