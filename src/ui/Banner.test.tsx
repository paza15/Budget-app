import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Banner } from '@/ui/Banner'

// docs/DESIGN.md §9.19 and docs/design/EXTRAS.md §1.6, §1.8.

afterEach(cleanup)

/** The UI icon a banner draws. */
function iconOf(testId: string): string | null | undefined {
  return screen.getByTestId(testId).querySelector('svg')?.getAttribute('data-icon')
}

describe('Banner', () => {
  it('announces critical banners as alerts and the others as status messages, each with its icon', () => {
    render(
      <>
        <Banner tone="info" data-testid="info">
          A new version of On a Budget is ready.
        </Banner>
        <Banner tone="warning" data-testid="warning">
          Skipped 3 damaged entries.
        </Banner>
        <Banner tone="warning" icon="backup" data-testid="backup">
          Your entries are only on this iPhone.
        </Banner>
        <Banner tone="critical" data-testid="critical">
          Couldn&apos;t save your last changes.
        </Banner>
      </>,
    )
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('critical'))
    expect(screen.getAllByRole('status')).toHaveLength(3)
    expect(['info', 'warning', 'backup', 'critical'].map(iconOf)).toEqual(['reload', 'warning', 'backup', 'critical'])
    for (const banner of screen.getAllByRole('status')) {
      expect(banner.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('offers its action and "Not now"', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn<() => void>()
    const onDismiss = vi.fn<() => void>()
    render(
      <Banner tone="warning" action={{ label: 'Export backup', onClick }} onDismiss={onDismiss}>
        Your entries are only on this iPhone.
      </Banner>,
    )
    await user.click(screen.getByRole('button', { name: 'Export backup' }))
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('shows no actions row without actions', () => {
    render(<Banner tone="critical">The app isn&apos;t saving.</Banner>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  describe("tone 'statement' (the month-end review)", () => {
    it('is statement paper with the 22px Closed seal in place of an icon, hidden from VoiceOver', () => {
      render(
        <Banner tone="statement" icon="backup" data-testid="banner-review">
          <strong>October is closed.</strong> Moved to your wallet: 132,82 €.
        </Banner>,
      )
      const banner = screen.getByRole('status')
      expect(banner).toBe(screen.getByTestId('banner-review'))
      expect(banner).toHaveAttribute('data-tone', 'statement')
      const seal = banner.querySelector('svg[data-engraving="seal"]')
      expect(seal).toHaveAttribute('width', '22')
      expect(seal).toHaveAttribute('height', '22')
      expect(seal).toHaveAttribute('aria-hidden', 'true')
      // The seal is the statement's mark: an icon asked for is not drawn.
      expect(banner.querySelector('svg[data-icon]')).toBeNull()
      expect(banner).toHaveTextContent('October is closed. Moved to your wallet: 132,82 €.')
    })

    it('becomes a region named by its label, with "See the review" and "Dismiss"', async () => {
      const user = userEvent.setup()
      const open = vi.fn<() => void>()
      const dismiss = vi.fn<() => void>()
      render(
        <Banner
          tone="statement"
          label="October is closed"
          action={{ label: 'See the review', onClick: open }}
          onDismiss={dismiss}
          dismissLabel="Dismiss"
        >
          <strong>October is closed.</strong> Moved to your wallet: 132,82 €.
        </Banner>,
      )
      const banner = screen.getByRole('region', { name: 'October is closed' })
      expect(screen.queryByRole('status')).toBeNull()
      await user.click(within(banner).getByRole('button', { name: 'See the review' }))
      await user.click(within(banner).getByRole('button', { name: 'Dismiss' }))
      expect(open).toHaveBeenCalledTimes(1)
      expect(dismiss).toHaveBeenCalledTimes(1)
    })
  })
})
