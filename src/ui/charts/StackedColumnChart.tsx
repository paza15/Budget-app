import { type ReactNode, useMemo } from 'react'
import { ChartGrid, gridLayout, NO_GRID } from '@/ui/charts/ChartGrid'
import { ChartTable } from '@/ui/charts/ChartTable'
import { ChartTooltip, TooltipContent } from '@/ui/charts/ChartTooltip'
import { classNames } from '@/ui/charts/classNames'
import styles from '@/ui/charts/columns.module.css'
import { Legend } from '@/ui/charts/Legend'
import { MaskedTspans } from '@/ui/MaskedText'
import {
  columnAxisLabels,
  columnPath,
  DATA_RADIUS,
  FALLBACK_FONT_SIZE,
  FALLBACK_WIDTH,
  labelHeadroom,
  layoutColumns,
  lineLabelY,
  round2,
  snap,
  stackColumn,
  stepLinePath,
  valueDomainWithLines,
  valueY,
} from '@/ui/charts/scale'
import { useChartBox } from '@/ui/charts/useChartBox'
import { useChartFormat } from '@/ui/charts/useChartFormat'
import { useColumnSelection } from '@/ui/charts/useColumnSelection'
import type { TestIdProps } from '@/ui/types'

export interface StackedColumnDatum {
  key: string
  /** Axis label, e.g. "Oct". */
  label: string
  /** Value per series key. */
  values: Record<string, number>
  /** Fuller name for the tooltip and the hidden table, e.g. "October 2026". Default: label. */
  title?: string
}

export interface ChartSeries {
  key: string
  label: string
  /** Custom property from tokens.css holding the series colour, e.g. '--chart-fixed'. */
  cssVar: string
  /**
   * 'column' (default): a part of each column, stacked bottom first. 'line': a 1.5px line
   * through each column's value, e.g. income with '--chart-ref', labelled "{label} {last value}"
   * at the right and keyed with a line in the legend.
   */
  kind?: 'column' | 'line'
}

export interface StackedColumnChartProps extends TestIdProps {
  data: StackedColumnDatum[]
  /** Stacking order, bottom first; line series draw over the columns. */
  series: ChartSeries[]
  /**
   * Formats values for the line label, the default tooltip and the hidden table. Default: the
   * money format from MoneyFormatContext. Masked while amounts are hidden, whatever it returns.
   */
  formatValue?(value: number): string
  /** Accessible name of the chart. */
  label: string
  /** Plot height in px; a 22px axis band comes on top. Default 124. */
  height?: number
  /** The tapped column. Controlled when not undefined (null: none). */
  selectedKey?: string | null
  /** A column was tapped (null: tapped outside, or the open column again). */
  onSelect?(key: string | null): void
  /** Tooltip content for the selected column. Default: its title and every series' value. */
  tooltip?(key: string): ReactNode
  /** Column whose axis label is emphasised (600, --ink), e.g. the current month. */
  highlightKey?: string
  /** Column width in px (at most 24). Default 22. */
  barWidth?: number
  /** Hairline gridlines at clean values, labelled after the plot. Default false. */
  grid?: boolean
  /** The legend under the plot. Default: shown for two or more series. */
  legend?: boolean
  /** Header of the hidden table's first column. Default "Month". */
  labelHeader?: string
  className?: string
}

/** The axis band under the plot and the baseline of its labels (docs/DESIGN.md §9.22). */
const AXIS_HEIGHT = 22
const AXIS_TEXT_Y = 16

/** A series' value in a datum; missing, inherited or invalid entries count as 0. */
function valueOf(values: Readonly<Record<string, number>>, key: string): number {
  if (!Object.hasOwn(values, key)) return 0
  const value = values[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Stacked columns per period, such as fixed costs and daily spending over six months
 * (docs/DESIGN.md §9.22): 22px columns, the first series at the bottom, a 2px surface gap, the
 * next on top with the 4px rounded data end; line series (income) over them. Tapping a column (or
 * the arrow keys) keeps it at full strength, fades the others to 35% and shows a tooltip above the
 * plot. A legend sits under the plot and the values are in a visually hidden table.
 */
export function StackedColumnChart({
  data,
  series,
  formatValue,
  label,
  height = 124,
  selectedKey,
  onSelect,
  tooltip,
  highlightKey,
  barWidth = 22,
  grid = false,
  legend = series.length >= 2,
  labelHeader = 'Month',
  className,
  'data-testid': testId,
  'data-id': dataId,
}: StackedColumnChartProps) {
  const [plotRef, box] = useChartBox<HTMLDivElement>()
  const width = box?.width ?? FALLBACK_WIDTH
  const fontSize = box?.fontSize ?? FALLBACK_FONT_SIZE
  const format = useChartFormat(formatValue)
  const keys = useMemo(() => data.map((datum) => datum.key), [data])

  const plotHeight = Math.max(1, height)
  const svgHeight = plotHeight + AXIS_HEIGHT
  const stacked = series.filter((item) => item.kind !== 'line')
  const lines = series.filter((item) => item.kind === 'line')
  const totals = data.map((datum) =>
    stacked.reduce((sum, item) => sum + Math.max(0, valueOf(datum.values, item.key)), 0),
  )
  const max = valueDomainWithLines(
    totals,
    data.flatMap((datum) => lines.map((item) => valueOf(datum.values, item.key))),
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

  const columns = layoutColumns(totals, { width: plotWidth, plotHeight, barWidth, max })
  const stacks = data.map((datum) =>
    stackColumn(
      stacked.map((item) => valueOf(datum.values, item.key)),
      { max, plotHeight },
    ),
  )
  const highlightIndex = highlightKey === undefined ? -1 : keys.indexOf(highlightKey)
  const selectedIndex = selected === null ? -1 : keys.indexOf(selected)
  const axisLabels = columnAxisLabels({
    keys,
    labels: data.map((datum) => datum.label),
    width: plotWidth,
    fontSize,
    highlightIndex,
  })
  const slot = data.length > 0 ? plotWidth / data.length : plotWidth
  const lineShapes = lines.map((item) => {
    const levels = data.map((datum) =>
      Object.hasOwn(datum.values, item.key) ? snap(valueY(valueOf(datum.values, item.key), max, plotHeight)) : null,
    )
    const lastDatum = data.findLast((datum) => Object.hasOwn(datum.values, item.key))
    const lastY = levels.findLast((level) => level !== null) ?? null
    return {
      key: item.key,
      cssVar: item.cssVar,
      d: stepLinePath(levels, slot),
      label: lastDatum === undefined ? null : `${item.label} ${format.value(valueOf(lastDatum.values, item.key))}`,
      labelY: lastY === null ? 0 : lineLabelY(lastY, fontSize),
    }
  })

  const activeDatum = data[selectedIndex]
  const activeColumn = columns[selectedIndex]

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
            const pieces = stacks[column.index]
            if (datum === undefined || pieces === undefined || pieces.length === 0) return null
            const x = snap(column.x)
            return (
              <g
                key={datum.key}
                className={styles.column}
                data-key={datum.key}
                data-dimmed={selectedIndex >= 0 && column.index !== selectedIndex ? '' : undefined}
              >
                {pieces.map((piece) => {
                  const item = stacked[piece.index]
                  if (item === undefined) return null
                  const fill = { fill: `var(${item.cssVar})` }
                  return piece.roundTop ? (
                    <path
                      key={item.key}
                      d={columnPath(x, piece.y + piece.height, column.width, piece.height, DATA_RADIUS)}
                      style={fill}
                      data-series={item.key}
                    />
                  ) : (
                    <rect
                      key={item.key}
                      x={x}
                      y={round2(piece.y)}
                      width={round2(column.width)}
                      height={round2(piece.height)}
                      style={fill}
                      data-series={item.key}
                    />
                  )
                })}
              </g>
            )
          })}
          {lineShapes.map((shape) => (
            <g key={shape.key} data-part="line" data-series={shape.key}>
              <path className={styles.lineHalo} d={shape.d} />
              <path className={styles.line} d={shape.d} style={{ stroke: `var(${shape.cssVar})` }} />
              {shape.label !== null && (
                <text className={styles.plotLabel} x={round2(plotWidth)} y={round2(shape.labelY)} textAnchor="end">
                  <MaskedTspans text={shape.label} />
                </text>
              )}
            </g>
          ))}
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
          // Above the plot (docs/DESIGN.md §9.22), where it covers none of the chart: beside a 22px
          // column of a 303px plot it fits for the outer months only and would hide the middle ones.
          <ChartTooltip
            key={activeDatum.key}
            x={activeColumn.center}
            halfWidth={activeColumn.width / 2}
            boxWidth={width}
            boxHeight={svgHeight}
            placement="above"
            onDismiss={clear}
          >
            {tooltip === undefined ? (
              <TooltipContent
                title={activeDatum.title ?? activeDatum.label}
                rows={series.map((item) => ({
                  key: item.key,
                  label: item.label,
                  cssVar: item.cssVar,
                  value: format.value(valueOf(activeDatum.values, item.key)),
                }))}
              />
            ) : (
              tooltip(activeDatum.key)
            )}
          </ChartTooltip>
        )}
      </div>
      {legend && (
        <Legend
          layout="inline"
          className={styles.legend}
          items={series.map((item) => ({
            key: item.key,
            label: item.label,
            cssVar: item.cssVar,
            shape: item.kind === 'line' ? 'line' : 'square',
          }))}
        />
      )}
      <ChartTable
        caption={label}
        columns={[labelHeader, ...series.map((item) => item.label)]}
        rows={data.map((datum) => ({
          key: datum.key,
          header: datum.title ?? datum.label,
          cells: series.map((item) => ({ key: item.key, text: format.value(valueOf(datum.values, item.key)) })),
        }))}
      />
    </div>
  )
}
