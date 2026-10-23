import { copy, euro, expect, fillAmount, figure, gotoTab, openFromYou, seed, sheet, test } from './fixtures.ts'

// Monthly limits on Home's Limits card (docs/SPEC.md §3.1, §3.7, §4.5). budgetStatus: warning from
// 85 % of the limit, over above it. The Meter carries its status in data-status.

test.describe('category limits', () => {
  test('a limit close to the spending shows a warning', async ({ page }) => {
    await seed(page, 'two-months')
    const home = page.getByTestId('screen-home')
    const coffee = home.getByTestId('budget-row').filter({ hasText: 'Coffee & snacks' })
    // 31,50 € of 40,00 € is 79 %: on track.
    await expect(coffee).toContainText(euro('31,50'))
    await expect(coffee).toContainText(euro('40,00'))
    await expect(coffee).toContainText(copy('8,50 € left'))
    await expect(coffee.locator('[data-status="ok"]').first()).toBeAttached()

    const categories = await openFromYou(page, 'categories')
    await categories.getByRole('button', { name: /^Coffee & snacks/ }).first().click()
    const edit = sheet(page, 'categoryEdit')
    await expect(edit).toBeVisible()
    await fillAmount(edit.getByRole('textbox', { name: 'Monthly limit' }), '35')
    await edit.getByTestId('sheet-save').click()
    await expect(edit).toBeHidden()

    // 31,50 € of 35,00 € is 90 %: near the limit.
    await gotoTab(page, 'home')
    await expect(coffee).toContainText(euro('35,00'))
    await expect(coffee).toContainText(copy('3,50 € left'))
    await expect(coffee.locator('[data-status="warning"]').first()).toBeAttached()
  })

  test('spending past a limit and past the month shows over', async ({ page }) => {
    await seed(page, 'over-budget')
    const home = page.getByTestId('screen-home')
    // 900,00 € in, 640,00 € rent, 300,00 € spent: 40,00 € over.
    await expect(home.getByText('Over budget by', { exact: true })).toBeVisible()
    await expect(home.getByTestId('hero-left')).toHaveText(figure('40,00'))
    await expect(home.getByText(copy('Spent 300,00 € of 260,00 € for daily life.'))).toBeVisible()

    const eating = home.getByTestId('budget-row').filter({ hasText: 'Eating' })
    await expect(eating).toContainText(copy('Over by 20,00 €'))
    await expect(eating.locator('[data-status="over"]').first()).toBeAttached()
  })
})
