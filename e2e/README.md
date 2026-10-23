# End-to-end tests

Playwright specs for the flows in `docs/SPEC.md` §9. `npm run e2e` builds the app, serves it on
`http://127.0.0.1:4173` and runs every spec on WebKit (iPhone 15) and Chromium (Pixel 7) with `de-DE` and
`Europe/Berlin`, two workers and one retry locally. One spec on one project: `npx playwright test e2e/add-expense.spec.ts --project=chromium-mobile`.
The offline spec runs on Chromium only; the lock spec skips only where `crypto.subtle` is missing.

## Chromium only

Where WebKit cannot launch (it is not installed, or an antivirus such as Norton 360 quarantines or
blocks Playwright's WebKit build), run the Chromium project alone. It still builds and serves the
app on port 4173 first:

```sh
npx playwright test --project=chromium-mobile
npx playwright test --project=chromium-mobile --workers=1   # if page loads still time out
```

`npm run e2e -- --project=chromium-mobile` does the same. To get WebKit back, run
`npx playwright install webkit` (and exclude Playwright's browser folder from the antivirus), then
`npx playwright test --project=iphone-webkit`. Chromium does not stand in for Safari: before a
release, run the WebKit project somewhere it launches, or check the flows on the iPhone itself.

## How the specs work

- Import `test` and `expect` from `./fixtures.ts`. Before each test it freezes the clock at
  Wednesday 14 October 2026, 10:00 in Berlin (day 14 of 31, 18 days left including today), marks
  the Safari install hint as dismissed and deletes `navigator.share`/`canShare`, so exports download.
- `seed(page, fixture)` restores a backup through Onboarding → "Restore from a backup" (or
  Home → Settings → Backup → Import once onboarded) and waits on Home until the data is saved.
  `fixture` is a name from `e2e/fixtures` or a changed copy from
  `changedFixture(name, (backup) => { … })`, which leaves the file on disk alone. Only
  `onboarding.spec.ts` walks onboarding.
- The tab bar is Home, Daily, (+), Fixed, Wallet (`tab-home`, `tab-daily`, `tab-add`, `tab-fixed`,
  `tab-wallet`). Settings are the route `you` pushed on Home's stack: `openSettings(page)` goes to
  Home's root and taps the monogram button (`open-settings`); `openFromYou(page, route)` then opens
  a subpage (`screen-you.<route>`).
- Locators use the accessible names of SPEC §3, then the test ids of SPEC §9, scoped to the visible
  screen (`visible(page)` or the `screen-<tab>` returned by `gotoTab`) or the open sheet (`sheet(page, name)`).
- Amounts are matched with `copy()`, `euro()` and `figure()` from `helpers.ts`, which accept any
  space (or none) before "€", including U+00A0 and U+202F. No timeouts: only Playwright's waiting
  assertions.
- Before `page.reload()`, call `waitForSaved(page)` (`html[data-save-state="saved"]`).

## Fixtures

All three are backup files (`app: 'on-a-budget'`, `kind: 'backup'`, `schemaVersion: 1`) in EUR and
`de-DE`, with the default categories and quick adds, already onboarded, and clean: `parseBackup`
neither drops nor repairs anything in them, so an export gives the same data back. Each has the
current data shape: `wallet` is `{ opening: 0, startMonth: null, entries: [], goals: [] }`,
`settings.homeCards` lists all eight cards in default order, and every transaction has
`fromWallet: false` and `splits: []`.

- `two-months.json`: Alex since 1 September 2026 with Job 1.100,00 € and Parents 350,00 € in; Rent 640,00 €, Deutschlandticket 63,00 €, Gym 29,90 € (15th), Spotify 11,99 € (20th), Netflix 13,99 € (22nd), Phone 15,00 € (28th) and Liability insurance 60,00 € yearly spread over 12 months; savings goal 100,00 €; Coffee & snacks limit 40,00 €; 41 expenses (September 425,10 €, October 201,15 € of which Coffee & snacks 31,50 € and today 10,50 €); October: 369,97 € left, 21,13 € a day, 10,63 € left today, Rent and Deutschlandticket paid. September is reviewed (`lastReviewedMonth: '2026-09'`), so Home shows no review banner; `review.spec.ts` seeds a copy with `null`. The wallet counts from September: it holds 246,02 € (100,00 € of savings plus 146,02 € left over) and October adds 469,97 € when it closes. Nobody owes anything, so Home has the Wallet card and no Owed card.
- `empty-onboarded.json`: onboarded on 1 October 2026 with no name, default categories and quick adds, and no income, fixed costs or expenses. `lastReviewedMonth: null`.
- `over-budget.json`: Sam since 1 October 2026 with Job 900,00 € in and Rent 640,00 € out, an Eating limit of 100,00 €, and 9 October expenses of 300,00 € (Eating 120,00 €): 40,00 € over budget, Eating over its limit by 20,00 €. `lastReviewedMonth: null`.

Changed copies used by specs: September not reviewed (`review.spec.ts`), Max owing 9,00 € of
"Bar with friends" (`split-owed.spec.ts`), a backup from 1 September with no `lastBackupAt`, so a
backup is due (`settings-entry.spec.ts`).

## What the specs assume beyond SPEC §9

Where the spec names no label, the specs use these; change the UI or the spec to match.

- Onboarding: `data-step` holds the §3.9 step number (0–7). Welcome's "On a Budget" is a heading.
  About you has a "Name" text field and a "Currency" select. Money in shows one row with a "Name"
  field (filled with "Income") and an "Amount" field, and "Add another" adds a row with the same two
  fields. Fixed costs labels each amount field with its item's name ("Rent", "Deutschlandticket");
  suggestion chips are buttons named after the suggestion. On Welcome, `backup-file-input` is in the
  page (or appears after tapping "Restore from a backup"); tests set its files instead of opening
  the system picker. After a restore, onboarding either continues at the lock step or opens Home.
- The install hint counts as dismissed when `localStorage['onabudget:installHintDismissed']` holds
  any value (the fixture writes "1").
- `html[data-save-state]` reads "saved" whenever nothing is pending, also right after loading.
- Each toast carries `data-testid="toast"`; its action is a button named "Undo".
- Confirmations render as `dialog` or `alertdialog` containing their title; chooseDialog options are
  buttons named by their labels. Sheets are `dialog`s named by their title (`sheetLabel`) and carry
  `data-sheet` with the route name.
- Empty states are a heading plus a paragraph ("Nothing spent this month yet" and "Tap + to add an
  expense."), never one joined text.

### Settings ("You")

- Home's monogram button (`open-settings`) is named "Settings", or "Settings, backup due" with its
  dot (`[data-part="backup-dot"]`). The You screen's back button is "Back to Home"; tapping the
  Home tab pops You and its subpages.
- You's rows are buttons named "Home layout", "Categories 12", "Quick add buttons 3",
  "Owed to you 9,00 €" (or "Owed to you None"), "App lock On" / "App lock Off", and "Backup" or
  "Backup, backup due" (the dot is `backup-due`). Subpages have the back button "Back to You".
- Theme is the combobox "Theme" with "System", "Light" and "Dark". Accent is the radiogroup
  "Accent" with Navy, Royal blue, Teal, Bottle green, Burgundy, Plum, Cognac and Graphite
  (`data-accent` holds the key, e.g. `teal`). Switches "Show cents in the big number" and
  "Hide amounts".
- Home layout has a switch per card named as in `HOME_CARDS` (8 cards: "Show the sums above the
  total", "Wallet", "Owed to you", "Where it went", "Limits", "Coming up", "Last 6 months",
  "Recent") and buttons "Move {name} up" / "Move {name} down"; the top card's up button is disabled.
  The Wallet and Owed cards hide themselves when they have nothing to show.
- Categories lists categories as buttons whose names start with the category name; the category
  sheet has a "Monthly limit" amount field, the icon row `category-icon`, and deleting a used
  category asks in the radiogroup "Move them to" (`move-to`). The quick add sheet's icon row is
  `quick-add-icon`.
- Backup: buttons "Export backup", "Export spending as CSV" and "Import backup"; the footer reads
  "Last backup …". The CSV is UTF-8 with a BOM, CRLF line ends and the eight columns
  `date,type,category,note,amount,currency,my_share,paid_from` (SPEC §4.7).
- App lock lives at Settings → "App lock" (`screen-you.privacy`): the switch "App lock", the PIN
  setup sheet `pinSetup` with the segmented control "PIN length" ("4 digits", "6 digits"), the
  same `keypad-*` and `pin-dots` test ids, and dots cleared for the confirmation. The lock screen
  says "Wrong PIN" after a wrong PIN and clears `pin-dots` to `data-filled="0"`; its Face ID key is
  "Unlock with Face ID" and "Forgot your PIN?" is `lock-forgot`.

### Home

- `hero-left` holds only the figure (its text has no other digits); `hero-per-day`, `hero-today`,
  `hero-ahead` and `hero-wallet` hold the hero's other lines. Home card titles are headings
  (`Section` renders an `h2`), named as in `HOME_CARDS`.
- The ledger rows are `equation-income|fixed|savings|daily|left`, and a past month's
  "Moved to/Taken from your wallet" line is `statement-wallet`. A past month shows the button
  "See the review". With Hide amounts on, the eye button is "Show amounts" / "Hide amounts".
- `budget-row` keeps the `Meter`'s `data-status` (ok, warning, over) inside it. The category
  detail total is `category-total`.
- Coming up has the same paid check as Fixed (`recurring-paid`, "Mark {name} as paid").

### Transaction sheet

- The title "New expense" / "Edit expense" is visible text. Today and Yesterday are buttons with
  `aria-pressed`; "Other date" is a native date input (role textbox: use `getByLabel(/^Other date/)`).
- `category-chip` (with `data-id`), `amount-display`, `sheet-save`, `sheet-delete`.
- Paying from the wallet is the switch "Pay from wallet" (`pay-from-wallet`); the sheet then shows
  `wallet-consequence` ("Wallet after: …"). Splitting: `split-toggle` (named "Split",
  `aria-expanded`), `split-panel`, `split-person` (a "Name" textbox and an amount named
  "{name} owes"), `split-add`, `split-evenly`, `split-share` ("Your share: …").
- Daily rows (`tx-row`, `data-id`) show a split as "Split, Max owes 9,00 €" and "of 18,00 €" with
  the share as the amount, and a wallet payment as "Paid from wallet".
- Quick add tiles (`quick-add`) are named "Add Coffee, 3,50 €" (DESIGN.md §9.23).

### Fixed

- Recurring sheet: "Name" and "Amount" text fields, "Category" and "Usually paid on" selects, a
  "Skip this month" switch and the "Different amount this month" row (`different-amount`), which
  reveals its amount field. "Stop after this month" (or "Stop after October") applies at once and
  closes the sheet, with the toast "Stopped {name} after October" for 6 s. The collapsed group is a
  button or `<summary>` named "Not this month".
- Fixed rows (`recurring-row`) have the paid check "Mark {name} as paid" / "{name} paid"
  (DESIGN.md §9.8). The total row is `fixed-total`, one-off income rows are `income-row`, and the
  add buttons are "Add fixed cost" / "Add income".

### Wallet

- Home's card is the button `wallet-card` ("Wallet, 246,02 €. October adds 469,97 € when it
  closes.") with `wallet-card-balance` and `wallet-card-line`.
- The Wallet screen: `wallet-hero`, `wallet-balance`, `wallet-pending`, `wallet-free`,
  `wallet-add`, `wallet-take`, `wallet-goals`, `goal-row` (`data-id`, `data-phase` reached,
  filling, waiting or empty), `goal-open`, `goal-up`, `goal-down`, `goal-add`, `wallet-done`,
  `goals-done`, `goal-done-row`, `goal-put-back`, `wallet-passbook`, `wallet-row` (`data-kind`
  opening, month, deposit, withdrawal, payment or forward; `data-id` the movement key, e.g.
  `month:2026-09`), `wallet-year`, `wallet-empty`, `wallet-opening-cta`, `wallet-settings`.
- Names: "Fill {name} sooner" / "Fill {name} later", "Done, {n}" (`aria-expanded`),
  "Put back {name}", the table "Passbook" whose lines are buttons named for the whole line
  ("14 October, taken out, …, minus 200,00 €, balance 46,02 €").
- The wallet entry sheet (`walletEntry`) is named "Add money" / "Take money out" / "Edit entry";
  its save button carries the same words; `wallet-consequence` reads "Wallet after: …";
  `wallet-note` is the note. Toasts: "Added 50,00 € to your wallet", "Took 200,00 € out of your
  wallet". The goal sheet (`goal`) is "New goal" / "Edit goal" with "Name", "Target" and
  "Mark as done".

### Review and Owed

- The review banner is `banner-review`, a region named "September is closed" with the buttons
  "See the review" and "Dismiss". It shows on Home's root in the current month only.
- The statement is the sheet `monthReview`, a dialog named "{name} statement" printed on paper
  (`data-material="paper"`), closed with "Close". Ids: `review-result`,
  `review-income|fixed|savings|daily`, `review-result-line`, `review-wallet`, `review-category`,
  `review-biggest`, `review-no-spend-days`, `review-entries`, `review-fixed-paid`, `review-owed`.
- Owed: `owed-card` (rows `owed-person`, `data-id` the name, named "Max owes you 9,00 €, …"),
  `owed-more`, and on the Owed screen `owed-total`, `owed-person-section`, `owed-item`
  (`data-id` `{transaction}:{split}`), `owed-paid` ("Paid back"), `owed-forgive` ("Forgive", asks
  "Forgive {x}?" first), `owed-all`, `owed-settled` (a row; its "Settled, {n}" button carries `aria-expanded`), `owed-settled-item`.
  Toasts: "Max paid back 9,00 €", "Forgave Max 9,00 €".
