import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav, type RouteProps } from '@/app/nav'
import type { AppData, SplitStatus } from '@/domain/types'
import { OwedScreen } from '@/features/owed/OwedScreen'
import { owedData } from '@/features/owed/owedTestData'
import { getData, useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { ConfirmHost, MoneyFormatContext } from '@/ui'
import { currentToast, dismissToast } from '@/ui/toast'

const INTL_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g')
const plain = (text: string | null | undefined): string => (text ?? '').replace(INTL_SPACES, ' ').trim()
/** Matches an accessible name or description written with plain spaces. */
const named = (text: string) => (name: string) => plain(name) === text

function WithMoney({ children }: { children: ReactNode }) {
  return <MoneyFormatContext value={useMoneyFormat()}>{children}</MoneyFormatContext>
}

/**
 * "Owed to you" pushed on Home (or on settings), with the dialogs App renders beside it; `person`
 * as a person row of the Home card asks for (ScreenStack passes the route's fields as props).
 */
function renderOwed(data: AppData = owedData(), from: 'home' | 'settings' = 'home', person?: string) {
  useAppStore.setState({ data, status: 'ready' })
  if (from === 'settings') useNav.getState().push({ name: 'you' })
  const props: RouteProps<'owed'> = person === undefined ? {} : { person }
  useNav.getState().push({ name: 'owed', ...props })
  return render(
    <WithMoney>
      <div id="app-root">
        <OwedScreen {...props} />
      </div>
      <ConfirmHost />
    </WithMoney>,
  )
}

/** The screen's scroller: the kit Screen's box around its nav row, banner slot and content. */
function scroller(): HTMLElement {
  const slot = document.querySelector('[data-banner-slot]')
  if (slot?.parentElement == null) throw new Error('no Screen')
  return slot.parentElement
}

/** jsdom lays nothing out: each person's section starts this far below the top of the scroller. */
const SECTION_TOPS: Readonly<Record<string, number>> = { Max: 180, Lea: 640 }

function layOutSections(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
    const top = SECTION_TOPS[this.dataset.person ?? ''] ?? 0
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
  })
}

function statusOf(transactionId: string, splitId: string): SplitStatus | undefined {
  return getData()
    .transactions.find((tx) => tx.id === transactionId)
    ?.splits.find((split) => split.id === splitId)?.status
}

/** The value a total is fading out, while it fades. */
function outgoing(total: HTMLElement): Element | null {
  return total.querySelector('[data-crossfade="out"]')
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name: named(name) })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 10))
  __resetNavForTests()
})

afterEach(async () => {
  const toast = currentToast()
  if (toast !== null) dismissToast(toast.id)
  // Answered dialogs fade out before the next test.
  await waitFor(() => {
    if (document.querySelector('[data-dialog-scrim]') !== null) throw new Error('A dialog is still on screen.')
  })
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('OwedScreen (docs/SPEC.md §3.16, EXTRAS.md §2.7)', () => {
  it('shows the total and who owes what, largest first, newest bill first', () => {
    renderOwed()
    expect(screen.getByRole('heading', { level: 1, name: 'Owed to you' })).toBeInTheDocument()
    expect(plain(screen.getByTestId('owed-total').textContent)).toContain('25,00')
    expect(screen.getByText('2 people owe you for 2 bills.')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.dataset.focusKey)).toEqual([
      'person:Max',
      'person:Lea',
    ])
    expect(screen.getByRole('heading', { level: 2, name: named('Max, 17,00 €') })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: named('Lea, 8,00 €') })).toBeInTheDocument()

    const max = section('Max, 17,00 €')
    const rows = within(max).getAllByTestId('owed-item')
    expect(rows.map((row) => row.dataset.id)).toEqual(['tx-bar:s-bar-max', 'tx-pizza:s-pizza-max'])
    expect(plain(rows[0]?.textContent)).toBe('Bar with friends9,00 €Sat 17 Octof 18,00 €Bar with friends, 9,00 €Paid backForgive')
    expect(within(max).getByRole('button', { name: 'Mark all as paid' })).toBeInTheDocument()
    // One bill: nothing to mark all.
    expect(within(section('Lea, 8,00 €')).queryByRole('button', { name: 'Mark all as paid' })).toBeNull()
    expect(
      screen.getByText('Your budget counts only your share. Forgiving a split counts it as your own spending again.'),
    ).toBeInTheDocument()
  })

  it('describes Paid back and Forgive by their item', () => {
    renderOwed()
    const [paid] = within(section('Max, 17,00 €')).getAllByRole('button', { name: 'Paid back' })
    const [forgive] = within(section('Max, 17,00 €')).getAllByRole('button', { name: 'Forgive' })
    if (paid === undefined || forgive === undefined) throw new Error('no actions')
    // The visible names stay (Voice Control), the item describes them.
    expect(paid).toHaveAccessibleDescription(/^Bar with friends, 9,00\s€$/)
    expect(forgive).toHaveAccessibleDescription(/^Bar with friends, 9,00\s€$/)
  })

  it('marks an item paid back at once, with Undo', async () => {
    const user = userEvent.setup()
    renderOwed()
    const before = getData()
    const [paid] = within(section('Max, 17,00 €')).getAllByRole('button', { name: 'Paid back' })
    if (paid === undefined) throw new Error('no Paid back')
    await user.click(paid)
    expect(statusOf('tx-bar', 's-bar-max')).toBe('paid')
    await waitFor(() => expect(plain(currentToast()?.message)).toBe('Max paid back 9,00 €'))
    expect(screen.getByRole('heading', { level: 2, name: named('Max, 8,00 €') })).toBeInTheDocument()
    expect(screen.getByText('2 people owe you for 1 bill.')).toBeInTheDocument()

    currentToast()?.action?.onClick()
    expect(getData()).toBe(before)
    expect(await screen.findByRole('heading', { level: 2, name: named('Max, 17,00 €') })).toBeInTheDocument()
  })

  it('moves focus to the next Paid back, or to the nearest person when a section goes', async () => {
    const user = userEvent.setup()
    renderOwed()
    const [first, second] = within(section('Max, 17,00 €')).getAllByRole('button', { name: 'Paid back' })
    if (first === undefined || second === undefined) throw new Error('no Paid back')
    await user.click(first)
    await waitFor(() => expect(second).toHaveFocus())

    await user.click(within(section('Lea, 8,00 €')).getByRole('button', { name: 'Paid back' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: named('Max, 8,00 €') })).toHaveFocus())
  })

  it('asks before forgiving, as a primary action, then offers Undo', async () => {
    const user = userEvent.setup()
    renderOwed()
    const [forgive] = within(section('Max, 17,00 €')).getAllByRole('button', { name: 'Forgive' })
    if (forgive === undefined) throw new Error('no Forgive')

    await user.click(forgive)
    let dialog = await screen.findByRole('alertdialog', { name: named('Forgive 9,00 €?') })
    expect(dialog).toHaveAccessibleDescription('It counts as your own spending again.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(statusOf('tx-bar', 's-bar-max')).toBe('open')
    await waitFor(() => expect(document.querySelector('[data-dialog-scrim]')).toBeNull())

    await user.click(forgive)
    dialog = await screen.findByRole('alertdialog', { name: named('Forgive 9,00 €?') })
    const confirm = within(dialog).getByRole('button', { name: 'Forgive' })
    expect(confirm).toHaveAttribute('data-variant', 'primary')
    await user.click(confirm)
    await waitFor(() => expect(statusOf('tx-bar', 's-bar-max')).toBe('forgiven'))
    await waitFor(() => expect(plain(currentToast()?.message)).toBe('Forgave Max 9,00 €'))
    expect(currentToast()?.action?.label).toBe('Undo')
  })

  it("names each person's heading as one string, with no space before the comma (EXTRAS.md §2.8)", () => {
    renderOwed()
    const [max, lea] = screen.getAllByRole('heading', { level: 2 })
    expect(plain(max?.getAttribute('aria-label'))).toBe('Max, 17,00 €')
    expect(plain(lea?.getAttribute('aria-label'))).toBe('Lea, 8,00 €')
    expect(max?.querySelector('.visually-hidden')).toBeNull()
  })

  it('crossfades a changed total, and lets go of the old value however its fade ends', async () => {
    const user = userEvent.setup()
    renderOwed()
    const total = screen.getByTestId('owed-total')
    const max = screen.getByRole('heading', { level: 2, name: named('Max, 17,00 €') })
    const [paid] = within(section('Max, 17,00 €')).getAllByRole('button', { name: 'Paid back' })
    if (paid === undefined) throw new Error('no Paid back')
    await user.click(paid)
    // The screen total is the kit's TotalFigure: the figure, its unit set apart with a margin (no
    // space before "€"), then the amount in words for a reader.
    await waitFor(() => expect(total.querySelector('[data-crossfade="in"]')).toHaveTextContent(/^16,00€16,00\s€$/))
    expect(outgoing(total)).toHaveTextContent(/^25,00€25,00\s€$/)
    expect(outgoing(max)).toHaveTextContent(/^17,00\s€$/)

    // The fade is cut short: display: none (another screen pushed on top) cancels it, and no
    // animationend follows. The old value goes all the same, never to stay hidden in the cell.
    // (jsdom has no AnimationEvent, so React's animationend handler cannot be reached here.)
    fireEvent(outgoing(total)!, new Event('animationcancel', { bubbles: true }))
    expect(outgoing(total)).toBeNull()
    expect(plain(total.textContent)).toBe('16,00 €16,00€16,00 €')
    fireEvent(outgoing(max)!, new Event('animationcancel', { bubbles: true }))
    expect(outgoing(max)).toBeNull()
    expect(plain(max.textContent)).toBe('MMax8,00 €')
  })

  it('marks all of a person as paid in one go', async () => {
    const user = userEvent.setup()
    renderOwed()
    await user.click(within(section('Max, 17,00 €')).getByRole('button', { name: 'Mark all as paid' }))
    expect(statusOf('tx-bar', 's-bar-max')).toBe('paid')
    expect(statusOf('tx-pizza', 's-pizza-max')).toBe('paid')
    expect(statusOf('tx-pizza', 's-pizza-lea')).toBe('open')
    await waitFor(() => expect(plain(currentToast()?.message)).toBe('Max paid back 17,00 €'))
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.dataset.focusKey)).toEqual(['person:Lea'])
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: named('Lea, 8,00 €') })).toHaveFocus())
    expect(screen.getByText('Lea owes you for 1 bill.')).toBeInTheDocument()
  })

  it('keeps settled splits collapsed under Settled until asked', async () => {
    const user = userEvent.setup()
    renderOwed()
    const settled = screen.getByRole('button', { name: 'Settled, 1' })
    expect(settled).toHaveAttribute('aria-expanded', 'false')
    expect(settled).not.toHaveAttribute('aria-controls')
    expect(screen.queryByTestId('owed-settled-item')).toBeNull()
    await user.click(settled)
    expect(settled).toHaveAttribute('aria-expanded', 'true')
    // The kit's disclosure row: it names the list it shows.
    const list = document.getElementById(settled.getAttribute('aria-controls') ?? '')
    expect(list).toContainElement(screen.getByTestId('owed-settled-item'))
    expect(plain(screen.getByTestId('owed-settled-item').textContent)).toBe('Bowling12,00 €Jonas paid back Thu 1 Octof 24,00 €')
  })

  it('says nobody owes anything when everything is settled, and still lists what was', () => {
    renderOwed(
      owedData((sample) =>
        sample.map((tx) => ({
          ...tx,
          splits: tx.splits.map((split) =>
            split.status === 'open' ? { ...split, status: 'forgiven' as const, settledAt: Date.UTC(2026, 9, 3, 10) } : split,
          ),
        })),
      ),
    )
    expect(screen.getByRole('heading', { name: 'Nobody owes you anything' })).toBeInTheDocument()
    expect(screen.getByText('When you split a bill, what others owe you shows up here.')).toBeInTheDocument()
    expect(screen.queryByTestId('owed-total')).toBeNull()
    expect(screen.getByRole('button', { name: 'Settled, 4' })).toBeInTheDocument()
    expect(screen.getByText(/Your budget counts only your share/)).toBeInTheDocument()
  })

  it('shows only the empty state without any split', () => {
    renderOwed(owedData(() => []))
    expect(screen.getByRole('heading', { name: 'Nobody owes you anything' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Settled/ })).toBeNull()
    expect(screen.queryByText(/Your budget counts only your share/)).toBeNull()
  })

  it('goes back to Home, or to Settings when it came from there', async () => {
    const user = userEvent.setup()
    renderOwed()
    await user.click(screen.getByRole('button', { name: 'Back to Home' }))
    expect(useNav.getState().stacks.home).toEqual([])
    cleanup()

    renderOwed(owedData(), 'settings')
    await user.click(screen.getByRole('button', { name: 'Back to Settings' }))
    expect(useNav.getState().stacks.home).toEqual([{ name: 'you' }])
  })

  it('opens scrolled to the person the Home card asked for', () => {
    layOutSections()
    renderOwed(owedData(), 'home', 'Max')
    expect(scroller().scrollTop).toBe(180)
    cleanup()

    renderOwed(owedData(), 'home', 'Lea')
    expect(scroller().scrollTop).toBe(640)
  })

  it('starts at the top without a person (from settings), or when that person owes nothing now', () => {
    layOutSections()
    renderOwed(owedData(), 'settings')
    expect(scroller().scrollTop).toBe(0)
    cleanup()

    renderOwed(owedData(), 'home', 'Jonas')
    expect(scroller().scrollTop).toBe(0)
  })

  it('hides every amount while amounts are hidden', async () => {
    const user = userEvent.setup()
    const data = owedData()
    renderOwed({ ...data, settings: { ...data.settings, hideAmounts: true } })
    expect(screen.queryByText(/17,00|25,00|9,00/)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Max, amount hidden' })).toBeInTheDocument()
    const [paid] = within(section('Max, amount hidden')).getAllByRole('button', { name: 'Paid back' })
    if (paid === undefined) throw new Error('no Paid back')
    await user.click(paid)
    await waitFor(() => expect(currentToast()?.message).toBe('Max paid back •••'))
  })
})
