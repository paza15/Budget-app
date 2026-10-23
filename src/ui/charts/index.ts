/**
 * Charts (docs/SPEC.md §5.8, docs/DESIGN.md §9.5, §9.22): SVG sized by its container and drawn
 * in token colours, a role="img" picture with a sentence label, and a visually hidden table of
 * the values beside it. Values read MASKED while amounts are hidden.
 */

export { TooltipContent, type TooltipRow } from '@/ui/charts/ChartTooltip'
export {
  ColumnChart,
  type ColumnChartProps,
  type ColumnDatum,
  type ColumnReference,
} from '@/ui/charts/ColumnChart'
export { formatShare } from '@/ui/charts/format'
export { Legend, type LegendItem, type LegendProps, type LegendShape } from '@/ui/charts/Legend'
export { PaceBar, type PaceBarProps } from '@/ui/charts/PaceBar'
export { FOLD_KEY, foldSegments, segmentColorVar } from '@/ui/charts/segments'
export { StackedBar, type StackedBarProps, type StackedBarSegment } from '@/ui/charts/StackedBar'
export {
  StackedColumnChart,
  type ChartSeries,
  type StackedColumnChartProps,
  type StackedColumnDatum,
} from '@/ui/charts/StackedColumnChart'
