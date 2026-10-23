import type { Transaction } from '@/domain/types'
import { TransactionRow } from '@/features/daily/TransactionRow'
import { Section } from '@/ui'
import styles from './RecentCard.module.css'

export interface RecentCardProps {
  /** The period's latest expenses, newest first (recentExpenses). */
  expenses: Transaction[]
  onSeeAll(): void
}

/**
 * Recent (docs/SPEC.md §3.1): the last five expenses of the period, listed as Daily lists them with
 * their day under the amount; a tap edits one. "See all" opens Daily. Without expenses (Home shows
 * it so only in the current period): "No expenses yet. Tap + to add one."
 */
export function RecentCard({ expenses, onSeeAll }: RecentCardProps) {
  return (
    <Section title="Recent" action={{ label: 'See all', onClick: onSeeAll }}>
      {expenses.length === 0 ? (
        <p className={styles.empty}>No expenses yet. Tap + to add one.</p>
      ) : (
        expenses.map((tx) => <TransactionRow key={tx.id} tx={tx} showDate />)
      )}
    </Section>
  )
}
