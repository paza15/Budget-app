import { copy, euro, expect, figure, gotoTab, openAddSheet, seed, test, toast, typeAmount, waitForApp, waitForSaved, writeNote } from './fixtures.ts'

// Everything is saved to IndexedDB; a reload reads it back (docs/SPEC.md §5.4).

test('an expense is still there after a reload', async ({ page }) => {
  await seed(page, 'empty-onboarded')
  const add = await openAddSheet(page)
  await typeAmount(page, '12,34')
  await add.getByTestId('category-chip').filter({ hasText: 'Groceries' }).click()
  await writeNote(add, 'Farmers market')
  await add.getByTestId('sheet-save').click()
  await expect(add).toBeHidden()
  await expect(toast(page, copy('Added 12,34 € to Groceries'))).toBeVisible()

  await waitForSaved(page)
  await page.reload()
  await waitForApp(page)

  const home = page.getByTestId('screen-home')
  await expect(home).toHaveAttribute('data-active', 'true')
  await expect(home.getByText('Spent this month', { exact: true })).toBeVisible()
  await expect(home.getByTestId('hero-left')).toHaveText(figure('12,34'))

  const daily = await gotoTab(page, 'daily')
  const row = daily.getByTestId('tx-row').filter({ hasText: 'Farmers market' })
  await expect(row).toContainText('Groceries')
  await expect(row).toContainText(euro('12,34'))
})
