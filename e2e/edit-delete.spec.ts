import { byId, copy, euro, expect, figure, gotoTab, seed, sheet, test, toast, typeAmount } from './fixtures.ts'

// Tapping a Daily row opens the transaction sheet for editing (docs/SPEC.md §3.3, §3.4).

test.describe('edit and delete', () => {
  test('the first key replaces the amount and Save changes keeps it', async ({ page }) => {
    await seed(page, 'two-months')
    const daily = await gotoTab(page, 'daily')
    const pizza = byId(daily, 'tx-row', 'tx-1010-pizza')
    await expect(pizza).toContainText(euro('12,90'))
    await pizza.click()

    const edit = sheet(page, 'transaction')
    await expect(edit.getByText('Edit expense', { exact: true }).first()).toBeVisible()
    await expect(edit.getByTestId('amount-display')).toHaveText(copy('12,90 €'))
    await typeAmount(page, '9,90')
    await expect(edit.getByTestId('amount-display')).toHaveText(figure('9,90'))
    await edit.getByTestId('sheet-save').click()
    await expect(edit).toBeHidden()
    await expect(toast(page, 'Saved')).toBeVisible()
    await expect(pizza).toContainText(euro('9,90'))

    const home = await gotoTab(page, 'home')
    await expect(home.getByTestId('hero-left')).toHaveText(figure('372,97'))
  })

  test('deleting an expense offers Undo', async ({ page }) => {
    await seed(page, 'two-months')
    const daily = await gotoTab(page, 'daily')
    const cinema = byId(daily, 'tx-row', 'tx-1013-cinema')
    await expect(cinema).toContainText('Cinema')
    await cinema.click()

    const edit = sheet(page, 'transaction')
    await expect(edit.getByText('Edit expense', { exact: true }).first()).toBeVisible()
    await edit.getByTestId('sheet-delete').click()
    await expect(edit).toBeHidden()
    await expect(cinema).toHaveCount(0)

    // The seed's "Backup restored" toast may still be on its way out.
    const deleted = toast(page).filter({ hasNotText: 'Backup restored' })
    await deleted.getByRole('button', { name: 'Undo' }).click()
    await expect(cinema).toBeVisible()
    await expect(cinema).toContainText(euro('11,50'))
  })
})
