import { type Locator, type Page } from '@playwright/test'
import { byId, copy, euro, expect, fillAmount, gotoTab, monthTitle, openRow, seed, setSwitch, sheet, test, toast } from './fixtures.ts'

// Fixed → Costs and the recurring sheet (docs/SPEC.md §3.5, §3.6, §4.4). In two-months, October has
// six charge lines (Rent and Deutschlandticket paid) plus Liability insurance set aside monthly:
// 778,88 € in all.

/** Opens a fixed cost's edit sheet from its row. */
async function editFixedCost(page: Page, row: Locator, name: string): Promise<Locator> {
  await openRow(row, name)
  const edit = sheet(page, 'recurring')
  await expect(edit).toBeVisible()
  return edit
}

test.describe('fixed costs', () => {
  test('adds fixed costs from a suggestion and from the add button', async ({ page }) => {
    await seed(page, 'empty-onboarded')
    const fixed = await gotoTab(page, 'fixed')
    await expect(fixed.getByText('Add rent, subscriptions and other costs that repeat every month.')).toBeVisible()

    // A suggestion fills in name, category and interval, never the price.
    await fixed.getByRole('button', { name: 'Netflix', exact: true }).click()
    const edit = sheet(page, 'recurring')
    await expect(edit).toBeVisible()
    await expect(edit.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Netflix')
    await fillAmount(edit.getByRole('textbox', { name: 'Amount', exact: true }), '13,99')
    await edit.getByRole('combobox', { name: 'Usually paid on' }).selectOption({ label: '22nd' })
    await edit.getByTestId('sheet-save').click()
    await expect(edit).toBeHidden()

    const netflix = fixed.getByTestId('recurring-row').filter({ hasText: 'Netflix' })
    await expect(netflix).toContainText(euro('13,99'))
    await expect(netflix).toContainText('Due on the 22nd')
    await expect(fixed.getByText(copy('13,99 € this month, 0 of 1 paid'))).toBeVisible()

    await fixed.getByRole('button', { name: 'Add fixed cost' }).first().click()
    await expect(edit).toBeVisible()
    await edit.getByRole('textbox', { name: 'Name', exact: true }).fill('Cloud storage')
    await fillAmount(edit.getByRole('textbox', { name: 'Amount', exact: true }), '2,99')
    await edit.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Subscriptions' })
    await edit.getByTestId('sheet-save').click()
    await expect(edit).toBeHidden()

    const cloud = fixed.getByTestId('recurring-row').filter({ hasText: 'Cloud storage' })
    await expect(cloud).toContainText(euro('2,99'))
    await expect(cloud).toContainText('Monthly')
    await expect(fixed.getByText(copy('16,98 € this month, 0 of 2 paid'))).toBeVisible()
  })

  test('ticks a fixed cost off as paid', async ({ page }) => {
    await seed(page, 'two-months')
    const fixed = await gotoTab(page, 'fixed')
    await expect(fixed.getByText(copy('778,88 € this month, 2 of 6 paid'))).toBeVisible()

    const paid = byId(fixed, 'recurring-row', 'fx-netflix').getByTestId('recurring-paid')
    await expect(paid).toHaveAccessibleName('Mark Netflix as paid')
    await paid.click()
    await expect(paid).toHaveAccessibleName('Netflix paid')
    await expect(fixed.getByText(copy('778,88 € this month, 3 of 6 paid'))).toBeVisible()

    // A spread item outside its charge month has no check.
    const insurance = byId(fixed, 'recurring-row', 'fx-insurance')
    await expect(insurance).toContainText(copy('Set aside 5,00 € this month'))
    await expect(insurance.getByTestId('recurring-paid')).toHaveCount(0)
  })

  test('skips a fixed cost this month only', async ({ page }) => {
    await seed(page, 'two-months')
    const fixed = await gotoTab(page, 'fixed')
    const gym = byId(fixed, 'recurring-row', 'fx-gym')
    await expect(gym).toContainText('Due on the 15th')

    const edit = await editFixedCost(page, gym, 'Gym')
    await setSwitch(edit.getByRole('switch', { name: 'Skip this month' }), true)
    await edit.getByTestId('sheet-save').click()
    await expect(edit).toBeHidden()

    await expect(gym).toContainText('Skipped this month')
    await expect(fixed.getByText(copy('748,98 € this month'))).toBeVisible()

    await fixed.getByTestId('month-next').click()
    await expect(fixed.getByTestId('month-label')).toHaveText(monthTitle('November'))
    await expect(gym).toContainText('Due on the 15th')
    await expect(gym).toContainText(euro('29,90'))
  })

  test('a different amount applies to this month only', async ({ page }) => {
    await seed(page, 'two-months')
    const fixed = await gotoTab(page, 'fixed')
    const spotify = byId(fixed, 'recurring-row', 'fx-spotify')
    await expect(spotify).toContainText(euro('11,99'))

    const edit = await editFixedCost(page, spotify, 'Spotify')
    const different = edit.getByRole('textbox', { name: 'Different amount this month' })
    if (!(await different.isVisible())) {
      await edit.getByRole('button', { name: /^Different amount this month/ }).click()
    }
    await fillAmount(different, '5,99')
    await edit.getByTestId('sheet-save').click()
    await expect(edit).toBeHidden()

    await expect(spotify).toContainText(euro('5,99'))
    await expect(fixed.getByText(copy('772,88 € this month'))).toBeVisible()

    await fixed.getByTestId('month-next').click()
    await expect(fixed.getByTestId('month-label')).toHaveText(monthTitle('November'))
    await expect(spotify).toContainText(euro('11,99'))
  })

  test('a new amount from this month on leaves past months alone', async ({ page }) => {
    await seed(page, 'two-months')
    const fixed = await gotoTab(page, 'fixed')
    const netflix = byId(fixed, 'recurring-row', 'fx-netflix')

    const edit = await editFixedCost(page, netflix, 'Netflix')
    await fillAmount(edit.getByRole('textbox', { name: 'Amount', exact: true }), '15,99')
    await edit.getByTestId('sheet-save').click()

    // chooseDialog: "From this month on" (default) or "Every month, including the past".
    await expect(page.getByRole('button', { name: 'Every month, including the past' })).toBeVisible()
    await page.getByRole('button', { name: 'From this month on' }).click()
    await expect(edit).toBeHidden()

    await expect(netflix).toContainText(euro('15,99'))
    await expect(fixed.getByText(copy('780,88 € this month'))).toBeVisible()

    await fixed.getByTestId('month-prev').click()
    await expect(fixed.getByTestId('month-label')).toHaveText(monthTitle('September'))
    await expect(netflix).toContainText(euro('13,99'))
    await expect(fixed.getByText(copy('778,88 € in September'))).toBeVisible()
  })

  test('stop after this month ends it from next month', async ({ page }) => {
    await seed(page, 'two-months')
    const fixed = await gotoTab(page, 'fixed')
    const phone = byId(fixed, 'recurring-row', 'fx-phone')

    const edit = await editFixedCost(page, phone, 'Phone')
    await edit.getByRole('button', { name: /^Stop after (this month|October)$/ }).click()
    await expect(edit).toBeHidden()
    const stopped = toast(page, 'Stopped Phone after October')
    await expect(stopped.getByRole('button', { name: 'Undo' })).toBeVisible()

    // October still counts it.
    await expect(phone).toContainText(euro('15,00'))
    await expect(fixed.getByText(copy('778,88 € this month'))).toBeVisible()

    await fixed.getByTestId('month-next').click()
    await expect(fixed.getByTestId('month-label')).toHaveText(monthTitle('November'))
    await expect(fixed.getByText(copy('763,88 € in November'))).toBeVisible()
    // The Undo toast stays 6 s and sits over the end of the list; the group opens once it has gone.
    await expect(stopped).toBeHidden({ timeout: 10_000 })
    await fixed
      .getByRole('button', { name: /^Not this month/ })
      .or(fixed.locator('summary').filter({ hasText: 'Not this month' }))
      .first()
      .click()
    await expect(phone).toContainText('Ended October')
  })
})
