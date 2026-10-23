import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page } from '@playwright/test'
import type { AppData } from '../src/domain/types.ts'

/**
 * Helpers shared by the specs (docs/SPEC.md §9). Locators prefer the accessible names of SPEC §3,
 * then the test ids of SPEC §9, and are scoped to the visible screen or the open sheet.
 */

// ---------------------------------------------------------------------------------------------
// Seed data

/**
 * The file "Export backup" writes. src/domain/backup.ts defines it too, but that module imports
 * through the app's "@/" alias, which the Node side of the tests cannot resolve.
 */
export interface BackupFile {
  app: 'on-a-budget'
  kind: 'backup'
  schemaVersion: number
  exportedAt: string
  data: AppData
}

/** Backups in e2e/fixtures; e2e/README.md describes each one. */
export type FixtureName = 'two-months' | 'empty-onboarded' | 'over-budget'

/** What a spec seeds or imports: a fixture by name, or a changed copy of one (changedFixture). */
export type Fixture = FixtureName | BackupFile

export function fixturePath(name: FixtureName): string {
  return fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url))
}

/** A fresh copy of a fixture's backup file, parsed from disk on every call. */
export function readFixture(name: FixtureName): BackupFile {
  return JSON.parse(readFileSync(fixturePath(name), 'utf8')) as BackupFile
}

/**
 * A copy of a fixture changed for one spec, e.g. a month nobody has reviewed yet:
 * changedFixture('two-months', (backup) => { backup.data.settings.lastReviewedMonth = null }).
 * The file on disk stays as it is.
 */
export function changedFixture(name: FixtureName, change: (backup: BackupFile) => void): BackupFile {
  const backup = readFixture(name)
  change(backup)
  return backup
}

/** The file the backup input receives: the fixture's path, or a changed copy as an in-memory file. */
function backupUpload(fixture: Fixture): string | { name: string; mimeType: string; buffer: Buffer } {
  if (typeof fixture === 'string') return fixturePath(fixture)
  return {
    name: `on-a-budget-backup-${fixture.exportedAt.slice(0, 10)}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture, null, 2), 'utf8'),
  }
}

// ---------------------------------------------------------------------------------------------
// Text patterns

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * UI copy as a pattern that ignores how amounts are spaced: Intl puts a no-break space (U+00A0)
 * or a narrow one (U+202F) before "€", and big figures put the unit in an element of its own with
 * no space at all. Each run of whitespace in `text` matches any whitespace or none, a minus
 * matches both "-" and "−" (U+2212), and an apostrophe both "'" and "’". The pattern is not
 * anchored: it finds the copy inside longer text.
 */
export function copy(text: string): RegExp {
  const source = escapeRegExp(text)
    .replace(/[\s  ]+/g, '\\s*')
    .replace(/[-−]/g, '[-−]')
    .replace(/['’]/g, "['’]")
  return new RegExp(source)
}

/** An amount in the de-DE format: euro('1.450,00') finds "1.450,00 €". */
export function euro(amount: string): RegExp {
  return copy(`${amount} €`)
}

/**
 * A big figure: the element's text holds this amount and no other digit, so figure('370') matches
 * "370 €" but not "369,97 €" (a sign or a visually hidden label around it is fine).
 */
export function figure(amount: string): RegExp {
  return new RegExp(`^[^\\d]*${escapeRegExp(amount)}\\s*€[^\\d]*$`)
}

/** A month switcher label: monthTitle('October') matches "October" but not "October 2027". */
export function monthTitle(name: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(name)}(?!\\s*\\d)`)
}

// ---------------------------------------------------------------------------------------------
// Where things are

/** The tab bar: Home, Daily, (+), Fixed, Wallet (§3). The (+) is tab-add and opens a sheet. */
export type TabId = 'home' | 'daily' | 'fixed' | 'wallet'

/** The screen on top: the tab root or pushed screen that carries data-active="true" (§5.5). */
export function visible(page: Page): Locator {
  return page.locator('[data-testid^="screen-"][data-active="true"]').last()
}

/** The open sheet registered under `name` (SheetHost puts the name in data-sheet). */
export function sheet(page: Page, name: string): Locator {
  return page.locator(`[data-testid="sheet"][data-sheet="${name}"]`).last()
}

/** A row by the record it shows (rows carry data-id, §9). */
export function byId(scope: Locator, testId: string, id: string): Locator {
  return scope.locator(`[data-testid="${testId}"][data-id="${id}"]`)
}

/** The toast, optionally only while it says `text`. */
export function toast(page: Page, text?: string | RegExp): Locator {
  const toasts = page.getByTestId('toast')
  return text === undefined ? toasts : toasts.filter({ hasText: text })
}

/** A confirmDialog (rendered by ConfirmHost) by its title. */
export function confirmDialog(page: Page, title: string): Locator {
  return page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: title })
}

// ---------------------------------------------------------------------------------------------
// Starting the app

export async function isIOS(page: Page): Promise<boolean> {
  return page.evaluate(() => /iPhone|iPad|iPod/.test(navigator.userAgent))
}

/** lockSupport().pin: PIN hashing needs WebCrypto, which needs a secure context (§3.8). */
export async function lockSupported(page: Page): Promise<boolean> {
  return page.evaluate(() => window.isSecureContext && globalThis.crypto?.subtle !== undefined)
}

/** Waits until the loading screen has gone: onboarding, the lock screen or the tabs. */
export async function waitForApp(page: Page): Promise<void> {
  const ready = page
    .getByTestId('install-gate')
    .or(page.getByTestId('onboarding'))
    .or(page.getByTestId('lock-screen'))
    .or(page.getByTestId('tab-home'))
  await expect(ready.first()).toBeVisible()
}

export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/')
  await waitForApp(page)
}

/**
 * Waits until the last change is in IndexedDB (§5.4 rule 10). A change queues its save in a
 * microtask, so one frame and a task go by first; then the root must read data-save-state="saved".
 */
export async function waitForSaved(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))))
  await expect(page.locator('html[data-save-state="saved"]')).toBeAttached()
}

export async function storedItem(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), key)
}

// ---------------------------------------------------------------------------------------------
// Onboarding (§3.9; data-step carries the step number)

function onboardingStep(page: Page, step: number): Locator {
  return page.getByTestId('onboarding').and(page.locator(`[data-step="${step}"]`))
}

/** Taps "Continue in Safari" when the install gate shows (iOS Safari only) and waits for Welcome. */
export async function continuePastInstallGate(page: Page): Promise<void> {
  const gate = page.getByTestId('install-gate')
  const welcome = onboardingStep(page, 1)
  await expect(gate.or(welcome).first()).toBeVisible()
  if (await gate.isVisible()) await gate.getByRole('button', { name: 'Continue in Safari' }).click()
  await expect(welcome).toBeVisible()
}

/** After Fixed costs: skips Spent so far, the lock offer and starts budgeting, whichever show. */
async function finishLastSteps(page: Page): Promise<void> {
  const home = page.getByTestId('tab-home')
  const spentSoFar = onboardingStep(page, 5)
  const lock = onboardingStep(page, 6)
  const done = onboardingStep(page, 7)
  // Spent so far shows after the period's first day, the lock offer only in a secure context.
  await expect(home.or(spentSoFar).or(lock).or(done).first()).toBeVisible()
  if (await spentSoFar.isVisible()) {
    await spentSoFar.getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(home.or(lock).or(done).first()).toBeVisible()
  }
  if (await lock.isVisible()) {
    await lock.getByRole('button', { name: 'Not now' }).click()
    await expect(home.or(done).first()).toBeVisible()
  }
  if (await done.isVisible()) await done.getByRole('button', { name: 'Start budgeting' }).click()
  await expect(home).toBeVisible()
}

/** The shortest way through onboarding: every optional step skipped. */
export async function finishOnboarding(page: Page): Promise<void> {
  await continuePastInstallGate(page)
  await onboardingStep(page, 1).getByRole('button', { name: 'Get started' }).click()
  const aboutYou = onboardingStep(page, 2)
  await aboutYou.getByRole('button', { name: 'Continue', exact: true }).click()
  const moneyIn = onboardingStep(page, 3)
  await moneyIn.getByRole('button', { name: 'Skip for now' }).click()
  const fixedCosts = onboardingStep(page, 4)
  await fixedCosts.getByRole('button', { name: 'Skip for now' }).click()
  await finishLastSteps(page)
}

// ---------------------------------------------------------------------------------------------
// Navigation

/** Taps a tab and returns its root screen; tapping the tab that shows pops it to its root (§5.5). */
export async function gotoTab(page: Page, tab: TabId): Promise<Locator> {
  await page.getByTestId(`tab-${tab}`).click()
  const root = page.getByTestId(`screen-${tab}`)
  await expect(root).toHaveAttribute('data-active', 'true')
  return root
}

/** Home's settings button (open-settings): "Settings", or "Settings, backup due" with the dot (§3). */
export function settingsButton(page: Page): Locator {
  return page.getByTestId('screen-home').getByTestId('open-settings')
}

/**
 * Opens settings, "You" (§3.7): Home at its root, then the monogram button, which pushes the route
 * 'you' on Home's stack. Returns screen-you.
 */
export async function openSettings(page: Page): Promise<Locator> {
  await gotoTab(page, 'home')
  const button = settingsButton(page)
  await expect(button).toHaveAccessibleName(/^Settings(, backup due)?$/)
  await button.click()
  const you = page.getByTestId('screen-you')
  await expect(you).toHaveAttribute('data-active', 'true')
  return you
}

/**
 * Settings subpages and the row that opens each (§3.7, §5.5). The rows are named "Home layout",
 * "Categories 12", "Quick add buttons 3", "Backup" or "Backup, backup due", "App lock On" or
 * "App lock Off".
 */
const YOU_ROWS = {
  homeLayout: 'Home layout',
  categories: 'Categories',
  quickAdds: 'Quick add buttons',
  backup: 'Backup',
  privacy: 'App lock',
} as const

/** Home → Settings → a subpage; returns its screen (screen-you.<route>). */
export async function openFromYou(page: Page, route: keyof typeof YOU_ROWS): Promise<Locator> {
  const you = await openSettings(page)
  const name = new RegExp(`^${escapeRegExp(YOU_ROWS[route])}`)
  await you.getByRole('button', { name }).or(you.getByRole('link', { name })).first().click()
  const screen = page.getByTestId(`screen-you.${route}`)
  await expect(screen).toHaveAttribute('data-active', 'true')
  return screen
}

// ---------------------------------------------------------------------------------------------
// Controls

/** Turns a switch on or off. The keyboard activates it wherever its styled track sits. */
export async function setSwitch(toggle: Locator, on: boolean): Promise<void> {
  if ((await toggle.isChecked()) !== on) await toggle.press('Space')
  await expect(toggle).toBeChecked({ checked: on })
}

/**
 * Picks `option` in the group labelled `group`: a native select (SelectField), a radio group
 * (SegmentedControl, ColorSwatches) or a tab list.
 */
export async function chooseOption(scope: Locator, group: string, option: string): Promise<void> {
  const select = scope.getByRole('combobox', { name: group, exact: true })
  const radios = scope.getByRole('radiogroup', { name: group, exact: true })
  const tabs = scope.getByRole('tablist', { name: group, exact: true })
  await expect(select.or(radios).or(tabs).first()).toBeAttached()
  if ((await select.count()) > 0) {
    await select.selectOption({ label: option })
  } else if ((await radios.count()) > 0) {
    const radio = radios.getByRole('radio', { name: option, exact: true })
    if (!(await radio.isChecked())) await radio.press('Space')
    await expect(radio).toBeChecked()
  } else {
    await tabs.getByRole('tab', { name: option, exact: true }).click()
  }
}

/** Taps a chip-like choice (button, tab or radio) by name and returns it. */
export async function pick(scope: Locator, name: string): Promise<Locator> {
  const radio = scope.getByRole('radio', { name, exact: true })
  const choice = scope.getByRole('button', { name, exact: true }).or(scope.getByRole('tab', { name, exact: true })).or(radio).first()
  await expect(choice).toBeAttached()
  if ((await radio.count()) > 0) await radio.first().press('Space')
  else await choice.click()
  return choice
}

/** A chip, tab or segment shows as chosen: checked, or aria-selected, aria-pressed or aria-checked. */
export async function expectSelected(item: Locator): Promise<void> {
  await expect
    .poll(() =>
      item.evaluate((element) =>
        element instanceof HTMLInputElement
          ? element.checked
          : ['aria-selected', 'aria-pressed', 'aria-checked'].some((name) => element.getAttribute(name) === 'true'),
      ),
    )
    .toBe(true)
}

/**
 * Types an amount into an AmountField (the system keyboard's text field, DESIGN.md §9.14), as a
 * finger would: tap, then type. A focused field swaps the formatted "13,99 €" for the plain "13,99"
 * it edits, so the text is filled only once that has happened; filling at once could land behind
 * the swap ("13,9915,99").
 */
export async function fillAmount(field: Locator, amount: string): Promise<void> {
  await field.focus()
  await expect(field).toHaveValue(/^[-−]?[\d.,]*$/)
  await field.fill(amount)
  await expect(field).toHaveValue(amount)
}

/** Taps keypad keys (test ids keypad-0…9 and keypad-dec) inside `scope`: "3,50", "1234". */
export async function typeKeys(scope: Locator, keys: string): Promise<void> {
  for (const key of keys) {
    const id = /^\d$/.test(key) ? key : key === ',' || key === '.' ? 'dec' : null
    if (id === null) throw new Error(`The keypad has no key for "${key}".`)
    await scope.getByTestId(`keypad-${id}`).click()
  }
}

// ---------------------------------------------------------------------------------------------
// Transactions

/** Opens a new expense with the (+) tab button. */
export async function openAddSheet(page: Page): Promise<Locator> {
  await page.getByTestId('tab-add').click()
  const add = sheet(page, 'transaction')
  await expect(add).toBeVisible()
  await expect(add.getByText('New expense', { exact: true }).first()).toBeVisible()
  return add
}

/** Types an amount on the transaction sheet's keypad, e.g. typeAmount(page, '3,50'). */
export async function typeAmount(page: Page, amount: string): Promise<void> {
  await typeKeys(sheet(page, 'transaction'), amount)
}

/** Writes the note, then leaves the field so the keypad shows again (§3.4 item 6). */
export async function writeNote(add: Locator, note: string): Promise<void> {
  const field = add.getByRole('textbox', { name: 'Note' })
  await field.fill(note)
  await field.blur()
  await expect(add.getByTestId('keypad-1')).toBeVisible()
}

/** Taps the row's title, which opens its sheet. */
export async function openRow(row: Locator, title: string): Promise<void> {
  await row.getByText(title, { exact: true }).first().click()
}

// ---------------------------------------------------------------------------------------------
// Backups

/**
 * Hands a backup file to the hidden backup-file-input. Tests set the input's files instead of
 * opening the system picker; `trigger` is tapped first only when the input is not in the page yet.
 */
async function chooseBackupFile(page: Page, trigger: Locator, fixture: Fixture): Promise<void> {
  const input = page.getByTestId('backup-file-input')
  if ((await input.count()) === 0) await trigger.click()
  await input.setInputFiles(backupUpload(fixture))
}

/** Confirms "Replace everything on this iPhone?" (§3.7). */
export async function confirmReplace(page: Page): Promise<void> {
  const dialog = confirmDialog(page, 'Replace everything on this iPhone?')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** Home → Settings → Backup → Import backup with a fixture; the confirmation stays open for the caller. */
export async function importBackup(page: Page, fixture: Fixture): Promise<Locator> {
  const backup = await openFromYou(page, 'backup')
  await chooseBackupFile(page, backup.getByRole('button', { name: 'Import backup' }), fixture)
  return backup
}

/**
 * Starts the app with a fixture's data: restores it through Onboarding → "Restore from a backup"
 * on a fresh install, or through Home → Settings → Backup → Import when the app is already set up,
 * then waits on Home until the data is saved.
 */
export async function seed(page: Page, fixture: Fixture): Promise<void> {
  await gotoApp(page)
  if (await page.getByTestId('tab-home').isVisible()) {
    await importBackup(page, fixture)
    await confirmReplace(page)
    await gotoTab(page, 'home')
  } else {
    await continuePastInstallGate(page)
    const welcome = onboardingStep(page, 1)
    await chooseBackupFile(page, welcome.getByRole('button', { name: 'Restore from a backup' }), fixture)
    await confirmReplace(page)
    // The lock is not part of backups, so onboarding continues at the lock step (§3.9).
    await finishLastSteps(page)
  }
  await expect(page.getByTestId('screen-home')).toHaveAttribute('data-active', 'true')
  await waitForSaved(page)
}

// ---------------------------------------------------------------------------------------------
// App lock

/** Enters a PIN twice in the PIN setup sheet: its length ("PIN length"), then choose and confirm. */
async function choosePin(setup: Locator, pin: string): Promise<void> {
  await chooseOption(setup, 'PIN length', `${pin.length} digits`)
  await typeKeys(setup, pin)
  // The confirmation starts with empty dots.
  await expect(setup.getByTestId('pin-dots')).toHaveAttribute('data-filled', '0')
  await typeKeys(setup, pin)
}

/** Home → Settings → App lock → turns the lock on with a 4-digit PIN (§3.8). */
export async function enablePin(page: Page, pin: string): Promise<void> {
  const privacy = await openFromYou(page, 'privacy')
  const toggle = privacy.getByRole('switch', { name: 'App lock' })
  await expect(toggle).not.toBeChecked()
  await toggle.press('Space')
  const setup = sheet(page, 'pinSetup')
  await expect(setup).toBeVisible()
  await choosePin(setup, pin)
  // PBKDF2 with 210,000 iterations takes a moment.
  await expect(setup).toBeHidden({ timeout: 15_000 })
  await expect(toggle).toBeChecked()
}

export function lockScreen(page: Page): Locator {
  return page.getByTestId('lock-screen')
}

/** Types the PIN on the lock screen and waits for it to go. */
export async function unlock(page: Page, pin: string): Promise<void> {
  const lock = lockScreen(page)
  await expect(lock.getByTestId('pin-dots')).toHaveAttribute('data-filled', '0')
  await typeKeys(lock, pin)
  await expect(lock).toBeHidden({ timeout: 15_000 })
}
