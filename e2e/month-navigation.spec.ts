import { copy, expect, figure, gotoTab, monthTitle, seed, test } from './fixtures.ts'

// Home, Daily and Fixed share one selected month; the switcher runs from the first period with
// data (September 2026 in two-months) to twelve months ahead (docs/SPEC.md §3.1, §5.5).

test.describe('month navigation', () => {
  test('goes back to a past month and returns to this month', async ({ page }) => {
    await seed(page, 'two-months')
    const home = page.getByTestId('screen-home')
    const label = home.getByTestId('month-label')
    const backToThisMonth = home.getByRole('button', { name: 'Back to this month' })
    await expect(label).toHaveText(monthTitle('October'))
    await expect(home.getByText('Left to spend', { exact: true })).toBeVisible()
    await expect(backToThisMonth).toBeHidden()

    await home.getByTestId('month-prev').click()
    await expect(label).toHaveText(monthTitle('September'))
    await expect(home.getByText('Left over', { exact: true })).toBeVisible()
    await expect(home.getByTestId('hero-left')).toHaveText(figure('146,02'))
    await expect(home.getByText(copy('You spent 425,10 € on daily life.'))).toBeVisible()
    await expect(backToThisMonth).toBeVisible()
    await expect(home.getByTestId('month-prev')).toBeDisabled()

    // Daily shows the same month; its quick add strip gives way to "Back to this month".
    const daily = await gotoTab(page, 'daily')
    await expect(daily.getByTestId('month-label')).toHaveText(monthTitle('September'))
    await expect(daily.getByTestId('quick-add').first()).toBeHidden()
    await daily.getByRole('button', { name: 'Back to this month' }).first().click()
    await expect(daily.getByTestId('month-label')).toHaveText(monthTitle('October'))
    await expect(daily.getByTestId('quick-add').first()).toBeVisible()

    await gotoTab(page, 'home')
    await expect(label).toHaveText(monthTitle('October'))
    await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))
    await expect(backToThisMonth).toBeHidden()
  })

  test('plans ahead up to twelve months', async ({ page }) => {
    await seed(page, 'two-months')
    const home = page.getByTestId('screen-home')
    const label = home.getByTestId('month-label')
    const next = home.getByTestId('month-next')

    await next.click()
    await expect(label).toHaveText(monthTitle('November'))
    await expect(home.getByText('Planned', { exact: true })).toBeVisible()
    await expect(home.getByTestId('hero-left')).toHaveText(figure('571,12'))
    await expect(home.getByText(copy('19,03 € a day across 30 days'))).toBeVisible()

    // Months outside 2026 carry their year.
    const ahead = ['December', 'January 2027', 'February 2027', 'March 2027', 'April 2027', 'May 2027']
    ahead.push('June 2027', 'July 2027', 'August 2027', 'September 2027', 'October 2027')
    for (const name of ahead) {
      await next.click()
      await expect(label).toHaveText(monthTitle(name))
    }
    await expect(next).toBeDisabled()

    await home.getByRole('button', { name: 'Back to this month' }).click()
    await expect(label).toHaveText(monthTitle('October'))
    await expect(home.getByText('Left to spend', { exact: true })).toBeVisible()
  })
})
