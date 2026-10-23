import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useImperativeHandle, useRef, type Ref } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withUndo } from '@/app/undo'
import { BEFORE_APP_NOTE, LS_KEYS } from '@/domain/constants'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeRecurring, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData, SecurityConfig } from '@/domain/types'
import { registerBiometric } from '@/features/lock/biometric'
import { lockSupport } from '@/features/lock/pin'
import { Onboarding } from '@/features/onboarding/Onboarding'
import { importWithConfirm } from '@/features/you/backupIO'
import { getData, useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { updateSecurity, useSecurityStore } from '@/store/securityStore'
import { ConfirmHost, MoneyFormatContext, ToastHost } from '@/ui'
import { currentToast, dismissToast } from '@/ui/toast'

// docs/SPEC.md §3.9, e2e/onboarding.spec.ts and e2e/README.md ("What the specs assume").

vi.mock('@/features/lock/pin', () => ({
  lockSupport: vi.fn<() => { pin: boolean; biometric: () => Promise<boolean> }>(() => ({
    pin: true,
    biometric: () => Promise.resolve(false),
  })),
}))

vi.mock('@/features/lock/biometric', () => ({
  registerBiometric: vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)),
}))

/** The lock feature's PIN setup, reduced to its two outcomes. */
vi.mock('@/features/lock/PinSetupFlow', () => ({
  PinSetupFlow: ({ onDone }: { onDone(): void; onCancel(): void }) => (
    <button type="button" onClick={onDone}>
      Set the PIN
    </button>
  ),
}))

vi.mock('@/features/you/backupIO', () => ({
  importWithConfirm: vi.fn<(file: File, o?: { continueOnboarding?: boolean }) => Promise<boolean>>(() =>
    Promise.resolve(false),
  ),
  BackupFileInput: ({ onFile, ref }: { onFile(file: File): void; ref?: Ref<HTMLInputElement> }) => {
    const input = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => input.current as HTMLInputElement, [])
    return (
      <input
        ref={input}
        type="file"
        data-testid="backup-file-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) onFile(file)
        }}
      />
    )
  },
}))

vi.mock('@/store/securityStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/securityStore')>()),
  updateSecurity: vi.fn<(patch: Partial<SecurityConfig>) => Promise<void>>(() => Promise.resolve()),
}))

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'

/** Onboarding as App shows it: with the money format, toasts and dialogs; "Home" once onboarded. */
function TestApp() {
  const onboarded = useAppStore((s) => s.data.settings.onboarded)
  const money = useMoneyFormat()
  return (
    <MoneyFormatContext value={money}>
      {onboarded ? <p>Home</p> : <Onboarding />}
      <ToastHost />
      <ConfirmHost />
    </MoneyFormatContext>
  )
}

function start(patch: Partial<AppData> = {}) {
  act(() => useAppStore.setState({ data: makeData(patch), status: 'ready' }))
  return render(<TestApp />)
}

function onboarding(): HTMLElement {
  return screen.getByTestId('onboarding')
}

function stored(): string | null {
  return localStorage.getItem(LS_KEYS.onboardingStep)
}

/** No pause between keys: these tests type a lot, and the timers are real. */
function setupUser() {
  return userEvent.setup({ delay: null })
}

function textbox(name: string): HTMLInputElement {
  return screen.getByRole('textbox', { name }) as HTMLInputElement
}

/** A step's large title. */
function title(name: string): HTMLElement {
  return screen.getByRole('heading', { level: 1, name })
}

/** Money in's "Savings you already have" (§3.12). */
function savings(): HTMLInputElement {
  return textbox('Savings you already have')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // Wed 14 Oct 2026, day 14 of 31
  localStorage.clear()
  vi.mocked(lockSupport).mockReturnValue({ pin: true, biometric: () => Promise.resolve(false) })
})

afterEach(() => {
  cleanup()
  const shown = currentToast()
  if (shown !== null) dismissToast(shown.id)
  vi.restoreAllMocks()
  vi.mocked(importWithConfirm).mockReset().mockResolvedValue(false)
  vi.mocked(registerBiometric).mockReset().mockResolvedValue(null)
  vi.mocked(updateSecurity).mockClear()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useSecurityStore.setState(useSecurityStore.getInitialState(), true)
  localStorage.clear()
  vi.useRealTimers()
})

describe('Onboarding (docs/SPEC.md §3.9)', () => {
  it('walks from Welcome to Done and writes every step through actions', async () => {
    const user = setupUser()
    start()

    // 1. Welcome
    expect(onboarding()).toHaveAttribute('data-step', '1')
    expect(screen.getByRole('heading', { level: 1, name: 'On a Budget' })).toBeInTheDocument()
    expect(screen.getByText('Your monthly budget, kept on this iPhone.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore from a backup' })).toBeEnabled()
    expect(screen.getByTestId('backup-file-input')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Get started' }))

    // 2. About you: the currency the store chose for a German phone in Berlin.
    expect(onboarding()).toHaveAttribute('data-step', '2')
    expect(stored()).toBe('2')
    expect(screen.getByText('Step 2 of 7')).toBeInTheDocument()
    const currency = screen.getByRole('combobox', { name: 'Currency' })
    expect(within(currency).getByRole('option', { selected: true })).toHaveTextContent('Euro (EUR)')
    await user.type(textbox('Name'), 'Alex')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(getData().settings.name).toBe('Alex')

    // 3. Money in: one row named "Income", then "Add another".
    expect(onboarding()).toHaveAttribute('data-step', '3')
    expect(screen.getByText('What comes in each month?')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox', { name: 'Name' }).map((field) => (field as HTMLInputElement).value)).toEqual(['Income'])
    await user.type(textbox('Amount'), '1100')
    await user.click(screen.getByRole('button', { name: 'Add another' }))
    const names = screen.getAllByRole('textbox', { name: 'Name' })
    expect(names).toHaveLength(2)
    expect(names[1]).toHaveFocus()
    await user.keyboard('Parents')
    await user.type(screen.getAllByRole('textbox', { name: 'Amount' })[1]!, '350')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // 4. Fixed costs: Rent first, then a suggestion chip adds a named row; no prices.
    expect(onboarding()).toHaveAttribute('data-step', '4')
    expect(textbox('Rent')).toHaveValue('')
    await user.type(textbox('Rent'), '640')
    await user.click(screen.getByRole('button', { name: 'Deutschlandticket' }))
    expect(screen.queryByRole('button', { name: 'Deutschlandticket' })).toBeNull()
    expect(textbox('Deutschlandticket')).toHaveFocus()
    expect(textbox('Deutschlandticket')).toHaveValue('')
    await user.keyboard('63')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // 5. Spent so far: day 14, so it shows.
    expect(onboarding()).toHaveAttribute('data-step', '5')
    expect(screen.getByRole('heading', { level: 1, name: 'Spent anything since 1 Oct?' })).toBeInTheDocument()
    expect(screen.getByText("A rough total is fine. It keeps this month's numbers honest.")).toBeInTheDocument()
    await user.type(textbox('Daily spending so far this month'), '120')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // 6. Lock, skipped.
    expect(onboarding()).toHaveAttribute('data-step', '6')
    expect(screen.getByRole('heading', { level: 1, name: 'Lock the app with a PIN' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Not now' }))

    // 7. Done: 1.450,00 € in, 703,00 € fixed, 120,00 € spent.
    expect(onboarding()).toHaveAttribute('data-step', '7')
    expect(screen.getByText('Left to spend')).toBeInTheDocument()
    expect(onboarding()).toHaveTextContent(/627,00\s*€/)
    expect(onboarding()).toHaveTextContent(/About 34,83\s*€ a day for the next 18 days\./)
    expect(getData().settings.onboarded).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Start budgeting' }))

    expect(screen.getByText('Home')).toBeInTheDocument()
    const data = getData()
    expect(data.settings.onboarded).toBe(true)
    expect(stored()).toBeNull()
    expect(data.recurring.map((item) => [item.kind, item.name, item.categoryId, item.amounts, item.startMonth])).toEqual([
      ['income', 'Income', null, [{ from: '2026-10', amount: 110000 }], '2026-10'],
      ['income', 'Parents', null, [{ from: '2026-10', amount: 35000 }], '2026-10'],
      ['expense', 'Rent', DEFAULT_CATEGORY_IDS.rent, [{ from: '2026-10', amount: 64000 }], '2026-10'],
      ['expense', 'Deutschlandticket', DEFAULT_CATEGORY_IDS.transport, [{ from: '2026-10', amount: 6300 }], '2026-10'],
    ])
    expect(data.transactions).toEqual([
      expect.objectContaining({ amount: 12000, categoryId: DEFAULT_CATEGORY_IDS.other, date: '2026-10-01', note: BEFORE_APP_NOTE }),
    ])
  }, 20_000)

  it('asks to install first in iOS Safari, and "Continue in Safari" goes on to Welcome for good', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI)
    const user = setupUser()
    start()
    expect(onboarding()).toHaveAttribute('data-step', '0')
    const gate = screen.getByTestId('install-gate')
    expect(within(gate).getByText('Install On a Budget first')).toBeInTheDocument()
    await user.click(within(gate).getByRole('button', { name: 'Continue in Safari' }))
    expect(onboarding()).toHaveAttribute('data-step', '1')
    expect(stored()).toBe('1')

    // A relaunch in Safari does not ask again.
    cleanup()
    render(<TestApp />)
    expect(onboarding()).toHaveAttribute('data-step', '1')
  })

  it('resumes at the step reached', () => {
    localStorage.setItem(LS_KEYS.onboardingStep, '3')
    start()
    expect(onboarding()).toHaveAttribute('data-step', '3')
    expect(screen.getByText('What comes in each month?')).toBeInTheDocument()
  })

  it("moves focus to each step's title as it opens, going forward and back", async () => {
    const user = setupUser()
    localStorage.setItem(LS_KEYS.onboardingStep, '2')
    start()
    expect(title('About you')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(title('What comes in each month?')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(title('What goes out each month?')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(title('What comes in each month?')).toHaveFocus()
    // A heading VoiceOver can land on, never a stop for the Tab key.
    expect(title('What comes in each month?')).toHaveAttribute('tabindex', '-1')
  })

  it('keeps what a step holds when going Back, and shows it again', async () => {
    const user = setupUser()
    localStorage.setItem(LS_KEYS.onboardingStep, '4')
    start()
    await user.type(textbox('Rent'), '640')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onboarding()).toHaveAttribute('data-step', '3')
    expect(stored()).toBe('3')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onboarding()).toHaveAttribute('data-step', '4')
    // Intl puts a no-break space before the unit.
    expect(textbox('Rent').value).toMatch(/^640,00\s€$/)
    expect(getData().recurring).toHaveLength(1)
  })

  it('edits and deletes what earlier visits created, and "Skip for now" changes nothing', async () => {
    const user = setupUser()
    localStorage.setItem(LS_KEYS.onboardingStep, '3')
    start({
      recurring: [
        makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job', startMonth: '2026-10', amounts: [{ from: '2026-10', amount: 100000 }] }),
        makeRecurring({ id: 'rec-parents', kind: 'income', name: 'Parents', startMonth: '2026-10', amounts: [{ from: '2026-10', amount: 35000 }], order: 1 }),
      ],
    })
    expect(screen.getAllByRole('textbox', { name: 'Name' }).map((field) => (field as HTMLInputElement).value)).toEqual(['Job', 'Parents'])
    const before = getData()
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(onboarding()).toHaveAttribute('data-step', '4')
    expect(getData()).toBe(before)

    await user.click(screen.getByRole('button', { name: 'Back' }))
    const amounts = screen.getAllByRole('textbox', { name: 'Amount' })
    await user.clear(amounts[1]!)
    await user.clear(amounts[0]!)
    await user.type(amounts[0]!, '1200')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(getData().recurring.map((item) => [item.id, item.amounts])).toEqual([['rec-job', [{ from: '2026-10', amount: 120000 }]]])
  })

  it('takes "Savings you already have" on Money in as the opening of the wallet (§3.12)', async () => {
    const user = setupUser()
    localStorage.setItem(LS_KEYS.onboardingStep, '3')
    start()
    expect(savings()).toHaveValue('')
    expect(screen.getByText('Money you have saved already. It starts your wallet.')).toBeInTheDocument()
    // Its own name: each income row still has exactly one field named "Amount" (e2e/onboarding.spec.ts).
    expect(screen.getAllByRole('textbox', { name: 'Amount' })).toHaveLength(1)

    await user.type(savings(), '500')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onboarding()).toHaveAttribute('data-step', '4')
    expect(getData().wallet.opening).toBe(50000)

    // Back and forward again: the step shows what it saved. Back saves as well.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onboarding()).toHaveAttribute('data-step', '3')
    expect(savings().value).toMatch(/^500,00\s€$/)
    await user.clear(savings())
    await user.type(savings(), '650')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(getData().wallet.opening).toBe(65000)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onboarding()).toHaveAttribute('data-step', '3')
    expect(savings().value).toMatch(/^650,00\s€$/)

    // Emptied, it goes back to 0.
    await user.clear(savings())
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(getData().wallet.opening).toBe(0)
  })

  it('"Skip for now" leaves the savings as they were', async () => {
    const user = setupUser()
    localStorage.setItem(LS_KEYS.onboardingStep, '3')
    start()
    await user.type(textbox('Savings you already have'), '500')
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(onboarding()).toHaveAttribute('data-step', '4')
    expect(getData().wallet.opening).toBe(0)
  })

  it('skips Spent so far on the first day of the period and the lock where no PIN can be hashed', async () => {
    vi.setSystemTime(new Date(2026, 9, 1, 9))
    vi.mocked(lockSupport).mockReturnValue({ pin: false, biometric: () => Promise.resolve(false) })
    const user = setupUser()
    localStorage.setItem(LS_KEYS.onboardingStep, '4')
    start()
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(onboarding()).toHaveAttribute('data-step', '7')
    // Nothing came in: Done says so, as Home will.
    expect(screen.getByText('Spent this month')).toBeInTheDocument()
    expect(screen.queryByText('This month')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onboarding()).toHaveAttribute('data-step', '4')
  })

  it('offers Face ID after the PIN and turns it on with the passkey', async () => {
    vi.mocked(lockSupport).mockReturnValue({ pin: true, biometric: () => Promise.resolve(true) })
    vi.mocked(registerBiometric).mockResolvedValueOnce(null).mockResolvedValueOnce('credential-1')
    const user = setupUser()
    localStorage.setItem(LS_KEYS.onboardingStep, '6')
    start()
    await user.click(screen.getByRole('button', { name: 'Set the PIN' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Unlock with Face ID' })).toBeInTheDocument()

    // Cancelled in the system sheet: it says so and stays.
    await user.click(screen.getByRole('button', { name: 'Use Face ID' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Face ID wasn't turned on.")
    expect(updateSecurity).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Use Face ID' }))
    expect(await screen.findByRole('heading', { level: 1, name: "You're all set" })).toBeInTheDocument()
    expect(onboarding()).toHaveAttribute('data-step', '7')
    expect(updateSecurity).toHaveBeenCalledWith({ biometricCredentialId: 'credential-1' })
  })

  it('says the lock is on when a PIN was set before the step', async () => {
    act(() => useSecurityStore.setState({ config: { ...useSecurityStore.getState().config, pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==' } }))
    const user = setupUser()
    localStorage.setItem(LS_KEYS.onboardingStep, '6')
    start()
    expect(screen.getByText(/App lock is on/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set the PIN' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onboarding()).toHaveAttribute('data-step', '7')
  })

  it('restores a backup, goes on at the lock step, and Undo starts again at Welcome', async () => {
    const user = setupUser()
    start()
    const before = getData()
    const restored = makeData({
      settings: { ...before.settings, name: 'Sam', onboarded: false },
      recurring: [makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job', startMonth: '2026-10', amounts: [{ from: '2026-10', amount: 90000 }] })],
    })
    // What importWithConfirm does once the user said Replace (src/features/you/backupIO.ts).
    vi.mocked(importWithConfirm).mockImplementation(async () => {
      await withUndo('Backup restored', () => useAppStore.setState({ data: restored }), { durationMs: 10_000 })
      return true
    })

    await user.upload(screen.getByTestId('backup-file-input'), new File(['{}'], 'on-a-budget-backup.json'))
    expect(importWithConfirm).toHaveBeenCalledWith(expect.any(File), { continueOnboarding: true })
    expect(onboarding()).toHaveAttribute('data-step', '6')
    expect(getData()).toBe(restored)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(getData()).toBe(before)
    expect(onboarding()).toHaveAttribute('data-step', '1')
    expect(stored()).toBe('1')
  })

  it('stays on Welcome when the restore is cancelled', async () => {
    const user = setupUser()
    start()
    await user.upload(screen.getByTestId('backup-file-input'), new File(['{}'], 'backup.json'))
    expect(importWithConfirm).toHaveBeenCalledTimes(1)
    expect(onboarding()).toHaveAttribute('data-step', '1')
    expect(screen.getByRole('button', { name: 'Restore from a backup' })).toBeEnabled()
  })

  it('shows the over-budget state on Done when fixed costs are more than the income', () => {
    localStorage.setItem(LS_KEYS.onboardingStep, '7')
    start({
      recurring: [
        makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job', startMonth: '2026-10', amounts: [{ from: '2026-10', amount: 50000 }] }),
        makeRecurring({ id: 'rec-rent', startMonth: '2026-10', amounts: [{ from: '2026-10', amount: 64000 }] }),
      ],
    })
    expect(screen.getByText('Over budget by')).toBeInTheDocument()
    expect(onboarding()).toHaveTextContent(/140,00\s*€/)
    expect(screen.getByText("Fixed costs and savings are more than this month's income.")).toBeInTheDocument()
  })
})
