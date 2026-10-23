import {
  changedFixture,
  expect,
  gotoTab,
  openFromYou,
  openSettings,
  seed,
  settingsButton,
  test,
  toast,
} from './fixtures.ts'

// Settings open from Home's monogram button (docs/SPEC.md §3, §3.7): it pushes "You" on Home's
// stack, and a dot on it says a backup is due (needsBackupReminder: 10 or more records and no
// backup for more than 30 days).

/** two-months last backed up when the file was written, 1 September: 43 days ago. */
const backupDue = changedFixture('two-months', (backup) => {
  backup.exportedAt = '2026-09-01T08:00:00.000Z'
  backup.data.settings.lastBackupAt = null
})

test.describe('settings entry', () => {
  test("Home's monogram button opens settings, and Back or the Home tab return", async ({ page }) => {
    await seed(page, 'two-months')
    const home = page.getByTestId('screen-home')
    const button = settingsButton(page)
    await expect(button).toHaveAccessibleName('Settings')
    await expect(button.locator('[data-part="backup-dot"]')).toHaveCount(0)
    // The tab bar has no settings tab.
    await expect(page.getByTestId('tab-you')).toHaveCount(0)

    let you = await openSettings(page)
    await expect(page.getByTestId('tab-home')).toHaveAttribute('aria-current', 'page')
    await expect(you.getByRole('button', { name: 'Backup', exact: true })).toBeVisible()
    await expect(you.getByTestId('backup-due')).toHaveCount(0)
    await you.getByRole('button', { name: 'Back to Home' }).click()
    await expect(home).toHaveAttribute('data-active', 'true')

    // Tapping the Home tab pops settings and its subpages back to Home.
    await openFromYou(page, 'homeLayout')
    await gotoTab(page, 'home')
    await expect(page.getByTestId('screen-you.homeLayout')).not.toHaveAttribute('data-active', 'true')
    you = await openSettings(page)
    await expect(you).toHaveAttribute('data-active', 'true')
  })

  test('a due backup puts a dot on the button and the Backup row until a backup is exported', async ({ page }) => {
    await seed(page, backupDue)
    const button = settingsButton(page)
    await expect(button).toHaveAccessibleName('Settings, backup due')
    await expect(button.locator('[data-part="backup-dot"]')).toBeVisible()

    const you = await openSettings(page)
    const row = you.getByRole('button', { name: 'Backup, backup due', exact: true })
    await expect(row).toBeVisible()
    await expect(you.getByTestId('backup-due')).toBeVisible()

    const backup = await openFromYou(page, 'backup')
    const download = page.waitForEvent('download')
    await backup.getByRole('button', { name: 'Export backup', exact: true }).click()
    await download
    await expect(toast(page, 'Backup exported')).toBeVisible()

    await gotoTab(page, 'home')
    await expect(button).toHaveAccessibleName('Settings')
    await expect(button.locator('[data-part="backup-dot"]')).toHaveCount(0)
    const settings = await openSettings(page)
    await expect(settings.getByRole('button', { name: 'Backup', exact: true })).toBeVisible()
    await expect(settings.getByTestId('backup-due')).toHaveCount(0)
  })
})
