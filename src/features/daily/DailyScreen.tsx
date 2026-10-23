import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { MonthStepper, MonthTitle } from '@/app/MonthSwitcher'
import { useNav, useSelectedMonth } from '@/app/nav'
import { formatDate, formatDayLabel } from '@/domain/dates'
import { dailyAverage, dailySeries } from '@/domain/insights'
import { formatPeriodName, formatPeriodTitle, periodOf } from '@/domain/period'
import { categoryDisplay } from '@/domain/queries'
import type { MonthSummary } from '@/domain/summary'
import type { Category, ISODate, MonthKey, QuickAdd } from '@/domain/types'
import { ALL, categoryChips, expensesFor, groupByDay, knownIds } from '@/features/daily/dailyModel'
import { DailySearch } from '@/features/daily/DailySearch'
import { shownAmount } from '@/features/daily/format'
import { QuickAddStrip } from '@/features/daily/QuickAddStrip'
import { TransactionRow } from '@/features/daily/TransactionRow'
import { useCategoryMap, useData, useMonthSummary, useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import { useUiStore } from '@/store/uiStore'
import {
  Button,
  CategoryBadge,
  ChipTabs,
  EmptyState,
  IconButton,
  ListRow,
  Meter,
  Money,
  Screen,
  Section,
  useMoneyFormatContext,
} from '@/ui'
import { ColumnChart, type ColumnDatum, type ColumnReference } from '@/ui/charts'
import styles from './DailyScreen.module.css'

/** Quick adds in their order (QuickAddsScreen sets it). */
function byOrder(quickAdds: readonly QuickAdd[]): QuickAdd[] {
  return quickAdds.toSorted((a, b) => a.order - b.order)
}

/** "this month" for the current period, else "in October 2026" (§3 naming). */
function inPeriod(month: MonthKey, current: boolean, startDay: number, locale: string): string {
  return current ? 'this month' : `in ${formatPeriodName(month, startDay, locale, { withYear: true })}`
}

/** The eye button while amounts are hidden: shows them until the app is hidden or locked. */
function EyeButton() {
  const revealed = useUiStore((s) => s.amountsRevealed)
  return (
    <IconButton
      variant="glass"
      icon={revealed ? 'eye-off' : 'eye'}
      label={revealed ? 'Hide amounts' : 'Show amounts'}
      onClick={() => useUiStore.getState().setAmountsRevealed(!revealed)}
    />
  )
}

interface SentenceProps {
  summary: MonthSummary
}

/** "336,40 € spent, about 18,69 € a day", or "{total} planned" for a future period (§3.3). */
function SummarySentence({ summary }: SentenceProps) {
  const money = useMoneyFormatContext()
  const average = dailyAverage(summary)
  if (summary.timing === 'future' || average === null) {
    return (
      <p className={styles.lede}>
        <span className={styles.strong}>{shownAmount(money, summary.daily)} planned</span>
      </p>
    )
  }
  return (
    <p className={styles.lede}>
      <span className={styles.strong}>{shownAmount(money, summary.daily)} spent</span>, about{' '}
      {shownAmount(money, average)} a day
    </p>
  )
}

interface ChartProps {
  summary: MonthSummary
  filter: string
  filterName: string | null
  categories: readonly Category[]
  today: ISODate
  startDay: number
  locale: string
}

/**
 * Spending per day for the chosen chip (§3.3, DESIGN.md §9.22): 96px of columns, today in ink.
 * The current period draws the allowance from today on ("17,33 € a day", the money for each day
 * left); a past one the "Daily budget" across the month. Both describe all daily spending, so a
 * single category's chart leaves them out.
 */
function DailyChart({ summary, filter, filterName, categories, today, startDay, locale }: ChartProps) {
  const data = useMemo<ColumnDatum[]>(
    () =>
      dailySeries(summary.transactions, summary.month, startDay, filter === ALL ? undefined : filter, categories).map(
        (day) => ({
          key: day.date,
          label: formatDate(day.date, locale, 'short'),
          title: formatDate(day.date, locale, 'medium'),
          value: day.amount,
        }),
      ),
    [summary, startDay, filter, categories, locale],
  )
  const current = summary.timing === 'current'
  let reference: ColumnReference | undefined
  if (filter === ALL && current && summary.perDay !== null && summary.perDay > 0) {
    reference = { value: summary.perDay, label: (value) => `${value} a day`, from: today }
  } else if (filter === ALL && summary.timing === 'past' && summary.available > 0) {
    reference = { value: Math.floor(summary.available / summary.days), label: (value) => `Daily budget ${value}` }
  }
  const name = formatPeriodName(summary.month, startDay, locale, { withYear: true })
  return (
    <div className={styles.chart}>
      <ColumnChart
        data={data}
        reference={reference}
        label={filterName === null ? `Spending per day in ${name}` : `${filterName} per day in ${name}`}
        highlightKey={current ? today : undefined}
        highlightLabel="Today"
      />
    </div>
  )
}

interface CategoryRowProps {
  categoryId: string
  summary: MonthSummary
  inPeriodText: string
}

/**
 * The chosen category above its expenses (§3.3): its coin and name with "{total} this month"
 * (fixed costs and daily spending), opening category detail, and its limit's Meter.
 */
function CategoryRow({ categoryId, summary, inPeriodText }: CategoryRowProps) {
  const money = useMoneyFormatContext()
  const map = useCategoryMap()
  const display = categoryDisplay(categoryId, map)
  const row = summary.byCategory.find((spend) => spend.categoryId === categoryId)
  const total = row?.total ?? 0
  const budget = row?.budget ?? null
  return (
    <div className={styles.categoryGroup}>
      <ListRow
        leading={<CategoryBadge icon={display.icon} color={display.color} />}
        title={display.name}
        subtitle={`${shownAmount(money, total)} ${inPeriodText}`}
        chevron
        onClick={() => useNav.getState().push({ name: 'category', categoryId })}
      />
      {budget !== null && row !== undefined && (
        <div className={styles.meter}>
          <Meter value={total} max={budget} status={row.status} label={`${display.name} limit`} timeRatio={summary.pace.timeRatio} />
        </div>
      )}
    </div>
  )
}

/**
 * The copy of an empty list (§3.3): "Nothing spent this month yet" with how to add one, "Nothing
 * spent in September 2026", "Nothing planned for November 2026"; "on Eating" with a chip chosen.
 */
function emptyCopy(summary: MonthSummary, categoryName: string | null, name: string): { title: string; message?: string } {
  const on = categoryName === null ? '' : ` on ${categoryName}`
  if (summary.timing === 'current') return { title: `Nothing spent${on} this month yet`, message: 'Tap + to add an expense.' }
  if (summary.timing === 'future') return { title: `Nothing planned${on} for ${name}` }
  return { title: `Nothing spent${on} in ${name}` }
}

function openQuickAdds(): void {
  useNav.getState().navigate('home', { name: 'you.quickAdds' })
}

function backToThisMonth(): void {
  useNav.getState().setMonth(null)
}

/** The chip row's choice, kept in nav (null for All) for the tab bar's (+). */
function chooseChip(value: string): void {
  useNav.getState().setDailyCategory(value === ALL ? null : value)
}

interface DayListProps {
  summary: MonthSummary
  filter: string
  filterName: string | null
  today: ISODate
  locale: string
  /** The period with its year, "September 2026". */
  periodName: string
  known: ReadonlySet<string>
}

/** The period's expenses by day, newest first, each day with its total (shares only, §4.9). */
function DayList({ summary, filter, filterName, today, locale, periodName, known }: DayListProps) {
  const groups = useMemo(() => groupByDay(expensesFor(summary.transactions, filter, known)), [summary, filter, known])
  if (groups.length === 0) {
    const copy = emptyCopy(summary, filterName, periodName)
    return (
      <div className={styles.emptyGroup}>
        <EmptyState title={copy.title} message={copy.message} />
      </div>
    )
  }
  return groups.map((group) => (
    <Section
      key={group.date}
      variant="day"
      title={formatDayLabel(group.date, today, locale)}
      // A day paid entirely from the wallet took nothing from the month (DESIGN.md §9.26).
      meta={group.fromWallet ? undefined : <Money cents={group.total} />}
      action={group.fromWallet ? <span className={styles.fromWallet}>From your wallet</span> : undefined}
    >
      {group.items.map((tx) => (
        <TransactionRow key={tx.id} tx={tx} />
      ))}
    </Section>
  ))
}

/**
 * The Daily tab (docs/SPEC.md §3.3; DESIGN.md §9.2, §9.10, §9.22, §9.23, §9.26): the month title,
 * what was spent and the average a day, the day chart, the quick adds (or "Back to this month"),
 * the category chips with the chosen category's row and limit, and the expenses by day. The
 * header's search looks through every period.
 */
export function DailyScreen() {
  const month = useSelectedMonth()
  const summary = useMonthSummary(month)
  const today = useToday()
  const { locale, monthStartDay: startDay, hideAmounts } = useSettings()
  const money = useMoneyFormatContext()
  const categories = useData((d) => d.categories)
  const quickAdds = useData((d) => d.quickAdds)
  const map = useCategoryMap()
  // The chip lives in nav, so the tab bar's (+) can start a new expense in it (§3.4).
  const filter = useNav((s) => s.dailyCategory) ?? ALL
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const known = useMemo(() => knownIds(categories), [categories])
  const chips = useMemo(() => categoryChips(summary.transactions, categories, map), [summary, categories, map])
  const sortedQuickAdds = useMemo(() => byOrder(quickAdds), [quickAdds])
  // A chip that this period does not offer (another month was chosen) falls back to All.
  const active = chips.some((chip) => chip.value === filter) ? filter : ALL
  const filterName = active === ALL ? null : categoryDisplay(active, map).name

  const current = summary.timing === 'current'
  const name = formatPeriodTitle(month, periodOf(today, startDay), startDay, locale)
  const period = inPeriod(month, current, startDay, locale)
  const compactSubtitle = `${shownAmount(money, summary.daily)} ${summary.timing === 'future' ? 'planned' : 'spent'}`

  const openSearch = (): void => {
    // Rendered at once, so the field takes focus inside the tap and iOS brings up the keyboard.
    flushSync(() => setSearching(true))
    searchRef.current?.focus()
  }
  const closeSearch = (): void => {
    setSearching(false)
    setQuery('')
  }

  return (
    <Screen
      title="Daily"
      eyebrow="Daily spending"
      titleContent={<MonthTitle />}
      largeTitle
      compactTitle={name}
      compactTitleVariant="month"
      compactSubtitle={compactSubtitle}
      headerRight={
        <>
          {hideAmounts && <EyeButton />}
          <IconButton
            variant="glass"
            icon="search"
            label="Search"
            aria-expanded={searching}
            className={styles.searchButton}
            data-testid="daily-search"
            onClick={openSearch}
          />
          <MonthStepper />
        </>
      }
    >
      {searching ? (
        <DailySearch query={query} onQueryChange={setQuery} onCancel={closeSearch} inputRef={searchRef} />
      ) : (
        <>
          <SummarySentence summary={summary} />
          <DailyChart
            summary={summary}
            filter={active}
            filterName={filterName}
            categories={categories}
            today={today}
            startDay={startDay}
            locale={locale}
          />
          {current ? (
            <Section title="Quick add" action={{ label: 'Edit', onClick: openQuickAdds }} bare className={styles.quick}>
              {sortedQuickAdds.length > 0 ? (
                <QuickAddStrip quickAdds={sortedQuickAdds} />
              ) : (
                <p className={styles.quickEmpty}>Add a button for what you buy often, then log it with one tap.</p>
              )}
            </Section>
          ) : (
            <div className={styles.backRow}>
              <Button variant="glass" tinted className={styles.backPill} onClick={backToThisMonth}>
                Back to this month
              </Button>
            </div>
          )}
          <ChipTabs
            items={chips}
            value={active}
            onChange={chooseChip}
            label="Categories"
            itemTestId="category-chip"
            className={styles.chips}
          />
          {active !== ALL && <CategoryRow categoryId={active} summary={summary} inPeriodText={period} />}
          <DayList
            summary={summary}
            filter={active}
            filterName={filterName}
            today={today}
            locale={locale}
            periodName={formatPeriodName(month, startDay, locale, { withYear: true })}
            known={known}
          />
        </>
      )}
    </Screen>
  )
}
