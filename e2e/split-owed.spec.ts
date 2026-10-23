import {
  byId,
  changedFixture,
  confirmDialog,
  copy,
  euro,
  expect,
  figure,
  gotoTab,
  openAddSheet,
  openSettings,
  seed,
  test,
  toast,
  typeAmount,
  writeNote,
} from './fixtures.ts'

// Split bills and "Owed to you" (docs/SPEC.md §3.16, docs/design/EXTRAS.md §2). The budget counts
// only your share: in two-months, October has 369,97 € left and 201,15 € of daily spending.

/** two-months with Max owing 9,00 € of Saturday's "Bar with friends" (18,00 €). */
const maxOwesForTheBar = changedFixture('two-months', ({ data }) => {
  const bar = data.transactions.find((tx) => tx.id === 'tx-1003-bar')
  if (bar === undefined) throw new Error('two-months has no tx-1003-bar')
  bar.splits = [{ id: 'split-bar-max', person: 'Max', amount: 900, status: 'open', settledAt: null }]
})

test.describe('split bills', () => {
  test('a split counts only your share, Max is owed on Home and pays back', async ({ page }) => {
    await seed(page, 'two-months')
    const home = page.getByTestId('screen-home')
    await expect(home.getByTestId('owed-card')).toHaveCount(0)

    // 18,00 € split with Max: one more person splits it evenly, 9,00 € each.
    const add = await openAddSheet(page)
    await typeAmount(page, '18')
    await add.getByTestId('category-chip').filter({ hasText: 'Going out' }).click()
    await writeNote(add, 'Karaoke')
    const split = add.getByTestId('split-toggle')
    await expect(split).toHaveAccessibleName('Split')
    await expect(split).toHaveAttribute('aria-expanded', 'false')
    await split.click()
    await expect(split).toHaveAttribute('aria-expanded', 'true')
    const panel = add.getByTestId('split-panel')
    await expect(panel).toBeVisible()
    await panel.getByTestId('split-add').click()
    await panel.getByTestId('split-person').getByRole('textbox', { name: 'Name' }).fill('Max')
    await expect(panel.getByRole('textbox', { name: 'Max owes' })).toHaveValue(copy('9,00 €'))
    await expect(add.getByTestId('split-share')).toHaveText(copy('Your share: 9,00 €'))
    // Today's line counts the share: 10,63 € − 9,00 €.
    await expect(add.getByText(copy('Leaves 1,63 € for today'))).toBeVisible()
    await add.getByTestId('sheet-save').click()
    await expect(add).toBeHidden()
    await expect(toast(page, copy('Added 18,00 € to Going out'))).toBeVisible()

    // The month's numbers count 9,00 €.
    await expect(home.getByTestId('hero-left')).toHaveText(figure('360,97'))
    await expect(home.getByTestId('hero-today')).toHaveText(copy('Today: 1,63 € left'))
    await expect(home.getByTestId('equation-daily')).toContainText('210,15')

    // Daily: the share as the amount, who owes what, and the whole bill.
    const daily = await gotoTab(page, 'daily')
    const row = daily.getByTestId('tx-row').filter({ hasText: 'Karaoke' })
    await expect(row).toContainText(euro('9,00'))
    await expect(row).toContainText(copy('Split, Max owes 9,00 €'))
    await expect(row).toContainText(copy('of 18,00 €'))
    await expect(row.getByRole('button')).toHaveAccessibleName(
      copy('Karaoke, Going out, 9,00 €, your share of 18,00 €. Split, Max owes 9,00 €.'),
    )

    // Home's "Owed to you" names Max; his row opens the Owed screen at him.
    await gotoTab(page, 'home')
    const card = home.getByTestId('owed-card')
    await expect(card.getByRole('heading', { name: 'Owed to you' })).toBeVisible()
    const max = byId(card, 'owed-person', 'Max')
    await expect(max).toContainText('Karaoke')
    await expect(max.getByRole('button')).toHaveAccessibleName(copy('Max owes you 9,00 €, Karaoke'))
    await max.getByRole('button').click()

    const owed = page.getByTestId('screen-owed')
    await expect(owed).toHaveAttribute('data-active', 'true')
    await expect(owed.getByRole('button', { name: 'Back to Home' })).toBeVisible()
    await expect(owed.getByTestId('owed-total')).toContainText(copy('9,00 €'))
    await expect(owed.getByText('Max owes you for 1 bill.')).toBeVisible()
    const section = byId(owed, 'owed-person-section', 'Max')
    // Chromium names the flex heading "Max , 9,00 €"; copy() lets the space before the comma pass.
    await expect(section.getByRole('heading', { name: copy('Max , 9,00 €') })).toBeInViewport()
    const item = section.getByTestId('owed-item').filter({ hasText: 'Karaoke' })
    await expect(item).toContainText(copy('of 18,00 €'))

    // Paid back: it leaves the list at once, and Undo brings it back.
    await item.getByRole('button', { name: 'Paid back' }).click()
    const paid = toast(page, copy('Max paid back 9,00 €'))
    await expect(paid).toBeVisible()
    await expect(owed.getByRole('heading', { name: 'Nobody owes you anything' })).toBeVisible()
    await expect(owed.getByTestId('owed-settled')).toContainText('Settled')
    await paid.getByRole('button', { name: 'Undo' }).click()
    await expect(owed.getByTestId('owed-item').filter({ hasText: 'Karaoke' })).toBeVisible()
    await expect(owed.getByTestId('owed-total')).toContainText(copy('9,00 €'))

    // Paid back again for good: Max's money was never your spending, so Home keeps 360,97 €.
    await owed.getByTestId('owed-item').filter({ hasText: 'Karaoke' }).getByRole('button', { name: 'Paid back' }).click()
    await expect(owed.getByRole('heading', { name: 'Nobody owes you anything' })).toBeVisible()
    await owed.getByRole('button', { name: 'Back to Home' }).click()
    await expect(home).toHaveAttribute('data-active', 'true')
    await expect(home.getByTestId('owed-card')).toHaveCount(0)
    await expect(home.getByTestId('hero-left')).toHaveText(figure('360,97'))
    const settled = await gotoTab(page, 'daily')
    await expect(settled.getByTestId('tx-row').filter({ hasText: 'Karaoke' })).toContainText('Split with Max, settled')
  })

  test('forgiving asks first, counts the split as your spending again, and Undo takes it back', async ({ page }) => {
    await seed(page, maxOwesForTheBar)
    const home = page.getByTestId('screen-home')
    // 201,15 € − 9,00 € of daily spending: 378,97 € left.
    await expect(home.getByTestId('hero-left')).toHaveText(figure('378,97'))

    // Settings lists what is owed too.
    const you = await openSettings(page)
    await you.getByRole('button', { name: copy('Owed to you 9,00 €') }).click()
    const owed = page.getByTestId('screen-owed')
    await expect(owed).toHaveAttribute('data-active', 'true')
    await expect(owed.getByRole('button', { name: 'Back to Settings' })).toBeVisible()
    const item = byId(owed, 'owed-item', 'tx-1003-bar:split-bar-max')
    await expect(item).toContainText('Bar with friends')
    await expect(item).toContainText(copy('Sat 3 Oct'))

    // Cancel leaves it open.
    await item.getByRole('button', { name: 'Forgive' }).click()
    const question = confirmDialog(page, 'Forgive 9,00 €?')
    await expect(question).toBeVisible()
    await expect(question).toContainText('It counts as your own spending again.')
    await question.getByRole('button', { name: 'Cancel' }).click()
    await expect(question).toBeHidden()
    await expect(item).toBeVisible()

    await item.getByRole('button', { name: 'Forgive' }).click()
    await expect(question).toBeVisible()
    await question.getByRole('button', { name: 'Forgive', exact: true }).click()
    await expect(question).toBeHidden()
    const forgave = toast(page, copy('Forgave Max 9,00 €'))
    await expect(forgave).toBeVisible()
    await expect(owed.getByRole('heading', { name: 'Nobody owes you anything' })).toBeVisible()
    // ListRow keeps the test id on its wrapper; aria-expanded sits on the disclosure button inside.
    const settledToggle = owed.getByTestId('owed-settled').getByRole('button', { name: /^Settled/ })
    await expect(settledToggle).toHaveAttribute('aria-expanded', 'false')
    await settledToggle.click()
    await expect(settledToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(owed.getByTestId('owed-settled-item')).toContainText(copy('Forgave Max Wed 14 Oct'))

    // Undo: Max owes it again.
    await forgave.getByRole('button', { name: 'Undo' }).click()
    await expect(item).toBeVisible()
    await expect(owed.getByTestId('owed-total')).toContainText(copy('9,00 €'))

    // Forgiven for good: the whole bill is your spending, and the row is an ordinary expense again.
    await item.getByRole('button', { name: 'Forgive' }).click()
    await question.getByRole('button', { name: 'Forgive', exact: true }).click()
    await expect(owed.getByRole('heading', { name: 'Nobody owes you anything' })).toBeVisible()
    await gotoTab(page, 'home')
    await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))
    await expect(home.getByTestId('owed-card')).toHaveCount(0)
    const daily = await gotoTab(page, 'daily')
    const bar = byId(daily, 'tx-row', 'tx-1003-bar')
    await expect(bar).toContainText(euro('18,00'))
    await expect(bar).not.toContainText('Split')
  })
})
