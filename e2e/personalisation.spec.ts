import { type Locator } from '@playwright/test'
import { LS_KEYS } from '../src/domain/constants.ts'
import {
  chooseOption,
  expect,
  figure,
  gotoTab,
  openFromYou,
  openSettings,
  seed,
  setSwitch,
  storedItem,
  test,
  waitForApp,
  waitForSaved,
} from './fixtures.ts'

// Home → Settings → Look (docs/SPEC.md §3.7, §5.4 rule 9, §7): theme and accent land on <html>
// before the first paint, "Show cents in the big number" touches only the hero, Home layout orders
// the cards.

/**
 * The names of HOME_CARDS (src/domain/catalog.ts) in default order. The first is the switch for the
 * sums inside the hero; every other one is a card titled with its name.
 */
const HOME_CARDS = [
  'Show the sums above the total',
  'Wallet',
  'Owed to you',
  'Where it went',
  'Limits',
  'Coming up',
  'Last 6 months',
  'Recent',
]
const CARD_TITLES = HOME_CARDS.slice(1)

/** Titles of the Home cards (h2 headings), in the order the screen shows them. */
async function cardOrder(home: Locator): Promise<string[]> {
  const headings = await home.getByRole('heading').allInnerTexts()
  return headings.flatMap((heading) => CARD_TITLES.filter((title) => heading.trim().startsWith(title)))
}

test.describe('personalisation', () => {
  test('theme and accent apply at once and survive a reload', async ({ page }) => {
    await seed(page, 'two-months')
    const html = page.locator('html')
    const you = await openSettings(page)

    await chooseOption(you, 'Theme', 'Dark')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await chooseOption(you, 'Theme', 'Light')
    await expect(html).toHaveAttribute('data-theme', 'light')
    await chooseOption(you, 'Accent', 'Teal')
    await expect(html).toHaveAttribute('data-accent', 'teal')
    await expect.poll(() => storedItem(page, LS_KEYS.theme)).toBe('light')
    await expect.poll(() => storedItem(page, LS_KEYS.accent)).toBe('teal')

    await waitForSaved(page)
    await page.reload()
    await waitForApp(page)
    await expect(html).toHaveAttribute('data-theme', 'light')
    await expect(html).toHaveAttribute('data-accent', 'teal')
  })

  test('show cents changes only the big number', async ({ page }) => {
    await seed(page, 'two-months')
    const home = page.getByTestId('screen-home')
    await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))

    const you = await openSettings(page)
    await setSwitch(you.getByRole('switch', { name: 'Show cents in the big number' }), false)

    await gotoTab(page, 'home')
    await expect(home.getByTestId('hero-left')).toHaveText(figure('370'))
    await expect(home.getByTestId('equation-daily')).toContainText('201,15')
  })

  test('home layout hides and reorders the cards', async ({ page }) => {
    await seed(page, 'two-months')
    const home = page.getByTestId('screen-home')
    await expect(home.getByTestId('equation-income')).toContainText('1.450,00')
    // Nobody owes Alex anything, so the Owed card leaves itself out.
    await expect
      .poll(() => cardOrder(home))
      .toEqual(['Wallet', 'Where it went', 'Limits', 'Coming up', 'Last 6 months', 'Recent'])

    // Recent is last of eight; seven moves take it to the top, where its up button is disabled.
    const layout = await openFromYou(page, 'homeLayout')
    for (const name of HOME_CARDS) await expect(layout.getByRole('switch', { name, exact: true })).toBeChecked()
    const recentUp = layout.getByRole('button', { name: 'Move Recent up' })
    for (let step = 0; step < HOME_CARDS.length - 1 && (await recentUp.isEnabled()); step += 1) await recentUp.click()
    await expect(recentUp).toBeDisabled()
    await setSwitch(layout.getByRole('switch', { name: 'Show the sums above the total' }), false)
    await setSwitch(layout.getByRole('switch', { name: 'Where it went' }), false)

    await gotoTab(page, 'home')
    await expect(home.getByTestId('equation-income')).toBeHidden()
    await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))
    await expect.poll(() => cardOrder(home)).toEqual(['Recent', 'Wallet', 'Limits', 'Coming up', 'Last 6 months'])
  })
})
