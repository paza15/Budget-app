import { copy, euro, expect, gotoTab, seed, test, toast } from './fixtures.ts'

// Quick add on Daily: one tap logs an expense dated today, the toast offers Undo (docs/SPEC.md §3.3).

test('a quick add logs an expense and Undo takes it back', async ({ page }) => {
  await seed(page, 'empty-onboarded')
  const daily = await gotoTab(page, 'daily')
  const rows = daily.getByTestId('tx-row')
  // The empty state is a heading and a message (DESIGN.md §9.20).
  const emptyTitle = daily.getByRole('heading', { name: 'Nothing spent this month yet' })
  const emptyMessage = daily.getByText('Tap + to add an expense.')
  await expect(emptyTitle).toBeVisible()
  await expect(emptyMessage).toBeVisible()
  await expect(rows).toHaveCount(0)

  const coffee = daily.getByTestId('quick-add').filter({ has: page.getByText('Coffee', { exact: true }) })
  await expect(coffee).toHaveAccessibleName(copy('Add Coffee, 3,50 €'))
  await coffee.click()

  const added = toast(page, copy('Added 3,50 € to Coffee & snacks'))
  await expect(added).toBeVisible()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(euro('3,50'))
  await expect(daily.getByText(copy('3,50 € spent, about 0,25 € a day'))).toBeVisible()
  await expect(emptyTitle).toBeHidden()

  await added.getByRole('button', { name: 'Undo' }).click()
  await expect(rows).toHaveCount(0)
  await expect(emptyTitle).toBeVisible()
  await expect(emptyMessage).toBeVisible()
})
