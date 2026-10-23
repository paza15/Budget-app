import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ColumnChart, type ColumnDatum } from '@/ui/charts/ColumnChart'
import {
  bandScale,
  barPath,
  besideLineY,
  columnAxisLabels,
  columnHeight,
  columnPath,
  columnsReach,
  coversColumn,
  edgeAxisLabels,
  estimateTextWidth,
  FALLBACK_WIDTH,
  freeAxisSpan,
  gridValues,
  labelBox,
  layoutColumns,
  MIN_MARK,
  niceStep,
  placeAbovePlot,
  placeTooltip,
  stackColumn,
  stackedBarLayout,
  stepLinePath,
  valueDomainMax,
  valueDomainWithLines,
  valueY,
} from '@/ui/charts/scale'

describe('bandScale', () => {
  it('centres columns in equal slots', () => {
    const band = bandScale(4, 200)
    expect(band.slot).toBe(50)
    expect(band.center(0)).toBe(25)
    expect(band.center(3)).toBe(175)
  })

  it('maps x to the slot under it and snaps x outside the plot to the ends', () => {
    const band = bandScale(4, 200)
    expect(band.indexAt(0)).toBe(0)
    expect(band.indexAt(49.9)).toBe(0)
    expect(band.indexAt(50)).toBe(1)
    expect(band.indexAt(199)).toBe(3)
    expect(band.indexAt(-20)).toBe(0)
    expect(band.indexAt(500)).toBe(3)
  })

  it('has no slot without columns', () => {
    expect(bandScale(0, 200).indexAt(10)).toBe(-1)
  })
})

describe('column heights', () => {
  it('are proportional to the value', () => {
    expect(columnHeight(500, 1000, 72)).toBe(36)
    expect(columnHeight(250, 1000, 72)).toBe(18)
    expect(columnHeight(1000, 1000, 72)).toBe(72)
    expect(columnHeight(300, 1000, 72) / columnHeight(600, 1000, 72)).toBeCloseTo(0.5)
  })

  it('draw nothing for zero, negative and invalid values', () => {
    expect(columnHeight(0, 1000, 72)).toBe(0)
    expect(columnHeight(-5, 1000, 72)).toBe(0)
    expect(columnHeight(Number.NaN, 1000, 72)).toBe(0)
    expect(columnHeight(10, 0, 72)).toBe(0)
  })

  it('keep a small amount visible and never leave the plot', () => {
    expect(columnHeight(1, 100_000, 72)).toBe(MIN_MARK)
    expect(columnHeight(2000, 1000, 72)).toBe(72)
  })

  it('leave a little air above the tallest column', () => {
    expect(valueDomainMax([4300, 1200])).toBeCloseTo(4300 / 0.95)
    expect(valueDomainMax([])).toBe(1)
    expect(valueDomainMax([0, 0])).toBe(1)
    expect(valueY(4300, valueDomainMax([4300]), 72)).toBeCloseTo(72 * 0.05)
  })

  it('keep room for a line label above the highest line', () => {
    const max = valueDomainWithLines([100], [1000], { plotHeight: 100, headroom: 20 })
    expect(valueY(1000, max, 100)).toBeCloseTo(20)
    // Columns above the line still decide the top.
    expect(valueDomainWithLines([5000], [1000], { plotHeight: 100, headroom: 20 })).toBeCloseTo(5000 / 0.95)
  })
})

describe('layoutColumns', () => {
  it('keeps a column without spending tappable across its whole slot', () => {
    const columns = layoutColumns([300, 0, 600], { width: 300, plotHeight: 72, barWidth: 6, max: 600 })
    expect(columns[1]).toMatchObject({ height: 0, hitX: 100, hitWidth: 100, center: 150 })
    expect(columns[0]?.height).toBe(36)
    expect(columns[2]?.height).toBe(72)
  })

  it('centres each column in its slot', () => {
    const [first] = layoutColumns([1], { width: 100, plotHeight: 72, barWidth: 6, max: 1 })
    expect(first).toMatchObject({ x: 47, width: 6, center: 50 })
  })

  it('caps bars at 24px and keeps 2px between neighbours', () => {
    expect(layoutColumns([1], { width: 300, plotHeight: 72, barWidth: 40, max: 1 })[0]?.width).toBe(24)
    expect(layoutColumns(Array.from({ length: 10 }, () => 1), { width: 50, plotHeight: 72, barWidth: 6, max: 1 })[0]?.width).toBe(3)
  })
})

describe('stackColumn', () => {
  it('stacks bottom first with a 2px gap and rounds only the top piece', () => {
    expect(stackColumn([600, 300], { max: 1000, plotHeight: 100 })).toEqual([
      { index: 0, y: 40, height: 60, roundTop: false },
      { index: 1, y: 10, height: 28, roundTop: true },
    ])
  })

  it('gives the data end to the bottom piece when nothing sits on it', () => {
    expect(stackColumn([600, 0], { max: 1000, plotHeight: 100 })).toEqual([
      { index: 0, y: 40, height: 60, roundTop: true },
    ])
  })
})

describe('stackedBarLayout', () => {
  it('splits the width by value with exactly 2px between segments', () => {
    expect(stackedBarLayout([300, 200, 100], 604)).toEqual([
      { x: 0, width: 300 },
      { x: 302, width: 200 },
      { x: 504, width: 100 },
    ])
  })

  it('keeps a sliver at least 2px wide', () => {
    expect(stackedBarLayout([1000, 1], 102)).toEqual([
      { x: 0, width: 98 },
      { x: 100, width: 2 },
    ])
  })

  it('draws nothing without a total', () => {
    expect(stackedBarLayout([0, 0], 100)).toEqual([
      { x: 0, width: 0 },
      { x: 0, width: 0 },
    ])
  })
})

describe('paths', () => {
  it('round the top of a column, clamped to half its width, and keep its base square', () => {
    expect(columnPath(10, 72, 6, 30, 4)).toBe('M10 72V45A3 3 0 0 1 13 42H13A3 3 0 0 1 16 45V72Z')
    expect(columnPath(0, 100, 22, 50, 4)).toBe('M0 100V54A4 4 0 0 1 4 50H18A4 4 0 0 1 22 54V100Z')
    expect(columnPath(0, 72, 6, 0)).toBe('')
  })

  it('round only the requested ends of a bar', () => {
    expect(barPath(0, 0, 100, 10, 4, { start: false, end: false })).toBe('M0 0H100V10H0V0Z')
    expect(barPath(0, 0, 100, 10, 4, { start: true, end: true }).match(/A/g)).toHaveLength(4)
    const end = barPath(0, 0, 100, 10, 4, { start: false, end: true })
    expect(end.startsWith('M0 0H96A4 4')).toBe(true)
    expect(end.match(/A/g)).toHaveLength(2)
  })

  it('draw a step line through one level per slot', () => {
    expect(stepLinePath([10, 10, 20], 50)).toBe('M0 10H50V10H100V20H150')
    expect(stepLinePath([10, null, 20], 50)).toBe('M0 10H50M100 20H150')
  })
})

describe('axis labels', () => {
  const keys = Array.from({ length: 31 }, (_, index) => String(index + 1))
  const labels = keys.map((day) => `${day} Oct`)
  const texts = (highlight: number) =>
    edgeAxisLabels({ keys, labels, width: 321, fontSize: 12, highlight: { index: highlight, text: 'Today' } }).map(
      (label) => [label.text, label.anchor],
    )

  it('show the first and last day and today in between', () => {
    expect(texts(17)).toEqual([
      ['1 Oct', 'start'],
      ['Today', 'middle'],
      ['31 Oct', 'end'],
    ])
  })

  it('let an end label give way to a nearby today', () => {
    expect(texts(1)).toEqual([
      ['Today', 'middle'],
      ['31 Oct', 'end'],
    ])
    expect(texts(29)).toEqual([
      ['1 Oct', 'start'],
      ['Today', 'middle'],
    ])
  })

  it('put today at the edge on the first and last day', () => {
    expect(texts(0)).toEqual([
      ['Today', 'start'],
      ['31 Oct', 'end'],
    ])
    expect(texts(30)).toEqual([
      ['1 Oct', 'start'],
      ['Today', 'end'],
    ])
  })

  it('label every column when the names fit their slots', () => {
    const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']
    const placed = columnAxisLabels({ keys: months, labels: months, width: 321, fontSize: 12, highlightIndex: 5 })
    expect(placed.map((label) => label.text)).toEqual(months)
    expect(placed.filter((label) => label.strong).map((label) => label.text)).toEqual(['Oct'])
  })
})

describe('placeTooltip', () => {
  const chart = { halfWidth: 3, boxWidth: 320, boxHeight: 96, width: 100, height: 40 }
  /** The allowance label at the plot's end: "17,34 € a day". */
  const label = { left: 240, right: 320, top: 30, bottom: 45 }

  it('puts the tooltip beside the column at the top, on the side with more room', () => {
    expect(placeTooltip({ ...chart, x: 50 })).toEqual({ left: 61, top: 0 })
    expect(placeTooltip({ ...chart, x: 270 })).toEqual({ left: 159, top: 0 })
  })

  it('takes the other side to keep a label on the plot readable', () => {
    expect(placeTooltip({ ...chart, x: 160, avoid: [label] })).toEqual({ left: 49, top: 0 })
  })

  it('moves below a label it cannot pass, while it still fits the chart', () => {
    const wide = { left: 0, right: 320, top: 10, bottom: 22 }
    expect(placeTooltip({ ...chart, x: 160, avoid: [wide] })).toEqual({ left: 171, top: 26 })
    // No room below: it covers the label rather than leave the chart.
    expect(placeTooltip({ ...chart, boxHeight: 50, x: 160, avoid: [wide] })).toEqual({ left: 171, top: 0 })
  })

  it('stays inside the chart when no side is wide enough, never above the plot', () => {
    expect(placeTooltip({ ...chart, x: 160, halfWidth: 11, width: 200, height: 90 })).toEqual({ left: 120, top: 0 })
    expect(placeTooltip({ ...chart, x: 100, halfWidth: 11, width: 300, height: 90 })).toEqual({ left: 20, top: 0 })
  })

  it('moves a tooltip pushed against the edge below the label it would cover', () => {
    // July on the six-month trend: the income label sits at the plot's top right.
    const income = { left: 216, right: 320, top: 2, bottom: 14 }
    const july = { x: 133.75, halfWidth: 11, boxWidth: 320, boxHeight: 146, width: 179, height: 87 }
    expect(placeTooltip({ ...july, avoid: [income] })).toEqual({ left: 141, top: 18 })
  })

  it('tells when the tooltip pushed against an edge would cover the column', () => {
    // The six-month trend on a 375pt iPhone: a 303px plot, 22px columns, a 179px tooltip. Beside
    // the column there is room for the outer months only; July and August would be covered.
    const columns = layoutColumns([1, 1, 1, 1, 1, 1], { width: 303, plotHeight: 124, barWidth: 22, max: 1 })
    const covered = columns.map(({ center: x }) => {
      const placed = placeTooltip({ x, halfWidth: 11, boxWidth: 303, boxHeight: 146, width: 179, height: 87 })
      return coversColumn({ left: placed.left, width: 179, x, halfWidth: 11 })
    })
    expect(covered).toEqual([false, false, true, true, false, false])
    // Touching edges do not cover.
    expect(coversColumn({ left: 61, width: 100, x: 50, halfWidth: 11 })).toBe(false)
    expect(coversColumn({ left: -61, width: 100, x: 50, halfWidth: 11 })).toBe(false)
  })
})

describe('placeAbovePlot', () => {
  /** The trend's plot and axis band on a 375pt iPhone, 300px down a 667px screen. */
  const plot = { left: 36, right: 339, top: 300, bottom: 446 }
  const screen375 = { left: 0, right: 375, top: 0, bottom: 667 }
  const tooltip = { width: 179, height: 87 }

  it('centres the tooltip on the column, 8px above the plot, so it covers no column', () => {
    // July, the column the review found covered: x 126.25 in the plot, 22px wide.
    const placed = placeAbovePlot({ ...tooltip, x: 126.25, plot, visible: screen375 })
    expect(placed).toEqual({ left: 36 + 126.25 - 89.5, top: 300 - 8 - 87, side: 'above' })
    expect(placed.top + tooltip.height).toBeLessThanOrEqual(plot.top - 8)
  })

  it('keeps within the plot for the outer months', () => {
    expect(placeAbovePlot({ ...tooltip, x: 25.25, plot, visible: screen375 }).left).toBe(36)
    expect(placeAbovePlot({ ...tooltip, x: 277.75, plot, visible: screen375 }).left).toBe(339 - 179)
  })

  it('goes under the plot when the chart is at the top of the visible area', () => {
    // Under a 44px navigation bar, the plot 100px down: no room for 87px above it.
    const visible = { ...screen375, top: 44 }
    const high = { ...plot, top: 100, bottom: 246 }
    expect(placeAbovePlot({ ...tooltip, x: 126.25, plot: high, visible })).toEqual({
      left: 72.75,
      top: 246 + 8,
      side: 'below',
    })
    // No room on either side: the side with more of it.
    const short = { ...visible, bottom: 300 }
    expect(placeAbovePlot({ ...tooltip, x: 126.25, plot: high, visible: short }).side).toBe('above')
  })

  it('stays on the screen, 8px from its edges, when huge text makes it wider than the plot', () => {
    // 340px: centred on the 303px plot, which still leaves 8px to each screen edge.
    expect(placeAbovePlot({ width: 340, height: 160, x: 126.25, plot, visible: screen375 }).left).toBe(36 - 18.5)
    // Wider than the screen allows: from the leading margin (its max-width keeps it narrower).
    expect(placeAbovePlot({ width: 400, height: 160, x: 126.25, plot, visible: screen375 }).left).toBe(8)
  })
})

describe('gridlines', () => {
  it('step by 1, 2, 2.5 or 5 times a power of ten', () => {
    expect([7, 25, 1000, 1131, 2100, 2600, 42250].map(niceStep)).toEqual([10, 25, 1000, 2000, 2500, 5000, 50000])
    expect(niceStep(0)).toBe(1)
    expect(niceStep(Number.NaN)).toBe(1)
  })

  it('sit at one to three clean values above the baseline, clear of the top edge', () => {
    // The Daily plot of October (tallest day 43,00 €) and the six-month trend.
    expect(gridValues(4300 / 0.95)).toEqual([2000, 4000])
    expect(gridValues(169000)).toEqual([50000, 100000, 150000])
    expect(gridValues(100)).toEqual([25, 50, 75])
    expect(gridValues(0)).toEqual([])
  })

  it('centre their labels on the line', () => {
    expect(besideLineY(40, 12)).toBeCloseTo(44.2)
  })
})

describe('label boxes', () => {
  it('span the text from its anchor', () => {
    expect(labelBox({ x: 100, y: 50, width: 40, fontSize: 10, anchor: 'end' })).toEqual({
      left: 60,
      right: 100,
      top: 42,
      bottom: 52.5,
    })
    expect(labelBox({ x: 100, y: 50, width: 40, fontSize: 10, anchor: 'middle' })).toMatchObject({ left: 80, right: 120 })
  })

  it('know when a column reaches into a label', () => {
    const box = { left: 0, right: 20, top: 10, bottom: 30 }
    // Standing on 72, 50 tall: its top at 22 is inside the box.
    expect(columnsReach([{ x: 10, width: 6, height: 50 }], 72, box)).toBe(true)
    expect(columnsReach([{ x: 10, width: 6, height: 30 }], 72, box)).toBe(false)
    expect(columnsReach([{ x: 40, width: 6, height: 70 }], 72, box)).toBe(false)
    expect(columnsReach([{ x: 10, width: 6, height: 0 }], 72, box)).toBe(false)
  })

  it('find the free middle of the axis band', () => {
    const edges = edgeAxisLabels({ keys: ['1', '30'], labels: ['1 Sep', '30 Sep'], width: 321, fontSize: 12 })
    const span = freeAxisSpan(edges, 321, 12)
    expect(span?.left).toBeCloseTo(estimateTextWidth('1 Sep', 12) + 6)
    expect(span?.right).toBeCloseTo(321 - estimateTextWidth('30 Sep', 12) - 6)
    const keys = Array.from({ length: 31 }, (_, index) => String(index + 1))
    const withToday = edgeAxisLabels({
      keys,
      labels: keys.map((day) => `${day} Oct`),
      width: 321,
      fontSize: 12,
      highlight: { index: 15, text: 'Today' },
    })
    expect(freeAxisSpan(withToday, 321, 12)).toBeNull()
  })
})

describe('hit targets', () => {
  afterEach(cleanup)

  const data: ColumnDatum[] = [
    { key: 'd1', label: '1 Oct', title: 'Thu 1 Oct', value: 300 },
    { key: 'd2', label: '2 Oct', title: 'Fri 2 Oct', value: 0 },
    { key: 'd3', label: '3 Oct', title: 'Sat 3 Oct', value: 600 },
  ]

  it('draws no column for a day without spending but still opens its tooltip', () => {
    const { container } = render(<ColumnChart data={data} label="Spending per day" />)
    expect(container.querySelector('[data-key="d2"]')).toBeNull()
    expect(container.querySelectorAll('path[data-key]')).toHaveLength(2)

    const plot = screen.getByRole('img', { name: 'Spending per day' }).parentElement
    if (plot === null) throw new Error('plot missing')
    // jsdom has no layout, so the chart draws at FALLBACK_WIDTH: the middle third is day 2.
    const x = FALLBACK_WIDTH / 2
    fireEvent.pointerDown(plot, { clientX: x, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerUp(plot, { clientX: x, pointerId: 1, pointerType: 'touch' })

    const tooltip = container.querySelector('[data-chart-tooltip]')
    expect(tooltip).toHaveTextContent('Fri 2 Oct')
    expect(tooltip).toHaveTextContent('0,00 €')
  })

  it('draws column heights in proportion to the values', () => {
    const { container } = render(<ColumnChart data={data} label="Spending per day" height={95} />)
    const top = (key: string) => {
      const d = container.querySelector(`path[data-key="${key}"]`)?.getAttribute('d') ?? ''
      // "M x 95 V (top + r) A …": the column's top is the V value minus its 3px radius.
      return Number(/V([\d.]+)/.exec(d)?.[1]) - 3
    }
    const max = valueDomainMax([300, 600])
    expect(95 - top('d1')).toBeCloseTo((300 / max) * 95, 1)
    expect(95 - top('d3')).toBeCloseTo((600 / max) * 95, 1)
  })
})
