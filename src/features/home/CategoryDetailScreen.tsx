import { useMemo, useState } from 'react'
import { MonthTitle } from '@/app/MonthSwitcher'
import { useMonthBounds, useNav, useSelectedMonth, type RouteProps } from '@/app/nav'
import { formatDate } from '@/domain/dates'
import { dailySeries } from '@/domain/insights'
import { formatPeriodName, formatPeriodTitle } from '@/domain/period'
import { categoryDisplay } from '@/domain/queries'
import { scheduleLabel, type RecurringLine } from '@/domain/recurring'
import { budgetStatus, categoryKeyOf, UNCATEGORIZED_ID } from '@/domain/summary'
import { backLabelFor, type ScreenOrigin } from '@/features/home/backLabel'
import { TREND_PERIODS, trendHasData, trendPoints, trendTitle } from '@/features/home/homeData'
import { TrendCard } from '@/features/home/TrendCard'
import { TransactionRow } from '@/features/daily/TransactionRow'
import {
  useCategoryMap,
  useCategoryTrend,
  useData,
  useMoneyFormat,
  useMonthSummary,
  useSettings,
} from '@/store/hooks'
import { useToday } from '@/store/today'
import { Button, CategoryBadge, EmptyState, Icon, ListRow, Meter, Money, Screen, Section, TotalFigure, withTrueMinus } from '@/ui'
import { ColumnChart, type ChartSeries, type ColumnDatum } from '@/ui/charts'
import styles from './CategoryDetailScreen.module.css'

/** Where this screen was pushed from: read once, when it is pushed and on top of its tab. */
function originNow(): ScreenOrigin {
  const { tab, stacks } = useNav.getState()
  return { tab, below: stacks[tab].at(-2) ?? null }
}

function back(): void {
  useNav.getState().pop()
}

function openRecurring(line: RecurringLine): void {
  useNav.getState().openSheet({ name: 'recurring', id: line.recurring.id, kind: line.recurring.kind })
}

/**
 * One category in the selected period (docs/SPEC.md §3.2, DESIGN.md §9.2): pushed on the current
 * tab, with "‹ {previous screen}" and "Edit" (the category sheet; not for Uncategorized). The body
 * shows the period's total (fixed plus daily, at budget amounts §4.9) beside the compact month
 * switcher, the limit's meter when there is one, the spending per day in the category's ink, its
 * fixed costs, its expenses as Daily lists them, and the last six periods. Expenses and fixed costs
 * open for editing; "Add expense" opens the transaction sheet with this category chosen.
 */
export function CategoryDetailScreen({ categoryId }: RouteProps<'category'>) {
  const [origin] = useState(originNow)
  const categories = useCategoryMap()
  const allCategories = useData((d) => d.categories)
  const month = useSelectedMonth()
  const { first, current } = useMonthBounds()
  const { monthStartDay: startDay, locale } = useSettings()
  const summary = useMonthSummary(month)
  const trend = useCategoryTrend(categoryId, month, TREND_PERIODS)
  const money = useMoneyFormat()
  const today = useToday()

  const uncategorized = categoryId === UNCATEGORIZED_ID
  const category = Object.hasOwn(categories, categoryId) ? categories[categoryId] : undefined
  const { name, icon, color } = categoryDisplay(categoryId, categories)
  const backLabel = backLabelFor(origin, categories)
  const { timing } = summary
  const isCurrent = timing === 'current'
  const title = formatPeriodTitle(month, current, startDay, locale)

  // Every list filters the way byCategory files entries (§4.6): deleted categories count as
  // Uncategorized, so what is listed adds up to the total above it.
  const known = useMemo(() => ({ has: (id: string) => Object.hasOwn(categories, id) }), [categories])
  const row = summary.byCategory.find((spend) => spend.categoryId === categoryId)
  const expenses = useMemo(
    () => summary.transactions.filter((tx) => tx.kind === 'expense' && categoryKeyOf(tx.categoryId, known) === categoryId),
    [summary.transactions, known, categoryId],
  )
  const fixedLines = useMemo(
    () => summary.fixedLines.filter((line) => categoryKeyOf(line.recurring.categoryId, known) === categoryId),
    [summary.fixedLines, known, categoryId],
  )
  const perDay = useMemo<ColumnDatum[]>(
    () =>
      dailySeries(summary.transactions, month, startDay, categoryId, allCategories).map((day) => ({
        key: day.date,
        label: formatDate(day.date, locale, 'short'),
        title: formatDate(day.date, locale, 'medium'),
        value: day.amount,
      })),
    [summary.transactions, month, startDay, categoryId, allCategories, locale],
  )
  const trendData = useMemo(() => trendPoints(trend, first), [trend, first])

  if (category === undefined && !uncategorized) {
    // Deleted while this screen was open (from its own Edit sheet, say).
    return (
      <Screen title={name} onBack={back} backLabel={backLabel}>
        <EmptyState className={styles.gone} title="This category was deleted" icon="archive" />
      </Screen>
    )
  }

  const ink = color === null ? null : `--cat-${color}`
  const total = row?.total ?? 0
  const budget = category?.budget ?? null
  const fullName = formatPeriodName(month, startDay, locale, { withYear: true })
  const caption =
    timing === 'current' ? 'spent this month' : timing === 'past' ? `spent in ${fullName}` : `planned for ${fullName}`
  const within = isCurrent ? 'this month' : `in ${title}`
  const dayText = isCurrent && summary.dayIndex !== null ? `Day ${summary.dayIndex} of ${summary.days}` : `${summary.days} days`
  const canAdd = category !== undefined && !category.archived

  const fixedSubtitle = (line: RecurringLine): string => {
    if (line.skipped) return `Skipped ${within}`
    if (line.recurring.spread && !line.isChargeMonth) {
      return `Set aside ${withTrueMinus(money.format(line.amount))} ${within}`
    }
    const schedule = scheduleLabel(line.recurring, month, startDay, locale)
    return line.paid ? `${schedule}, paid` : schedule
  }

  const anyFixed = trendData.some((point) => point.fixed > 0)
  const anyDaily = trendData.some((point) => point.daily > 0)
  const dailyInk = ink ?? '--chart-daily'
  const trendSeries: ChartSeries[] = [
    // Alone, a series takes the category's ink; together, fixed costs are the neutral base.
    ...(anyFixed ? [{ key: 'fixed', label: 'Fixed costs', cssVar: anyDaily ? '--chart-fixed' : dailyInk }] : []),
    ...(anyDaily ? [{ key: 'daily', label: 'Daily spending', cssVar: dailyInk }] : []),
  ]

  return (
    <Screen
      title={name}
      onBack={back}
      backLabel={backLabel}
      headerRight={
        category === undefined ? undefined : (
          <Button
            variant="glass"
            onClick={() => useNav.getState().openSheet({ name: 'categoryEdit', id: categoryId })}
          >
            Edit
          </Button>
        )
      }
      titleContent={
        <div className={styles.heading}>
          <CategoryBadge icon={icon} color={color} size="lg" />
          {/* The Screen names the screen with a heading of its own; this is its visible form. */}
          <span className={styles.name} aria-hidden="true">
            {name}
          </span>
        </div>
      }
      compactTitle={name}
    >
      <div className={styles.summary}>
        <div className={styles.total}>
          <TotalFigure cents={total} data-testid="category-total" />
          <p className={styles.caption}>{caption}</p>
        </div>
        <MonthTitle variant="compact" className={styles.month} />
      </div>

      {budget !== null && (
        <div className={styles.limit}>
          <div className={styles.limitLine}>
            <span>Monthly limit</span>
            <Money cents={budget} className={styles.figure} />
          </div>
          <Meter
            value={total}
            max={budget}
            status={row?.status ?? budgetStatus(total, budget)}
            label={`${name} limit`}
            timeRatio={isCurrent ? summary.pace.timeRatio : null}
            verbose
            trailing={dayText}
          />
        </div>
      )}

      {perDay.some((day) => day.value > 0) && (
        <div className={styles.chart}>
          <ColumnChart
            data={perDay}
            label={`${name}, spending per day in ${title}`}
            height={64}
            cssVar={ink ?? undefined}
            highlightKey={isCurrent ? today : undefined}
            highlightLabel={isCurrent ? 'Today' : undefined}
          />
        </div>
      )}

      {fixedLines.length > 0 && (
        <Section variant="day" title="Fixed costs" meta={<Money cents={row?.fixed ?? 0} />}>
          {fixedLines.map((line) => (
            <ListRow
              key={line.recurring.id}
              title={line.recurring.name}
              subtitle={fixedSubtitle(line)}
              value={<Money cents={line.skipped ? line.scheduledAmount : line.amount} />}
              valueTone={line.skipped ? 'struck' : line.paid ? 'muted' : 'default'}
              onClick={() => openRecurring(line)}
              data-id={line.recurring.id}
            />
          ))}
        </Section>
      )}

      <Section
        variant="day"
        title={isCurrent ? 'This month' : title}
        action={
          expenses.length === 0 ? undefined : (
            <span className={styles.count}>{expenses.length === 1 ? '1 entry' : `${expenses.length} entries`}</span>
          )
        }
      >
        {expenses.length === 0 ? (
          <p className={styles.none}>Nothing spent {within}.</p>
        ) : (
          expenses.map((tx) => <TransactionRow key={tx.id} tx={tx} showDate showCategory={false} />)
        )}
      </Section>
      {canAdd && (
        <button
          type="button"
          className={styles.add}
          onClick={() => useNav.getState().openSheet({ name: 'transaction', categoryId })}
        >
          <Icon name="plus-circle" size={22} />
          Add expense
        </button>
      )}

      {trendHasData(trendData) && (
        <TrendCard
          variant="day"
          title={trendTitle(isCurrent, title)}
          points={trendData}
          series={trendSeries}
          subject={`${name}, fixed costs and daily spending`}
          current={trendData.some((point) => point.month === current) ? current : null}
          startDay={startDay}
          locale={locale}
        />
      )}
    </Screen>
  )
}
