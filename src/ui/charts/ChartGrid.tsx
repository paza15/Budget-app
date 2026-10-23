import styles from '@/ui/charts/columns.module.css'
import { MaskedTspans } from '@/ui/MaskedText'
import { besideLineY, estimateTextWidth, gridValues, round2, snap, valueY } from '@/ui/charts/scale'

/** Space between the plot's end and the values of its gridlines. */
const GRID_LABEL_GAP = 6

export interface GridLine {
  value: number
  /** Position on the plot, on the device pixel grid. */
  y: number
  /** The value as the line's label, e.g. "20 €" (MASKED while amounts are hidden). */
  text: string
}

export interface GridLayout {
  readonly lines: readonly GridLine[]
  /** Width the labels take after the plot, with their gap; 0 without lines. */
  readonly gutter: number
}

/** No grid: the default of the column charts. */
export const NO_GRID: GridLayout = Object.freeze({ lines: Object.freeze([]), gutter: 0 })

/**
 * The gridlines of a value axis whose top is `max`, at clean values (scale.ts gridValues), and the
 * trailing gutter their labels need. Labels sit after the plot, level with their line, so they
 * never cross a column.
 */
export function gridLayout(o: {
  max: number
  plotHeight: number
  fontSize: number
  format(value: number): string
}): GridLayout {
  const lines = gridValues(o.max).map((value) => ({
    value,
    y: snap(valueY(value, o.max, o.plotHeight)),
    text: o.format(value),
  }))
  if (lines.length === 0) return NO_GRID
  const widest = lines.reduce((most, line) => Math.max(most, estimateTextWidth(line.text, o.fontSize)), 0)
  return { lines, gutter: Math.ceil(widest + GRID_LABEL_GAP) }
}

/**
 * Hairline gridlines in --chart-grid (solid, recessive, docs/DESIGN.md §4.6) across a plot
 * `plotWidth` wide, each with its value in the gutter after it. Draw it before the columns.
 */
export function ChartGrid({ layout, plotWidth, fontSize }: { layout: GridLayout; plotWidth: number; fontSize: number }) {
  return layout.lines.map((line) => (
    <g key={line.value} data-part="grid">
      <line className={styles.grid} x1={0} x2={round2(plotWidth)} y1={line.y} y2={line.y} />
      <text className={styles.gridLabel} x={round2(plotWidth + GRID_LABEL_GAP)} y={round2(besideLineY(line.y, fontSize))}>
        <MaskedTspans text={line.text} />
      </text>
    </g>
  ))
}
