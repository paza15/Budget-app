import { useMemo } from 'react'
import { useNav } from '@/app/nav'
import { sumCents, type MoneyFormat } from '@/domain/money'
import { categoryDisplay } from '@/domain/queries'
import type { OwedItem } from '@/domain/splits'
import type { Cents } from '@/domain/types'
import styles from '@/features/owed/OwedCard.module.css'
import { morePeople, personDetail } from '@/features/owed/owedModel'
import { PersonCoin } from '@/features/owed/PersonCoin'
import { useCategoryMap, useData, useMoneyFormat, useOwed } from '@/store/hooks'
import { Icon, ListRow, Money, Section, withTrueMinus } from '@/ui'

/** People shown on the card; the rest are summed in the last line. */
const SHOWN = 3

/** An amount as VoiceOver says it: the formatted amount, or "amount hidden". */
function spoken(money: MoneyFormat, cents: Cents): string {
  return money.masked ? 'amount hidden' : withTrueMinus(money.format(cents))
}

/** Opens "Owed to you" over Home, scrolled to `person` when given (EXTRAS.md §2.6). Taps only. */
function openOwed(person?: string): void {
  useNav.getState().push(person === undefined ? { name: 'owed' } : { name: 'owed', person })
}

/**
 * The Home "Owed to you" card (docs/SPEC.md §3.16, docs/design/EXTRAS.md §2.6): the open total as
 * the section's figure, then up to three people by what they owe, largest first. Each row opens
 * "Owed to you" at that person; with more people a last line sums the rest. Nothing is shown while
 * nobody owes anything.
 */
export function OwedCard() {
  const owed = useOwed()
  const transactions = useData((d) => d.transactions)
  const categoryMap = useCategoryMap()
  const money = useMoneyFormat()
  const byId = useMemo(() => new Map(transactions.map((tx) => [tx.id, tx])), [transactions])

  if (owed.people.length === 0) return null

  /** A bill by its note, or its category when it has none. */
  const billName = (item: OwedItem): string =>
    item.note.trim() || categoryDisplay(byId.get(item.transactionId)?.categoryId ?? null, categoryMap).name
  const shown = owed.people.slice(0, SHOWN)
  const rest = owed.people.slice(SHOWN)
  const restTotal = sumCents(rest.map((person) => person.total))

  return (
    <Section title="Owed to you" meta={<Money cents={owed.total} />} data-testid="owed-card">
      {shown.map((person) => {
        const detail = personDetail(person, billName)
        return (
          <ListRow
            key={person.person}
            leading={<PersonCoin name={person.person} />}
            title={person.person}
            value={<Money cents={person.total} />}
            subtitle={detail}
            onClick={() => openOwed(person.person)}
            label={`${person.person} owes you ${spoken(money, person.total)}, ${detail}`}
            data-testid="owed-person"
            data-id={person.person}
          />
        )
      })}
      {rest.length > 0 && (
        <button
          type="button"
          className={styles.more}
          onClick={() => openOwed()}
          data-testid="owed-more"
        >
          <span className={styles.moreText}>
            {'Plus '}
            <Money cents={restTotal} />
            {` from ${morePeople(rest.length)}`}
          </span>
          <Icon name="chevron-right" size={14} className={styles.chevron} />
        </button>
      )}
    </Section>
  )
}
