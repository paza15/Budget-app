import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMoneyFormat, MASKED } from '@/domain/money'
import { ColumnChart, type ColumnChartProps, type ColumnDatum } from '@/ui/charts/ColumnChart'
import { bandScale, FALLBACK_WIDTH } from '@/ui/charts/scale'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'

const masked = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })

/** Daily spending, 1–18 October 2026 (docs/DESIGN.md sample data); today is the 18th. */
const SPENDING = [
  1240, 3120, 890, 2250, 680, 1430, 2760, 970, 1820, 450, 3540, 1690, 1130, 2410, 2480, 1680, 4300, 800,
]
const OCTOBER: ColumnDatum[] = Array.from({ length: 31 }, (_, index) => ({
  key: `2026-10-${String(index + 1).padStart(2, '0')}`,
  label: `${index + 1} Oct`,
  title: `Day ${index + 1}`,
  value: SPENDING[index] ?? 0,
}))
const TODAY = '2026-10-18'
const ALLOWANCE = { value: 1734, label: (value: string) => `${value} a day`, from: TODAY }

/** A past month: every day spent around the budget line, so columns cross it everywhere. */
const SEPTEMBER: ColumnDatum[] = Array.from({ length: 30 }, (_, index) => ({
  key: `2026-09-${String(index + 1).padStart(2, '0')}`,
  label: `${index + 1} Sep`,
  value: index % 2 === 0 ? 3000 : 1000,
}))

const chart = (props: Partial<ColumnChartProps> = {}) => (
  <ColumnChart
    data={OCTOBER}
    label="Spending per day in October"
    highlightKey={TODAY}
    highlightLabel="Today"
    reference={ALLOWANCE}
    {...props}
  />
)

/** jsdom has no layout: the chart draws at FALLBACK_WIDTH and the plot's left edge is 0. */
const centreOf = (index: number, count = 31) => bandScale(count, FALLBACK_WIDTH).center(index)

function plotOf(container: HTMLElement): HTMLElement {
  const plot = container.querySelector('svg')?.parentElement
  if (plot === null || plot === undefined) throw new Error('plot missing')
  return plot
}

function tap(plot: HTMLElement, x: number) {
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

describe('ColumnChart', () => {
  it('is an image named by its label, with a hidden table of every day', () => {
    render(chart())
    expect(screen.getByRole('img', { name: 'Spending per day in October' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Spending per day in October' })
    // A header row, one per day and the allowance as a footer.
    expect(within(table).getAllByRole('row')).toHaveLength(33)
    expect(within(table).getByRole('row', { name: /Day 17/ })).toHaveTextContent('43,00 €')
    expect(table).toHaveTextContent('17,34 € a day')
  })

  it('draws today in --chart-col-now, the days gone in --chart-col and nothing for days ahead', () => {
    const { container } = render(chart())
    expect(container.querySelector(`[data-key="${TODAY}"]`)?.getAttribute('style')).toContain('var(--chart-col-now)')
    expect(container.querySelector('[data-key="2026-10-17"]')?.getAttribute('style')).toContain('var(--chart-col)')
    expect(container.querySelectorAll('path[data-key]')).toHaveLength(18)
  })

  it('starts the allowance at today with a dot and labels it 6px above its end', () => {
    const { container } = render(chart())
    const reference = container.querySelector('[data-part="reference"]')
    const dot = reference?.querySelector('circle')
    expect(Number(dot?.getAttribute('cx'))).toBeCloseTo(centreOf(17), 1)
    expect(Number(reference?.querySelector('rect')?.getAttribute('x'))).toBeCloseTo(centreOf(17), 1)
    const text = container.querySelector('[data-part="reference-label"]')
    expect(text).toHaveTextContent('17,34 € a day')
    expect(text).toHaveAttribute('text-anchor', 'end')
    expect(Number(text?.getAttribute('y'))).toBeLessThan(72)
    // "Today" sits under today's column, in 600 ink.
    expect(screen.getByText('Today')).toHaveAttribute('data-strong')
  })

  it('draws no allowance without its first column, but keeps it in the table', () => {
    const { container } = render(chart({ reference: { ...ALLOWANCE, from: '2026-11-01' } }))
    expect(container.querySelector('[data-part="reference"]')).toBeNull()
    expect(screen.getByRole('table')).toHaveTextContent('17,34 € a day')
  })

  it('moves a past month’s budget label into the axis band when columns reach its end', () => {
    const { container } = render(
      <ColumnChart data={SEPTEMBER} label="Spending per day in September" reference={{ value: 1903, label: 'Daily budget' }} />,
    )
    const reference = container.querySelector('[data-part="reference"]')
    expect(reference?.querySelector('circle')).toBeNull()
    expect(reference?.querySelector('rect')).toHaveAttribute('x', '0')
    const text = container.querySelector('[data-part="reference-label"]')
    expect(text).toHaveAttribute('text-anchor', 'start')
    expect(text).toHaveAttribute('y', String(72 + 18))
    // A short stroke of the line keys it.
    expect(reference?.querySelectorAll('rect')).toHaveLength(2)
  })

  it('keeps a past month’s budget label at the line’s end when the columns there stay low', () => {
    const quietEnd = SEPTEMBER.map((datum, index) => (index >= 20 ? { ...datum, value: 200 } : datum))
    const { container } = render(
      <ColumnChart data={quietEnd} label="Spending per day in September" reference={{ value: 1903, label: 'Daily budget' }} />,
    )
    const text = container.querySelector('[data-part="reference-label"]')
    expect(text).toHaveAttribute('text-anchor', 'end')
    expect(Number(text?.getAttribute('y'))).toBeLessThan(72)
  })

  it('masks the tooltip, the reference label and the table', () => {
    const { container } = render(<MoneyFormatContext value={masked}>{chart()}</MoneyFormatContext>)
    expect(container.querySelector('[data-part="reference-label"]')).toHaveTextContent(`${MASKED} a day`)
    tap(plotOf(container), centreOf(16))
    expect(tooltipOf(container)).toHaveTextContent('Day 17')
    expect(tooltipOf(container)).toHaveTextContent(MASKED)
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('Amount hidden')).toHaveLength(32)
    expect(document.body).not.toHaveTextContent('43,00')
    expect(document.body).not.toHaveTextContent('17,34')
  })

  it('draws an opt-in hairline grid at clean values, labelled after the plot', () => {
    const { container, rerender } = render(chart({ grid: true }))
    const lines = [...container.querySelectorAll('[data-part="grid"]')]
    expect(lines.map((line) => line.textContent?.replace(/\s/g, ' '))).toEqual(['20 €', '40 €'])
    // The plot gives up the labels' gutter.
    const baseline = Number(container.querySelector('svg > rect')?.getAttribute('width'))
    expect(baseline).toBeLessThan(FALLBACK_WIDTH - 20)
    const labelX = Number(lines[0]?.querySelector('text')?.getAttribute('x'))
    expect(labelX).toBeGreaterThan(baseline)

    rerender(<MoneyFormatContext value={masked}>{chart({ grid: true })}</MoneyFormatContext>)
    expect(container.querySelectorAll('[data-part="grid"]')[0]).toHaveTextContent(MASKED)
  })

  it('has no grid by default', () => {
    const { container } = render(chart())
    expect(container.querySelector('[data-part="grid"]')).toBeNull()
  })
})

describe('ColumnChart selection', () => {
  it('opens a tooltip with the day and amount on tap, and closes it on a second tap', () => {
    const { container } = render(chart())
    const plot = plotOf(container)
    tap(plot, centreOf(15))
    expect(tooltipOf(container)).toHaveTextContent('Day 16')
    expect(tooltipOf(container)).toHaveTextContent('16,80 €')
    // The tapped column is drawn strong and the others fade.
    expect(container.querySelector('[data-key="2026-10-16"]')?.getAttribute('style')).toContain('--chart-col-now')
    expect(container.querySelector('[data-key="2026-10-16"]')).not.toHaveAttribute('data-dimmed')
    expect(container.querySelector('[data-key="2026-10-15"]')).toHaveAttribute('data-dimmed')

    tap(plot, centreOf(15))
    expect(tooltipOf(container)).toBeNull()
    expect(container.querySelector('[data-dimmed]')).toBeNull()
  })

  it('closes on a press outside the chart and on Escape', () => {
    const { container } = render(
      <>
        {chart()}
        <button type="button">Elsewhere</button>
      </>,
    )
    const plot = plotOf(container)
    tap(plot, centreOf(3))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(tooltipOf(container)).toBeNull()

    tap(plot, centreOf(3))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(tooltipOf(container)).toBeNull()
  })

  it('scrubs across columns with a horizontal drag', () => {
    const { container } = render(chart())
    const plot = plotOf(container)
    fireEvent.pointerDown(plot, { clientX: centreOf(2), pointerId: 7, pointerType: 'touch' })
    fireEvent.pointerMove(plot, { clientX: centreOf(9), pointerId: 7, pointerType: 'touch' })
    expect(tooltipOf(container)).toHaveTextContent('Day 10')
    fireEvent.pointerMove(plot, { clientX: centreOf(11), pointerId: 7, pointerType: 'touch' })
    fireEvent.pointerUp(plot, { clientX: centreOf(11), pointerId: 7, pointerType: 'touch' })
    expect(tooltipOf(container)).toHaveTextContent('Day 12')
  })

  it('steps through the columns with the arrow keys, starting at today', () => {
    const { container } = render(chart())
    const svg = screen.getByRole('img', { name: 'Spending per day in October' })
    expect(svg).toHaveAttribute('tabindex', '0')
    act(() => svg.focus())
    fireEvent.keyDown(svg, { key: 'ArrowRight' })
    expect(tooltipOf(container)).toHaveTextContent('Day 18')
    fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    expect(tooltipOf(container)).toHaveTextContent('Day 17')
    fireEvent.keyDown(svg, { key: 'End' })
    expect(tooltipOf(container)).toHaveTextContent('Day 31')
    fireEvent.keyDown(svg, { key: 'ArrowRight' })
    expect(tooltipOf(container)).toHaveTextContent('Day 31')
    fireEvent.keyDown(svg, { key: 'Home' })
    expect(tooltipOf(container)).toHaveTextContent('Day 1')
    // Tabbing away closes it.
    act(() => svg.blur())
    expect(tooltipOf(container)).toBeNull()
  })

  it('puts the tooltip beside the day, and above the plot only when no side has room for it', () => {
    // A 303px plot of 31 days. A 200px tooltip (huge text) fits beside the 3rd but not the 16th.
    mockLayout({ left: 36, top: 300, width: 303, height: 96 }, { width: 200, height: 44 })
    const { container, rerender } = render(chart({ selectedKey: '2026-10-03' }))
    expect(tooltipOf(container)).toHaveAttribute('data-placement', 'beside')

    rerender(chart({ selectedKey: '2026-10-16' }))
    const tooltip = tooltipOf(container)
    expect(tooltip).toHaveAttribute('data-placement', 'above')
    expect(tooltip).toHaveStyle({ top: `${300 - 8 - 44}px` })
  })

  it('keeps a tooltip beside the day open while the page scrolls: it moves with the chart', () => {
    const onSelect = vi.fn<(key: string | null) => void>()
    const { container } = render(chart({ selectedKey: '2026-10-16', onSelect }))
    expect(tooltipOf(container)).toHaveAttribute('data-placement', 'beside')
    fireEvent.scroll(document)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('follows a controlled selection and reports taps', () => {
    const onSelect = vi.fn<(key: string | null) => void>()
    const { container, rerender } = render(chart({ selectedKey: '2026-10-02', onSelect }))
    expect(tooltipOf(container)).toHaveTextContent('Day 2')

    tap(plotOf(container), centreOf(4))
    expect(onSelect).toHaveBeenLastCalledWith('2026-10-05')
    // Still the parent's choice until it changes.
    expect(tooltipOf(container)).toHaveTextContent('Day 2')

    rerender(chart({ selectedKey: '2026-10-05', onSelect }))
    tap(plotOf(container), centreOf(4))
    expect(onSelect).toHaveBeenLastCalledWith(null)

    rerender(chart({ selectedKey: null, onSelect }))
    expect(tooltipOf(container)).toBeNull()
  })
})
