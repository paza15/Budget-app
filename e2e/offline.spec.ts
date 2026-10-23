import { expect, figure, seed, test, waitForApp } from './fixtures.ts'

// The service worker precaches the build, so the app opens without a network (docs/SPEC.md §7).
// Chromium only: the other projects block service workers.

test.use({ serviceWorkers: 'allow' })

test('the app opens offline once the service worker controls it', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service worker checks run in Chromium only')
  await seed(page, 'two-months')

  // The first visit installs the worker; pages loaded after it activates are controlled by it.
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null), {
      timeout: 15_000,
    })
    .toBe('activated')
  await page.reload()
  await waitForApp(page)
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await waitForApp(page)
  const home = page.getByTestId('screen-home')
  await expect(home.getByText('Left to spend', { exact: true })).toBeVisible()
  await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))
})
