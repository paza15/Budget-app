import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { vi } from 'vitest'
import { __resetNavForTests } from '@/app/nav'
import { NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { useUiStore } from '@/store/uiStore'
import { MoneyFormatContext } from '@/ui'
import { currentToast, dismissToast } from '@/ui/toast'

/** The app's money settings for the UI kit, as App provides them. */
function Providers({ children }: { children: ReactNode }) {
  const money = useMoneyFormat()
  return <MoneyFormatContext value={money}>{children}</MoneyFormatContext>
}

export function renderWithApp(ui: ReactElement) {
  return render(ui, { wrapper: Providers })
}

export function setData(data: AppData): void {
  useAppStore.setState({ data, status: 'ready' })
}

/** Before each test: the clock on Wed 14 Oct 2026 10:00 (Date only), fresh navigation, `data`. */
export function startTest(data: AppData): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetNavForTests()
  setData(data)
}

/** After each test: no toast, no revealed amounts, initial stores, real clock. */
export function endTest(): void {
  const toast = currentToast()
  if (toast !== null) dismissToast(toast.id)
  __resetNavForTests()
  useUiStore.setState({ amountsRevealed: false })
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
}

/** Intl writes U+00A0 or U+202F before "€"; tests compare with plain spaces. */
export function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}
