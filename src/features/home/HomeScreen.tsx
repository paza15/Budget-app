import { useMemo, type ReactNode } from 'react'
import { MonthStepper, MonthTitle } from '@/app/MonthSwitcher'
import { useMonthBounds, useNav, useSelectedMonth } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { compareISO, formatDate } from '@/domain/dates'
import { upcomingFixed } from '@/domain/insights'
import { formatPeriodName, formatPeriodRange, formatPeriodTitle } from '@/domain/period'
import type { RecurringLine } from '@/domain/recurring'
import type { HomeCardKey, MonthKey } from '@/domain/types'
import { monthResult } from '@/domain/wallet'
import { ComingUpCard } from '@/features/home/ComingUpCard'
import { Hero } from '@/features/home/Hero'
import { heroText } from '@/features/home/heroText'
import {
  cardOrder,
  dayAndMonth,
  limitRows,
  recentExpenses,
  spendingSegments,
  TREND_PERIODS,
  trendHasData,
  trendPoints,
  trendTitle,
  walletHasContent,
} from '@/features/home/homeData'
import { Ledger, type LedgerTarget, type StatementLine } from '@/features/home/Ledger'
import { LimitsCard } from '@/features/home/LimitsCard'
import { RecentCard } from '@/features/home/RecentCard'
import { SettingsButton } from '@/features/home/SettingsButton'
import { TrendCard } from '@/features/home/TrendCard'
import { WhereItWentCard } from '@/features/home/WhereItWentCard'
import { OwedCard } from '@/features/owed/OwedCard'
import { WalletCard } from '@/features/wallet/WalletCard'
import { actions } from '@/store/actions'
import {
  useCategoryMap,
  useMoneyFormat,
  useMonthSummary,
  useOwed,
  useSettings,
  useTrend,
  useWallet,
} from '@/store/hooks'
import { useToday } from '@/store/today'
import { useUiStore } from '@/store/uiStore'
import { Button, chooseDialog, EmptyState, IconButton, MASKED_LABEL, Screen, withTrueMinus } from '@/ui'
import type { ChartSeries } from '@/ui/charts'
import styles from './HomeScreen.module.css'

/** The trend's series (DESIGN.md §9.22): fixed costs at the bottom, daily spending on top, income as a line. */
const TREND_SERIES: ChartSeries[] = [
  { key: 'fixed', label: 'Fixed costs', cssVar: '--chart-fixed' },
  { key: 'daily', label: 'Daily spending', cssVar: '--chart-daily' },
  { key: 'income', label: 'Income', cssVar: '--chart-ref', kind: 'line' },
]

type CardKey = Exclude<HomeCardKey, 'equation'>

// ── Where things lead (SPEC §3.1). Event handlers read the stores at event time. ──────────────

function openLedgerTarget(target: LedgerTarget, month: MonthKey): void {
  const nav = useNav.getState()
  if (target === 'income' || target === 'fixed') {
    nav.setFixedSegment(target === 'income' ? 'income' : 'costs')
    nav.navigate('fixed')
  } else if (target === 'savings') {
    nav.openSheet({ name: 'savingsGoal', month })
  } else {
    nav.navigate('daily')
  }
}

function openFixedCosts(): void {
  const nav = useNav.getState()
  nav.setFixedSegment('costs')
  nav.navigate('fixed')
}

function openDaily(): void {
  useNav.getState().navigate('daily')
}

function openWallet(): void {
  useNav.getState().navigate('wallet')
}

function openCategory(categoryId: string): void {
  useNav.getState().push({ name: 'category', categoryId })
}

/** Categories, under settings on the Home stack, so Back leads to settings (SPEC §5.5). */
function openCategories(): void {
  useNav.getState().navigate('home', { name: 'you.categories' })
}

function openRecurring(line: RecurringLine): void {
  useNav.getState().openSheet({ name: 'recurring', id: line.recurring.id, kind: line.recurring.kind })
}

/** "Add your income": every month (the recurring sheet) or just this month (a one-off). */
async function addIncome(): Promise<void> {
  const choice = await chooseDialog({
    title: 'How often does it come in?',
    options: [
      { value: 'every', label: 'Every month' },
      { value: 'once', label: 'Just this month' },
    ],
  })
  if (choice === 'every') useNav.getState().openSheet({ name: 'recurring', kind: 'income' })
  else if (choice === 'once') useNav.getState().openSheet({ name: 'transaction', kind: 'income' })
}

/** Opening a closed month's review counts as having seen it (SPEC §3.15); markReviewed only moves forward. */
function openReview(month: MonthKey): void {
  actions.markReviewed(month)
  useNav.getState().openSheet({ name: 'monthReview', month })
}

/** Ticks a charge off from Coming up. The row leaves the card, so Undo brings it back. */
function markPaid(month: MonthKey, line: RecurringLine): void {
  const { id, name } = line.recurring
  withUndo(`Marked ${name} as paid`, () => actions.setOverride(month, id, { paid: true })).catch(() => {
    // The charge changed underneath (deleted or skipped elsewhere): nothing to mark, nothing to undo.
  })
}

function toggleAmounts(): void {
  const ui = useUiStore.getState()
  ui.setAmountsRevealed(!ui.amountsRevealed)
}

/**
 * Home (docs/SPEC.md §3.1, DESIGN.md §2, §9.2–§9.8): the settings button, the month stepper and the
 * month title; the hero with the month written as a sum (or a closed statement, or the plan for a
 * future month); then the cards in the user's order, each hidden when it has nothing to show, and
 * an empty state when none has. The shell puts its banners into the Screen's banner slot.
 */
export function HomeScreen() {
  const month = useSelectedMonth()
  const { first, current } = useMonthBounds()
  const { monthStartDay: startDay, locale, homeCards, hideAmounts } = useSettings()
  const summary = useMonthSummary(month)
  const wallet = useWallet()
  const owed = useOwed()
  const trend = useTrend(month, TREND_PERIODS)
  const categories = useCategoryMap()
  const money = useMoneyFormat()
  const today = useToday()
  const revealed = useUiStore((s) => s.amountsRevealed)

  const { timing } = summary
  const isCurrent = timing === 'current'
  const title = formatPeriodTitle(month, current, startDay, locale)
  const walletCounts = compareISO(month, wallet.start) >= 0

  const text = useMemo(() => {
    const format = (cents: number): string => withTrueMinus(money.format(cents))
    return heroText(summary, {
      format,
      speak: (cents) => (money.masked ? MASKED_LABEL : format(cents)),
      name: formatPeriodName(month, startDay, locale),
      walletCounts,
      closedLabel: timing === 'past' ? `Statement closed on ${dayAndMonth(summary.range.end, locale)}` : null,
    })
  }, [summary, money, month, startDay, locale, walletCounts, timing])

  // A closed month the wallet counts says where its result went (§3.1, §4.8).
  const statement = useMemo<StatementLine | null>(() => {
    if (timing !== 'past' || !walletCounts) return null
    const result = monthResult(summary)
    return result >= 0
      ? { text: 'Moved to your wallet:', amount: result }
      : { text: 'Taken from your wallet:', amount: -result }
  }, [summary, timing, walletCounts])

  const segments = useMemo(() => spendingSegments(summary.byCategory, categories), [summary.byCategory, categories])
  const limits = useMemo(() => limitRows(summary.byCategory, categories), [summary.byCategory, categories])
  const upcoming = useMemo(() => upcomingFixed(summary, today), [summary, today])
  const trendData = useMemo(() => trendPoints(trend, first), [trend, first])
  const recent = useMemo(() => recentExpenses(summary.transactions), [summary.transactions])

  const has: Readonly<Record<CardKey, boolean>> = {
    wallet: walletHasContent(wallet),
    owed: owed.people.length > 0,
    whereItWent: segments.length > 0,
    // A month still to come shows its limits once something counts against one.
    budgets: limits.length > 0 && (timing !== 'future' || limits.some((row) => row.total > 0)),
    comingUp: upcoming.length > 0,
    trend: trendHasData(trendData),
    recent: recent.length > 0,
  }
  const cards = cardOrder(homeCards)
  const empty = !cards.some((key) => has[key])

  const card = (key: CardKey): ReactNode => {
    switch (key) {
      case 'wallet':
        // The Wallet and Owed cards decide for themselves whether they show.
        return <WalletCard key={key} month={month} />
      case 'owed':
        return <OwedCard key={key} />
      case 'whereItWent':
        return has.whereItWent ? (
          <WhereItWentCard
            key={`${key}-${month}`}
            segments={segments}
            total={summary.daily}
            fixed={summary.fixed}
            onCategory={openCategory}
            onFixed={openFixedCosts}
          />
        ) : null
      case 'budgets':
        // Without limits, the current period invites setting one; other periods leave the card out.
        return has.budgets || isCurrent ? (
          <LimitsCard
            key={key}
            rows={limits}
            timeRatio={isCurrent ? summary.pace.timeRatio : null}
            onCategory={openCategory}
            onCategories={openCategories}
          />
        ) : null
      case 'comingUp':
        return has.comingUp ? (
          <ComingUpCard
            key={key}
            lines={upcoming}
            today={today}
            onOpen={openRecurring}
            onPaid={(line) => markPaid(month, line)}
          />
        ) : null
      case 'trend':
        return has.trend ? (
          <TrendCard
            key={key}
            title={trendTitle(isCurrent, title)}
            points={trendData}
            series={TREND_SERIES}
            subject="Fixed costs and daily spending"
            current={trendData.some((point) => point.month === current) ? current : null}
            startDay={startDay}
            locale={locale}
          />
        ) : null
      case 'recent':
        return has.recent || isCurrent ? <RecentCard key={key} expenses={recent} onSeeAll={openDaily} /> : null
    }
  }

  const ledgerTitle = isCurrent ? 'This month' : timing === 'past' ? `Statement for ${title}` : title

  return (
    <Screen
      title="Home"
      largeTitle
      titleContent={<MonthTitle />}
      leading={<SettingsButton />}
      headerRight={
        <>
          {hideAmounts && (
            <IconButton
              variant="glass"
              icon={revealed ? 'eye-off' : 'eye'}
              label={revealed ? 'Hide amounts' : 'Show amounts'}
              onClick={toggleAmounts}
            />
          )}
          <MonthStepper />
        </>
      }
      compactTitle={title}
      compactTitleVariant="month"
      compactSubtitle={text.compact}
    >
      <Hero
        summary={summary}
        text={text}
        closedCaption={timing === 'past' ? `Closed ${formatDate(summary.range.end, locale, 'short')}` : null}
        onAddIncome={() => void addIncome()}
        onReviewFixed={openFixedCosts}
      />
      {homeCards.includes('equation') && (
        <Ledger
          summary={summary}
          title={ledgerTitle}
          range={timing === 'past' ? formatPeriodRange(month, startDay, locale) : null}
          statement={statement}
          onOpen={(target) => openLedgerTarget(target, month)}
          onStatement={openWallet}
        />
      )}
      {timing === 'past' && (
        <div className={styles.review}>
          <Button variant="secondary" size="md" block onClick={() => openReview(month)}>
            See the review
          </Button>
        </div>
      )}
      {empty ? (
        <EmptyState
          className={styles.empty}
          title="Your month starts here"
          message="Add what you spend with + and the app does the sums."
        />
      ) : (
        cards.map(card)
      )}
    </Screen>
  )
}
