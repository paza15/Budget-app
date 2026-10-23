import { useMemo } from 'react'
import { formatPeriodLabel, formatPeriodName } from '@/domain/period'
import type { MonthKey } from '@/domain/types'
import { type ChartSeries, StackedColumnChart, type StackedColumnDatum } from '@/ui/charts'
import { Section } from '@/ui'
import styles from './TrendCard.module.css'

/** A period of the chart: what went to fixed costs, to daily life, and what came in. */
export interface TrendCardPoint {
  month: MonthKey
  fixed: number
  daily: number
  /** Drawn as the income line when given. */
  income?: number
}

export interface TrendCardProps {
  title: string
  points: TrendCardPoint[]
  /** Fixed costs at the bottom, daily spending on top, income as a line (DESIGN.md §9.22). */
  series: ChartSeries[]
  /** Accessible name of the chart's subject, e.g. "Fixed costs and daily spending". */
  subject: string
  /** The current period, whose month label is emphasised; null when it is not among the points. */
  current: MonthKey | null
  startDay: number
  locale: string
  /** The section's heading style: 'card' on Home (default), 'day' among category detail's lists. */
  variant?: 'card' | 'day'
}

/** A period's values by series key; income only where the point has it. */
function valuesOf(point: TrendCardPoint): Record<string, number> {
  const values: Record<string, number> = { fixed: point.fixed, daily: point.daily }
  if (point.income !== undefined) values.income = point.income
  return values
}

/**
 * Last 6 months (docs/SPEC.md §3.1, §3.2; DESIGN.md §9.22): stacked columns per period with a
 * legend; a tap on a column keeps it at full strength and shows its values in a tooltip. Home's
 * trend and category detail's both use it.
 */
export function TrendCard({
  title,
  points,
  series,
  subject,
  current,
  startDay,
  locale,
  variant = 'card',
}: TrendCardProps) {
  const data = useMemo<StackedColumnDatum[]>(
    () =>
      points.map((point) => ({
        key: point.month,
        label: formatPeriodName(point.month, startDay, locale, { style: 'short' }),
        title: formatPeriodLabel(point.month, startDay, locale),
        values: valuesOf(point),
      })),
    [points, startDay, locale],
  )
  const first = points.at(0)
  const last = points.at(-1)
  const span =
    first === undefined || last === undefined
      ? ''
      : `, ${formatPeriodName(first.month, startDay, locale)} to ${formatPeriodName(last.month, startDay, locale)}`

  return (
    <Section title={title} variant={variant}>
      <div className={styles.chart}>
        <StackedColumnChart
          data={data}
          series={series}
          label={`${subject}${span}`}
          highlightKey={current ?? undefined}
        />
      </div>
    </Section>
  )
}
