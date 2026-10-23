import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMoneyFormat } from '@/domain/money'
import type { Cents } from '@/domain/types'
import { LedgerFigure } from '@/ui/LedgerFigure'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'
import { useLedgerColumn } from '@/ui/useLedgerColumn'

const MONEY = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false })

/** jsdom has no layout: a figure is `advance` px wide per character of its own text, not the unit's. */
let advance = 8

function fakeRect(element: Element): DOMRect {
  const text = [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('')
  return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: text.length * advance, height: 22, toJSON: () => ({}) }
}

/** Records what the hook observes; `resize()` reports a change, as the browser does after layout. */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null
  readonly observed = new Set<Element>()
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.last = this
  }
  observe(element: Element) {
    this.observed.add(element)
  }
  unobserve(element: Element) {
    this.observed.delete(element)
  }
  disconnect() {
    this.observed.clear()
  }
  resize() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function Ledger({ figures }: { figures: readonly Cents[] }) {
  const ledgerRef = useLedgerColumn<HTMLDivElement>()
  return (
    <MoneyFormatContext value={MONEY}>
      <div ref={ledgerRef} data-testid="ledger">
        {figures.map((cents, index) => (
          <p key={cents}>
            <LedgerFigure cents={cents} result={index === figures.length - 1} />
          </p>
        ))}
      </div>
    </MoneyFormatContext>
  )
}

/** Income, fixed costs, savings, daily spending and the result "= Left 234,72 €". */
const MONTH: readonly Cents[] = [145000, 77888, 10000, 33640, 23472]

const colw = () => screen.getByTestId('ledger').style.getPropertyValue('--colw')
const observer = () => {
  if (!FakeResizeObserver.last) throw new Error('The hook made no ResizeObserver.')
  return FakeResizeObserver.last
}

beforeEach(() => {
  advance = 8
  FakeResizeObserver.last = null
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return fakeRect(this)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useLedgerColumn', () => {
  it('writes the width of the widest figure to --colw', () => {
    render(<Ledger figures={MONTH} />)
    // "1.450,00" is the widest; the result's hanging "€" is not part of its box.
    expect(colw()).toBe('64px')
  })

  it('measures again when a figure changes size, as when Source Serif 4 replaces the fallback font', () => {
    advance = 9
    render(<Ledger figures={MONTH} />)
    expect(colw()).toBe('72px')
    expect(observer().observed.size).toBe(MONTH.length)
    advance = 7.5
    act(() => observer().resize())
    expect(colw()).toBe('60px')
  })

  it('follows rows that come and go', async () => {
    const { rerender } = render(<Ledger figures={MONTH} />)
    rerender(<Ledger figures={[1234500, ...MONTH]} />)
    await act(async () => {})
    expect(colw()).toBe('72px')
    expect(observer().observed.size).toBe(MONTH.length + 1)
    rerender(<Ledger figures={MONTH} />)
    await act(async () => {})
    expect(colw()).toBe('64px')
    expect(observer().observed.size).toBe(MONTH.length)
  })

  it('stops observing when the ledger goes away', () => {
    const stopRows = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const { unmount } = render(<Ledger figures={MONTH} />)
    unmount()
    expect(observer().observed.size).toBe(0)
    expect(stopRows).toHaveBeenCalled()
  })
})
