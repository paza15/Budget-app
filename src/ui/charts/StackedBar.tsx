import { ChartTable } from '@/ui/charts/ChartTable'
import { classNames } from '@/ui/charts/classNames'
import { barPath, DATA_RADIUS, FALLBACK_WIDTH, round2, snap, stackedBarLayout } from '@/ui/charts/scale'
import { segmentColorVar, type StackedBarSegment } from '@/ui/charts/segments'
import styles from '@/ui/charts/StackedBar.module.css'
import { useChartBox } from '@/ui/charts/useChartBox'
import { useChartFormat } from '@/ui/charts/useChartFormat'
import type { TestIdProps } from '@/ui/types'

export type { StackedBarSegment } from '@/ui/charts/segments'

export interface StackedBarProps extends TestIdProps {
  /** In drawing order, largest first (foldSegments sorts and folds the tail). */
  segments: StackedBarSegment[]
  /** Accessible name of the chart, e.g. "Daily spending by category". */
  label: string
  /**
   * Formats values for the hidden table. Default: the money format from MoneyFormatContext.
   * Values are masked while amounts are hidden, whatever this returns.
   */
  formatValue?(value: number): string
  className?: string
}

/** Height of the bar (docs/DESIGN.md §9.22). */
const HEIGHT = 10

/**
 * One horizontal bar split into category segments (Where it went, docs/DESIGN.md §9.22): 10px
 * tall, 2px surface gaps between segments, 4px rounded outer ends, each segment in its category
 * ink (--cat-other for the fold). Segments without a positive value are left out. The legend is
 * the caller's (Legend, in the same order); the values are also in a visually hidden table.
 */
export function StackedBar({
  segments,
  label,
  formatValue,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: StackedBarProps) {
  const [boxRef, box] = useChartBox<HTMLDivElement>()
  const width = box?.width ?? FALLBACK_WIDTH
  const format = useChartFormat(formatValue)
  const visible = segments.filter((segment) => segment.value > 0)
  const total = visible.reduce((sum, segment) => sum + segment.value, 0)
  const layout = stackedBarLayout(
    visible.map((segment) => segment.value),
    width,
  )
  const last = visible.length - 1

  return (
    <div ref={boxRef} className={classNames(styles.root, className)} data-testid={testId} data-id={dataId}>
      <svg
        className={styles.svg}
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${round2(width)} ${HEIGHT}`}
        // An inline SVG chart cannot be an <img>; role="img" names the picture (DESIGN.md §9.22).
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        aria-label={label}
      >
        {visible.map((segment, index) => {
          const place = layout[index]
          if (place === undefined || place.width <= 0) return null
          // Edges on the device pixel grid keep every 2px gap equally sharp.
          const start = index === 0 ? 0 : snap(place.x)
          const end = index === last ? width : snap(place.x + place.width)
          return (
            <path
              key={segment.key}
              d={barPath(start, 0, end - start, HEIGHT, DATA_RADIUS, { start: index === 0, end: index === last })}
              style={{ fill: `var(${segmentColorVar(segment.color)})` }}
              data-key={segment.key}
              data-part="segment"
            />
          )
        })}
      </svg>
      <ChartTable
        caption={label}
        columns={['Category', 'Amount', 'Share']}
        rows={visible.map((segment) => ({
          key: segment.key,
          header: segment.label,
          cells: [
            { key: 'amount', text: format.value(segment.value) },
            { key: 'share', text: format.share(segment.value / total) },
          ],
        }))}
      />
    </div>
  )
}
