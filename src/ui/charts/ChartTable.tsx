import { MASKED } from '@/domain/money'
import styles from '@/ui/charts/ChartTable.module.css'

export interface ChartTableCell {
  key: string
  text: string
}

export interface ChartTableRow {
  key: string
  /** The row header, e.g. the day or the category. */
  header: string
  cells: readonly ChartTableCell[]
}

export interface ChartTableProps {
  caption: string
  /** Column headers, the row-header column first. Omit for a list of named values. */
  columns?: readonly string[]
  rows: readonly ChartTableRow[]
  /** A closing note, e.g. the reference line's label. */
  footer?: string
}

/**
 * The visually hidden table every chart carries (docs/DESIGN.md §9.22), so VoiceOver can read
 * the values the picture shows. It sits beside the chart's role="img", never inside it, because
 * an image's content is presentational. Masked amounts read "Amount hidden". A 1px wrapper hides
 * it: the table itself would keep its full width (see ChartTable.module.css).
 */
export function ChartTable({ caption, columns, rows, footer }: ChartTableProps) {
  const span = columns?.length ?? rows.reduce((most, row) => Math.max(most, row.cells.length + 1), 1)
  return (
    <div className={styles.hidden} data-chart-table-box="">
      <table data-chart-table="">
        <caption>{caption}</caption>
        {columns !== undefined && (
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.header}</th>
              {row.cells.map((cell) => (
                <td key={cell.key}>
                  <SpokenText text={cell.text} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer !== undefined && (
          <tfoot>
            <tr>
              <td colSpan={span}>
                <SpokenText text={footer} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** Text with every MASKED run read as "Amount hidden" instead of three bullets. */
function SpokenText({ text }: { text: string }) {
  const at = text.indexOf(MASKED)
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <span aria-hidden="true">{MASKED}</span>
      <span>Amount hidden</span>
      <SpokenText text={text.slice(at + MASKED.length)} />
    </>
  )
}
