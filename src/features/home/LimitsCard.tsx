import { categoryDisplay } from '@/domain/queries'
import type { CategorySpend } from '@/domain/summary'
import type { Cents } from '@/domain/types'
import { LIMIT_ROWS } from '@/features/home/homeData'
import { useCategoryMap, useMoneyFormat } from '@/store/hooks'
import { Button, CategoryBadge, MASKED_LABEL, Meter, Money, Section, withTrueMinus } from '@/ui'
import styles from './LimitsCard.module.css'

export interface LimitsCardProps {
  /** Every limit, in display order (limitRows). Empty shows the empty line. */
  rows: CategorySpend[]
  /** Today's share of the current period for the meters' notch; null in other periods. */
  timeRatio: number | null
  onCategory(categoryId: string): void
  /** Opens Categories, where limits are set. */
  onCategories(): void
}

/**
 * Limits (docs/SPEC.md §3.1, DESIGN.md §9.21): one meter row per category with a monthly limit, at
 * most five (over first, then near the limit, then the highest share), each opening its category;
 * "Show all {n}" opens Categories when there are more. Without limits: "No monthly limits yet." and
 * "Set a limit".
 */
export function LimitsCard({ rows, timeRatio, onCategory, onCategories }: LimitsCardProps) {
  if (rows.length === 0) {
    return (
      <Section title="Limits">
        <div className={styles.empty}>
          <p className={styles.emptyText}>No monthly limits yet.</p>
          <Button variant="secondary" size="md" onClick={onCategories}>
            Set a limit
          </Button>
        </div>
      </Section>
    )
  }
  return (
    <Section
      title="Limits"
      action={rows.length > LIMIT_ROWS ? { label: `Show all ${rows.length}`, onClick: onCategories } : undefined}
    >
      {rows.slice(0, LIMIT_ROWS).map((row) => (
        <LimitRow key={row.categoryId} row={row} timeRatio={timeRatio} onOpen={onCategory} />
      ))}
    </Section>
  )
}

interface LimitRowProps {
  row: CategorySpend
  timeRatio: number | null
  onOpen(categoryId: string): void
}

/**
 * A coin, the name and what was spent, then the meter with "{x} left" / "Over by {x}" and "of
 * {limit}". One button covers the row and reads it as one sentence: "Coffee & snacks, 38,50 € of
 * 40,00 €, near the limit, 1,50 € left".
 */
function LimitRow({ row, timeRatio, onOpen }: LimitRowProps) {
  const categories = useCategoryMap()
  const money = useMoneyFormat()
  const { name, icon, color } = categoryDisplay(row.categoryId, categories)
  const budget = row.budget ?? 0
  const over = row.status === 'over'
  const spoken = (cents: Cents): string => (money.masked ? MASKED_LABEL : withTrueMinus(money.format(cents)))
  const label = [
    name,
    `${spoken(row.total)} of ${spoken(budget)}`,
    row.status === 'warning' ? 'near the limit' : null,
    over ? `over by ${spoken(row.total - budget)}` : `${spoken(Math.max(0, budget - row.total))} left`,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className={styles.row} data-row="coin" data-testid="budget-row" data-id={row.categoryId}>
      <button type="button" className={styles.open} aria-label={label} onClick={() => onOpen(row.categoryId)} />
      <CategoryBadge icon={icon} color={color} />
      <div className={styles.main} aria-hidden="true">
        <div className={styles.line}>
          <span className={styles.name}>{name}</span>
          <Money cents={row.total} className={styles.figure} />
        </div>
        <Meter value={row.total} max={budget} status={row.status} label={`${name} limit`} timeRatio={timeRatio} />
      </div>
    </div>
  )
}
