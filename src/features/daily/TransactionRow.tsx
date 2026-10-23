import type { ReactNode } from 'react'
import { useNav } from '@/app/nav'
import { formatDayLabel } from '@/domain/dates'
import type { MoneyFormat } from '@/domain/money'
import { categoryDisplay } from '@/domain/queries'
import { myShare } from '@/domain/splits'
import type { Transaction } from '@/domain/types'
import { spokenAmount } from '@/features/daily/format'
import { splitLine, type SplitLine } from '@/features/daily/splitText'
import { useCategoryMap, useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import { CategoryBadge, Icon, ListRow, Money, useMoneyFormatContext } from '@/ui'
import styles from './TransactionRow.module.css'

export interface TransactionRowProps {
  tx: Transaction
  /** Replaces the default tap, which opens the transaction sheet to edit `tx`. */
  onOpen?(): void
  /** Shows the day ("Today", "Yesterday", "Wed 14 Oct"), for lists not grouped by day. */
  showDate?: boolean
  /**
   * False in a list of one category (category detail), where every coin is the same: line 2 and
   * the row's name then leave the category out, and a plain row shows its day as line 2.
   */
  showCategory?: boolean
}

/**
 * One expense in a list (docs/SPEC.md §3.3, §3.13, §3.16; DESIGN.md §9.8, §9.26; EXTRAS.md §2.5):
 * the category coin, the note (or the category name) as the title and the amount on its baseline.
 * Line 2 is the category name when there is a note, "Paid from wallet" with the wallet glyph for an
 * expense paid from the wallet (its amount in --ink-2), or the split ("Split, Max owes 9,00 €",
 * "Split with 2 people") with the people glyph, the share as the amount and "of {bill}" under it.
 * With `showDate`, the day trails line 2 ("Today", "Wed 14 Oct"); a split keeps its bill there.
 * Home's Recent and category detail list expenses with it too; category detail passes
 * `showCategory={false}`, so a plain row reads "Cappuccino / Today". A tap opens the transaction
 * sheet to edit the expense, unless `onOpen` is given.
 */
export function TransactionRow({ tx, onOpen, showDate = false, showCategory = true }: TransactionRowProps) {
  const money = useMoneyFormatContext()
  const categories = useCategoryMap()
  const { locale } = useSettings()
  const today = useToday()

  const income = tx.kind === 'income'
  const fromWallet = tx.fromWallet && !income
  const category = categoryDisplay(tx.categoryId, categories)
  const note = tx.note.trim()
  const title = note !== '' ? note : income ? 'One-off income' : category.name
  const share = myShare(tx)
  const split = income ? null : splitLine(tx, money)
  const day = showDate ? formatDayLabel(tx.date, today, locale) : undefined

  // Line 2, leading: the wallet line wins over the split line (EXTRAS.md §2.5); a plain expense
  // with a note names its category there, or, in a list of one category, gives its day.
  let subtitle: ReactNode
  let dayLeads = false
  if (fromWallet) {
    subtitle = (
      <span className={styles.via}>
        <Icon name="wallet" weight="regular" size={15} className={styles.glyph} />
        <span>Paid from wallet</span>
      </span>
    )
  } else if (split !== null) {
    subtitle = (
      <span className={styles.via}>
        <Icon name="people" weight="regular" size={15} className={styles.glyph} />
        <span>{split.text}</span>
      </span>
    )
  } else if (!showCategory) {
    subtitle = day
    dayLeads = day !== undefined
  } else if (note !== '' && !income) {
    subtitle = category.name
  }

  // Line 2, trailing: the whole bill under the share, else the day when asked for (unless it
  // already leads). A split row keeps the bill there; its day is still in the row's name.
  let trailing: ReactNode
  if (split !== null) {
    trailing = (
      <span className={styles.bill}>
        of <Money cents={tx.amount} />
      </span>
    )
  } else if (day !== undefined && !dayLeads) {
    trailing = day
  }

  const open = onOpen ?? (() => useNav.getState().openSheet({ name: 'transaction', id: tx.id, kind: tx.kind }))

  return (
    <ListRow
      leading={<CategoryBadge icon={income ? 'coins' : category.icon} color={income ? null : category.color} />}
      title={title}
      subtitle={subtitle}
      value={<Money cents={share} tone={income ? 'income' : 'default'} />}
      valueTone={fromWallet ? 'muted' : 'default'}
      note={trailing}
      onClick={open}
      label={rowLabel({ tx, title, category: showCategory ? category.name : null, note, share, split, day, money })}
      data-testid="tx-row"
      data-id={tx.id}
    />
  )
}

interface RowLabelInput {
  tx: Transaction
  title: string
  /** The category's name, or null where the list is one category's and it goes without saying. */
  category: string | null
  note: string
  share: number
  split: SplitLine | null
  day: string | undefined
  money: MoneyFormat
}

/**
 * The row read as one sentence. The category is said aloud whenever the title is the note, since
 * only the coin shows it then (DESIGN.md §9.26): "Laptop, Shopping, 549,00 €, paid from wallet",
 * "Bar with friends, Going out, 9,00 €, your share of 18,00 €. Split, Max owes 9,00 €." (EXTRAS.md
 * §2.5). The day comes last when the row shows it.
 */
export function rowLabel({ tx, title, category, note, share, split, day, money }: RowLabelInput): string {
  const income = tx.kind === 'income'
  const fromWallet = tx.fromWallet && !income
  const parts = [title]
  if (income) parts.push('income')
  else if (note !== '' && category !== null) parts.push(category)
  parts.push(spokenAmount(money, share))
  if (split !== null) parts.push(`your share of ${spokenAmount(money, tx.amount)}`)
  if (fromWallet) parts.push('paid from wallet')
  let sentence = parts.join(', ')
  if (split !== null) sentence += `. ${split.spoken}`
  if (day !== undefined) sentence += split !== null ? ` ${day}.` : `, ${day}`
  return sentence
}
