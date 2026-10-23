import { LS_KEYS } from '../src/domain/constants.ts'
import {
  continuePastInstallGate,
  copy,
  euro,
  expect,
  figure,
  finishOnboarding,
  gotoApp,
  isIOS,
  lockSupported,
  storedItem,
  test,
  visible,
  waitForApp,
  waitForSaved,
} from './fixtures.ts'

// Only this spec walks onboarding; the others restore a fixture (docs/SPEC.md §3.9, §9).

test.describe('onboarding', () => {
  test("walks from the install gate to this month's budget", async ({ page }) => {
    await gotoApp(page)
    const onboarding = page.getByTestId('onboarding')
    const gate = page.getByTestId('install-gate')

    // 0. Install first: iOS Safari outside the installed app only.
    const ios = await isIOS(page)
    await expect(gate).toHaveCount(ios ? 1 : 0)
    if (ios) {
      await expect(gate.getByText('Install On a Budget first')).toBeVisible()
      await expect(gate.getByText(copy('Anything you enter here in Safari stays in Safari'))).toBeVisible()
      await gate.getByRole('button', { name: 'Continue in Safari' }).click()
    }

    // 1. Welcome
    await expect(onboarding).toHaveAttribute('data-step', '1')
    await expect(onboarding.getByRole('heading', { name: 'On a Budget', exact: true })).toBeVisible()
    await expect(onboarding.getByText('Your monthly budget, kept on this iPhone.')).toBeVisible()
    await expect(onboarding.getByRole('button', { name: 'Restore from a backup' })).toBeVisible()
    await onboarding.getByRole('button', { name: 'Get started' }).click()

    // 2. About you: the currency follows the de-DE locale and Berlin time zone.
    await expect(onboarding).toHaveAttribute('data-step', '2')
    await onboarding.getByRole('textbox', { name: 'Name' }).fill('Alex')
    await expect(onboarding.getByRole('combobox', { name: 'Currency' }).locator('option:checked')).toHaveText(/Euro|EUR/)
    await onboarding.getByRole('button', { name: 'Continue', exact: true }).click()

    // 3. Money in: one row named "Income", then "Add another".
    await expect(onboarding).toHaveAttribute('data-step', '3')
    await expect(onboarding.getByText('What comes in each month?')).toBeVisible()
    const names = onboarding.getByRole('textbox', { name: 'Name', exact: true })
    const amounts = onboarding.getByRole('textbox', { name: 'Amount', exact: true })
    await expect(names.first()).toHaveValue('Income')
    await amounts.first().fill('1100')
    await onboarding.getByRole('button', { name: 'Add another' }).click()
    await expect(amounts).toHaveCount(2)
    await names.last().fill('Parents')
    await amounts.last().fill('350')
    await onboarding.getByRole('button', { name: 'Continue', exact: true }).click()

    // 4. Fixed costs: Rent, then a suggestion chip adds a named row. Prices are never filled in.
    await expect(onboarding).toHaveAttribute('data-step', '4')
    const rent = onboarding.getByRole('textbox', { name: 'Rent', exact: true })
    await expect(rent).toHaveValue('')
    await rent.fill('640')
    await onboarding.getByRole('button', { name: 'Deutschlandticket', exact: true }).click()
    const ticket = onboarding.getByRole('textbox', { name: 'Deutschlandticket', exact: true })
    await expect(ticket).toHaveValue('')
    await ticket.fill('63')
    await onboarding.getByRole('button', { name: 'Continue', exact: true }).click()

    // 5. Spent so far: today is day 14, so the step shows.
    await expect(onboarding).toHaveAttribute('data-step', '5')
    await expect(onboarding.getByText(/Spent anything since .*1 Oct/)).toBeVisible()
    await expect(onboarding.getByText(copy("A rough total is fine. It keeps this month's numbers honest."))).toBeVisible()
    await onboarding.getByRole('textbox', { name: 'Daily spending so far this month' }).fill('120')
    await onboarding.getByRole('button', { name: 'Continue', exact: true }).click()

    // 6. Lock: offered where a PIN can be hashed; skipped here.
    if (await lockSupported(page)) {
      await expect(onboarding).toHaveAttribute('data-step', '6')
      await expect(onboarding.getByText('Lock the app with a PIN').first()).toBeVisible()
      await onboarding.getByRole('button', { name: 'Not now' }).click()
    }

    // 7. Done: 1.450,00 € in, 703,00 € fixed, 120,00 € spent → 627,00 € left.
    await expect(onboarding).toHaveAttribute('data-step', '7')
    await expect(onboarding.getByText(euro('627,00')).first()).toBeVisible()
    await onboarding.getByRole('button', { name: 'Start budgeting' }).click()

    const home = page.getByTestId('screen-home')
    await expect(visible(page)).toHaveAttribute('data-testid', 'screen-home')
    await expect(home.getByText('Hi, Alex')).toBeVisible()
    await expect(home.getByText('Left to spend', { exact: true })).toBeVisible()
    await expect(home.getByTestId('hero-left')).toHaveText(figure('627,00'))
    await expect(home.getByTestId('hero-per-day')).toHaveText(copy('About 34,83 € a day for the next 18 days'))
    await expect(home.getByTestId('hero-today')).toHaveText(copy('Today: 34,83 € left'))
    await expect.poll(() => storedItem(page, LS_KEYS.onboardingStep)).toBeNull()
  })

  test('skipping every step still opens Home', async ({ page }) => {
    await gotoApp(page)
    await finishOnboarding(page)

    const home = page.getByTestId('screen-home')
    await expect(home.getByText('Hi there')).toBeVisible()
    await expect(home.getByText('Spent this month', { exact: true })).toBeVisible()
    await expect(home.getByTestId('hero-left')).toHaveText(figure('0,00'))
    await expect(home.getByRole('button', { name: 'Add your income' })).toBeVisible()
  })

  test('a relaunch resumes at the step reached', async ({ page }) => {
    await gotoApp(page)
    await continuePastInstallGate(page)
    const onboarding = page.getByTestId('onboarding')
    await onboarding.getByRole('button', { name: 'Get started' }).click()
    await expect(onboarding).toHaveAttribute('data-step', '2')
    await onboarding.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(onboarding).toHaveAttribute('data-step', '3')

    await waitForSaved(page)
    await page.reload()
    await waitForApp(page)
    await expect(onboarding).toHaveAttribute('data-step', '3')
    await expect(onboarding.getByText('What comes in each month?')).toBeVisible()
  })
})
