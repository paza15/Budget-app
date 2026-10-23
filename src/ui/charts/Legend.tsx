import type { ReactNode } from 'react'
import { classNames } from '@/ui/charts/classNames'
import styles from '@/ui/charts/Legend.module.css'
import type { TestIdProps } from '@/ui/types'

export type LegendShape = 'dot' | 'square' | 'line'

export interface LegendItem {
  key: string
  label: string
  /** Custom property holding the swatch colour, e.g. '--cat-green' or '--chart-fixed'. */
  cssVar: string
  /** e.g. an amount (`<Money>`, which masks itself), set in the figures font. */
  value?: ReactNode
  /** A trailing secondary figure, e.g. the share "35 %". */
  meta?: ReactNode
  /** Default: a dot in rows, a rounded square inline. A line keys a line series. */
  shape?: LegendShape
  /**
   * Marks the row as a disclosure (aria-expanded), e.g. the "{n} more" row that unfolds the rest
   * of Where it went. Only on interactive rows (rows layout with onSelect).
   */
  expanded?: boolean
}

export interface LegendProps extends TestIdProps {
  items: LegendItem[]
  /**
   * 'rows' (default): one 40px row per item, dot, name, value and share (Where it went).
   * 'inline': keys and names in one wrapping line under a plot.
   */
  layout?: 'rows' | 'inline'
  /** Makes each row a button, e.g. to open the category (rows only). */
  onSelect?(key: string): void
  /** Accessible name of the list. */
  label?: string
  /** Test id of every row; each row also carries data-id={item.key}. */
  itemTestId?: string
  className?: string
}

/**
 * Swatch, name and optional value for each series of a chart (docs/DESIGN.md §9.22). Text wears
 * ink tokens; only the swatch carries the series colour.
 */
export function Legend({
  items,
  layout = 'rows',
  onSelect,
  label,
  itemTestId,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: LegendProps) {
  const interactive = onSelect !== undefined && layout === 'rows'
  return (
    <ul
      aria-label={label}
      className={classNames(styles.legend, layout === 'rows' ? styles.rows : styles.inline, className)}
      data-testid={testId}
      data-id={dataId}
    >
      {items.map((item) => (
        <li key={item.key} className={styles.item}>
          {interactive ? (
            <button
              type="button"
              className={classNames(styles.entry, styles.button)}
              data-testid={itemTestId}
              data-id={item.key}
              aria-expanded={item.expanded}
              onClick={() => onSelect(item.key)}
            >
              <LegendEntry item={item} layout={layout} />
            </button>
          ) : (
            <div className={styles.entry} data-testid={itemTestId} data-id={item.key}>
              <LegendEntry item={item} layout={layout} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function LegendEntry({ item, layout }: { item: LegendItem; layout: 'rows' | 'inline' }) {
  const swatch = (
    <span
      className={styles.swatch}
      data-shape={item.shape ?? (layout === 'rows' ? 'dot' : 'square')}
      style={{ background: `var(${item.cssVar})` }}
      aria-hidden="true"
    />
  )
  const value = item.value !== undefined && <span className={styles.value}>{item.value}</span>
  const meta = item.meta !== undefined && <span className={styles.meta}>{item.meta}</span>
  if (layout === 'inline') {
    return (
      <>
        {swatch}
        <span className={styles.label}>{item.label}</span>
        {value}
        {meta}
      </>
    )
  }
  // A row: the name, then the figures as one unit that moves under the name when it must
  // (Legend.module.css).
  return (
    <>
      {swatch}
      <span className={styles.main}>
        <span className={styles.label}>{item.label}</span>
        {(item.value !== undefined || item.meta !== undefined) && (
          <span className={styles.figures}>
            {value}
            {meta}
          </span>
        )}
      </span>
    </>
  )
}
