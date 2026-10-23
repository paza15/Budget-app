import { useDeferredValue, useMemo, type KeyboardEvent, type Ref } from 'react'
import { formatPeriodLabel } from '@/domain/period'
import { searchExpenses } from '@/features/daily/dailyModel'
import { TransactionRow } from '@/features/daily/TransactionRow'
import { useCategoryMap, useData, useSettings } from '@/store/hooks'
import { Button, EmptyState, Money, Section, TextField } from '@/ui'
import styles from './DailySearch.module.css'

/** The most matches listed at once; the newest ones. */
export const SEARCH_LIMIT = 200

export interface DailySearchProps {
  query: string
  onQueryChange(query: string): void
  onCancel(): void
  inputRef?: Ref<HTMLInputElement>
}

/** Closes the keyboard on Search (Return): the results are already there. */
function blurOnEnter(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.target.blur()
}

/** "1 result", "12 results", "200 of 340 results". */
function countText(listed: number, count: number): string {
  if (count === 1) return '1 result'
  return listed < count ? `${listed} of ${count} results` : `${count} results`
}

/**
 * Daily's search (docs/SPEC.md §3.3, DESIGN.md §9.14): a search capsule with "Cancel" beside it,
 * and the expenses whose note or category name matches, from every period, grouped by period
 * (newest first) with each period's total. Rows show their day.
 */
export function DailySearch({ query, onQueryChange, onCancel, inputRef }: DailySearchProps) {
  const transactions = useData((d) => d.transactions)
  const map = useCategoryMap()
  const { monthStartDay, locale } = useSettings()
  // Typing stays quick in a long history: the list follows a moment later.
  const deferred = useDeferredValue(query)
  const result = useMemo(
    () => searchExpenses(transactions, deferred, map, monthStartDay, SEARCH_LIMIT),
    [transactions, deferred, map, monthStartDay],
  )
  const wanted = deferred.trim()
  const listed = Math.min(result.count, SEARCH_LIMIT)

  return (
    <div className={styles.search}>
      {/* Return in the search field closes the keyboard. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className={styles.bar} onKeyDown={blurOnEnter}>
        <TextField
          type="search"
          label="Search"
          placeholder="Notes and categories"
          value={query}
          onChange={onQueryChange}
          enterKeyHint="search"
          clearLabel="Clear search"
          inputRef={inputRef}
          className={styles.field}
        />
        <Button variant="plain" onClick={onCancel} className={styles.cancel}>
          Cancel
        </Button>
      </div>

      {/* <output> is a polite status: VoiceOver hears how many entries matched. */}
      <output className="visually-hidden">{wanted === '' ? '' : countText(listed, result.count)}</output>

      {wanted === '' ? (
        <p className={styles.hint}>Finds notes and category names in every month.</p>
      ) : result.count === 0 ? (
        <div className={styles.emptyGroup}>
          <EmptyState icon="search" title={`No results for “${wanted}”`} message="Try another word from a note or a category name." />
        </div>
      ) : (
        <>
          {result.groups.map((group) => (
            <Section
              key={group.month}
              variant="day"
              title={formatPeriodLabel(group.month, monthStartDay, locale)}
              meta={<Money cents={group.total} />}
            >
              {group.items.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} showDate />
              ))}
            </Section>
          ))}
          {result.count > listed && (
            <p className={styles.more}>
              Showing the newest {listed} of {result.count} entries. Type more to narrow it down.
            </p>
          )}
        </>
      )}
    </div>
  )
}
