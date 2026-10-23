import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Cents } from '@/domain/types'
import { useMoneyFormat } from '@/store/hooks'
import { Icon, Money, Section } from '@/ui'
import {
  FOLD_KEY,
  foldSegments,
  formatShare,
  Legend,
  segmentColorVar,
  StackedBar,
  type StackedBarSegment,
} from '@/ui/charts'
import styles from './WhereItWentCard.module.css'

export interface WhereItWentCardProps {
  /** One segment per category with daily spending (spendingSegments). */
  segments: StackedBarSegment[]
  /** The period's daily spending: the section's meta and the whole of the bar. */
  total: Cents
  /** The period's fixed costs, for "Plus {fixed} in fixed costs"; 0 hides that line. */
  fixed: Cents
  onCategory(categoryId: string): void
  onFixed(): void
}

/**
 * Where it went (docs/SPEC.md §3.1, DESIGN.md §9.22): daily spending as a stacked bar in the
 * category inks, the top five categories and a folded "{n} more" when two or more remain, then a
 * legend in the same order (dot, name, amount, share) whose rows open the category, and under it
 * "Plus {fixed} in fixed costs", which opens Fixed. Tapping the fold lists every category and moves
 * focus to the first one it held, since the fold row itself goes. Give it a `key` per period, so a
 * new period starts folded.
 */
export function WhereItWentCard({ segments, total, fixed, onCategory, onFixed }: WhereItWentCardProps) {
  const money = useMoneyFormat()
  const [expanded, setExpanded] = useState(false)
  // Expanded, nothing is folded: every category keeps its own segment and legend row.
  const shown = useMemo(
    () => foldSegments(segments, expanded ? { limit: segments.length } : {}),
    [segments, expanded],
  )

  const breakdownRef = useRef<HTMLDivElement>(null)

  const select = (key: string): void => {
    if (key !== FOLD_KEY) {
      onCategory(key)
      return
    }
    // The fold row leaves as the list expands, so focus would drop to the page: it moves on to the
    // first category the fold held, rendered at once inside the tap.
    const before = new Set(shown.map((segment) => segment.key))
    flushSync(() => setExpanded(true))
    const rows = breakdownRef.current?.querySelectorAll<HTMLElement>('[data-testid="category-row"]') ?? []
    for (const row of rows) {
      if (row.dataset.id !== undefined && !before.has(row.dataset.id)) {
        row.focus()
        return
      }
    }
  }

  return (
    <Section title="Where it went" meta={<Money cents={total} />}>
      <div ref={breakdownRef} className={styles.breakdown}>
        <StackedBar segments={shown} label="Daily spending by category" />
        <Legend
          className={styles.legend}
          label="Categories"
          itemTestId="category-row"
          onSelect={select}
          items={shown.map((segment) => ({
            key: segment.key,
            label: segment.label,
            cssVar: segmentColorVar(segment.color),
            value: <Money cents={segment.value} />,
            // Shares are ratios, not amounts: they stay visible while amounts are hidden.
            meta: formatShare(total > 0 ? segment.value / total : 0, money.locale),
            // The fold row is a disclosure: it says it is collapsed, and goes once it opens.
            expanded: segment.key === FOLD_KEY ? false : undefined,
          }))}
        />
        {fixed > 0 && (
          <button type="button" className={styles.plus} onClick={onFixed}>
            <span>
              Plus <Money cents={fixed} /> in fixed costs
            </span>
            <Icon name="chevron-right" size={14} className={styles.chevron} />
          </button>
        )}
      </div>
    </Section>
  )
}
