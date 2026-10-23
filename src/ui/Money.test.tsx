import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMoneyFormat, type MoneyFormatOptions } from '@/domain/money'
import { BigAmount } from '@/ui/BigAmount'
import { MASKED_LABEL, Money } from '@/ui/Money'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'

afterEach(cleanup)

/** Renders `children` with the user's money settings: de-DE euros with cents, unless overridden. */
function withMoney(children: ReactNode, options: Partial<MoneyFormatOptions> = {}) {
  const money = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false, ...options })
  return <MoneyFormatContext value={money}>{children}</MoneyFormatContext>
}

describe('Money', () => {
  it('formats in the user locale with the currency in its place', () => {
    render(withMoney(<Money cents={23472} data-testid="m" />))
    expect(screen.getByTestId('m')).toHaveTextContent('234,72 €')
  })

  it('puts a prefix symbol first in prefix locales', () => {
    render(withMoney(<Money cents={23472} data-testid="m" />, { currency: 'USD', locale: 'en-US' }))
    expect(screen.getByTestId('m')).toHaveTextContent('$234.72')
  })

  it('writes negative amounts with a true minus, never a hyphen', () => {
    render(withMoney(<Money cents={-4128} data-testid="m" />))
    const text = screen.getByTestId('m').textContent ?? ''
    expect(text).toContain('−41,28')
    expect(text).not.toContain('-')
  })

  it('adds a plus sign for income, but not to zero', () => {
    render(
      withMoney(
        <>
          <Money cents={145000} tone="income" data-testid="income" />
          <Money cents={0} tone="income" data-testid="zero" />
        </>,
      ),
    )
    expect(screen.getByTestId('income')).toHaveTextContent('+1.450,00 €')
    expect(screen.getByTestId('zero')).toHaveTextContent('0,00 €')
    expect(screen.getByTestId('zero').textContent).not.toContain('+')
  })

  it('always shows cents in lists, whatever "Show cents in the big number" says', () => {
    render(withMoney(<Money cents={23472} data-testid="m" />, { showCents: false }))
    expect(screen.getByTestId('m')).toHaveTextContent('234,72 €')
  })

  it('drops the cents only when asked to', () => {
    render(withMoney(<Money cents={23472} showCents={false} data-testid="m" />))
    expect(screen.getByTestId('m')).toHaveTextContent('235 €')
  })

  it('shows "•••", named "Amount hidden", while amounts are hidden', () => {
    render(withMoney(<Money cents={23472} data-testid="m" data-id="tx-1" />, { masked: true }))
    const masked = screen.getByRole('img', { name: MASKED_LABEL })
    expect(masked).toHaveTextContent('•••')
    expect(masked).toHaveAttribute('data-testid', 'm')
    expect(masked).toHaveAttribute('data-id', 'tx-1')
    expect(document.body).not.toHaveTextContent('234,72')
  })
})

describe('BigAmount', () => {
  it('sets the number and its unit apart, and reads as one amount', () => {
    render(withMoney(<BigAmount cents={23472} data-testid="hero" />))
    expect(screen.getByText('234,72')).toBeInTheDocument()
    expect(screen.getByText('€')).toBeInTheDocument()
    expect(screen.getByTestId('hero')).toHaveTextContent('234,72 €')
  })

  it('puts the unit before the number in prefix locales', () => {
    render(withMoney(<BigAmount cents={23472} data-testid="hero" />, { currency: 'USD', locale: 'en-US' }))
    const hero = screen.getByTestId('hero')
    expect(hero).toHaveTextContent('$234.72')
    expect(hero.textContent?.indexOf('$')).toBeLessThan(hero.textContent?.indexOf('234') ?? -1)
  })

  it('follows "Show cents in the big number"', () => {
    render(withMoney(<BigAmount cents={23472} data-testid="hero" />, { showCents: false }))
    expect(screen.getByTestId('hero')).toHaveTextContent('235 €')
    expect(screen.queryByText('234,72')).not.toBeInTheDocument()
  })

  it('lets the showCents prop override the setting both ways', () => {
    render(
      <>
        {withMoney(<BigAmount cents={23472} showCents data-testid="on" />, { showCents: false })}
        {withMoney(<BigAmount cents={23472} showCents={false} data-testid="off" />, { showCents: true })}
      </>,
    )
    expect(screen.getByTestId('on')).toHaveTextContent('234,72 €')
    expect(screen.getByTestId('off')).toHaveTextContent('235 €')
  })

  it('keeps the cents of an amount that would round to zero', () => {
    render(withMoney(<BigAmount cents={49} data-testid="hero" />, { showCents: false }))
    expect(screen.getByTestId('hero')).toHaveTextContent('0,49 €')
  })

  it('shows "•••" without a unit while amounts are hidden', () => {
    render(withMoney(<BigAmount cents={23472} data-testid="hero" />, { masked: true }))
    const hero = screen.getByTestId('hero')
    expect(screen.getByRole('img', { name: MASKED_LABEL })).toHaveTextContent('•••')
    expect(hero).not.toHaveTextContent('€')
    expect(hero).not.toHaveTextContent('234')
  })

  it('writes a negative figure with a true minus', () => {
    render(withMoney(<BigAmount cents={-4128} tone="critical" data-testid="hero" />))
    expect(screen.getByTestId('hero')).toHaveTextContent('−41,28 €')
    expect(screen.getByTestId('hero')).toHaveAttribute('data-tone', 'critical')
  })

  it('replaces the value at once where the Web Animations API is missing', () => {
    const { rerender } = render(withMoney(<BigAmount cents={23922} animate data-testid="hero" />))
    rerender(withMoney(<BigAmount cents={23472} animate data-testid="hero" />))
    expect(screen.getByTestId('hero')).toHaveTextContent('234,72 €')
    expect(document.querySelector('[data-drum]')).toBeNull()
  })
})

/** BigAmount loaded afresh, after the stub below; it uses the default context (de-DE euros, cents shown). */
async function loadBigAmount() {
  const module = await import('@/ui/BigAmount')
  return module.BigAmount
}

/** A text range laid out as if every character were 10px wide: the advances BigAmount measures. */
function rangeRect(this: Range): DOMRect {
  const left = this.startOffset * 10
  const right = this.endOffset * 10
  return { left, right, x: left, y: 0, top: 0, bottom: 76, width: right - left, height: 76, toJSON: () => ({}) }
}

/**
 * The odometer (docs/DESIGN.md §3.3). jsdom has neither the Web Animations API nor text
 * measurement, so these tests give elements a stub `animate` and ranges a stub layout, and load
 * BigAmount afresh: it checks for both when it loads.
 */
describe('BigAmount odometer', () => {
  const animate = vi.fn<(keyframes: Keyframe[], options?: KeyframeAnimationOptions) => Animation>()
  const realMatchMedia = window.matchMedia

  beforeEach(() => {
    animate.mockImplementation(() => {
      // Never finishes, so the drums stay in place for the assertions.
      const running = { finished: new Promise<Animation>(() => {}), cancel: () => {} }
      return running as unknown as Animation
    })
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: rangeRect, configurable: true, writable: true })
    vi.resetModules()
  })

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate')
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    window.matchMedia = realMatchMedia
  })

  it('rolls only the digits that change, the cents first', async () => {
    const Hero = await loadBigAmount()
    const { rerender } = render(<Hero cents={23922} animate data-testid="hero" />)
    expect(document.querySelector('[data-drum]')).toBeNull()

    // Adding Mensa 4,50 €: 239,22 → 234,72. The 9 and the first cent change; the rest stays still.
    rerender(<Hero cents={23472} animate data-testid="hero" />)
    const drums = [...document.querySelectorAll<HTMLElement>('[data-drum]')]
    expect(drums.map((drum) => [drum.dataset.from, drum.dataset.to, drum.dataset.order])).toEqual([
      ['9', '4', '1'],
      ['2', '7', '0'],
    ])
    // Falling: 9 → 4 passes 8, 7, 6, 5; 2 → 7 wraps through 1, 0, 9, 8. Strips stack new to old.
    expect(drums.map((drum) => drum.querySelector('[data-strip]')?.textContent)).toEqual(['456789', '789012'])
    // A width and a transform animation per drum, staggered right to left.
    expect(animate).toHaveBeenCalledTimes(4)
    const delays = animate.mock.calls.map(([, options]) => options?.delay)
    expect(delays).toEqual([45, 45, 0, 0])
  })

  it('keeps every character at its measured advance, so the figure does not jump', async () => {
    const Hero = await loadBigAmount()
    const { rerender } = render(<Hero cents={23922} animate data-testid="hero" />)
    rerender(<Hero cents={23472} animate data-testid="hero" />)
    const cells = [...document.querySelectorAll<HTMLElement>('[data-cell]')]
    expect(cells.map((cell) => cell.textContent?.at(0))).toEqual(['2', '3', '4', ',', '7', '2'])
    expect(cells.map((cell) => cell.style.width)).toEqual(['10px', '10px', '10px', '10px', '10px', '10px'])
    // The drums animate their width from the old advance to the new one.
    expect(animate.mock.calls[0]?.[0]).toEqual([{ width: '10px' }, { width: '10px' }])
  })

  it('keeps the final value readable while the drums roll', async () => {
    const Hero = await loadBigAmount()
    const { rerender } = render(<Hero cents={23922} animate data-testid="hero" />)
    rerender(<Hero cents={23472} animate data-testid="hero" />)
    const hero = screen.getByTestId('hero')
    const figure = hero.firstElementChild
    expect(figure).toHaveAttribute('aria-hidden', 'true')
    expect(hero.querySelector('.visually-hidden')).toHaveTextContent('234,72 €')
  })

  it('rolls upwards when the value rises', async () => {
    const Hero = await loadBigAmount()
    const { rerender } = render(<Hero cents={23472} animate />)
    rerender(<Hero cents={23922} animate />)
    const strips = [...document.querySelectorAll('[data-strip]')].map((strip) => strip.textContent)
    // Rising: 4 → 9 passes 5, 6, 7, 8; 7 → 2 wraps through 8, 9, 0, 1. Strips stack old to new.
    expect(strips).toEqual(['456789', '789012'])
    const first = animate.mock.calls.find(([keyframes]) => 'transform' in (keyframes[0] ?? {}))
    expect(first?.[0]).toEqual([{ transform: 'translateY(0em)' }, { transform: 'translateY(-5em)' }])
  })

  it('does not roll on first render, without animate, or when the number of digits changes', async () => {
    const Hero = await loadBigAmount()
    const { rerender } = render(<Hero cents={99900} animate />)
    expect(document.querySelector('[data-drum]')).toBeNull()

    rerender(<Hero cents={99800} />)
    expect(document.querySelector('[data-drum]')).toBeNull()

    // 998,00 → 1.000,00: the shape changes, so the figure crossfades instead.
    rerender(<Hero cents={100000} animate />)
    expect(document.querySelector('[data-drum]')).toBeNull()
    expect(document.body).toHaveTextContent('1.000,00 €')
  })

  it('shows the new value at once with Reduce Motion', async () => {
    window.matchMedia = (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
    const Hero = await loadBigAmount()
    const { rerender } = render(<Hero cents={23922} animate data-testid="hero" />)
    rerender(<Hero cents={23472} animate data-testid="hero" />)
    expect(document.querySelector('[data-drum]')).toBeNull()
    expect(animate).not.toHaveBeenCalled()
    expect(screen.getByTestId('hero')).toHaveTextContent('234,72 €')
  })
})
