import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeSplit } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { OwedCard } from '@/features/owed/OwedCard'
import { bill, owedData } from '@/features/owed/owedTestData'
import { useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { MoneyFormatContext } from '@/ui'

const INTL_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g')
const plain = (text: string | null | undefined): string => (text ?? '').replace(INTL_SPACES, ' ').trim()
const named = (text: string) => (name: string) => plain(name) === text

function WithMoney({ children }: { children: ReactNode }) {
  return <MoneyFormatContext value={useMoneyFormat()}>{children}</MoneyFormatContext>
}

function renderCard(data: AppData = owedData()) {
  useAppStore.setState({ data, status: 'ready' })
  return render(
    <WithMoney>
      <OwedCard />
    </WithMoney>,
  )
}

/** The sample plus Jonas (12,00 € for concert tickets) and Ana (6,40 € for a taxi, no note: Transport). */
function fourPeople(): AppData {
  return owedData((sample) => [
    ...sample,
    bill('tx-concert', 4800, 'Concert tickets', { date: '2026-10-10' }, [makeSplit({ id: 's-jonas', person: 'Jonas', amount: 1200 })]),
    bill('tx-taxi', 1280, '', { categoryId: DEFAULT_CATEGORY_IDS.transport, date: '2026-10-11' }, [
      makeSplit({ id: 's-ana', person: 'Ana', amount: 640 }),
    ]),
  ])
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 10))
  __resetNavForTests()
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('OwedCard (docs/SPEC.md §3.16, EXTRAS.md §2.6)', () => {
  it('is hidden while nobody owes anything', () => {
    const { container } = renderCard(owedData((sample) => sample.filter((tx) => tx.id === 'tx-bowling')))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the open total and each person with a bill or the number of bills', () => {
    renderCard()
    const card = screen.getByTestId('owed-card')
    expect(within(card).getByRole('heading', { level: 2, name: 'Owed to you' })).toBeInTheDocument()
    expect(plain(card.textContent)).toContain('Owed to you25,00 €')
    const people = within(card).getAllByRole('button')
    expect(people.map((button) => plain(button.getAttribute('aria-label')))).toEqual([
      'Max owes you 17,00 €, 2 bills',
      'Lea owes you 8,00 €, Pizza night',
    ])
    expect(plain(people[0]?.textContent)).toBe('MMax17,00 €2 bills')
  })

  it('opens "Owed to you" at the person tapped, through the route', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: named('Max owes you 17,00 €, 2 bills') }))
    expect(useNav.getState().stacks.home).toEqual([{ name: 'owed', person: 'Max' }])
  })

  it('shows the top three people and sums the rest in a last line', async () => {
    const user = userEvent.setup()
    renderCard(fourPeople())
    const rows = screen.getAllByTestId('owed-person')
    expect(rows.map((row) => row.dataset.id)).toEqual(['Max', 'Jonas', 'Lea'])
    expect(screen.getByRole('button', { name: named('Jonas owes you 12,00 €, Concert tickets') })).toBeInTheDocument()
    const more = screen.getByRole('button', { name: named('Plus 6,40 € from 1 more person') })
    await user.click(more)
    // The rest are not one person: the screen opens at its top.
    expect(useNav.getState().stacks.home).toEqual([{ name: 'owed' }])
  })

  it('names a bill without a note by its category', () => {
    renderCard(owedData(() => [bill('tx-taxi', 1280, '', { categoryId: DEFAULT_CATEGORY_IDS.transport }, [makeSplit({ person: 'Ana', amount: 640 })])]))
    expect(screen.getByRole('button', { name: named('Ana owes you 6,40 €, Transport') })).toBeInTheDocument()
  })

  it('hides the amounts while amounts are hidden', () => {
    const data = owedData()
    renderCard({ ...data, settings: { ...data.settings, hideAmounts: true } })
    expect(screen.queryByText(/25,00|17,00/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Max owes you amount hidden, 2 bills' })).toBeInTheDocument()
  })
})
