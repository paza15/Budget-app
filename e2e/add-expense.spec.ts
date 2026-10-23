import {
  copy,
  euro,
  expect,
  expectSelected,
  figure,
  gotoTab,
  openAddSheet,
  pick,
  seed,
  test,
  toast,
  typeAmount,
  writeNote,
} from './fixtures.ts'

// two-months, Wed 14 Oct: 369,97 € left, 21,13 € a day, 10,63 € left for today (docs/SPEC.md §3.4).

test('adds an expense with the keypad', async ({ page }) => {
  await seed(page, 'two-months')
  const home = page.getByTestId('screen-home')
  await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))
  await expect(home.getByTestId('hero-today')).toHaveText(copy('Today: 10,63 € left'))

  const add = await openAddSheet(page)
  const save = add.getByTestId('sheet-save')
  await expect(save).toHaveAccessibleName('Add expense')
  await expect(save).toBeDisabled()

  await typeAmount(page, '7,80')
  await expect(add.getByTestId('amount-display')).toHaveText(copy('7,80 €'))
  await expect(add.getByText(copy('Leaves 2,83 € for today'))).toBeVisible()

  const groceries = add.getByTestId('category-chip').filter({ hasText: 'Groceries' })
  await groceries.click()
  await expectSelected(groceries)

  await writeNote(add, 'Farmers market')
  await expectSelected(await pick(add, 'Today'))

  await expect(save).toBeEnabled()
  await save.click()
  await expect(add).toBeHidden()
  await expect(toast(page, copy('Added 7,80 € to Groceries'))).toBeVisible()

  await expect(home.getByTestId('hero-left')).toHaveText(figure('362,17'))
  await expect(home.getByTestId('hero-per-day')).toHaveText(copy('About 21,13 € a day for the next 18 days'))
  await expect(home.getByTestId('hero-today')).toHaveText(copy('Today: 2,83 € left'))

  // Newest first: the entry made now heads today's group.
  const daily = await gotoTab(page, 'daily')
  const newest = daily.getByTestId('tx-row').first()
  await expect(newest).toContainText('Farmers market')
  await expect(newest).toContainText('Groceries')
  await expect(newest).toContainText(euro('7,80'))
})
