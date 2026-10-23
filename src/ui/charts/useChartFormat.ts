import { useMemo } from 'react'
import { MASKED } from '@/domain/money'
import { formatShare } from '@/ui/charts/format'
import { useMoneyFormatContext } from '@/ui/MoneyFormatContext'

export interface ChartFormat {
  /** A value for labels, tooltips and hidden tables. */
  value(value: number): string
  /** A gridline value: the compact money format ("20 €", "€1.5K"). */
  tick(value: number): string
  /** A share such as "35 %". */
  share(ratio: number): string
  masked: boolean
}

/**
 * Formatting for chart text. Values go through the chart's `formatValue`, or the user's money
 * format from MoneyFormatContext, and read MASKED whenever amounts are hidden, whatever formatter
 * the caller passed (docs/SPEC.md §4.1: chart values, ticks, tooltips and tables are masked).
 * Shares are ratios, not amounts, so they stay visible.
 */
export function useChartFormat(formatValue?: (value: number) => string): ChartFormat {
  const money = useMoneyFormatContext()
  return useMemo(() => {
    const masked = money.masked
    const format = formatValue ?? ((value: number) => money.format(value))
    return {
      masked,
      value: masked ? () => MASKED : format,
      tick: masked ? () => MASKED : (value: number) => money.format(value, { compact: true }),
      share: (ratio: number) => formatShare(ratio, money.locale),
    }
  }, [money, formatValue])
}
