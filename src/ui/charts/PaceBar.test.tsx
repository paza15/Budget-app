import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMoneyFormat, MASKED } from '@/domain/money'
import { PaceBar } from '@/ui/charts/PaceBar'
import { PACE, paceDayText, paceGeometry, paceSentence } from '@/ui/charts/paceGeometry'
import { FALLBACK_WIDTH } from '@/ui/charts/scale'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'

const money = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false })
const masked = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })

/** jest-dom collapses the element's whitespace (Intl's no-break space before "€") but not ours. */
const spaced = (text: string) => text.replace(/\s/g, ' ')

/** 310px wide and 31 days: 10px per day. */
const base = { width: 310, available: 1000, days: 31 }

/** The fill's CSS width for `spent` of 571,12 € at the width jsdom draws with. */
const fillWidth = (spent: number) => `${(FALLBACK_WIDTH * spent) / 57112}px`

/** Stands in for Element.animate, which jsdom lacks. */
function stubAnimate() {
  const animate = vi.fn<Element['animate']>()
  Object.defineProperty(SVGElement.prototype, 'animate', { value: animate, configurable: true, writable: true })
  return animate
}

describe('paceGeometry', () => {
  it('fills the spent share in ink', () => {
    expect(paceGeometry({ ...base, spent: 500, timeRatio: 0.6, status: 'ok' }).segments).toEqual([
      { part: 'fill', x: 0, width: 155, roundStart: true, grows: true },
    ])
  })

  it('clamps the fill to the track', () => {
    expect(paceGeometry({ ...base, spent: 2500, timeRatio: 0.5, status: 'ok' }).segments[0]?.width).toBe(310)
  })

  it('keeps a first small spend visible and draws nothing for none', () => {
    expect(paceGeometry({ ...base, spent: 1, timeRatio: 0.5, status: 'ok' }).segments[0]?.width).toBe(PACE.minFill)
    expect(paceGeometry({ ...base, spent: 0, timeRatio: 0.5, status: 'ok' }).segments).toEqual([])
  })

  it('draws over budget as the critical bar to 100% − 13px, a 2px gap and an 11px nub', () => {
    const geometry = paceGeometry({ ...base, spent: 1200, timeRatio: 0.5, status: 'over' })
    expect(geometry.segments).toEqual([
      { part: 'over', x: 0, width: 297, roundStart: true, grows: false },
      { part: 'nub', x: 299, width: 11, roundStart: true, grows: false },
    ])
    expect(geometry.notchX).toBe(155)
  })

  it('splits spending ahead of pace at the notch', () => {
    // Notch at 155: ink to 1px before it, --warning-mark from 1px after it to the spent share.
    expect(paceGeometry({ ...base, spent: 700, timeRatio: 0.5, status: 'ahead' }).segments).toEqual([
      { part: 'fill', x: 0, width: 154, roundStart: true, grows: false },
      { part: 'ahead', x: 156, width: 61, roundStart: false, grows: true },
    ])
  })

  it('ticks every day boundary, every fifth longer, the days gone darker', () => {
    const geometry = paceGeometry({ ...base, spent: 500, timeRatio: 18 / 31, status: 'ok' })
    expect(geometry.dayIndex).toBe(18)
    expect(geometry.ticks).toHaveLength(30)
    expect(geometry.ticks[0]?.x).toBe(10)
    expect(geometry.ticks.filter((tick) => tick.long).map((tick) => tick.day)).toEqual([5, 10, 15, 20, 25, 30])
    expect(geometry.ticks.filter((tick) => tick.past).map((tick) => tick.day)).toEqual(
      Array.from({ length: 17 }, (_, index) => index + 1),
    )
  })

  it('has no notch and only past ticks for a past period', () => {
    const geometry = paceGeometry({ width: 300, available: 1000, days: 30, spent: 500, timeRatio: null, status: 'ok' })
    expect(geometry.notchX).toBeNull()
    expect(geometry.dayIndex).toBeNull()
    expect(geometry.ticks).toHaveLength(29)
    expect(geometry.ticks.every((tick) => tick.past)).toBe(true)
  })

  it('draws no ticks when the period length is unknown', () => {
    expect(paceGeometry({ width: 300, available: 1000, spent: 500, timeRatio: 0.5, status: 'ok' }).ticks).toEqual([])
  })
})

describe('pace words', () => {
  it('name the day or the length of the period', () => {
    expect(paceDayText(18, 31)).toBe('Day 18 of 31')
    expect(paceDayText(null, 30)).toBe('30 days')
    expect(paceDayText(null, undefined)).toBeNull()
  })

  it('say how much was spent by when, never an amount', () => {
    expect(paceSentence({ spent: 33640, available: 57112, status: 'ok', dayIndex: 18, days: 31 })).toBe(
      'Spent 59 percent of the money for daily life on day 18 of 31',
    )
    expect(paceSentence({ spent: 39980, available: 57112, status: 'ahead', dayIndex: 18, days: 31 })).toBe(
      'Spent 70 percent of the money for daily life on day 18 of 31, more than planned by today',
    )
    expect(paceSentence({ spent: 61240, available: 57112, status: 'over', dayIndex: 18, days: 31 })).toBe(
      'Over budget: spent 107 percent of the money for daily life on day 18 of 31',
    )
    expect(paceSentence({ spent: 51230, available: 57112, status: 'ok', dayIndex: null, days: 30 })).toBe(
      'Spent 90 percent of the money for daily life in 30 days',
    )
  })
})

describe('PaceBar', () => {
  const current = { spent: 33640, available: 57112, timeRatio: 18 / 31, status: 'ok', days: 31 } as const

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('is an image named with a sentence, with the caption under it', () => {
    const { container } = render(<PaceBar {...current} data-testid="pace" />)
    expect(screen.getByRole('img', { name: 'Spent 59 percent of the money for daily life on day 18 of 31' })).toBeInTheDocument()
    expect(screen.getByTestId('pace')).toHaveAttribute('data-status', 'ok')
    const caption = container.querySelector('[data-part="caption"]')
    expect(caption).toHaveTextContent(spaced(`Spent ${money.format(33640)} of ${money.format(57112)}`))
    expect(caption).toHaveTextContent('Day 18 of 31')
  })

  it('can leave the caption out', () => {
    const { container } = render(<PaceBar {...current} caption={false} />)
    expect(container.querySelector('[data-part="caption"]')).toBeNull()
    expect(screen.getByRole('table', { name: 'Spending pace' })).toHaveTextContent('Day 18 of 31')
  })

  it('lists its values in a visually hidden table', () => {
    render(<PaceBar {...current} />)
    const table = screen.getByRole('table', { name: 'Spending pace' })
    expect(within(table).getByRole('rowheader', { name: 'Spent' })).toBeInTheDocument()
    expect(table).toHaveTextContent(spaced(money.format(33640)))
    expect(table).toHaveTextContent('Day 18 of 31')
  })

  it('draws the today notch only for the current period', () => {
    const { container, rerender } = render(<PaceBar {...current} />)
    expect(container.querySelector('[data-part="notch"]')).not.toBeNull()
    rerender(<PaceBar {...current} timeRatio={null} days={30} />)
    expect(container.querySelector('[data-part="notch"]')).toBeNull()
    expect(container.querySelector('[data-part="caption"]')).toHaveTextContent('30 days')
  })

  it('draws over budget with a 2px gap and an overflow nub at the end', () => {
    const { container } = render(<PaceBar {...current} spent={61240} status="over" />)
    const over = container.querySelector('[data-part="over"]')
    const nub = container.querySelector('[data-part="nub"]')
    expect(over).toHaveAttribute('width', String(FALLBACK_WIDTH - 13))
    expect(nub).toHaveAttribute('x', String(FALLBACK_WIDTH - 11))
    expect(nub).toHaveAttribute('width', '11')
    expect(container.querySelector('[data-part="fill"]')).toBeNull()
    expect(screen.getByRole('img', { name: /^Over budget: spent 107 percent/ })).toBeInTheDocument()
  })

  it('clamps the fill at the end of the track', () => {
    const { container } = render(<PaceBar {...current} spent={90000} status="ok" />)
    expect(container.querySelector('[data-part="fill"]')).toHaveAttribute('width', String(FALLBACK_WIDTH))
  })

  it('masks the amounts in the caption and the table', () => {
    const { container } = render(
      <MoneyFormatContext value={masked}>
        <PaceBar {...current} />
      </MoneyFormatContext>,
    )
    const table = screen.getByRole('table', { name: 'Spending pace' })
    expect(table).toHaveTextContent(MASKED)
    expect(within(table).getAllByText('Amount hidden')).toHaveLength(2)
    expect(document.body).not.toHaveTextContent('336,40')
    expect(document.body).not.toHaveTextContent('571,12')
    expect(container.querySelector('[data-part="caption"]')).toHaveTextContent(`Spent ${MASKED} of ${MASKED}`)
  })

  it('grows the fill after an entry, but not when the period changes', () => {
    const animate = stubAnimate()
    try {
      const { rerender } = render(<PaceBar {...current} />)
      expect(animate).not.toHaveBeenCalled()

      rerender(<PaceBar {...current} spent={35640} />)
      expect(animate).toHaveBeenCalledTimes(1)
      const [keyframes] = animate.mock.calls[0] ?? []
      expect(keyframes).toEqual([{ width: fillWidth(33640) }, { width: fillWidth(35640) }])

      // Another month: a different spend and time share, drawn at once.
      rerender(<PaceBar {...current} spent={51230} timeRatio={null} days={30} />)
      expect(animate).toHaveBeenCalledTimes(1)
    } finally {
      Reflect.deleteProperty(SVGElement.prototype, 'animate')
    }
  })

  it('does not animate with Reduce Motion', () => {
    const animate = stubAnimate()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList)
    try {
      const { rerender } = render(<PaceBar {...current} />)
      rerender(<PaceBar {...current} spent={35640} />)
      expect(animate).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(SVGElement.prototype, 'animate')
    }
  })
})
