import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMoneyFormat, MASKED } from '@/domain/money'
import { bandScale, FALLBACK_WIDTH } from '@/ui/charts/scale'
import {
  type ChartSeries,
  StackedColumnChart,
  type StackedColumnChartProps,
  type StackedColumnDatum,
} from '@/ui/charts/StackedColumnChart'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'

const masked = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })

const SERIES: ChartSeries[] = [
  { key: 'fixed', label: 'Fixed costs', cssVar: '--chart-fixed' },
  { key: 'daily', label: 'Daily spending', cssVar: '--chart-daily' },
  { key: 'income', label: 'Income', cssVar: '--chart-ref', kind: 'line' },
]

/** Last 6 months to October 2026 (docs/DESIGN.md sample data). */
const TREND: StackedColumnDatum[] = [
  ['05', 'May', 48210],
  ['06', 'Jun', 52990],
  ['07', 'Jul', 61500],
  ['08', 'Aug', 58917],
  ['09', 'Sep', 51230],
  ['10', 'Oct', 33640],
].map(([month, label, daily]) => ({
  key: `2026-${month}`,
  label: String(label),
  title: `${String(label)} 2026`,
  values: { fixed: 77888, daily: Number(daily), income: 145000 },
}))

const chart = (props: Partial<StackedColumnChartProps> = {}) => (
  <StackedColumnChart
    data={TREND}
    series={SERIES}
    label="Fixed costs and daily spending, May to October"
    highlightKey="2026-10"
    {...props}
  />
)

const centreOf = (index: number) => bandScale(6, FALLBACK_WIDTH).center(index)

function tap(container: HTMLElement, x: number) {
  const plot = container.querySelector('svg')?.parentElement
  if (plot === null || plot === undefined) throw new Error('plot missing')
  fireEvent.pointerDown(plot, { clientX: x, pointerId: 1, pointerType: 'touch' })
  fireEvent.pointerUp(plot, { clientX: x, pointerId: 1, pointerType: 'touch' })
}

const tooltipOf = (container: HTMLElement) => container.querySelector('[data-chart-tooltip]')

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect

/**
 * Lays the chart out as on a 375pt iPhone: jsdom has no layout, so the plot (the svg's box, in
 * viewport coordinates) and the tooltip's size come from here; everything else measures 0.
 */
function mockLayout(plot: { left: number; top: number; width: number; height: number }, tooltip: { width: number; height: number }) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-chart-tooltip')) return rect(0, 0, tooltip.width, tooltip.height)
    if (this.querySelector(':scope > svg') !== null) return rect(plot.left, plot.top, plot.width, plot.height)
    return rect(0, 0, 0, 0)
  })
}

afterEach(cleanup)

describe('StackedColumnChart', () => {
  it('stacks fixed costs at the bottom and daily spending on top, 2px apart, rounding only the top', () => {
    const { container } = render(chart())
    const column = container.querySelector('[data-key="2026-09"]')
    const fixed = column?.querySelector('[data-series="fixed"]')
    const daily = column?.querySelector('[data-series="daily"]')
    // The bottom piece is a plain rect standing on the baseline; the top one a path with the data end.
    expect(fixed?.tagName).toBe('rect')
    expect(fixed?.getAttribute('style')).toContain('var(--chart-fixed)')
    expect(daily?.tagName).toBe('path')
    expect(daily?.getAttribute('style')).toContain('var(--chart-daily)')
    expect(daily?.getAttribute('d')).toContain('A4 4')
    const fixedTop = Number(fixed?.getAttribute('y'))
    const dailyBottom = Number(/^M[\d.]+ ([\d.]+)/.exec(daily?.getAttribute('d') ?? '')?.[1])
    expect(fixedTop - dailyBottom).toBeCloseTo(2)
    expect(Number(fixed?.getAttribute('y')) + Number(fixed?.getAttribute('height'))).toBeCloseTo(124)
  })

  it('draws columns 22px wide in proportion to their totals', () => {
    const { container } = render(chart())
    const heightOf = (key: string) => {
      const fixed = container.querySelector(`[data-key="${key}"] [data-series="fixed"]`)
      const d = container.querySelector(`[data-key="${key}"] [data-series="daily"]`)?.getAttribute('d') ?? ''
      // "M x bottom V (top + r) …": the column's top is that V value less the 4px radius.
      const top = Number(/V([\d.]+)/.exec(d)?.[1]) - 4
      expect(fixed?.getAttribute('width')).toBe('22')
      return 124 - top
    }
    expect(heightOf('2026-07') / heightOf('2026-10')).toBeCloseTo((77888 + 61500) / (77888 + 33640), 1)
  })

  it('draws income as a line labelled at the right, and emphasises the current month', () => {
    const { container } = render(chart())
    const income = container.querySelector('[data-part="line"][data-series="income"]')
    expect(income?.querySelectorAll('path')).toHaveLength(2)
    expect(income?.querySelector('text')).toHaveTextContent('Income 1.450,00 €')
    expect(screen.getByText('Oct')).toHaveAttribute('data-strong')
    expect(screen.getByText('Sep')).not.toHaveAttribute('data-strong')
  })

  it('has a legend for its series, keying the line with a stroke', () => {
    const { container } = render(chart())
    const legend = container.querySelector('ul')
    expect(legend).toHaveTextContent('Fixed costs')
    expect(legend).toHaveTextContent('Daily spending')
    expect(legend?.querySelector('[data-shape="line"]')).not.toBeNull()
    expect(legend?.querySelectorAll('[data-shape="square"]')).toHaveLength(2)
  })

  it('leaves the legend out for a single series', () => {
    const { container } = render(chart({ series: SERIES.slice(1, 2) }))
    expect(container.querySelector('ul')).toBeNull()
  })

  it('lists every month and series in a hidden table', () => {
    render(chart())
    const table = screen.getByRole('table', { name: 'Fixed costs and daily spending, May to October' })
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Month',
      'Fixed costs',
      'Daily spending',
      'Income',
    ])
    expect(within(table).getByRole('row', { name: /Sep 2026/ })).toHaveTextContent('512,30 €')
  })

  it('shows the tapped month in a tooltip and fades the other columns', () => {
    const onSelect = vi.fn<(key: string | null) => void>()
    const { container, rerender } = render(chart({ selectedKey: null, onSelect }))
    tap(container, centreOf(4))
    expect(onSelect).toHaveBeenLastCalledWith('2026-09')

    rerender(chart({ selectedKey: '2026-09', onSelect }))
    const tooltip = tooltipOf(container)
    expect(tooltip).toHaveTextContent('Sep 2026')
    expect(tooltip).toHaveTextContent('Fixed costs778,88 €')
    expect(tooltip).toHaveTextContent('Daily spending512,30 €')
    expect(tooltip).toHaveTextContent('Income1.450,00 €')
    expect(container.querySelector('[data-key="2026-09"]')).not.toHaveAttribute('data-dimmed')
    expect(container.querySelectorAll('[data-dimmed]')).toHaveLength(5)

    tap(container, centreOf(4))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('puts the tooltip above the plot, centred on the month, so it never covers the column', () => {
    // July on a 375pt iPhone: a 303px plot, 300px down the screen. Beside its column the 179px
    // tooltip had no room and covered it; above the plot it covers nothing of the chart.
    mockLayout({ left: 36, top: 300, width: 303, height: 146 }, { width: 179, height: 87 })
    const { container, rerender } = render(chart({ selectedKey: '2026-07' }))
    const tooltip = tooltipOf(container)
    expect(tooltip).toHaveAttribute('data-placement', 'above')
    // Centred on July (the third of six 50.5px slots), 8px above the plot.
    expect(tooltip).toHaveStyle({ left: `${36 + 2.5 * 50.5 - 179 / 2}px`, top: `${300 - 8 - 87}px` })

    // Every month alike (May would fit beside its column): above, kept within the plot's width.
    rerender(chart({ selectedKey: '2026-05' }))
    expect(tooltipOf(container)).toHaveAttribute('data-placement', 'above')
    expect(tooltipOf(container)).toHaveStyle({ left: '36px', top: `${300 - 8 - 87}px` })
  })

  it('closes the tooltip above the plot when the page scrolls under it', () => {
    const onSelect = vi.fn<(key: string | null) => void>()
    const { container } = render(chart({ selectedKey: '2026-07', onSelect }))
    // A scroller elsewhere does not move the chart.
    const elsewhere = document.body.appendChild(document.createElement('div'))
    fireEvent.scroll(elsewhere)
    expect(onSelect).not.toHaveBeenCalled()
    expect(tooltipOf(container)).not.toBeNull()
    fireEvent.scroll(document)
    expect(onSelect).toHaveBeenLastCalledWith(null)
    // Fixed to the screen, it never drifts from its column: it goes even while this parent keeps
    // July selected.
    expect(tooltipOf(container)).toBeNull()
    elsewhere.remove()
  })

  it('renders a custom tooltip for the selected column', () => {
    const { container } = render(chart({ selectedKey: '2026-07', tooltip: (key) => <p>Custom {key}</p> }))
    expect(tooltipOf(container)).toHaveTextContent('Custom 2026-07')
  })

  it('masks the line label, the tooltip and the table', () => {
    const { container } = render(
      <MoneyFormatContext value={masked}>{chart({ selectedKey: '2026-10' })}</MoneyFormatContext>,
    )
    expect(container.querySelector('[data-part="line"] text')).toHaveTextContent(`Income ${MASKED}`)
    expect(tooltipOf(container)).toHaveTextContent(`Fixed costs${MASKED}`)
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('Amount hidden')).toHaveLength(18)
    expect(document.body).not.toHaveTextContent('778,88')
    expect(document.body).not.toHaveTextContent('1.450,00')
  })
})
