import type { MoneyFormat } from '@/domain/money'
import { periodOf } from '@/domain/period'
import type { MonthSummary } from '@/domain/summary'
import { StepFrame } from '@/features/onboarding/StepFrame'
import styles from '@/features/onboarding/Steps.module.css'
import type { StepNav } from '@/features/onboarding/types'
import { useMonthSummary, useMoneyFormat, useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import { BigAmount, Icon, ListRow, Money, Section, withTrueMinus } from '@/ui'

export interface DoneStepProps extends Omit<StepNav, 'onNext'> {
  /** "Start budgeting": ends onboarding. */
  onFinish(): void
}

interface Hero {
  label: string
  /** Over budget: the octagon and critical ink. */
  over: boolean
  figure: number
  sentence: string
}

/**
 * The current period's result in the words of Home's hero (docs/SPEC.md §3.1), so the first number
 * the user sees here is the one Home shows next.
 */
function heroOf(summary: MonthSummary, money: MoneyFormat): Hero {
  const fmt = (cents: number) => withTrueMinus(money.format(cents))
  if (summary.income === 0) {
    return {
      label: 'Spent this month',
      over: false,
      figure: summary.spent,
      sentence: "Add your income on Home to see what's left to spend.",
    }
  }
  if (summary.available <= 0) {
    return {
      label: 'Over budget by',
      over: true,
      figure: -summary.left,
      sentence: "Fixed costs and savings are more than this month's income.",
    }
  }
  if (summary.left < 0) {
    return {
      label: 'Over budget by',
      over: true,
      figure: -summary.left,
      sentence: `Spent ${fmt(summary.daily)} of ${fmt(summary.available)} for daily life.`,
    }
  }
  return {
    label: 'Left to spend',
    over: false,
    figure: summary.left,
    sentence:
      summary.daysLeft > 1 && summary.perDay !== null
        ? `About ${fmt(summary.perDay)} a day for the next ${summary.daysLeft} days.`
        : 'Last day of this month.',
  }
}

/**
 * Step 7, Done (docs/SPEC.md §3.9): this month's left to spend from what was entered (BigAmount,
 * which follows "Show cents in the big number"), the sums behind it, and "Start budgeting", which
 * ends onboarding.
 */
export function DoneStep({ progress, direction, onBack, onFinish }: DoneStepProps) {
  const { monthStartDay } = useSettings()
  const today = useToday()
  const summary = useMonthSummary(periodOf(today, monthStartDay))
  const money = useMoneyFormat()
  const hero = heroOf(summary, money)
  const entered = summary.income > 0 || summary.fixed > 0 || summary.savings > 0 || summary.daily > 0

  return (
    <StepFrame
      title="You're all set"
      compactTitle="Done"
      progress={progress}
      direction={direction}
      onBack={onBack}
      primary={{ label: 'Start budgeting', onClick: onFinish }}
    >
      <div className={styles.hero}>
        <p className={hero.over ? styles.heroLabelOver : styles.heroLabel}>
          {hero.over && <Icon name="critical" size={16} className={styles.heroIcon} />}
          {hero.label}
        </p>
        <BigAmount cents={hero.figure} tone={hero.over ? 'critical' : 'default'} className={styles.heroFigure} />
        <p className={styles.heroSentence}>{hero.sentence}</p>
      </div>
      {entered && (
        <Section variant="form" title="This month" footer="You can change all of this later.">
          <ListRow title="Money in" value={<Money cents={summary.income} />} />
          <ListRow title="Fixed costs" value={<Money cents={summary.fixed} />} />
          {/* Only a restored backup can bring a savings goal; then the sums still add up. */}
          {summary.savings > 0 && <ListRow title="Savings" value={<Money cents={summary.savings} />} />}
          <ListRow title="Spent so far" value={<Money cents={summary.daily} />} />
        </Section>
      )}
    </StepFrame>
  )
}
