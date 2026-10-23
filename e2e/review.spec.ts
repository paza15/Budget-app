import { type Page } from '@playwright/test'
import { changedFixture, copy, expect, figure, monthTitle, seed, sheet, test, waitForApp, waitForSaved } from './fixtures.ts'

// The month review (docs/SPEC.md §3.15, docs/design/EXTRAS.md §1). In two-months September closed
// with 1.450,00 € in, 778,88 € of fixed costs and 425,10 € of daily spending: 246,02 € moved to the
// wallet (100,00 € of savings plus 146,02 € left over). The fixture has reviewed September; this
// copy has not, so the first open in October shows the review banner on Home.
const septemberNotReviewed = changedFixture('two-months', ({ data }) => {
  data.settings.lastReviewedMonth = null
})

function reviewBanner(page: Page) {
  return page.getByTestId('banner-review')
}

/** The statement sheet, a dialog named "{month} statement" printed on paper. */
async function expectStatement(page: Page, month: string) {
  const review = sheet(page, 'monthReview')
  await expect(review).toBeVisible()
  await expect(review).toHaveAccessibleName(`${month} statement`)
  await expect(review).toHaveAttribute('data-material', 'paper')
  await expect(review.getByTestId('review-result')).toHaveText(figure('246,02'))
  return review
}

/** Reloads once everything is saved and waits for Home. */
async function reloadHome(page: Page) {
  await waitForSaved(page)
  await page.reload()
  await waitForApp(page)
  const home = page.getByTestId('screen-home')
  await expect(home).toHaveAttribute('data-active', 'true')
  await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))
  return home
}

test.describe('month review', () => {
  test('the first open after a month closed shows the banner, and See the review opens the statement', async ({ page }) => {
    await seed(page, septemberNotReviewed)
    const banner = reviewBanner(page)
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAccessibleName('September is closed')
    await expect(banner).toContainText('September is closed.')
    await expect(banner).toContainText(copy('Moved to your wallet: 246,02 €.'))
    await expect(banner.getByRole('button', { name: 'Dismiss' })).toBeVisible()

    await banner.getByRole('button', { name: 'See the review' }).click()
    const review = await expectStatement(page, 'September')
    // Opening the review records it: the banner has gone behind the sheet.
    await expect(banner).toHaveCount(0)
    await review.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(review).toBeHidden()
    await expect(banner).toHaveCount(0)

    await reloadHome(page)
    await expect(banner).toHaveCount(0)
  })

  test('Dismiss hides the banner for good', async ({ page }) => {
    await seed(page, septemberNotReviewed)
    const banner = reviewBanner(page)
    await expect(banner).toBeVisible()

    await banner.getByRole('button', { name: 'Dismiss' }).click()
    await expect(banner).toHaveCount(0)
    await expect(sheet(page, 'monthReview')).toHaveCount(0)

    await reloadHome(page)
    await expect(banner).toHaveCount(0)
  })

  test("a past month's See the review opens its statement and records the review", async ({ page }) => {
    await seed(page, septemberNotReviewed)
    const home = page.getByTestId('screen-home')
    const banner = reviewBanner(page)
    await expect(banner).toBeVisible()
    // In the current month the only "See the review" is the banner's (it sits in Home's banner slot).
    const seeTheReview = home.getByRole('button', { name: 'See the review', exact: true })
    await expect(seeTheReview).toHaveCount(1)
    await expect(banner.getByRole('button', { name: 'See the review' })).toBeVisible()

    // The banner belongs to the current month; a past month has its own button instead.
    await home.getByTestId('month-prev').click()
    await expect(home.getByTestId('month-label')).toHaveText(monthTitle('September'))
    await expect(banner).toHaveCount(0)
    await expect(seeTheReview).toHaveCount(1)
    await seeTheReview.click()
    const review = await expectStatement(page, 'September')
    await review.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(review).toBeHidden()

    // Back in October, September counts as reviewed.
    await home.getByTestId('month-next').click()
    await expect(home.getByTestId('month-label')).toHaveText(monthTitle('October'))
    await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))
    await expect(banner).toHaveCount(0)
  })
})
