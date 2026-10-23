import { useMemo } from 'react'
import { useNav, type SheetRoute } from '@/app/nav'
import { formatDayLabel } from '@/domain/dates'
import type { RecurringLine } from '@/domain/recurring'
import type { MonthKey, Recurring, Transaction } from '@/domain/types'
import {
  AddLine,
  GroupHeader,
  Lede,
  LedeStrong,
  NoCheck,
  RecurringRow,
  RowGroup,
  SubtitleText,
} from '@/features/fixed/FixedList'
import { canTick, itemsWithoutLine, lineSubtitle, periodPhrase, rowAmount } from '@/features/fixed/fixedModel'
import styles from '@/features/fixed/FixedScreen.module.css'
import { NotThisMonth } from '@/features/fixed/NotThisMonth'
import { actions } from '@/store/actions'
import { useData, useMonthSummary, useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import { EmptyState, ListRow, Money } from '@/ui'

export interface IncomeViewProps {
  /** The selected period. */
  month: MonthKey
  /** The current period. */
  current: MonthKey
}

function openSheet(route: SheetRoute): void {
  useNav.getState().openSheet(route)
}

function openItem(r: Recurring): void {
  openSheet({ name: 'recurring', id: r.id, kind: r.kind })
}

function openOneOff(tx: Transaction): void {
  openSheet({ name: 'transaction', id: tx.id, kind: 'income' })
}

function toggleReceived(line: RecurringLine): void {
  actions.setOverride(line.month, line.recurring.id, { paid: !line.paid })
}

/**
 * Fixed → Income (docs/SPEC.md §3.5): "{total} this month", the recurring income rows with their
 * "Received" check, the one-off income of the period (tap to edit), and buttons for both kinds.
 */
export function IncomeView({ month, current }: IncomeViewProps) {
  const summary = useMonthSummary(month)
  const recurring = useData((d) => d.recurring)
  const months = useData((d) => d.months)
  const { monthStartDay: startDay, locale } = useSettings()
  const today = useToday()

  const lines = summary.incomeLines
  const oneOff = useMemo(() => summary.transactions.filter((tx) => tx.kind === 'income'), [summary.transactions])
  const withoutLine = useMemo(() => itemsWithoutLine(recurring, 'income', lines, month), [recurring, lines, month])
  const phrase = periodPhrase(month, current, startDay, locale)
  const nothing = lines.length === 0 && oneOff.length === 0 && withoutLine.length === 0

  return (
    <>
      <Lede>
        <LedeStrong>
          <Money cents={summary.income} /> {phrase}
        </LedeStrong>
      </Lede>
      {nothing && (
        <EmptyState
          className={styles.incomeEmpty}
          icon="fixed"
          title="No income yet"
          message="Add your pay and any other money that comes in every month."
        />
      )}
      {lines.length > 0 && (
        <>
          <GroupHeader title="Recurring" total={summary.incomeRecurring} />
          <RowGroup>
            {lines.map((line) => (
              <RecurringRow
                key={`${month}:${line.recurring.id}`}
                item={line.recurring}
                subtitle={<SubtitleText subtitle={lineSubtitle(line, current, startDay, locale)} />}
                amount={rowAmount(line, months)}
                tone={line.skipped ? 'struck' : line.paid || !line.isChargeMonth ? 'muted' : 'default'}
                check={canTick(line) ? { paid: line.paid, onToggle: () => toggleReceived(line) } : null}
                onOpen={() => openItem(line.recurring)}
              />
            ))}
          </RowGroup>
        </>
      )}
      {oneOff.length > 0 && (
        <>
          <GroupHeader title={`One-off ${phrase}`} total={summary.incomeOneOff} />
          <RowGroup>
            {oneOff.map((tx) => (
              <ListRow
                key={tx.id}
                title={tx.note === '' ? 'One-off income' : tx.note}
                subtitle={formatDayLabel(tx.date, today, locale)}
                value={<Money cents={tx.amount} />}
                trailing={<NoCheck />}
                onClick={() => openOneOff(tx)}
                data-testid="income-row"
                data-id={tx.id}
              />
            ))}
          </RowGroup>
        </>
      )}
      <NotThisMonth items={withoutLine} month={month} startDay={startDay} locale={locale} onOpen={openItem} />
      <div className={styles.incomeActions}>
        <AddLine label="Add income" onClick={() => openSheet({ name: 'recurring', kind: 'income' })} />
        <AddLine label="Add one-off income" onClick={() => openSheet({ name: 'transaction', kind: 'income' })} />
      </div>
    </>
  )
}
