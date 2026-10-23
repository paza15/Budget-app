import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LS_KEYS } from '@/domain/constants'
import { InstallHint, installHintPending } from '@/features/pwa/InstallHint'
import { cssRule, readSibling } from '@/ui/testing/css'

// docs/SPEC.md §3.9 step 0 (the gate), §3.10 (the Home banner) and §3.7 About (the inline guide).

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

/** Storage that throws, as Safari's does with blocked site data. */
function blocked(): never {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}

function useDevice(userAgent: string, o: { standalone?: boolean } = {}): void {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  if (o.standalone) {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          media: query,
          matches: query.includes('(display-mode: standalone)'),
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    )
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('gate', () => {
  it('asks to install first and lists the four iOS steps', () => {
    useDevice(IPHONE_SAFARI)
    render(<InstallHint variant="gate" />)
    const gate = screen.getByTestId('install-gate')
    expect(screen.getByRole('region', { name: 'Install On a Budget first' })).toBe(gate)
    expect(within(gate).getByRole('heading', { level: 1, name: 'Install On a Budget first' })).toBeVisible()
    expect(gate).toHaveTextContent(
      "The app keeps your money data inside the Home Screen app. Anything you enter here in Safari stays in Safari, and Safari can clear it if you don't visit for a while.",
    )
    const steps = within(gate).getByRole('list', { name: 'How to install' })
    const items = within(steps).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent(/tap\s*•••\s*More next to the address bar, or Share if you see it/)
    expect(items[1]).toHaveTextContent('Tap Share, then Add to Home Screen. It may be under View More.')
    expect(items[2]).toHaveTextContent('Leave Open as Web App on and tap Add.')
    expect(items[3]).toHaveTextContent('Open On a Budget from your Home Screen.')
  })

  it('reads the ••• button as "More"', () => {
    render(<InstallHint variant="gate" />)
    const dots = screen.getAllByText('•••')[0]
    expect(dots).toHaveAttribute('aria-hidden', 'true')
    expect(dots?.nextElementSibling).toHaveTextContent('More')
    expect(dots?.nextElementSibling).toHaveClass('visually-hidden')
  })

  it('keeps the step numbers readable', () => {
    render(<InstallHint variant="gate" />)
    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.firstElementChild?.textContent)).toEqual(['1', '2', '3', '4'])
    for (const item of items) expect(item.firstElementChild).not.toHaveAttribute('aria-hidden')
  })

  it('goes on with "Continue in Safari"', async () => {
    const onContinue = vi.fn<() => void>()
    render(<InstallHint variant="gate" onContinue={onContinue} />)
    await userEvent.click(screen.getByRole('button', { name: 'Continue in Safari' }))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('shows wherever the caller puts it, even in the installed app', () => {
    useDevice(IPHONE_SAFARI, { standalone: true })
    render(<InstallHint variant="gate" />)
    expect(screen.getByTestId('install-gate')).toBeInTheDocument()
  })

  it('fills the area it is given, not the viewport, so a banner above it never hides its button', () => {
    // App puts the gate in its content area, under the banner outlet (docs/SPEC.md §5.6); jsdom has
    // no layout, so this reads the rule as written.
    const gate = cssRule(readSibling(import.meta.url, 'InstallHint.module.css'), '.gate')
    expect(gate.height).toBe('100%')
    expect(gate).toMatchObject({ display: 'flex', 'flex-direction': 'column' })
  })
})

describe('banner', () => {
  it('tells Safari users how to install and what happens to entries made in Safari', () => {
    useDevice(IPHONE_SAFARI)
    render(<InstallHint variant="banner" />)
    const banner = screen.getByTestId('banner-install')
    expect(banner).toHaveTextContent(
      /Install On a Budget: tap\s*•••\s*More\s*\(or Share\), then Share, then Add to Home Screen\. Entries made in Safari stay in Safari, and Safari may delete them after a week without use\./,
    )
    expect(banner).toHaveTextContent(
      'Already added entries here? Export a backup in Safari, then import it in the installed app.',
    )
  })

  it('stays dismissed', async () => {
    useDevice(IPHONE_SAFARI)
    const { unmount } = render(<InstallHint variant="banner" />)
    await userEvent.click(within(screen.getByTestId('banner-install')).getByRole('button', { name: "Don't show again" }))
    expect(screen.queryByTestId('banner-install')).not.toBeInTheDocument()
    expect(localStorage.getItem(LS_KEYS.installHintDismissed)).toBe('1')

    unmount()
    render(<InstallHint variant="banner" />)
    expect(screen.queryByTestId('banner-install')).not.toBeInTheDocument()
  })

  it('stays hidden once dismissed earlier (e2e fixtures rely on this)', () => {
    useDevice(IPHONE_SAFARI)
    localStorage.setItem(LS_KEYS.installHintDismissed, '1')
    render(<InstallHint variant="banner" />)
    expect(screen.queryByTestId('banner-install')).not.toBeInTheDocument()
  })

  it('is not shown in the installed app or off iOS', () => {
    useDevice(IPHONE_SAFARI, { standalone: true })
    const { unmount } = render(<InstallHint variant="banner" />)
    expect(screen.queryByTestId('banner-install')).not.toBeInTheDocument()
    unmount()
    vi.restoreAllMocks()

    useDevice(ANDROID_CHROME)
    render(<InstallHint variant="banner" />)
    expect(screen.queryByTestId('banner-install')).not.toBeInTheDocument()
  })

  it('still shows and dismisses when storage is blocked', async () => {
    useDevice(IPHONE_SAFARI)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    render(<InstallHint variant="banner" />)
    await userEvent.click(within(screen.getByTestId('banner-install')).getByRole('button'))
    expect(screen.queryByTestId('banner-install')).not.toBeInTheDocument()
  })

  it('tells the shell when it was dismissed, after keeping the dismissal', async () => {
    useDevice(IPHONE_SAFARI)
    const onDismiss = vi.fn<() => void>(() => {
      expect(localStorage.getItem(LS_KEYS.installHintDismissed)).toBe('1')
    })
    render(<InstallHint variant="banner" onDismiss={onDismiss} />)
    await userEvent.click(within(screen.getByTestId('banner-install')).getByRole('button', { name: "Don't show again" }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('installHintPending', () => {
  it('is true in iOS Safari until the hint is dismissed', () => {
    useDevice(IPHONE_SAFARI)
    expect(installHintPending()).toBe(true)
    localStorage.setItem(LS_KEYS.installHintDismissed, '1')
    expect(installHintPending()).toBe(false)
  })

  it('is false in the installed app and off iOS', () => {
    useDevice(IPHONE_SAFARI, { standalone: true })
    expect(installHintPending()).toBe(false)
    vi.restoreAllMocks()
    useDevice(ANDROID_CHROME)
    expect(installHintPending()).toBe(false)
  })

  it('is true when storage is blocked, as the banner then shows', () => {
    useDevice(IPHONE_SAFARI)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    expect(installHintPending()).toBe(true)
  })
})

describe('inline', () => {
  it('shows the steps under a group title, with where the app runs now', () => {
    useDevice(IPHONE_SAFARI)
    const { container } = render(<InstallHint variant="inline" />)
    expect(screen.getByRole('heading', { level: 2, name: 'How to install' })).toBeVisible()
    const steps = screen.getByRole('list', { name: 'How to install' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(4)
    expect(within(steps).getAllByRole('listitem')[3]).toHaveTextContent('4Open On a Budget from your Home Screen.')
    expect(container).toHaveTextContent("You're in Safari now. Entries made here stay in Safari.")
    expect(screen.queryByTestId('install-gate')).not.toBeInTheDocument()
    expect(screen.queryByTestId('banner-install')).not.toBeInTheDocument()
  })

  it('says so in the installed app', () => {
    useDevice(IPHONE_SAFARI, { standalone: true })
    const { container } = render(<InstallHint variant="inline" />)
    expect(container).toHaveTextContent("You're using the installed app.")
  })

  it('points other devices to Safari on iPhone', () => {
    useDevice(ANDROID_CHROME)
    const { container } = render(<InstallHint variant="inline" />)
    expect(container).toHaveTextContent('These steps are for Safari on iPhone.')
  })

  it('passes className to its root', () => {
    const { container } = render(<InstallHint variant="inline" className="spaced" />)
    expect(container.firstElementChild).toHaveClass('spaced')
  })
})
