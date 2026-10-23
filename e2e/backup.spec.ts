import { readFile } from 'node:fs/promises'
import {
  type BackupFile,
  confirmDialog,
  expect,
  figure,
  gotoTab,
  importBackup,
  openFromYou,
  readFixture,
  seed,
  test,
  toast,
} from './fixtures.ts'

// Home → Settings → Backup (docs/SPEC.md §3.7, §4.7). The fixture removes navigator.share, so both
// exports take the <a download> path; the clock reads 14 Oct 2026, 10:00 in Berlin (08:00 UTC).

/** The data without the backup date, which an export may change. */
function withoutBackupDate(data: BackupFile['data']): BackupFile['data'] {
  return { ...data, settings: { ...data.settings, lastBackupAt: null } }
}

test.describe('backup', () => {
  test('export downloads everything as a dated backup file and a CSV', async ({ page }) => {
    await seed(page, 'two-months')
    const fixture = readFixture('two-months')
    const backup = await openFromYou(page, 'backup')

    const backupDownload = page.waitForEvent('download')
    await backup.getByRole('button', { name: 'Export backup', exact: true }).click()
    const download = await backupDownload
    expect(download.suggestedFilename()).toBe('on-a-budget-backup-2026-10-14.json')
    const text = await readFile(await download.path(), 'utf8')
    const file = JSON.parse(text.replace(/^\uFEFF/, '')) as BackupFile
    expect(file).toMatchObject({ app: 'on-a-budget', kind: 'backup', schemaVersion: 1, exportedAt: '2026-10-14T08:00:00.000Z' })
    // The restored data comes back out unchanged.
    expect(withoutBackupDate(file.data)).toEqual(withoutBackupDate(fixture.data))
    // The app lock never leaves the device.
    expect(text).not.toContain('pinHash')
    await expect(toast(page, 'Backup exported')).toBeVisible()
    await expect(backup.getByText(/Last backup just now/)).toBeVisible()

    const csvDownload = page.waitForEvent('download')
    await backup.getByRole('button', { name: 'Export spending as CSV' }).click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toBe('on-a-budget-spending-2026-10-14.csv')
    const rows = await readFile(await csv.path(), 'utf8')
    // UTF-8 with a byte order mark, CRLF after every row, the eight columns of §4.7.
    expect(rows.startsWith('\uFEFFdate,type,category,note,amount,currency,my_share,paid_from\r\n')).toBe(true)
    // Not split and paid from the budget: the share is the whole amount.
    expect(rows).toContain('\r\n2026-10-10,expense,Eating,Pizza,12.90,EUR,12.90,budget\r\n')
    expect(rows.split('\r\n')).toHaveLength(fixture.data.transactions.length + 2)
  })

  test('import asks first, replaces everything, and Undo brings the old data back', async ({ page }) => {
    await seed(page, 'two-months')
    await importBackup(page, 'over-budget')

    const dialog = confirmDialog(page, 'Replace everything on this iPhone?')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/The backup from .+ has 9 entries and 2 fixed costs and income items\./)
    await expect(dialog).toContainText('This iPhone has 41 entries')
    await expect(dialog).toContainText('Settings and categories are replaced too.')
    await dialog.getByRole('button', { name: 'Replace', exact: true }).click()
    await expect(dialog).toBeHidden()

    const home = await gotoTab(page, 'home')
    await expect(home.getByText('Over budget by', { exact: true })).toBeVisible()
    await expect(home.getByTestId('hero-left')).toHaveText(figure('40,00'))

    // One toast at a time: by now the seed's own "Backup restored" has made way for this one.
    const restored = toast(page)
    await expect(restored).toHaveCount(1)
    await expect(restored).toContainText('Backup restored')
    await restored.getByRole('button', { name: 'Undo' }).click()
    await expect(home.getByText('Left to spend', { exact: true })).toBeVisible()
    await expect(home.getByTestId('hero-left')).toHaveText(figure('369,97'))
  })
})
