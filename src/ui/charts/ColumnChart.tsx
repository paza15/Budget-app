import { useMemo } from 'react'
import { ChartGrid, gridLayout, NO_GRID } from '@/ui/charts/ChartGrid'
import { ChartTable } from '@/ui/charts/ChartTable'
import { ChartTooltip, TooltipContent } from '@/ui/charts/ChartTooltip'
import { classNames } from '@/ui/charts/classNames'
import styles from '@/ui/charts/columns.module.css'
import { MaskedTspans } from '@/ui/MaskedText'
import {
  type AxisLabel,
  clamp,
  type ColumnBox,
  columnPath,
  columnsReach,
  DATA_RADIUS,
  edgeAxisLabels,
  estimateTextWidth,
  FALLBACK_FONT_SIZE,
  FALLBACK_WIDTH,
  freeAxisSpan,
  labelBox,
  labelHeadroom,
  layoutColumns,
  lineLabelY,
  round2,
  snap,
  valueDomainWithLines,
  valueY,
} from '@/ui/charts/scale'
import { useChartBox } from '@/ui/charts/useChartBox'
import { useChartFormat } from '@/ui/charts/useChartFormat'
import { useColumnSelection } from '@/ui/charts/useColumnSelection'
import type { TestIdProps } from '@/ui/types'

export interface ColumnDatum {
  key: string
  /** Axis and table label, e.g. "16 Oct". The axis shows the first, the last and the highlighted one. */
  label: string
  value: number
  /** Fuller name for the tooltip and the hidden table, e.g. "Fri 16 Oct". Default: label. */
  title?: string
}

export interface ColumnReference {
  value: number
  /**
   * Caption of the line, e.g. "17,34 € a day". A function receives the formatted value (masked
   * while amounts are hidden): `(v) => `${v} a day``.
   */
  label: string | ((formattedValue: string) => string)
  /**
   * Key of the column the line starts at, marked with a dot: the current month's allowance runs
   * from today to the end of the period (docs/SPEC.md §3.3), its label right-aligned 6px above
   * the line's end. Nothing is drawn when the key is not among the columns. Omitted: the line
   * spans the whole plot, as a past month's "Daily budget" does.
   */
  from?: string
}

export interface ColumnChartProps extends TestIdProps {
  data: ColumnDatum[]
  /** A solid reference line, such as the per-day allowance or the daily budget. */
  reference?: ColumnReference
  /**
   * Formats values for tooltips, the reference label and the hidden table. Default: the money
   * format from MoneyFormatContext. Values are masked while amounts are hidden, whatever this returns.
   */
  formatValue?(value: number): string
  /** Accessible name of the chart, e.g. "Spending per day in October". */
  label: string
  /** Plot height in px; a 24px axis band comes on top. Default 72. */
  height?: number
  /** Column drawn in --chart-col-now (today), with its axis label in 600 ink. */
  highlightKey?: string
  /** Axis label under the highlighted column, e.g. "Today". Default: that column's label. */
  highlightLabel?: string
  /** Custom property of the columns' colour, e.g. '--cat-yellow' on category detail. Default '--chart-col'. */
  cssVar?: string
  /** Colour of the highlighted and the selected column. Default: '--chart-col-now', or `cssVar` when that is set. */
  highlightCssVar?: string
  /** Column width in px (at most 24). Default 6. */
  barWidth?: number
  /**
   * Hairline gridlines at clean values, labelled in the compact money format after the plot.
   * Default false: the app's charts read through the reference line, the tooltip and the table.
   */
  grid?: boolean
  /** Controlled tooltip selection; leave undefined to let the chart keep its own. */
  selectedKey?: string | null
  /** A column was tapped (null: its tooltip was closed). */
  onSelect?(key: string | null): void
  /** Headers of the hidden table. Default ['Day', 'Amount']. */
  tableHeaders?: readonly [string, string]
  className?: string
}

/** The axis band under the plot and the baseline of its labels (docs/DESIGN.md §9.22). */
const AXIS_HEIGHT = 24
const AXIS_TEXT_Y = 18
const REFERENCE_DOT_RADIUS = 2.5
/** The short stroke that keys a reference label set in the axis band, and its gap to the text. */
const KEY_WIDTH = 12
const KEY_GAP = 5
const DEFAULT_HEADERS = ['Day', 'Amount'] as const

/**
 * Columns over time, such as spending per day (docs/DESIGN.md §9.22): one column per datum,
 * centred in its slot, rounded at the top and square on the 0.75px baseline; days with nothing
 * draw nothing. An optional reference line, a tap tooltip (the whole slot is the target; the
 * arrow keys work too), and a visually hidden table of the values beside the role="img" picture.
 */
export function ColumnChart({
  data,
  reference,
  formatValue,
  label,
  height = 72,
  highlightKey,
  highlightLabel,
  cssVar,
  highlightCssVar,
  barWidth = 6,
  grid = false,
  selectedKey,
  onSelect,
  tableHeaders = DEFAULT_HEADERS,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: ColumnChartProps) {
  const [plotRef, box] = useChartBox<HTMLDivElement>()
  const width = box?.width ?? FALLBACK_WIDTH
  const fontSize = box?.fontSize ?? FALLBACK_FONT_SIZE
  const format = useChartFormat(formatValue)
  const keys = useMemo(() => data.map((datum) => datum.key), [data])

  const plotHeight = Math.max(1, height)
  const svgHeight = plotHeight + AXIS_HEIGHT
  const max = valueDomainWithLines(
    data.map((datum) => datum.value),
    reference === undefined ? [] : [reference.value],
    { plotHeight, headroom: labelHeadroom(fontSize) },
  )
  const gridLines = grid ? gridLayout({ max, plotHeight, fontSize, format: format.tick }) : NO_GRID
  const plotWidth = Math.max(1, width - gridLines.gutter)
  const { selected, rootRef, plotHandlers, keyHandlers, clear } = useColumnSelection({
    keys,
    plotWidth,
    selectedKey,
    onSelect,
    startKey: highlightKey,
  })

  const columns = layoutColumns(
    data.map((datum) => datum.value),
    { width: plotWidth, plotHeight, barWidth, max },
  )
  const columnVar = cssVar ?? '--chart-col'
  const nowVar = highlightCssVar ?? cssVar ?? '--chart-col-now'
  const highlightIndex = highlightKey === undefined ? -1 : keys.indexOf(highlightKey)
  const selectedIndex = selected === null ? -1 : keys.indexOf(selected)
  const highlighted = data[highlightIndex]
  const axisLabels = edgeAxisLabels({
    keys,
    labels: data.map((datum) => datum.label),
    width: plotWidth,
    fontSize,
    highlight: highlighted === undefined ? undefined : { index: highlightIndex, text: highlightLabel ?? highlighted.label },
  })

  const referenceText =
    reference === undefined
      ? undefined
      : typeof reference.label === 'function'
        ? reference.label(format.value(reference.value))
        : reference.label
  const line =
    reference === undefined || referenceText === undefined
      ? null
      : referenceShape(reference, referenceText, { keys, columns, axisLabels, plotWidth, plotHeight, max, fontSize })

  const activeDatum = data[selectedIndex]
  const activeColumn = columns[selectedIndex]
  // The tooltip leaves the line's label readable when it can.
  const avoid =
    line === null || line.keyX !== null
      ? []
      : [
          labelBox({
            x: line.labelX,
            y: line.labelY,
            width: estimateTextWidth(referenceText ?? '', fontSize),
            fontSize,
            anchor: 'end',
          }),
        ]

  return (
    <div ref={rootRef} className={classNames(styles.root, className)} data-testid={testId} data-id={dataId}>
      <div ref={plotRef} className={styles.plot} {...plotHandlers}>
        <svg
          className={styles.svg}
          width="100%"
          height={svgHeight}
          viewBox={`0 0 ${round2(width)} ${svgHeight}`}
          // An inline SVG chart cannot be an <img>; role="img" names the picture (DESIGN.md §9.22).
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="img"
          aria-label={label}
          // Focusable for keyboard users (iOS Full Keyboard Access): the arrow keys step through the
          // columns' tooltips. Screen readers read the same values from the hidden table.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={data.length > 0 ? 0 : undefined}
          {...keyHandlers}
        >
          <ChartGrid layout={gridLines} plotWidth={plotWidth} fontSize={fontSize} />
          <rect className={styles.baseline} x={0} y={plotHeight} width={round2(plotWidth)} height={0.75} />
          {columns.map((column) => {
            const datum = data[column.index]
            if (datum === undefined || column.height <= 0) return null
            const strong = column.index === highlightIndex || column.index === selectedIndex
            return (
              <path
                key={datum.key}
                className={styles.column}
                d={columnPath(snap(column.x), plotHeight, column.width, column.height, DATA_RADIUS)}
                style={{ fill: `var(${strong ? nowVar : columnVar})` }}
                data-key={datum.key}
                data-dimmed={selectedIndex >= 0 && column.index !== selectedIndex ? '' : undefined}
              />
            )
          })}
          {line !== null && (
            <g data-part="reference">
              <rect
                className={styles.reference}
                x={round2(line.start)}
                y={round2(line.y - 0.5)}
                width={round2(Math.max(0, plotWidth - line.start))}
                height={1}
              />
              {line.dot && (
                <circle className={styles.reference} cx={round2(line.start)} cy={round2(line.y)} r={REFERENCE_DOT_RADIUS} />
              )}
              {line.keyX !== null && (
                <rect
                  className={styles.reference}
                  x={round2(line.keyX)}
                  y={snap(line.labelY - fontSize * 0.35 - 0.5)}
                  width={KEY_WIDTH}
                  height={1}
                />
              )}
              <text
                className={line.keyX === null ? styles.plotLabel : styles.axisLabel}
                x={round2(line.labelX)}
                y={round2(line.labelY)}
                textAnchor={line.keyX === null ? 'end' : 'start'}
                data-part="reference-label"
              >
                <MaskedTspans text={referenceText ?? ''} />
              </text>
            </g>
          )}
          {axisLabels.map((axisLabel) => (
            <text
              key={axisLabel.key}
              className={styles.axisLabel}
              data-strong={axisLabel.strong ? '' : undefined}
              x={round2(axisLabel.x)}
              y={plotHeight + AXIS_TEXT_Y}
              textAnchor={axisLabel.anchor}
            >
              {axisLabel.text}
            </text>
          ))}
        </svg>
        {activeDatum !== undefined && activeColumn !== undefined && (
          <ChartTooltip
            key={activeDatum.key}
            x={activeColumn.center}
            halfWidth={activeColumn.width / 2}
            boxWidth={width}
            boxHeight={svgHeight}
            avoid={avoid}
            onDismiss={clear}
          >
            <TooltipContent
              title={activeDatum.title ?? activeDatum.label}
              rows={[{ key: 'value', value: format.value(activeDatum.value) }]}
            />
          </ChartTooltip>
        )}
      </div>
      <ChartTable
        caption={label}
        columns={tableHeaders}
        rows={data.map((datum) => ({
          key: datum.key,
          header: datum.title ?? datum.label,
          cells: [{ key: 'value', text: format.value(datum.value) }],
        }))}
        footer={referenceText}
      />
    </div>
  )
}

interface ReferenceShape {
  /** y of the line, on the device pixel grid. */
  y: number
  /** Where the line starts: the `from` column's centre (with a dot) or the plot's start. */
  start: number
  dot: boolean
  labelX: number
  labelY: number
  /** Left edge of the key stroke when the label sits in the axis band; null beside the line. */
  keyX: number | null
}

/**
 * The reference line and where its label goes. From a column (the current month's allowance),
 * the label is right-aligned 6px above the line's end, where the days ahead leave room. Across
 * the whole plot (a past month's daily budget), columns can reach into that spot; the label then
 * moves to the free middle of the axis band, keyed with a short stroke of the line, rather than
 * cross them. With no room there either it stays at the line's end, on its --surface halo.
 */
function referenceShape(
  reference: ColumnReference,
  text: string,
  o: {
    keys: readonly string[]
    columns: readonly ColumnBox[]
    axisLabels: readonly AxisLabel[]
    plotWidth: number
    plotHeight: number
    max: number
    fontSize: number
  },
): ReferenceShape | null {
  const y = snap(valueY(reference.value, o.max, o.plotHeight))
  const atEnd: ReferenceShape = {
    y,
    start: 0,
    dot: false,
    labelX: o.plotWidth,
    labelY: lineLabelY(y, o.fontSize),
    keyX: null,
  }
  if (reference.from !== undefined) {
    const from = o.columns[o.keys.indexOf(reference.from)]
    if (from === undefined) return null
    return { ...atEnd, start: Math.min(from.center, o.plotWidth), dot: true }
  }
  const textWidth = estimateTextWidth(text, o.fontSize)
  const box = labelBox({ x: atEnd.labelX, y: atEnd.labelY, width: textWidth, fontSize: o.fontSize, anchor: 'end' })
  if (!columnsReach(o.columns, o.plotHeight, box)) return atEnd
  const span = freeAxisSpan(o.axisLabels, o.plotWidth, o.fontSize)
  const keyed = KEY_WIDTH + KEY_GAP + textWidth
  if (span === null || span.right - span.left < keyed) return atEnd
  const keyX = clamp((o.plotWidth - keyed) / 2, span.left, span.right - keyed)
  return { ...atEnd, labelX: keyX + KEY_WIDTH + KEY_GAP, labelY: o.plotHeight + AXIS_TEXT_Y, keyX }
}
