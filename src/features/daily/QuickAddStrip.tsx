import type { QuickAdd } from '@/domain/types'
import { spokenAmount } from '@/features/daily/format'
import { addQuickAdd } from '@/features/daily/quickAdd'
import { CategoryIcon, Icon, Money, useMoneyFormatContext } from '@/ui'
import styles from './QuickAddStrip.module.css'

export interface QuickAddStripProps {
  quickAdds: readonly QuickAdd[]
}

/**
 * The quick-add tiles of the current period (docs/SPEC.md §3.3, DESIGN.md §9.23): three per row,
 * then the row scrolls. Each tile shows its glyph with a "+" badge, its label and its amount, and
 * adds the expense at once with a toast and Undo. Named "Add Coffee, 3,50 €".
 */
export function QuickAddStrip({ quickAdds }: QuickAddStripProps) {
  const money = useMoneyFormatContext()
  return (
    <div className={styles.strip}>
      {quickAdds.map((quickAdd) => (
        <button
          key={quickAdd.id}
          type="button"
          className={styles.tile}
          aria-label={`Add ${quickAdd.label}, ${spokenAmount(money, quickAdd.amount)}`}
          data-testid="quick-add"
          data-id={quickAdd.id}
          onClick={() => {
            void addQuickAdd(quickAdd, money)
          }}
        >
          <span className={styles.glyph} aria-hidden="true">
            <CategoryIcon icon={quickAdd.icon} size={24} />
            <span className={styles.plus}>
              <Icon name="plus" weight="bold" size={9} />
            </span>
          </span>
          <span className={styles.text}>
            <span className={styles.label}>{quickAdd.label}</span>
            <Money cents={quickAdd.amount} tone="muted" className={styles.amount} />
          </span>
        </button>
      ))}
    </div>
  )
}
