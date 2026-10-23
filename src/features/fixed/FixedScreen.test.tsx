import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { createMoneyFormat } from '@/domain/money'
import { makeData, makeRecurring, makeTransaction, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData, Recurring } from '@/domain/types'
import { FixedScreen } from '@/features/fixed/FixedScreen'
import { getData, useAppStore } from '@/store/appStore'
import { MoneyFormatContext } from '@/ui'

// Today is Wednesday 14 October 2026 (NOW); October is the current period.

const C = DEFAULT_CATEGORY_IDS

function cost(id: string, name: string, categoryId: string, amount: number, dueDay: number | null, order: number, patch: Partial<Recurring> = {}): Recurring {
  return makeRecurring({ id, name, categoryId, amounts: [{ from: '2026-09', amount }], startMonth: '2026-09', dueDay, order, ...patch })
}

/** The sample month: 778,88 € of fixed costs, Rent and Deutschlandticket paid, insurance set aside. */
function sample(patch: Partial<AppData> = {}): AppData {
  const data = makeData()
  return {
    ...data,
    settings: { ...data.settings, onboarded: true, lastReviewedMonth: '2026-09' },
    recurring: [
      makeRecurring({ id: 'job', kind: 'income', name: 'Job', amounts: [{ from: '2026-09', amount: 110000 }], startMonth: '2026-09', dueDay: 1, order: 0 }),
      makeRecurring({ id: 'parents', kind: 'income', name: 'Parents', amounts: [{ from: '2026-09', amount: 35000 }], startMonth: '2026-09', dueDay: 1, order: 1 }),
      cost('rent', 'Rent', C.rent, 64000, 1, 2),
      cost('ticket', 'Deutschlandticket', C.transport, 6300, 1, 3),
      cost('gym', 'Gym', C.subscriptions, 2990, 1, 4),
      cost('spotify', 'Spotify', C.subscriptions, 1199, 5, 5),
      cost('netflix', 'Netflix', C.subscriptions, 1399, 22, 6),
      cost('phone', 'Phone', C.phone, 1500, 28, 7),
      cost('insurance', 'Liability insurance', C.insurance, 6000, 15, 8, { everyMonths: 12, spread: true }),
    ],
    months: { '2026-10': { overrides: { job: { paid: true }, rent: { paid: true }, ticket: { paid: true } } } },
    ...patch,
  }
}

/** Text with every kind of space as one plain space (Intl puts a no-break space before "€"). */
function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim()
}

function sentence(): string {
  const lede = document.querySelector('p')
  return text(lede)
}

function row(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-testid="recurring-row"][data-id="${id}"]`)
  if (found === null) throw new Error(`no row ${id}`)
  return found
}

function renderFixed(masked = false) {
  const money = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked })
  return render(
    <MoneyFormatContext value={money}>
      <FixedScreen />
    </MoneyFormatContext>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetNavForTests()
  useNav.setState({ tab: 'fixed' })
  useAppStore.setState({ data: sample(), status: 'ready' })
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('Fixed → Costs (docs/SPEC.md §3.5)', () => {
  it('sums the month and counts only charge lines that are not skipped', () => {
    renderFixed()
    expect(sentence()).toBe('778,88 € this month, 2 of 6 paid')
    expect(screen.getByTestId('fixed-segment')).toHaveAccessibleName('Costs or income')
    expect(screen.getByRole('radio', { name: 'Costs' })).toBeChecked()
  })

  it('groups rows under their categories in category order, each with its subtotal', () => {
    renderFixed()
    const headers = screen.getAllByRole('heading', { level: 2 }).map(text)
    expect(headers).toEqual([
      'Rent 640,00 €',
      'Subscriptions 55,88 €',
      'Transport 63,00 €',
      'Phone & internet 15,00 €',
      'Insurance 5,00 €',
    ])
    expect(text(row('netflix'))).toContain('Due on the 22nd')
    expect(text(row('netflix'))).toContain('13,99 €')
    expect(text(screen.getByTestId('fixed-total'))).toBe('Total 778,88 €')
    expect(screen.getByText(/^Fixed costs count in full from the first day of the month, paid or not\./)).toBeInTheDocument()
  })

  it('shows a spread item’s monthly share without a check', () => {
    renderFixed()
    const insurance = row('insurance')
    expect(text(insurance)).toContain('Set aside 5,00 € this month')
    expect(within(insurance).queryByTestId('recurring-paid')).toBeNull()
  })

  it('ticks a fixed cost off as paid, and back', async () => {
    const user = userEvent.setup()
    renderFixed()
    const check = within(row('netflix')).getByTestId('recurring-paid')
    expect(check).toHaveAccessibleName('Mark Netflix as paid')
    expect(check).toHaveAttribute('aria-pressed', 'false')
    await user.click(check)
    expect(getData().months['2026-10']?.overrides?.netflix).toEqual({ paid: true })
    expect(check).toHaveAccessibleName('Netflix paid')
    expect(sentence()).toBe('778,88 € this month, 3 of 6 paid')
    await user.click(check)
    expect(getData().months['2026-10']?.overrides?.netflix).toBeUndefined()
    expect(sentence()).toBe('778,88 € this month, 2 of 6 paid')
  })

  it('strikes a skipped cost through and leaves it out of the count', () => {
    const data = sample()
    useAppStore.setState({
      data: { ...data, months: { '2026-10': { overrides: { ...data.months['2026-10']?.overrides, gym: { skipped: true } } } } },
    })
    renderFixed()
    expect(text(row('gym'))).toContain('Skipped this month')
    expect(text(row('gym'))).toContain('29,90 €')
    expect(within(row('gym')).queryByTestId('recurring-paid')).toBeNull()
    expect(sentence()).toBe('748,98 € this month, 2 of 5 paid')
  })

  it('opens a row in the recurring sheet', async () => {
    const user = userEvent.setup()
    renderFixed()
    await user.click(within(row('phone')).getByText('Phone', { exact: true }))
    expect(useNav.getState().sheets.map((s) => s.route)).toEqual([{ name: 'recurring', id: 'phone', kind: 'expense' }])
  })

  it('filters one category by due date, with a "Today" divider and the category row', async () => {
    const user = userEvent.setup()
    renderFixed()
    await user.click(screen.getByRole('tab', { name: 'Subscriptions' }))
    expect(screen.getByRole('tab', { name: 'Subscriptions' })).toHaveAttribute('aria-selected', 'true')
    const categoryRow = screen.getByRole('button', { name: /^Subscriptions/ })
    expect(categoryRow).toHaveTextContent(/^Subscriptions\s*55,88\s€ this month$/)

    const rows = [...document.querySelectorAll('[data-testid="recurring-row"]')]
    expect(rows.map((r) => r.getAttribute('data-id'))).toEqual(['gym', 'spotify', 'netflix'])
    // Gym (1st) and Spotify (5th) are due before today, Netflix (22nd) is still to come.
    const divider = screen.getByText('Today', { exact: true })
    expect(rows[1]?.nextElementSibling).toBe(divider)
    expect(text(screen.getByTestId('fixed-total'))).toBe('Total 55,88 €')
    // The sentence still sums the month.
    expect(sentence()).toBe('778,88 € this month, 2 of 6 paid')

    await user.click(categoryRow)
    expect(useNav.getState().stacks.fixed).toEqual([{ name: 'category', categoryId: C.subscriptions }])
  })

  it('adds a fixed cost, in the selected chip’s category', async () => {
    const user = userEvent.setup()
    renderFixed()
    await user.click(screen.getAllByRole('button', { name: 'Add fixed cost' })[0] as HTMLElement)
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'recurring', kind: 'expense' })

    await user.click(screen.getByRole('tab', { name: 'Transport' }))
    await user.click(screen.getAllByRole('button', { name: 'Add fixed cost' })[1] as HTMLElement)
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({
      name: 'recurring',
      kind: 'expense',
      preset: { categoryId: C.transport },
    })
  })

  it('keeps items without a line this month in a collapsed group', async () => {
    const user = userEvent.setup()
    const data = sample()
    useAppStore.setState({
      data: {
        ...data,
        recurring: [
          ...data.recurring,
          cost('club', 'Climbing club', C.other, 2500, 1, 9, { endMonth: '2026-09' }),
          cost('flat', 'New flat', C.rent, 70000, 1, 10, { startMonth: '2027-01', amounts: [{ from: '2027-01', amount: 70000 }] }),
        ],
      },
    })
    renderFixed()
    const toggle = screen.getByRole('button', { name: /^Not this month/ })
    expect(toggle).toHaveAccessibleName('Not this month 2 items')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(row('club')).not.toBeVisible()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(row('club')).toBeVisible()
    expect(text(row('flat'))).toContain('Starts January 2027')
    expect(text(row('club'))).toContain('Ended September')
    // Upcoming first.
    const ids = [...document.querySelectorAll('[data-testid="recurring-row"]')].map((r) => r.getAttribute('data-id'))
    expect(ids.slice(-2)).toEqual(['flat', 'club'])
    // They count nothing this month.
    expect(sentence()).toBe('778,88 € this month, 2 of 6 paid')
  })

  it('names other months in the sentence', () => {
    act(() => useNav.getState().setMonth('2026-11'))
    renderFixed()
    expect(sentence()).toBe('778,88 € in November, 0 of 6 paid')
    expect(text(row('insurance'))).toContain('Set aside 5,00 € in November')
    // No divider outside the current month.
    expect(screen.queryByText('Today', { exact: true })).toBeNull()
  })

  it('hides every amount while amounts are hidden', () => {
    renderFixed(true)
    expect(sentence()).toBe('••• this month, 2 of 6 paid')
    expect(text(screen.getByTestId('fixed-total'))).toBe('Total •••')
    expect(within(row('netflix')).getAllByRole('img', { name: 'Amount hidden' }).length).toBeGreaterThan(0)
  })

  it('offers the eye button while Hide amounts is on', () => {
    const data = sample()
    useAppStore.setState({ data: { ...data, settings: { ...data.settings, hideAmounts: true } } })
    renderFixed(true)
    expect(screen.getByRole('button', { name: 'Show amounts' })).toBeInTheDocument()
  })
})

describe('Fixed → Costs, empty (§3.5)', () => {
  beforeEach(() => {
    const data = sample()
    useAppStore.setState({ data: { ...data, recurring: data.recurring.filter((r) => r.kind === 'income') } })
  })

  it('invites the first fixed cost with suggestions that never fill in a price', async () => {
    const user = userEvent.setup()
    renderFixed()
    expect(screen.getByText('Add rent, subscriptions and other costs that repeat every month.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Netflix' }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({
      name: 'recurring',
      kind: 'expense',
      preset: { name: 'Netflix', categoryId: C.subscriptions, everyMonths: 1 },
    })
    await user.click(screen.getByRole('button', { name: 'Insurance' }))
    expect(useNav.getState().sheets.at(-1)?.route).toMatchObject({ preset: { name: 'Insurance', everyMonths: 12 } })
  })

  it('has no sentence, chips or total yet', () => {
    renderFixed()
    expect(screen.queryByTestId('fixed-total')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})

describe('Fixed → Income (§3.5)', () => {
  beforeEach(() => {
    const data = sample()
    useAppStore.setState({
      data: {
        ...data,
        transactions: [makeTransaction({ id: 'gift', kind: 'income', amount: 5000, note: 'Grandma', date: '2026-10-12' })],
      },
    })
    useNav.getState().setFixedSegment('income')
  })

  it('sums recurring and one-off income', () => {
    renderFixed()
    expect(sentence()).toBe('1.500,00 € this month')
    expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked()
    const headers = screen.getAllByRole('heading', { level: 2 }).map(text)
    expect(headers).toEqual(['Recurring 1.450,00 €', 'One-off this month 50,00 €'])
  })

  it('ticks recurring income off as received', async () => {
    const user = userEvent.setup()
    renderFixed()
    expect(text(row('job'))).toContain('Arrives on the 1st')
    expect(within(row('job')).getByTestId('recurring-paid')).toHaveAccessibleName('Job received')
    const parents = within(row('parents')).getByTestId('recurring-paid')
    expect(parents).toHaveAccessibleName('Mark Parents as received')
    await user.click(parents)
    expect(getData().months['2026-10']?.overrides?.parents).toEqual({ paid: true })
  })

  it('opens one-off income and both add buttons in their sheets', async () => {
    const user = userEvent.setup()
    renderFixed()
    await user.click(screen.getByRole('button', { name: /^Grandma/ }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'transaction', id: 'gift', kind: 'income' })
    await user.click(screen.getAllByRole('button', { name: 'Add income' })[1] as HTMLElement)
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'recurring', kind: 'income' })
    await user.click(screen.getByRole('button', { name: 'Add one-off income' }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'transaction', kind: 'income' })
  })

  it('switches back to costs', async () => {
    const user = userEvent.setup()
    renderFixed()
    await user.click(screen.getByRole('radio', { name: 'Costs' }))
    expect(useNav.getState().fixedSegment).toBe('costs')
    expect(sentence()).toBe('778,88 € this month, 2 of 6 paid')
  })
})
