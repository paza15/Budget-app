import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMoneyFormat, MASKED } from '@/domain/money'
import { FALLBACK_WIDTH } from '@/ui/charts/scale'
import { FOLD_KEY, foldSegments, type StackedBarSegment } from '@/ui/charts/segments'
import { StackedBar } from '@/ui/charts/StackedBar'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'

const masked = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })

const WHERE_IT_WENT: StackedBarSegment[] = [
  { key: 'groceries', label: 'Groceries', color: 'green', value: 11860 },
  { key: 'eating', label: 'Eating', color: 'orange', value: 9630 },
  { key: 'going-out', label: 'Going out', color: 'red', value: 5200 },
  { key: 'coffee', label: 'Coffee & snacks', color: 'yellow', value: 3850 },
  { key: 'shopping', label: 'Shopping', color: 'magenta', value: 2100 },
  { key: 'transport', label: 'Transport', color: 'aqua', value: 1000 },
]

/** Horizontal extent of a bar path: every M, H and arc end point. */
function extent(d: string): { left: number; right: number } {
  const xs: number[] = []
  for (const [, command, args] of d.matchAll(/([MHA])([^MHAVZ]*)/g)) {
    const numbers = (args ?? '').trim().split(/[\s,]+/).map(Number)
    const x = command === 'A' ? numbers[5] : numbers[0]
    if (x !== undefined) xs.push(x)
  }
  return { left: Math.min(...xs), right: Math.max(...xs) }
}

function segmentPaths(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll<SVGPathElement>('[data-part="segment"]')]
}

afterEach(cleanup)

describe('StackedBar', () => {
  it('draws a segment per category with 2px surface gaps across the whole width', () => {
    const { container } = render(<StackedBar segments={WHERE_IT_WENT} label="Daily spending by category" />)
    const extents = segmentPaths(container).map((path) => extent(path.getAttribute('d') ?? ''))
    expect(extents).toHaveLength(6)
    expect(extents[0]?.left).toBe(0)
    expect(extents.at(-1)?.right).toBe(FALLBACK_WIDTH)
    for (let i = 1; i < extents.length; i += 1) {
      expect((extents[i]?.left ?? 0) - (extents[i - 1]?.right ?? 0)).toBe(2)
    }
  })

  it('rounds only the outer ends', () => {
    const { container } = render(<StackedBar segments={WHERE_IT_WENT} label="Daily spending by category" />)
    const arcs = segmentPaths(container).map((path) => (path.getAttribute('d') ?? '').match(/A/g)?.length ?? 0)
    expect(arcs).toEqual([2, 0, 0, 0, 0, 2])
  })

  it('rounds both ends of a single segment', () => {
    const { container } = render(<StackedBar segments={WHERE_IT_WENT.slice(0, 1)} label="Spending" />)
    expect(segmentPaths(container)[0]?.getAttribute('d')?.match(/A/g)).toHaveLength(4)
  })

  it('paints each segment in its category ink and the fold in --cat-other', () => {
    const { container } = render(
      <StackedBar
        segments={foldSegments([
          ...WHERE_IT_WENT,
          { key: 'health', label: 'Health', color: 'blue', value: 650 },
          { key: 'other', label: 'Other', color: 'slate', value: 400 },
        ])}
        label="Daily spending by category"
      />,
    )
    const paths = segmentPaths(container)
    expect(paths.map((path) => path.dataset.key)).toEqual(['groceries', 'eating', 'going-out', 'coffee', 'shopping', FOLD_KEY])
    expect(paths[0]?.getAttribute('style')).toContain('var(--cat-green)')
    expect(paths.at(-1)?.getAttribute('style')).toContain('var(--cat-other)')
  })

  it('leaves out segments without spending', () => {
    const { container } = render(
      <StackedBar
        segments={[...WHERE_IT_WENT.slice(0, 2), { key: 'none', label: 'Nothing', color: 'blue', value: 0 }]}
        label="Spending"
      />,
    )
    expect(segmentPaths(container).map((path) => path.dataset.key)).toEqual(['groceries', 'eating'])
    expect(screen.queryByRole('rowheader', { name: 'Nothing' })).toBeNull()
  })

  it('is an image with the given name and a hidden table of amounts and shares', () => {
    render(<StackedBar segments={WHERE_IT_WENT} label="Daily spending by category" data-testid="where" />)
    expect(screen.getByRole('img', { name: 'Daily spending by category' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Daily spending by category' })
    const groceries = within(table).getByRole('row', { name: /Groceries/ })
    expect(groceries).toHaveTextContent('118,60 €')
    expect(groceries).toHaveTextContent('35 %')
  })

  it('masks the amounts in its table, but not the shares', () => {
    render(
      <MoneyFormatContext value={masked}>
        <StackedBar segments={WHERE_IT_WENT} label="Daily spending by category" />
      </MoneyFormatContext>,
    )
    const table = screen.getByRole('table', { name: 'Daily spending by category' })
    expect(within(table).getAllByText('Amount hidden')).toHaveLength(6)
    expect(table).toHaveTextContent(MASKED)
    expect(table).not.toHaveTextContent('118,60')
    expect(table).toHaveTextContent('35 %')
  })
})

describe('foldSegments', () => {
  const eight: StackedBarSegment[] = [
    { key: 'small', label: 'Small', color: 'blue', value: 400 },
    ...WHERE_IT_WENT,
    { key: 'health', label: 'Health', color: 'blue', value: 650 },
  ]

  it('sorts by amount, largest first', () => {
    expect(foldSegments(WHERE_IT_WENT.toReversed()).map((segment) => segment.key)).toEqual(
      WHERE_IT_WENT.map((segment) => segment.key),
    )
  })

  it('folds a tail of two or more into "{n} more" in the neutral colour', () => {
    const folded = foldSegments(eight)
    expect(folded).toHaveLength(6)
    expect(folded.slice(0, 5).map((segment) => segment.key)).toEqual(['groceries', 'eating', 'going-out', 'coffee', 'shopping'])
    expect(folded[5]).toEqual({ key: FOLD_KEY, value: 1000 + 650 + 400, color: 'other', label: '3 more' })
  })

  it('shows a single remaining category by name', () => {
    expect(foldSegments(WHERE_IT_WENT).map((segment) => segment.key)).not.toContain(FOLD_KEY)
    expect(foldSegments(WHERE_IT_WENT)).toHaveLength(6)
  })

  it('takes another limit and fold label', () => {
    const folded = foldSegments(eight, { limit: 3, foldLabel: (count) => `${count} others` })
    expect(folded.map((segment) => segment.label)).toEqual(['Groceries', 'Eating', 'Going out', '5 others'])
  })

  it('leaves out segments without spending', () => {
    expect(foldSegments([...WHERE_IT_WENT, { key: 'zero', label: 'Zero', color: 'red', value: 0 }])).toHaveLength(6)
  })
})
