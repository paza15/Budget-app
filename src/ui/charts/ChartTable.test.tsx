import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MASKED } from '@/domain/money'
import { ChartTable } from '@/ui/charts/ChartTable'

afterEach(cleanup)

// Node built-ins come in through import(string), as in src/ui/ListRow.test.tsx: typing them would
// pull @types/node into the app's type program.
const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
/** ChartTable.module.css as written: Vitest blanks CSS modules on import. */
const css = fs.readFileSync(
  new URL(import.meta.url.replace(/ChartTable\.test\.tsx(?:[?#].*)?$/, 'ChartTable.module.css')),
  'utf8',
)

/** The declarations of the rules in ChartTable.module.css, by selector. */
function rules(): Map<string, Record<string, string>> {
  const found = new Map<string, Record<string, string>>()
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, selector = '', body = ''] of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const declarations: Record<string, string> = {}
    for (const declaration of body.split(';')) {
      const at = declaration.indexOf(':')
      if (at > 0) declarations[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim()
    }
    found.set(selector.trim(), declarations)
  }
  return found
}

/** Thirty-one days with long names: as a table, far wider than a phone. */
const MONTH = Array.from({ length: 31 }, (_, index) => ({
  key: `d${index + 1}`,
  header: `Wednesday ${index + 1} October 2026`,
  cells: [{ key: 'amount', text: '1.234,56 €' }],
}))

describe('ChartTable', () => {
  it('hides the table inside a 1px box, because a table box ignores a width of its own', () => {
    render(<ChartTable caption="Spending per day in October" columns={['Day', 'Amount']} rows={MONTH} />)
    const table = screen.getByRole('table', { name: 'Spending per day in October' })
    const box = table.parentElement
    expect(box).toHaveAttribute('data-chart-table-box')
    expect(box?.children).toHaveLength(1)

    // The only rule hides the box: 1px, clipped, out of the flow. Nothing styles the table itself,
    // so it can never be the element that widens the page (it was 403px wide on a 375pt phone).
    const all = rules()
    expect([...all.keys()]).toEqual(['.hidden'])
    expect(all.get('.hidden')).toMatchObject({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      'clip-path': 'inset(50%)',
      'white-space': 'nowrap',
    })
  })

  it('keeps the caption, the headers and every row for VoiceOver', () => {
    render(
      <ChartTable
        caption="Spending per day in October"
        columns={['Day', 'Amount']}
        rows={MONTH.slice(0, 2)}
        footer="17,34 € a day"
      />,
    )
    const table = screen.getByRole('table', { name: 'Spending per day in October' })
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Day', 'Amount'])
    expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Wednesday 1 October 2026',
      'Wednesday 2 October 2026',
    ])
    expect(table).toHaveTextContent('17,34 € a day')
  })

  it('reads a masked amount as "Amount hidden", never as three bullets', () => {
    render(
      <ChartTable
        caption="Spending pace"
        rows={[{ key: 'spent', header: 'Spent', cells: [{ key: 'value', text: `${MASKED} of ${MASKED}` }] }]}
      />,
    )
    const cell = within(screen.getByRole('table', { name: 'Spending pace' })).getByRole('cell')
    expect(within(cell).getAllByText('Amount hidden')).toHaveLength(2)
    for (const bullets of within(cell).getAllByText(MASKED)) expect(bullets).toHaveAttribute('aria-hidden', 'true')
  })
})
