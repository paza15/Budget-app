import { act, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { __resetNavForTests } from '@/app/nav'
import { NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { useUiStore } from '@/store/uiStore'
import { ConfirmHost, MoneyFormatContext, ToastHost } from '@/ui'
import { answerDialog, currentDialog, removeDialog } from '@/ui/dialogs'
import { currentToast, dismissToast } from '@/ui/toast'

/**
 * Test setup for the daily feature's component tests: what App puts around every screen (the
 * user's money format, the toasts and the dialogs), a store with the given data at the e2e clock
 * (Wed 14 Oct 2026, 10:00 in Berlin), and a reset after each test.
 */

export function AppFrame({ children }: { children?: ReactNode }) {
  return (
    <MoneyFormatContext value={useMoneyFormat()}>
      {children}
      <ToastHost />
      <ConfirmHost />
    </MoneyFormatContext>
  )
}

export function startAt(data: AppData): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  __resetNavForTests()
  useUiStore.setState({ amountsRevealed: false })
  useAppStore.setState({ data, status: 'ready' })
}

export async function tearDown(): Promise<void> {
  cleanup()
  for (let dialog = currentDialog(); dialog !== null; dialog = currentDialog()) {
    answerDialog(dialog.id, null)
    removeDialog(dialog.id)
  }
  const shown = currentToast()
  if (shown !== null) dismissToast(shown.id)
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  localStorage.clear()
  vi.useRealTimers()
  // Toasts and dialogs that were leaving finish before the next test.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

/** Text with every run of spaces (Intl's U+00A0 and U+202F included) as one plain space. */
export function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/gu, ' ').trim()
}

/** The words an element shows, each text node apart: "Brezel 3,50 € Coffee & snacks". */
export function words(element: Element): string {
  const texts: string[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = plain(node.nodeValue)
    if (text !== '') texts.push(text)
  }
  return texts.join(' ')
}
