import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNav } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeSplit, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import type { Transaction } from '@/domain/types'
import { useAppStore } from '@/store/appStore'
import { AppFrame, plain, startAt, tearDown, words } from './testing'
import { TransactionRow } from './TransactionRow'

const { coffee, goingOut, shopping } = DEFAULT_CATEGORY_IDS

function renderRow(tx: Transaction, props: { onOpen?(): void; showDate?: boolean; showCategory?: boolean } = {}) {
  render(
    <AppFrame>
      <TransactionRow tx={tx} {...props} />
    </AppFrame>,
  )
  const row = screen.getByTestId('tx-row')
  return { row, button: within(row).getByRole('button') }
}

beforeEach(() => startAt(makeData()))
afterEach(tearDown)

describe('TransactionRow (docs/SPEC.md §3.3, DESIGN.md §9.8)', () => {
  it('shows the note as the title, the category under it and the amount', () => {
    const { row, button } = renderRow(makeTransaction({ id: 'tx-7', note: 'Cappuccino', amount: 350 }))
    expect(row).toHaveAttribute('data-id', 'tx-7')
    expect(words(row)).toBe('Cappuccino 3,50 € Coffee & snacks')
    expect(plain(button.getAttribute('aria-label'))).toBe('Cappuccino, Coffee & snacks, 3,50 €')
  })

  it('names the category as the title when there is no note', () => {
    const { row } = renderRow(makeTransaction({ note: '  ' }))
    expect(words(row)).toBe('Coffee & snacks 3,50 €')
  })

  it('says "Paid from wallet" for an expense paid from the wallet, its amount in secondary ink', () => {
    const { row, button } = renderRow(makeTransaction({ note: 'Laptop', amount: 54900, categoryId: shopping, fromWallet: true }))
    expect(words(row)).toBe('Laptop 549,00 € Paid from wallet')
    expect(row.querySelector('[data-icon="wallet"]')).not.toBeNull()
    expect(plain(button.getAttribute('aria-label'))).toBe('Laptop, Shopping, 549,00 €, paid from wallet')
  })

  it('shows a split expense as your share of the bill', () => {
    const tx = makeTransaction({
      note: 'Bar with friends',
      amount: 1800,
      categoryId: goingOut,
      splits: [makeSplit({ person: 'Max', amount: 900 })],
    })
    const { row, button } = renderRow(tx)
    expect(words(row)).toBe('Bar with friends 9,00 € Split, Max owes 9,00 € of 18,00 €')
    expect(row.querySelector('[data-icon="people"]')).not.toBeNull()
    expect(plain(button.getAttribute('aria-label'))).toBe(
      'Bar with friends, Going out, 9,00 €, your share of 18,00 €. Split, Max owes 9,00 €.',
    )
  })

  it('shows the day when asked, for lists that are not grouped by day', () => {
    const { row, button } = renderRow(makeTransaction({ note: 'Brezel', date: '2026-10-13' }), { showDate: true })
    expect(words(row)).toBe('Brezel 3,50 € Coffee & snacks Yesterday')
    expect(plain(button.getAttribute('aria-label'))).toBe('Brezel, Coffee & snacks, 3,50 €, Yesterday')
  })

  describe('in a list of one category (showCategory false)', () => {
    it('shows the day as line 2 of a plain row, and never names the category', () => {
      const { row, button } = renderRow(makeTransaction({ note: 'Cappuccino' }), { showDate: true, showCategory: false })
      expect(words(row)).toBe('Cappuccino 3,50 € Today')
      expect(plain(button.getAttribute('aria-label'))).toBe('Cappuccino, 3,50 €, Today')
    })

    it('keeps the category as the title when there is no note', () => {
      const { row, button } = renderRow(makeTransaction({ date: '2026-10-13' }), { showDate: true, showCategory: false })
      expect(words(row)).toBe('Coffee & snacks 3,50 € Yesterday')
      expect(plain(button.getAttribute('aria-label'))).toBe('Coffee & snacks, 3,50 €, Yesterday')
    })

    it('keeps "Paid from wallet" on line 2 and shows the day as the trailing note', () => {
      const tx = makeTransaction({ note: 'Laptop', amount: 54900, categoryId: shopping, fromWallet: true, date: '2026-10-08' })
      const { row, button } = renderRow(tx, { showDate: true, showCategory: false })
      expect(words(row)).toBe('Laptop 549,00 € Paid from wallet Thu 8 Oct')
      expect(row.querySelector('[data-icon="wallet"]')).not.toBeNull()
      expect(plain(button.getAttribute('aria-label'))).toBe('Laptop, 549,00 €, paid from wallet, Thu 8 Oct')
    })

    it('keeps "of {bill}" trailing a split row and says the day only in its name', () => {
      const tx = makeTransaction({
        note: 'Bar with friends',
        amount: 1800,
        categoryId: goingOut,
        date: '2026-10-13',
        splits: [makeSplit({ person: 'Max', amount: 900 })],
      })
      const { row, button } = renderRow(tx, { showDate: true, showCategory: false })
      expect(words(row)).toBe('Bar with friends 9,00 € Split, Max owes 9,00 € of 18,00 €')
      expect(plain(button.getAttribute('aria-label'))).toBe(
        'Bar with friends, 9,00 €, your share of 18,00 €. Split, Max owes 9,00 €. Yesterday.',
      )
    })

    it('leaves line 2 empty for a plain row without the day', () => {
      const { row, button } = renderRow(makeTransaction({ note: 'Cappuccino' }), { showCategory: false })
      expect(words(row)).toBe('Cappuccino 3,50 €')
      expect(plain(button.getAttribute('aria-label'))).toBe('Cappuccino, 3,50 €')
    })
  })

  it('opens the transaction sheet to edit the expense', async () => {
    const user = userEvent.setup()
    const { button } = renderRow(makeTransaction({ id: 'tx-3' }))
    await user.click(button)
    expect(useNav.getState().sheets.map((entry) => entry.route)).toEqual([{ name: 'transaction', id: 'tx-3', kind: 'expense' }])
  })

  it('calls onOpen instead when given', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn<() => void>()
    const { button } = renderRow(makeTransaction(), { onOpen })
    await user.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(useNav.getState().sheets).toEqual([])
  })

  it('hides amounts while they are masked, and says so', () => {
    const data = makeData()
    useAppStore.setState({ data: { ...data, settings: { ...data.settings, hideAmounts: true } } })
    const tx = makeTransaction({ amount: 1800, categoryId: coffee, splits: [makeSplit({ person: 'Max', amount: 900 })] })
    const { row, button } = renderRow(tx)
    expect(words(row)).toBe('Coffee & snacks ••• Split, Max owes ••• of •••')
    expect(plain(button.getAttribute('aria-label'))).toBe(
      'Coffee & snacks, amount hidden, your share of amount hidden. Split, Max owes amount hidden.',
    )
  })
})
