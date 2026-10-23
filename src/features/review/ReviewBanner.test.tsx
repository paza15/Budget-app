import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeRecurring, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { ReviewBanner } from '@/features/review/ReviewBanner'
import { getData, useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { MoneyFormatContext } from '@/ui'

const INTL_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g')
const plain = (text: string | null | undefined): string => (text ?? '').replace(INTL_SPACES, ' ').trim()

/**
 * Installed in August with 1.450,00 € in and 650,00 € rent; October's daily spending is
 * `octoberDaily`. September is reviewed, so on Sun 1 November October waits for its review.
 */
function closedOctober(octoberDaily: number, settings: Partial<AppData['settings']> = {}): AppData {
  const base = makeData()
  return {
    ...base,
    settings: { ...base.settings, onboarded: true, lastReviewedMonth: '2026-09', ...settings },
    recurring: [
      makeRecurring({ id: 'rec-salary', kind: 'income', amounts: [{ from: '2026-08', amount: 145000 }] }),
      makeRecurring({ id: 'rec-rent', amounts: [{ from: '2026-08', amount: 65000 }] }),
    ],
    transactions: [
      makeTransaction({ id: 'tx-oct', amount: octoberDaily, categoryId: DEFAULT_CATEGORY_IDS.groceries, date: '2026-10-12' }),
    ],
  }
}

function WithMoney({ children }: { children: ReactNode }) {
  return <MoneyFormatContext value={useMoneyFormat()}>{children}</MoneyFormatContext>
}

function renderBanner(data: AppData) {
  useAppStore.setState({ data, status: 'ready' })
  return render(
    <WithMoney>
      <ReviewBanner />
    </WithMoney>,
  )
}

/** The banner in a slot of its own, as the shell's AppBanners portals it into Home's Screen. */
function renderInSlot(data: AppData) {
  useAppStore.setState({ data, status: 'ready' })
  const slot = document.body.appendChild(document.createElement('div'))
  slot.setAttribute('data-banner-slot', '')
  return render(
    <WithMoney>
      <ReviewBanner />
    </WithMoney>,
    { container: slot },
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 1, 10))
  __resetNavForTests()
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('ReviewBanner (docs/SPEC.md §3.15, EXTRAS.md §1.6)', () => {
  it('says the month is closed and what moved to the wallet, as a region named by its first sentence', () => {
    renderBanner(closedOctober(23000))
    const banner = screen.getByRole('region', { name: 'October is closed' })
    expect(banner).toHaveAttribute('data-testid', 'banner-review')
    expect(plain(banner.textContent)).toBe('October is closed. Moved to your wallet: 570,00 €.See the reviewDismiss')
    expect(screen.getByText('October is closed.').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: 'See the review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('says what was taken from the wallet after an overspent month', () => {
    renderBanner(closedOctober(84128))
    expect(plain(screen.getByRole('region').textContent)).toContain('October is closed. Taken from your wallet: 41,28 €.')
  })

  it('leaves the amount out while amounts are hidden', () => {
    renderBanner(closedOctober(23000, { hideAmounts: true }))
    expect(plain(screen.getByRole('region').textContent)).toBe('October is closed.See the reviewDismiss')
  })

  it('shows nothing once the month has been reviewed, or before the wallet counts it', () => {
    renderBanner(closedOctober(23000, { lastReviewedMonth: '2026-10' }))
    expect(screen.queryByRole('region')).toBeNull()
    cleanup()
    const fresh = closedOctober(23000, { lastReviewedMonth: null })
    renderBanner({ ...fresh, wallet: { ...fresh.wallet, startMonth: '2026-11' } })
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('opens the review and records it, so the banner goes behind the sheet', async () => {
    const user = userEvent.setup()
    renderBanner(closedOctober(23000))
    await user.click(screen.getByRole('button', { name: 'See the review' }))
    expect(useNav.getState().sheets.map((entry) => entry.route)).toEqual([{ name: 'monthReview', month: '2026-10' }])
    expect(getData().settings.lastReviewedMonth).toBe('2026-10')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('records the month on Dismiss: the banner does not come back', async () => {
    const user = userEvent.setup()
    renderBanner(closedOctober(23000))
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(getData().settings.lastReviewedMonth).toBe('2026-10')
    expect(screen.queryByRole('region')).toBeNull()
    expect(useNav.getState().sheets).toEqual([])
  })
})

describe('ReviewBanner dismissal (EXTRAS.md §1.9)', () => {
  /** The slot's spacing as src/ui/Screen.module.css gives it: margins of the banners, not padding. */
  const SLOT_CSS = '[data-banner-slot] { display: grid } [data-banner-slot] > :first-child { margin-top: 2px } [data-banner-slot] > :last-child { margin-bottom: 6px }'

  let sheet: HTMLStyleElement
  let keyframes: Keyframe[][]
  let finish: () => void

  // jsdom has no Web Animations API: elements get a stub that records the keyframes and finishes
  // when the test says so.
  beforeEach(() => {
    sheet = document.head.appendChild(document.createElement('style'))
    sheet.textContent = SLOT_CSS
    keyframes = []
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const animate = (frames: Keyframe[] | PropertyIndexedKeyframes | null): Animation => {
      keyframes.push(frames as Keyframe[])
      return { finished, cancel: () => {} } as unknown as Animation
    }
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    sheet.remove()
  })

  it('collapses from the margins the slot gives it to none, then records the month', async () => {
    const user = userEvent.setup()
    renderInSlot(closedOctober(23000))
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(keyframes).toHaveLength(1)
    const [first, last] = [keyframes[0]?.at(0), keyframes[0]?.at(-1)]
    // Its own margins go with it, from where the slot put them: nothing snaps at the start, and the
    // content under the slot rises the whole way without a jump when the banner is removed.
    expect(first).toMatchObject({ marginTop: '2px', marginBottom: '6px', opacity: 1 })
    expect(last).toMatchObject({ height: '0px', marginTop: '0px', marginBottom: '0px', opacity: 0 })
    expect(screen.getByRole('region', { name: 'October is closed' }).closest('[inert]')).not.toBeNull()
    expect(getData().settings.lastReviewedMonth).toBe('2026-09')

    await act(async () => finish())
    expect(getData().settings.lastReviewedMonth).toBe('2026-10')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('only fades with Reduce Motion', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList,
    )
    const user = userEvent.setup()
    renderInSlot(closedOctober(23000))
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(keyframes).toEqual([[{ opacity: 1 }, { opacity: 0 }]])
    await act(async () => finish())
    expect(getData().settings.lastReviewedMonth).toBe('2026-10')
  })
})
