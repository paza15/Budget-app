import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { exportBackup } from '@/features/you/backupIO'
import { useSecurityStore } from '@/store/securityStore'
import { currentToast, dismissToast } from '@/ui/toast'

vi.mock('@/features/you/backupIO', () => ({
  exportBackup: vi.fn<() => Promise<'shared' | 'downloaded' | 'cancelled'>>(),
}))

function Broken(): never {
  throw new Error('Secret detail: 1.234,56 € at Rewe')
}

beforeEach(() => {
  // React reports caught render errors to the console; the fallback is what matters here.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  useSecurityStore.setState({ status: 'ready', locked: false, unlockedOnce: true })
})

afterEach(() => {
  cleanup()
  const shown = currentToast()
  if (shown !== null) dismissToast(shown.id)
  useSecurityStore.setState(useSecurityStore.getInitialState(), true)
})

describe('ErrorBoundary (docs/SPEC.md §3.10)', () => {
  it('replaces the app with a fallback that never shows the error', () => {
    render(
      <ErrorBoundary level="app">
        <Broken />
      </ErrorBoundary>,
    )
    const fallback = screen.getByRole('alert')
    expect(fallback).toHaveTextContent('Something went wrong.')
    expect(fallback).toHaveTextContent('Your entries are still saved on this iPhone.')
    expect(fallback).not.toHaveTextContent(/Secret|Rewe|1\.234/)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeInTheDocument()
  })

  it('goes back from a broken screen and closes a broken sheet', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn<() => void>()
    const onClose = vi.fn<() => void>()
    render(
      <>
        <ErrorBoundary level="screen" onDismiss={onBack}>
          <Broken />
        </ErrorBoundary>
        <ErrorBoundary level="sheet" onDismiss={onClose}>
          <Broken />
        </ErrorBoundary>
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers Reload on a tab root, which has nowhere to go back to', () => {
    render(
      <ErrorBoundary level="screen">
        <Broken />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('hides Export backup while the app is locked', () => {
    useSecurityStore.setState({ locked: true })
    render(
      <ErrorBoundary level="app">
        <Broken />
      </ErrorBoundary>,
    )
    expect(screen.queryByRole('button', { name: 'Export backup' })).toBeNull()
  })

  it('exports a backup from the fallback', async () => {
    const user = userEvent.setup()
    vi.mocked(exportBackup).mockResolvedValue('downloaded')
    render(
      <ErrorBoundary level="app">
        <Broken />
      </ErrorBoundary>,
    )
    await user.click(screen.getByRole('button', { name: 'Export backup' }))
    expect(exportBackup).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(currentToast()?.message).toBe('Backup exported'))
  })

  it('says how to retry when the export fails', async () => {
    const user = userEvent.setup()
    vi.mocked(exportBackup).mockRejectedValue(new Error('denied'))
    render(
      <ErrorBoundary level="app">
        <Broken />
      </ErrorBoundary>,
    )
    await user.click(screen.getByRole('button', { name: 'Export backup' }))
    await waitFor(() => expect(currentToast()?.message).toBe("Couldn't export a backup. Try again from Backup in Settings."))
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeEnabled()
  })

  it('shows nothing for a silent boundary', () => {
    const { container } = render(
      <ErrorBoundary level="silent">
        <Broken />
      </ErrorBoundary>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
