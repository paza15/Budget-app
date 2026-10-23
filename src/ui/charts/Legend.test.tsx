import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Legend, type LegendItem } from '@/ui/charts/Legend'

const ITEMS: LegendItem[] = [
  { key: 'cat-groceries', label: 'Groceries', cssVar: '--cat-green', value: '118,60 €', meta: '35 %' },
  { key: 'cat-eating', label: 'Eating', cssVar: '--cat-orange', value: '96,30 €', meta: '29 %' },
]

afterEach(cleanup)

// Node built-ins come in through import(string), as in src/ui/ListRow.test.tsx: typing them would
// pull @types/node into the app's type program.
const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
/** Legend.module.css as written: Vitest blanks CSS modules on import. */
const css = fs.readFileSync(new URL(import.meta.url.replace(/Legend\.test\.tsx(?:[?#].*)?$/, 'Legend.module.css')), 'utf8')

/** iOS Body text (-apple-system-body, px) at the standard sizes, xSmall to xxxLarge (17 is the default). */
const STANDARD_SIZES = [14, 15, 16, 17, 19, 21, 23]
/** iOS Body text at the accessibility sizes, AX1 to AX5. */
const ACCESSIBILITY_SIZES = [28, 33, 40, 47, 53]
/** Portrait widths (pt) of the iPhones the app runs on, from the SE and the mini (375) to the Pro Max (440). */
const IPHONE_WIDTHS = [375, 390, 393, 402, 414, 420, 428, 430, 440]
/** A legend row spans the screen minus the two 20pt gutters and the 16pt group padding (DESIGN.md §6, §9.7). */
const legendRowWidth = (screenWidth: number) => screenWidth - 2 * 20 - 2 * 16

/** The rules of `source`, outside any at-rule block, by selector. */
function rulesOf(source: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>()
  for (const [, selector = '', body = ''] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations: Record<string, string> = {}
    for (const declaration of body.split(';')) {
      const at = declaration.indexOf(':')
      if (at > 0) declarations[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim()
    }
    rules.set(selector.trim(), declarations)
  }
  return rules
}

const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
const containerQuery = /@container\s*\(\s*max-width:\s*([\d.]+)em\s*\)\s*\{([\s\S]*?)\n\}/.exec(source)
const topLevel = rulesOf(source.replace(containerQuery?.[0] ?? '', ''))

/** The row width, in em of the row's Body text, at or below which the figures move under the name. */
function stackingWidthEm(): number {
  expect([...source.matchAll(/@container/g)]).toHaveLength(1)
  return Number(containerQuery?.[1])
}

/** Whether a legend row `width` px wide, with Body text at `fontSize` px, is in the stacked layout. */
const stacks = (width: number, fontSize: number) => width <= stackingWidthEm() * fontSize

describe('Legend', () => {
  it('lists a swatch, the name, the amount and the share per item, in order', () => {
    render(<Legend items={ITEMS} label="Categories" />)
    const list = screen.getByRole('list', { name: 'Categories' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(['Groceries118,60 €35 %', 'Eating96,30 €29 %'])
    // Only the swatch carries the colour; it is hidden from assistive technology.
    const swatch = rows[0]?.querySelector('[data-shape="dot"]')
    expect(swatch?.getAttribute('style')).toContain('var(--cat-green)')
    expect(swatch).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the amount and the share together, so they move under the name as one', () => {
    render(<Legend items={ITEMS} />)
    const amount = screen.getByText('118,60 €')
    expect(amount.parentElement).toBe(screen.getByText('35 %').parentElement)
    expect(amount.parentElement).not.toBe(screen.getByText('Groceries').parentElement)
    expect(amount.parentElement?.parentElement).toBe(screen.getByText('Groceries').parentElement)
  })

  it('makes each row a button with its test id and record id when rows open something', () => {
    const onSelect = vi.fn<(key: string) => void>()
    render(<Legend items={ITEMS} onSelect={onSelect} itemTestId="category-row" />)
    const rows = screen.getAllByTestId('category-row')
    expect(rows.map((row) => row.tagName)).toEqual(['BUTTON', 'BUTTON'])
    expect(rows[1]).toHaveAttribute('data-id', 'cat-eating')
    fireEvent.click(screen.getByRole('button', { name: /Eating/ }))
    expect(onSelect).toHaveBeenCalledWith('cat-eating')
  })

  it('marks a row as a disclosure only when its item says expanded', () => {
    const more: LegendItem = { key: 'more', label: '3 more', cssVar: '--ink-3', expanded: false }
    const { rerender } = render(<Legend items={[...ITEMS, more]} onSelect={() => {}} itemTestId="category-row" />)
    const rows = screen.getAllByTestId('category-row')
    expect(rows[2]).toHaveAttribute('aria-expanded', 'false')
    expect(rows[0]).not.toHaveAttribute('aria-expanded')
    expect(rows[1]).not.toHaveAttribute('aria-expanded')
    rerender(<Legend items={[...ITEMS, { ...more, expanded: true }]} onSelect={() => {}} itemTestId="category-row" />)
    expect(screen.getAllByTestId('category-row')[2]).toHaveAttribute('aria-expanded', 'true')
  })

  it('keys a plot with rounded squares and a stroke for a line, inline', () => {
    const { container } = render(
      <Legend
        layout="inline"
        onSelect={() => {}}
        items={[
          { key: 'fixed', label: 'Fixed costs', cssVar: '--chart-fixed' },
          { key: 'income', label: 'Income', cssVar: '--chart-ref', shape: 'line' },
        ]}
      />,
    )
    expect([...container.querySelectorAll('[data-shape]')].map((swatch) => swatch.getAttribute('data-shape'))).toEqual([
      'square',
      'line',
    ])
    // Keys under a plot are not rows: they stay plain text even with a handler.
    expect(screen.queryByRole('button')).toBeNull()
  })
})

// The breakpoint of the rows (Legend.module.css). jsdom has no layout, so these check the CSS as
// written against the rows of real iPhones, as src/ui/ListRow.test.tsx does for list rows.
describe('Legend rows at each text size', () => {
  it('measure their breakpoint in the Body size, whatever text surrounds the legend', () => {
    expect(topLevel.get('.rows .item')).toMatchObject({ 'container-type': 'inline-size', font: 'var(--text-body)' })
  })

  it('stay one 40px row at the default text size on a 375pt iPhone', () => {
    // The narrowest row: 303px. A breakpoint of 18em (306px at 17px) stacked every row here.
    expect(legendRowWidth(375)).toBe(303)
    expect(stacks(legendRowWidth(375), 17)).toBe(false)
    expect(topLevel.get('.rows .entry')).toMatchObject({ 'min-height': '40px' })
  })

  it('stay on one line at every standard text size on every iPhone', () => {
    for (const width of IPHONE_WIDTHS) {
      for (const size of STANDARD_SIZES) expect(stacks(legendRowWidth(width), size), `${width}pt at ${size}px`).toBe(false)
    }
  })

  it('move the figures under the name at every accessibility size on every iPhone', () => {
    for (const width of IPHONE_WIDTHS) {
      for (const size of ACCESSIBILITY_SIZES) expect(stacks(legendRowWidth(width), size), `${width}pt at ${size}px`).toBe(true)
    }
    // Stacked: the name takes its own line, and the figures wrap under it.
    expect(rulesOf(containerQuery?.[2] ?? '').get('.rows .label')).toMatchObject({ 'flex-basis': '100%' })
  })

  it('never break a name inside a word: its longest word decides when the figures move down', () => {
    // A zero basis with the line's free space, and an automatic minimum of its longest word (at most
    // the full line): the figures wrap under the name instead of squeezing it mid-word.
    expect(topLevel.get('.rows .main')).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap' })
    expect(topLevel.get('.rows .label')).toMatchObject({
      flex: '1000 1 0%',
      'max-width': '100%',
      'overflow-wrap': 'break-word',
    })
    expect(topLevel.get('.rows .label')).not.toHaveProperty('min-width')
    expect(topLevel.get('.rows .figures')).toMatchObject({ display: 'flex', flex: '1 0 auto' })
  })
})
