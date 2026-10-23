import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ListRow } from '@/ui/ListRow'
import styles from '@/ui/ListRow.module.css'
import { classOf } from '@/ui/testing/css'

afterEach(cleanup)

// Node built-ins come in through import(string), as in src/features/pwa/platformFiles.test.tsx:
// typing them would pull @types/node into the app's type program.
const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
/** ListRow.module.css as written: Vitest blanks CSS modules on import, even with ?raw. */
const css = fs.readFileSync(new URL(import.meta.url.replace(/ListRow\.test\.tsx(?:[?#].*)?$/, 'ListRow.module.css')), 'utf8')

/** iOS body text (-apple-system-body, px): the largest standard size (xxxLarge) and the first accessibility size. */
const XXX_LARGE = 23
const AX1 = 28
/** Portrait widths (pt) of the iPhones the app runs on, from the SE and the mini (375) to the Pro Max (440). */
const IPHONE_WIDTHS = [375, 390, 393, 402, 414, 420, 428, 430, 440]
/** A row of an inset group spans the screen minus the two 20pt gutters (docs/DESIGN.md §6, §9.7). */
const groupRowWidth = (screenWidth: number) => screenWidth - 40

/** The row width, in em of the row's Body text, at or below which the amount moves under the title. */
function stackingWidthEm(): number {
  const queries = [...css.matchAll(/@container\s*\(\s*max-width:\s*([\d.]+)em\s*\)/g)]
  expect(queries).toHaveLength(1)
  return Number(queries[0]?.[1])
}

describe('ListRow', () => {
  it('puts the amount on the title line, and the subtitle and note beneath both', () => {
    render(<ListRow title="Cappuccino" subtitle="Coffee & snacks" value="3,50 €" note="Today" />)
    const line1 = screen.getByText('Cappuccino').parentElement
    expect(line1).toContainElement(screen.getByText('3,50 €'))
    expect(line1).not.toContainElement(screen.getByText('Coffee & snacks'))
    expect(screen.getByText('Today').parentElement).toBe(screen.getByText('Coffee & snacks').parentElement)
  })

  it('makes the row one button and keeps the trailing control outside it', () => {
    render(
      <ListRow
        title="Netflix"
        value="13,99 €"
        onClick={() => {}}
        trailing={<button type="button">Mark Netflix as paid</button>}
      />,
    )
    const row = screen.getByRole('button', { name: /^Netflix/ })
    expect(row).toContainElement(screen.getByText('13,99 €'))
    expect(row).not.toContainElement(screen.getByRole('button', { name: 'Mark Netflix as paid' }))
  })

  it('forwards data-testid and data-id', () => {
    render(<ListRow title="Rent" value="640,00 €" data-testid="recurring-row" data-id="rec-rent" />)
    expect(screen.getByTestId('recurring-row')).toHaveAttribute('data-id', 'rec-rent')
  })
})

// jsdom cannot run size queries, so these hold the breakpoint against the rows it meets on real
// iPhones (docs/DESIGN.md §5.5). A `max-width` query matches a row at most that wide.
describe('ListRow at large text sizes', () => {
  it('keeps the amount on the title line at every standard text size, even on a 375pt iPhone', () => {
    const breakpoint = stackingWidthEm()
    for (const width of IPHONE_WIDTHS) expect(breakpoint * XXX_LARGE).toBeLessThan(groupRowWidth(width))
  })

  it('moves the amount under the title from the first accessibility size on every iPhone', () => {
    const breakpoint = stackingWidthEm()
    for (const width of IPHONE_WIDTHS) expect(breakpoint * AX1).toBeGreaterThanOrEqual(groupRowWidth(width))
  })
})

describe('ListRow disclosure', () => {
  it('sets aria-expanded and aria-controls on the row button, and turns the down chevron', () => {
    const { container, rerender } = render(
      <ListRow title="More options" chevron="down" onClick={() => {}} expanded={false} controls="more-options" />,
    )
    const button = screen.getByRole('button', { name: 'More options' })
    const chevron = container.querySelector('svg[data-icon="chevron-down"]')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'more-options')
    expect(chevron).not.toHaveClass(classOf(styles, 'turned'))

    rerender(<ListRow title="More options" chevron="down" onClick={() => {}} expanded controls="more-options" />)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(chevron).toHaveClass(classOf(styles, 'turned'))
  })

  it('is no disclosure without expanded', () => {
    render(<ListRow title="Currency" chevron onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Currency' })).not.toHaveAttribute('aria-expanded')
    expect(screen.getByRole('button', { name: 'Currency' })).not.toHaveAttribute('aria-controls')
  })

  it('turns the chevron over --dur-fade, and not at all under Reduce Motion', () => {
    expect(css).toMatch(/\.chevron \{[^}]*transition: rotate var\(--dur-fade\)/)
    expect(css).toMatch(/\.turned \{\s*rotate: 180deg;\s*\}/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.chevron \{\s*transition: none;/)
  })
})
