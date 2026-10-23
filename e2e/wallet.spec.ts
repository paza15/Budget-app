import { type Locator } from '@playwright/test'
import {
  byId,
  copy,
  euro,
  expect,
  figure,
  fillAmount,
  gotoTab,
  monthTitle,
  openAddSheet,
  seed,
  setSwitch,
  sheet,
  test,
  toast,
  typeAmount,
  typeKeys,
  writeNote,
} from './fixtures.ts'

// The Wallet (docs/SPEC.md §3.12 to §3.14, DESIGN.md §9.26). In two-months the wallet counts from
// September, the month Alex started: September closed with 246,02 € (100,00 € of savings plus
// 146,02 € left over), so the wallet holds 246,02 €, and October adds 469,97 € when it closes
// (100,00 € plus the 369,97 € left).

/** A goal's row, found by the name its button starts with ("Bike, 246,02 € of 300,00 €, …"). */
function goalRow(wallet: Locator, name: string): Locator {
  return wallet.getByTestId('goal-row').filter({ has: wallet.page().getByRole('button', { name: new RegExp(`^${name},`) }) })
}

test.describe('wallet', () => {
  test('the Home card shows the balance and opens the Wallet with its passbook', async ({ page }) => {
    await seed(page, 'two-months')
    const home = page.getByTestId('screen-home')
    const card = home.getByTestId('wallet-card')
    await expect(home.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible()
    await expect(card.getByTestId('wallet-card-balance')).toHaveText(copy('246,02 €'))
    await expect(card.getByTestId('wallet-card-line')).toHaveText(copy('October adds 469,97 € when it closes'))
    await expect(card).toHaveAccessibleName(copy('Wallet, 246,02 €. October adds 469,97 € when it closes.'))

    await card.click()
    const wallet = page.getByTestId('screen-wallet')
    await expect(wallet).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('tab-wallet')).toHaveAttribute('aria-current', 'page')
    await expect(wallet.getByTestId('wallet-balance')).toHaveText(figure('246,02'))
    await expect(wallet.getByTestId('wallet-pending')).toHaveText(copy('October adds 469,97 € when it closes'))

    // One line so far: September's closing, with its amount and the balance after it.
    const passbook = wallet.getByRole('table', { name: 'Passbook' })
    await expect(wallet.getByTestId('wallet-row')).toHaveCount(1)
    const september = byId(wallet, 'wallet-row', 'month:2026-09')
    await expect(september).toHaveAttribute('data-kind', 'month')
    await expect(september).toContainText('September closed')
    await expect(september).toContainText(copy('+246,02'))
    const line = passbook.getByRole('button', { name: copy('30 September, September closed, plus 246,02 €, balance 246,02 €') })
    await expect(line).toBeVisible()

    // A month's line comes from the month itself: it opens that month on Home.
    await line.click()
    await expect(home).toHaveAttribute('data-active', 'true')
    await expect(home.getByTestId('month-label')).toHaveText(monthTitle('September'))
    await expect(home.getByText('Left over', { exact: true })).toBeVisible()
    await expect(home.getByTestId('hero-left')).toHaveText(figure('146,02'))
    await expect(card.getByTestId('wallet-card-line')).toHaveText(copy('September added 246,02 €'))
  })

  test('adds money and takes money out, line by line in the passbook, with Undo', async ({ page }) => {
    await seed(page, 'two-months')
    const wallet = await gotoTab(page, 'wallet')
    const balance = wallet.getByTestId('wallet-balance')
    const rows = wallet.getByTestId('wallet-row')
    await expect(balance).toHaveText(figure('246,02'))

    // Add money: the keypad, then what the wallet holds after it.
    await wallet.getByTestId('wallet-add').click()
    const entry = sheet(page, 'walletEntry')
    await expect(entry).toHaveAccessibleName('Add money')
    const save = entry.getByTestId('sheet-save')
    await expect(save).toHaveAccessibleName('Add money')
    await expect(save).toBeDisabled()
    await typeKeys(entry, '50')
    await expect(entry.getByTestId('amount-display')).toHaveText(copy('50 €'))
    await expect(entry.getByTestId('wallet-consequence')).toHaveText(copy('Wallet after: 296,02 €'))
    await save.click()
    await expect(entry).toBeHidden()

    const added = toast(page, copy('Added 50,00 € to your wallet'))
    await expect(added).toBeVisible()
    await expect(balance).toHaveText(figure('296,02'))
    const deposit = rows.and(wallet.locator('[data-kind="deposit"]'))
    await expect(deposit).toHaveCount(1)
    await expect(deposit).toContainText('Added')
    await expect(deposit).toContainText(copy('+50,00'))
    await expect(deposit).toContainText('296,02')

    // Undo takes the entry back out of the book.
    await added.getByRole('button', { name: 'Undo' }).click()
    await expect(balance).toHaveText(figure('246,02'))
    await expect(deposit).toHaveCount(0)

    // Take money out, with a note: the book names the line after it.
    await wallet.getByTestId('wallet-take').click()
    await expect(entry).toHaveAccessibleName('Take money out')
    await typeKeys(entry, '200')
    await expect(entry.getByTestId('wallet-consequence')).toHaveText(copy('Wallet after: 46,02 €'))
    await writeNote(entry, 'Moved to my savings account')
    await entry.getByTestId('sheet-save').click()
    await expect(entry).toBeHidden()

    await expect(toast(page, copy('Took 200,00 € out of your wallet'))).toBeVisible()
    await expect(balance).toHaveText(figure('46,02'))
    const withdrawal = rows.and(wallet.locator('[data-kind="withdrawal"]'))
    await expect(withdrawal).toContainText('Moved to my savings account')
    await expect(withdrawal).toContainText(copy('-200,00'))
    await expect(withdrawal).toContainText('46,02')
    await expect(rows).toHaveCount(2)
    await expect(
      wallet.getByRole('button', {
        name: copy('14 October, taken out, Moved to my savings account, minus 200,00 €, balance 46,02 €'),
      }),
    ).toBeVisible()
  })

  test('goals fill from the top, move, are marked as done and put back', async ({ page }) => {
    await seed(page, 'two-months')
    const wallet = await gotoTab(page, 'wallet')
    const goals = wallet.getByTestId('goal-row')
    const goal = sheet(page, 'goal')

    // A first goal takes what the wallet holds, up to its target.
    await wallet.getByTestId('goal-add').click()
    await expect(goal).toHaveAccessibleName('New goal')
    await goal.getByRole('textbox', { name: 'Name' }).fill('Bike')
    await fillAmount(goal.getByRole('textbox', { name: 'Target' }), '300')
    await goal.getByTestId('sheet-save').click()
    await expect(goal).toBeHidden()

    await expect(goals).toHaveCount(1)
    const bike = goalRow(wallet, 'Bike')
    await expect(bike).toHaveAttribute('data-phase', 'filling')
    await expect(bike).toContainText(copy('of 300,00 €'))
    await expect(bike).toContainText(copy('53,98 € to go'))
    await expect(bike.getByTestId('goal-open')).toHaveAccessibleName(copy('Bike, 246,02 € of 300,00 €, 53,98 € to go'))
    await expect(wallet.getByTestId('wallet-free')).toHaveText(copy('Not set aside: 0,00 €'))

    // A second goal waits for the first.
    await wallet.getByTestId('goal-add').click()
    await goal.getByRole('textbox', { name: 'Name' }).fill('Laptop')
    await fillAmount(goal.getByRole('textbox', { name: 'Target' }), '1000')
    await goal.getByTestId('sheet-save').click()
    await expect(goal).toBeHidden()
    const laptop = goalRow(wallet, 'Laptop')
    await expect(goals).toHaveCount(2)
    await expect(laptop).toHaveAttribute('data-phase', 'waiting')
    await expect(laptop).toContainText('Fills after Bike')
    await expect(laptop.getByTestId('goal-open')).toHaveAccessibleName(copy('Laptop, 0,00 € of 1.000,00 €, fills after Bike'))

    // "Fill Laptop sooner": Laptop now fills first and Bike waits.
    await expect(wallet.getByRole('button', { name: 'Fill Bike sooner' })).toHaveCount(0)
    await wallet.getByRole('button', { name: 'Fill Laptop sooner' }).click()
    await expect(goals.first()).toContainText('Laptop')
    await expect(laptop).toHaveAttribute('data-phase', 'filling')
    await expect(laptop.getByTestId('goal-open')).toHaveAccessibleName(copy('Laptop, 246,02 € of 1.000,00 €, 753,98 € to go'))
    await expect(bike).toContainText('Fills after Laptop')
    await expect(wallet.getByText('Laptop fills first now')).toBeAttached()

    // Mark as done: Laptop leaves the fill order, and Bike fills again.
    await laptop.getByTestId('goal-open').click()
    await expect(goal).toHaveAccessibleName('Edit goal')
    await goal.getByRole('button', { name: 'Mark as done' }).click()
    await expect(goal).toBeHidden()
    await expect(toast(page, 'Marked Laptop as done')).toBeVisible()
    await expect(goals).toHaveCount(1)
    await expect(bike).toHaveAttribute('data-phase', 'filling')
    const done = wallet.getByRole('button', { name: 'Done, 1' })
    await expect(done).toHaveAttribute('aria-expanded', 'false')

    // Put back: it returns to the place it had, first.
    await done.click()
    await expect(done).toHaveAttribute('aria-expanded', 'true')
    await expect(wallet.getByTestId('goal-done-row')).toContainText(copy('1.000,00 €, done 14 Oct'))
    await wallet.getByRole('button', { name: 'Put back Laptop' }).click()
    await expect(goals).toHaveCount(2)
    await expect(goals.first()).toContainText('Laptop')
    await expect(laptop).toHaveAttribute('data-phase', 'filling')
    await expect(bike).toContainText('Fills after Laptop')
    await expect(wallet.getByTestId('goals-done')).toHaveCount(0)
  })

  test('an expense paid from the wallet leaves the budget alone', async ({ page }) => {
    await seed(page, 'two-months')
    const home = page.getByTestId('screen-home')
    await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))

    const add = await openAddSheet(page)
    await typeAmount(page, '49')
    await add.getByTestId('category-chip').filter({ hasText: 'Shopping' }).click()
    await writeNote(add, 'Headphones')
    // From the budget it would be more than today's 10,63 €; from the wallet the line says what is left there.
    await expect(add.getByText(copy("38,37 € over today's budget"))).toBeVisible()
    await setSwitch(add.getByRole('switch', { name: 'Pay from wallet' }), true)
    await expect(add.getByTestId('wallet-consequence')).toHaveText(copy('Wallet after: 197,02 €'))
    await expect(add.getByText(copy("38,37 € over today's budget"))).toHaveCount(0)
    await add.getByTestId('sheet-save').click()
    await expect(add).toBeHidden()
    await expect(toast(page, copy('Added 49,00 € to Shopping'))).toBeVisible()

    // The month's numbers do not count it; the wallet pays it.
    await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))
    await expect(home.getByTestId('equation-daily')).toContainText('201,15')
    await expect(home.getByTestId('wallet-card-balance')).toHaveText(copy('197,02 €'))
    await expect(home.getByTestId('wallet-card-line')).toHaveText(copy('October adds 469,97 € when it closes'))

    // Daily lists it with the wallet glyph, "Paid from wallet" and the amount in secondary ink.
    const daily = await gotoTab(page, 'daily')
    const row = daily.getByTestId('tx-row').filter({ hasText: 'Headphones' })
    await expect(row).toContainText('Paid from wallet')
    await expect(row).toContainText(euro('49,00'))
    await expect(row.getByRole('button')).toHaveAccessibleName(copy('Headphones, Shopping, 49,00 €, paid from wallet'))

    // In the passbook it is a payment on its date, named after the note.
    const wallet = await gotoTab(page, 'wallet')
    await expect(wallet.getByTestId('wallet-balance')).toHaveText(figure('197,02'))
    const payment = wallet.getByTestId('wallet-row').and(wallet.locator('[data-kind="payment"]'))
    await expect(payment).toContainText('Paid: Headphones')
    await expect(payment).toContainText(copy('-49,00'))
    await expect(payment).toContainText('197,02')
  })
})
