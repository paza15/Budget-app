import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests } from '@/app/nav'
import { makeData, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import { lockSupport } from '@/features/lock/pin'
import { DiagnosticsScreen } from '@/features/you/DiagnosticsScreen'
import { useAppStore } from '@/store/appStore'
import { useStorageStatus } from '@/store/persistence'

vi.mock('@/features/lock/pin', () => ({
  lockSupport: vi.fn<() => { pin: boolean; biometric: () => Promise<boolean> }>(),
}))

/** The value a row shows: the row's text after its title. */
function valueOf(title: string): string {
  const row = screen.getByText(title, { exact: true }).closest('[data-row]')
  if (row === null) throw new Error(`No row "${title}"`)
  return (row.textContent ?? '').slice(title.length)
}

beforeEach(() => {
  useAppStore.setState({
    data: makeData({ transactions: [makeTransaction({ amount: 123456 })] }),
    status: 'ready',
  })
  useStorageStatus.setState({ phase: 'write-failed', persisted: false, saving: true, error: "Couldn't save your last changes." })
  vi.mocked(lockSupport).mockReturnValue({ pin: true, biometric: () => Promise.resolve(true) })
  __resetNavForTests()
})

afterEach(() => {
  cleanup()
  useStorageStatus.setState(useStorageStatus.getInitialState(), true)
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('DiagnosticsScreen (docs/SPEC.md §3.7)', () => {
  it('shows how the app runs here', async () => {
    render(<DiagnosticsScreen />)
    expect(screen.getByRole('heading', { name: 'Diagnostics', level: 1 })).toBeInTheDocument()
    expect(valueOf('Version')).toMatch(/^\d+\.\d+\.\d+$/)
    expect(valueOf('Build')).toBe('Development server')
    expect(valueOf('Secure context')).toMatch(/^(Yes|No)$/)
    expect(valueOf('Standalone')).toBe('Not reported')
    expect(valueOf('Safe area top')).toBe('0 px')
    expect(valueOf('Window')).toBe(`${window.innerWidth} × ${window.innerHeight} px`)
    expect(valueOf('Visual viewport height')).toBe(`${window.innerHeight} px`)
    expect(valueOf('Visual viewport top')).toBe('0 px')
    expect(await screen.findByText('Yes', { selector: '[data-row] *' })).toBeInTheDocument()
    expect(valueOf('Face ID or Touch ID')).toBe('Yes')
  })

  it('shows the storage phase, protection and the last error', () => {
    render(<DiagnosticsScreen />)
    expect(valueOf('Phase')).toBe('Write failed')
    expect(valueOf('Saving now')).toBe('Yes')
    expect(valueOf('Protected from cleanup')).toBe('No')
    expect(valueOf('Last storage error')).toBe("Couldn't save your last changes.")
  })

  it('tells where there are no service workers', () => {
    render(<DiagnosticsScreen />)
    expect(valueOf('Supported')).toBe('No')
    expect(valueOf('Controls this page')).toBe('No')
  })

  it('says Unknown when Face ID cannot be checked', async () => {
    vi.mocked(lockSupport).mockImplementation(() => {
      throw new Error('not available')
    })
    render(<DiagnosticsScreen />)
    expect(await screen.findByText('Unknown')).toBeInTheDocument()
  })

  it('follows the window as it changes size', () => {
    render(<DiagnosticsScreen />)
    const height = window.innerHeight
    act(() => {
      Object.defineProperty(window, 'innerHeight', { value: height - 300, configurable: true })
      window.dispatchEvent(new Event('resize'))
    })
    expect(valueOf('Window')).toBe(`${window.innerWidth} × ${height - 300} px`)
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
  })

  it('never shows an amount', () => {
    const { container } = render(<DiagnosticsScreen />)
    expect(container.textContent).not.toMatch(/€|1\.234,56|1234,56|1,234\.56/)
  })
})
