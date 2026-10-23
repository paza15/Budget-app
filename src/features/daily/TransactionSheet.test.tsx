import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNav, type SheetProps } from '@/app/nav'
import { LS_KEYS } from '@/domain/constants'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeRecurring, makeSplit, makeTransaction, TODAY } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { getData } from '@/store/appStore'
import { AppFrame, plain, startAt, tearDown, words } from './testing'
import { TransactionSheet } from './TransactionSheet'

const { coffee, eating, groceries, rent } = DEFAULT_CATEGORY_IDS

// Whole flows of taps and typing: room for a busy machine.
vi.setConfig({ testTimeout: 30_000 })

/**
 * October 2026 on Wed 14 Oct (day 14 of 31, 18 days left): 1.000,00 € in, nothing fixed or saved,
 * 300,00 € spent on the 10th and 10,00 € today. Left 690,00 €, 38,88 € a day, 28,88 € left today.
 * The wallet counts from October with 500,00 € opening.
 */
function sampleData(): AppData {
  const base = makeData()
  return {
    ...base,
    settings: { ...base.settings, onboarded: true },
    recurring: [makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job', amounts: [{ from: '2026-08', amount: 100000 }] })],
    transactions: [
      makeTransaction({ id: 'tx-pizza', amount: 30000, categoryId: eating, note: 'Pizza', date: '2026-10-10', createdAt: 1 }),
      makeTransaction({ id: 'tx-today', amount: 1000, categoryId: groceries, note: 'Rewe', date: TODAY, createdAt: 2 }),
      makeTransaction({
        id: 'tx-bar',
        amount: 1800,
        categoryId: eating,
        note: 'Bar',
        date: '2026-08-05',
        createdAt: 0,
        splits: [makeSplit({ id: 's-lea', person: 'Lea', amount: 600 }), makeSplit({ id: 's-max', person: 'Max', amount: 600 })],
      }),
    ],
    wallet: { opening: 50000, startMonth: '2026-10', entries: [], goals: [] },
  }
}

type Route = SheetProps<'transaction'>['route']

function renderSheet(route: Route = { name: 'transaction' }) {
  const onClose = vi.fn<() => void>()
  const setDirty = vi.fn<(dirty: boolean) => void>()
  const view = render(
    <AppFrame>
      <TransactionSheet route={route} onClose={onClose} setDirty={setDirty} />
    </AppFrame>,
  )
  return { onClose, setDirty, unmount: view.unmount }
}

async function typeKeys(user: UserEvent, keys: string): Promise<void> {
  for (const key of keys) await user.click(screen.getByTestId(`keypad-${key === ',' ? 'dec' : key}`))
}

function display(): string {
  return plain(screen.getByTestId('amount-display').textContent)
}

function toastText(): string {
  return words(screen.getByTestId('toast'))
}

function lineText(): string {
  return plain(document.querySelector('[aria-live="polite"]:not([data-testid])')?.textContent)
}

function chip(name: string): HTMLElement {
  return screen.getByRole('tab', { name })
}

beforeEach(() => startAt(sampleData()))
afterEach(tearDown)

describe('a new expense (docs/SPEC.md §3.4)', () => {
  it('adds an expense typed on the keypad and says so', async () => {
    const user = userEvent.setup({ delay: null })
    const { onClose } = renderSheet()
    expect(screen.getByRole('heading', { name: 'New expense' })).toBeInTheDocument()
    const save = screen.getByTestId('sheet-save')
    expect(save).toHaveAccessibleName('Add expense')
    expect(save).toBeDisabled()

    await typeKeys(user, '7,80')
    expect(display()).toBe('Amount 7,80€')
    expect(lineText()).toBe('Leaves 21,08 € for today')

    await user.click(chip('Groceries'))
    expect(chip('Groceries')).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Farmers market')
    expect(screen.queryByTestId('keypad-1')).toBeNull()
    await user.tab()
    expect(screen.getByTestId('keypad-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(save)
    expect(onClose).toHaveBeenCalledTimes(1)
    const added = getData().transactions.at(-1)
    expect(added).toMatchObject({
      kind: 'expense',
      amount: 780,
      categoryId: groceries,
      note: 'Farmers market',
      date: TODAY,
      fromWallet: false,
      splits: [],
    })
    expect(toastText()).toBe('Added 7,80 € to Groceries')
  })

  it('starts with the last category used and no date but today', () => {
    renderSheet()
    expect(chip('Groceries')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('starts with the category it was opened for', () => {
    renderSheet({ name: 'transaction', categoryId: coffee })
    expect(chip('Coffee & snacks')).toHaveAttribute('aria-selected', 'true')
  })

  it("warns past today's allowance and, in critical ink, past the month's money", async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet()
    await typeKeys(user, '30')
    expect(lineText()).toBe("1,12 € over today's budget")
    expect(document.querySelector('[data-icon="warning"]')).not.toBeNull()
    await user.click(screen.getByTestId('keypad-back'))
    await user.click(screen.getByTestId('keypad-back'))
    await typeKeys(user, '700')
    expect(lineText()).toBe("10,00 € over this month's budget")
    expect(document.querySelector('[data-icon="critical"]')).not.toBeNull()
  })

  it('says nothing about today for another date, or before an amount is typed', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet()
    expect(lineText()).toBe('')
    await typeKeys(user, '5')
    expect(lineText()).toBe('Leaves 23,88 € for today')
    await user.click(screen.getByRole('button', { name: 'Yesterday' }))
    expect(lineText()).toBe('')
  })

  it('adds the fixed-only categories with "All categories"', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet()
    expect(screen.queryByRole('tab', { name: 'Rent' })).toBeNull()
    await user.click(chip('All categories'))
    expect(chip('Rent')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'All categories' })).toBeNull()
    await user.click(chip('Rent'))
    expect(chip('Rent')).toHaveAttribute('aria-selected', 'true')
    await typeKeys(user, '1')
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().transactions.at(-1)?.categoryId).toBe(rent)
  })

  it('toasts the month with "Show" when the date is in another month', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet()
    await typeKeys(user, '7,80')
    fireEvent.change(screen.getByLabelText('Other date'), { target: { value: '2026-09-20' } })
    expect(screen.getByLabelText('Other date, Sunday 20 September 2026')).toBeInTheDocument()
    expect(screen.getByText('Sun 20 Sep')).toBeInTheDocument()
    // The picker's Reset leaves the date as it is.
    fireEvent.change(screen.getByLabelText(/^Other date/), { target: { value: '' } })
    expect(screen.getByText('Sun 20 Sep')).toBeInTheDocument()

    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().transactions.at(-1)?.date).toBe('2026-09-20')
    expect(toastText()).toBe('Added 7,80 € to September Show')
    await user.click(within(screen.getByTestId('toast')).getByRole('button', { name: 'Show' }))
    expect(useNav.getState().month).toBe('2026-09')
  })

  it('fills note and amount from what was entered often', async () => {
    const user = userEvent.setup({ delay: null })
    const data = sampleData()
    startAt({
      ...data,
      transactions: [
        ...data.transactions,
        makeTransaction({ id: 'c1', note: 'Cappuccino', amount: 350, categoryId: coffee, date: '2026-10-01', createdAt: 3 }),
        makeTransaction({ id: 'c2', note: 'cappuccino ', amount: 350, categoryId: coffee, date: '2026-10-02', createdAt: 4 }),
      ],
    })
    renderSheet({ name: 'transaction', categoryId: coffee })
    const suggestion = /^cappuccino, 3,50\s€$/u
    await user.click(screen.getByRole('button', { name: suggestion }))
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('cappuccino')
    expect(display()).toBe('Amount 3,50€')
    expect(screen.queryByRole('button', { name: suggestion })).toBeNull()
    // The amount came from elsewhere: the first key replaces it.
    await typeKeys(user, '4')
    expect(display()).toBe('Amount 4€')
  })
})

describe('editing (§3.4)', () => {
  it('replaces the amount with the first key and saves the change', async () => {
    const user = userEvent.setup({ delay: null })
    const { onClose } = renderSheet({ name: 'transaction', id: 'tx-pizza' })
    expect(screen.getByRole('heading', { name: 'Edit expense' })).toBeInTheDocument()
    expect(display()).toBe('Amount 300€')
    // An edit says nothing about today's budget.
    expect(lineText()).toBe('')
    await typeKeys(user, '9,90')
    expect(display()).toBe('Amount 9,90€')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onClose).toHaveBeenCalled()
    expect(getData().transactions.find((tx) => tx.id === 'tx-pizza')).toMatchObject({ amount: 990, note: 'Pizza', categoryId: eating })
    expect(toastText()).toBe('Saved')
  })

  it('edits a pristine amount with backspace', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet({ name: 'transaction', id: 'tx-today' })
    await user.click(screen.getByTestId('keypad-back'))
    expect(display()).toBe('Amount 1€')
  })

  it('deletes with Undo', async () => {
    const user = userEvent.setup({ delay: null })
    const { onClose } = renderSheet({ name: 'transaction', id: 'tx-pizza' })
    await user.click(screen.getByTestId('sheet-delete'))
    expect(onClose).toHaveBeenCalled()
    expect(getData().transactions.some((tx) => tx.id === 'tx-pizza')).toBe(false)
    expect(toastText()).toBe('Deleted Pizza Undo')
    await user.click(within(screen.getByTestId('toast')).getByRole('button', { name: 'Undo' }))
    expect(getData().transactions.some((tx) => tx.id === 'tx-pizza')).toBe(true)
  })

  it('explains an entry that was deleted meanwhile', () => {
    renderSheet({ name: 'transaction', id: 'tx-gone' })
    expect(screen.getByText('This entry no longer exists')).toBeInTheDocument()
    expect(screen.queryByTestId('sheet-save')).toBeNull()
  })
})

describe('paying from the wallet (§3.13, DESIGN.md §9.26)', () => {
  it('shows the wallet after the payment, short in critical ink, and saves it', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet()
    const toggle = screen.getByTestId('pay-from-wallet')
    expect(toggle).not.toBeChecked()
    await typeKeys(user, '120')
    await user.click(toggle)
    expect(screen.getByTestId('wallet-consequence')).toHaveTextContent(/^Wallet after: 380,00\s€$/u)
    await typeKeys(user, '0')
    expect(plain(screen.getByTestId('wallet-consequence').textContent)).toBe('Wallet after: short by 700,00 €')
    expect(screen.getByTestId('wallet-consequence').querySelector('[data-icon="critical"]')).not.toBeNull()
    // Still allowed.
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().transactions.at(-1)).toMatchObject({ amount: 120000, fromWallet: true })
  })

  it('counts an edited payment back in first', async () => {
    const user = userEvent.setup({ delay: null })
    const data = sampleData()
    startAt({
      ...data,
      transactions: [...data.transactions, makeTransaction({ id: 'tx-w', amount: 10000, fromWallet: true, createdAt: 9 })],
    })
    renderSheet({ name: 'transaction', id: 'tx-w' })
    expect(screen.getByTestId('pay-from-wallet')).toBeChecked()
    expect(plain(screen.getByTestId('wallet-consequence').textContent)).toBe('Wallet after: 400,00 €')
    await typeKeys(user, '50')
    expect(plain(screen.getByTestId('wallet-consequence').textContent)).toBe('Wallet after: 450,00 €')
  })
})

describe('splitting the bill (§3.16, EXTRAS.md §2.1 to §2.4)', () => {
  it('splits evenly, keeps the remainder with you and saves what others owe', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet()
    const split = screen.getByTestId('split-toggle')
    expect(split).toBeDisabled()
    await typeKeys(user, '32')
    expect(split).toBeEnabled()
    expect(split).toHaveAttribute('aria-expanded', 'false')
    await user.click(split)
    expect(split).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByTestId('keypad-1')).toBeNull()
    expect(screen.getByRole('group', { name: 'Who owes you' })).toBeInTheDocument()
    // The capsule is the header's action, and it names the panel it opens.
    expect(split.closest('[data-sheet-header]')).not.toBeNull()
    expect(document.getElementById(split.getAttribute('aria-controls') ?? '')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Add person' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveFocus()
    await user.type(name, 'Lea')
    expect(plain(screen.getByTestId('split-share').textContent)).toBe('Your share: 16,00 €')
    await user.click(screen.getByRole('button', { name: 'Split evenly' }))
    // Max split with you before: a chip adds him at once, and the split stays even.
    await user.click(screen.getByRole('button', { name: 'Add Max' }))
    expect(plain(screen.getByTestId('split-share').textContent)).toBe('Your share: 10,68 €')
    expect(screen.getAllByRole('textbox', { name: 'Name' }).map((input) => (input as HTMLInputElement).value)).toEqual(['Lea', 'Max'])

    // Typing an amount by hand ends the even split.
    const maxOwes = screen.getByRole('textbox', { name: 'Max owes' })
    await user.clear(maxOwes)
    await user.type(maxOwes, '8')
    expect(plain(screen.getByTestId('split-share').textContent)).toBe('Your share: 13,34 €')

    // Back to the keypad: the split is kept and the capsule stays tinted.
    await user.click(screen.getByRole('button', { name: /^Amount, 32,00\s€, the whole bill\. Edit amount$/u }))
    expect(screen.getByTestId('keypad-1')).toBeInTheDocument()
    expect(split).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().transactions.at(-1)?.splits.map((s) => [s.person, s.amount, s.status])).toEqual([
      ['Lea', 1066, 'open'],
      ['Max', 800, 'open'],
    ])
    expect(toastText()).toBe('Added 32,00 € to Groceries')
  })

  it('stops saving while others owe more than the bill', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet()
    await typeKeys(user, '18')
    await user.click(screen.getByTestId('split-toggle'))
    await user.click(screen.getByRole('button', { name: 'Add Lea' }))
    const leaOwes = screen.getByRole('textbox', { name: 'Lea owes' })
    await user.clear(leaOwes)
    await user.type(leaOwes, '20')
    expect(plain(screen.getByTestId('split-share').textContent)).toBe('Others owe more than the bill of 18,00 €')
    expect(screen.getByTestId('sheet-save')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Remove Lea' }))
    expect(screen.queryByTestId('split-share')).toBeNull()
    expect(screen.getByTestId('sheet-save')).toBeEnabled()
  })

  it('says under the row when what someone owes is not an amount', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet()
    await typeKeys(user, '18')
    await user.click(screen.getByTestId('split-toggle'))
    await user.click(screen.getByRole('button', { name: 'Add Lea' }))
    const leaOwes = screen.getByRole('textbox', { name: 'Lea owes' })
    await user.clear(leaOwes)
    await user.type(leaOwes, 'abc')
    await user.tab()
    // The amount is a bare cell; its message belongs to the whole person row.
    const row = screen.getByTestId('split-person')
    expect(row.querySelector('[data-row]')).toBeNull()
    expect(row.querySelector('[data-part="error"]')?.textContent).toMatch(/^That isn't an amount\./)
  })

  it('removes a row left without a name', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet()
    await typeKeys(user, '10')
    await user.click(screen.getByTestId('split-toggle'))
    await user.click(screen.getByRole('button', { name: 'Add person' }))
    expect(screen.getAllByTestId('split-person')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Split evenly' }))
    expect(screen.queryAllByTestId('split-person')).toHaveLength(0)
  })
})

describe('one-off income (§3.4)', () => {
  it('has no categories, wallet or split, and adds to its month', async () => {
    const user = userEvent.setup({ delay: null })
    renderSheet({ name: 'transaction', kind: 'income' })
    expect(screen.getByRole('heading', { name: 'One-off income' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByTestId('pay-from-wallet')).toBeNull()
    expect(screen.queryByTestId('split-toggle')).toBeNull()
    await typeKeys(user, '50')
    expect(lineText()).toBe('')
    await user.type(screen.getByRole('textbox', { name: 'From' }), 'Grandma')
    await user.click(screen.getByRole('button', { name: 'Add income' }))
    expect(getData().transactions.at(-1)).toMatchObject({ kind: 'income', amount: 5000, categoryId: null, note: 'Grandma' })
    expect(toastText()).toBe('Added 50,00 € to October')
  })
})

describe('unsaved changes and drafts (§5.10)', () => {
  it('marks the sheet dirty once something would be saved', async () => {
    const user = userEvent.setup({ delay: null })
    const { setDirty } = renderSheet()
    expect(setDirty).toHaveBeenLastCalledWith(false)
    await typeKeys(user, '4')
    expect(setDirty).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByTestId('keypad-back'))
    expect(setDirty).toHaveBeenLastCalledWith(false)
  })

  it('keeps a draft of a new expense and ends it when the sheet closes', async () => {
    const user = userEvent.setup({ delay: null })
    const { unmount } = renderSheet()
    await typeKeys(user, '4,5')
    const draft = JSON.parse(localStorage.getItem(LS_KEYS.draft) ?? 'null') as { route: unknown; fields: { keys: string } }
    expect(draft.route).toEqual({ name: 'transaction' })
    expect(draft.fields.keys).toBe('4.5')
    unmount()
    expect(localStorage.getItem(LS_KEYS.draft)).toBeNull()
  })

  it('reopens with the draft filled in', () => {
    localStorage.setItem(
      LS_KEYS.draft,
      JSON.stringify({
        route: { name: 'transaction' },
        fields: {
          keys: '12.5',
          categoryId: coffee,
          note: 'Bakery',
          date: '2026-10-13',
          fromWallet: false,
          splits: [{ person: 'Lea', amount: 500 }],
          even: false,
          showAllCategories: false,
        },
        savedAt: Date.now(),
      }),
    )
    const { setDirty } = renderSheet()
    expect(display()).toBe('Amount 12,5€')
    expect(chip('Coffee & snacks')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Bakery')
    expect(screen.getByRole('button', { name: 'Yesterday' })).toHaveAttribute('aria-pressed', 'true')
    expect(plain(screen.getByTestId('split-share').textContent)).toBe('Your share: 7,50 €')
    expect(setDirty).toHaveBeenLastCalledWith(true)
  })

  it('removes the draft on Cancel and keeps none for an edit', async () => {
    const user = userEvent.setup({ delay: null })
    const { onClose } = renderSheet()
    await typeKeys(user, '3')
    expect(localStorage.getItem(LS_KEYS.draft)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(localStorage.getItem(LS_KEYS.draft)).toBeNull()
    act(() => undefined)
  })
})
