# On a Budget: product and technical spec

On a Budget is a private monthly budget app for one person's iPhone. It is an installable web app
(PWA): opened once in Safari, added to the Home Screen, then it runs full screen, works offline and
keeps every number on the device. No accounts, no server, no analytics.

- This document is the source of truth for behaviour and architecture.
- `docs/DESIGN.md` is the source of truth for the visual design (tokens, type, components), with
  `docs/design/EXTRAS.md` for the month review, split bills, "Owed to you" and the settings entry.
- `src/domain/types.ts` is the data contract.

When code and spec disagree, fix the code or change the spec deliberately. Section numbers are
referenced from code comments and agent reports, so keep them stable.

---

## 1. Platform and privacy

- The owner develops on Windows. A native iOS app needs a Mac, Xcode and a paid developer account,
  so this is a PWA.
- Installed from Safari it opens without browser chrome, works offline through a service worker,
  and can unlock with Face ID through a passkey (WebAuthn).
- Data lives in IndexedDB inside the installed Home Screen app. The app never sends data anywhere.
  Its only network traffic is the service worker fetching new versions of the app from its own
  host. Anyone else who opens the URL gets their own empty app.
- iOS facts the design depends on (verified October 2026):
  - A Home Screen web app has storage of its own, separate from Safari. Data entered in Safari does
    not appear in the installed app, and Safari may delete a site's storage after 7 days of Safari
    use without visiting it. The installed app is exempt from that rule.
  - Removing the app from the Home Screen deletes its data. A new install starts empty.
  - The storage, the passkey and the install are tied to the origin (host plus path). The app must
    be deployed to one address that never changes.
  - Install steps on iOS 26: in Safari tap ••• next to the address bar (or Share if visible), tap
    Share, then Add to Home Screen (it may be under View More), leave Open as Web App on, tap Add.
    Then open the app from the Home Screen.

## 2. Core jobs

1. See how much is left to spend this month, and today. (Home)
2. Log daily spending in seconds: two taps with a quick-add button, about five with the keypad.
3. Keep fixed costs (rent, subscriptions, transport pass, phone, insurance) and recurring income in
   one place, counted automatically every month. (Fixed)
4. See where the money goes by category, with optional monthly limits. (Home, category detail)
5. Make it personal: name, currency and number format, theme and accent colour, categories (icon,
   colour, limit), quick-add buttons, Home layout, the day the month starts, app lock. (You)

---

## 3. Screens and flows

Bottom tab bar: **Home · Daily · (+) · Fixed · Wallet**. The (+) opens the transaction sheet for a
new expense; a long press on it offers the quick adds as an action sheet (tap one to add it at once).
Settings ("You", §3.7) open from the monogram and greeting at the top of Home (route `you`, pushed on
the Home stack), like the account button in Apple's own apps; the backup reminder dot sits on that
monogram (accessible name "Settings, backup due"). Home, Daily and Fixed share one selected month (§5.5) shown by the `MonthSwitcher`.

Naming periods (§4.3): a period is named after the month it starts in ("October"). With a start day
other than 1 the name is always accompanied by its range ("25 Oct – 24 Nov"). Sentences about the
selected period say "this month" when it is the current period, otherwise its name ("October 2026").

### 3.1 Home

1. **Nav row**: eyebrow with the monogram (or chosen emoji) and "Hi, {name}" ("Hi there" without
   a name); trailing, the `MonthStepper` glass capsule (previous/next month) and, when `hideAmounts`
   is on, an eye button ("Show amounts" / "Hide amounts"). (Daily's eyebrow is "Daily spending",
   Fixed's is "Fixed costs and income"; both carry the stepper too.)
2. **MonthTitle** as the large title (serif month name with a chevron that opens the month picker;
   away from the current period, the "Back to this month" pill sits beside it). When the hero scrolls
   away, the compact header (opaque `--bg`, continuing the iOS status bar) shows the period name and
   under it the figure with its state: "234,72 € left", "58,82 € left over", "571,12 € planned",
   "41,28 € over budget", "1.115,28 € spent" or "Short by 158,88 €". It never repeats the hero's
   label word for word: the compact header stays in the DOM, and e2e finds the label by its exact
   text.
3. **Hero (always shown)**, a ledger of the month (visual design in DESIGN.md):
   - Sum rows (hidden when the `equation` Home card is off): Income (+), Fixed costs (−), Savings
     (−, hidden when 0), Daily spending (−). Rows open: Income → Fixed tab, Income segment; Fixed
     costs → Fixed tab; Savings → savings sheet for the selected month; Daily spending → Daily tab.
   - The result: a state label, the big figure (`BigAmount`), a sentence, and the `PaceBar`, per
     this table. Never show a negative per-day amount.

   | Period | Condition | Label | Figure | Sentence | PaceBar |
   |---|---|---|---|---|---|
   | current | income = 0 | Spent this month | spent | button "Add your income" | no |
   | current | available ≤ 0 | Over budget by (warning icon) | −left, critical ink | "Fixed costs and savings are more than this month's income." + button "Review fixed costs" | no |
   | current | left < 0 | Over budget by (warning icon) | −left, critical ink | "Spent {daily} of {available} for daily life." | full, overflow marker |
   | current | left ≥ 0, daysLeft > 1 | Left to spend | left | "About {perDay} a day for the next {daysLeft} days" + line "Today: {todayLeft} left" or "Today: {−todayLeft} over" | yes |
   | current | left ≥ 0, daysLeft = 1 | Left to spend | left | "Last day of this month." + the Today line | yes |
   | past | income = 0 | Spent | spent | none | no |
   | past | left ≥ 0 | Left over | left | "You spent {daily} on daily life." | yes, no notch |
   | past | left < 0 | Over budget by | −left | "You spent {daily} on daily life." | full, overflow |
   | future | available ≥ 0 | Planned | available | "{perDay} a day across {days} days" | no |
   | future | available < 0 | Short by | −available | "Fixed costs and savings are more than the income planned." | no |

   - The label row carries a trailing status for the current period: "On track" (`--ink-2`,
     check-circle) or "Spending fast" (warning icon and ink) from the pace status.
   - PaceBar status `ahead` adds a line with the warning icon: "{x} more than planned by today",
     where x = daily − floor(available × dayIndex / days). Status `over` reads "Over budget".
   - Past periods read as a closed statement: the sum rows are titled "Statement for {name}", and
     the brass Closed seal with "Closed {last day, short date}" sits beside the figure. Under the
     sum rows a line says where the month's result went: "Moved to your wallet: {result}" or "Taken
     from your wallet: {−result}" (result = savings + left, §4.8).
   - Current period over budget (both rows, left < 0 and available ≤ 0): a line in secondary ink
     that says what the overspend does to the wallet, only when the wallet counts the period (the
     period ≥ the wallet's start). With result = savings + left (§4.8), the amount the wallet gets
     when the period closes:
     - result > 0: "Your savings cover it. October still adds 58,72 € to your wallet."
     - result = 0: "Your savings cover it."
     - result < 0 with savings > 0: "Your savings cover part of it. 12,00 € comes out of your wallet
       when October closes." (the amount is −result)
     - no savings: "That comes out of your wallet when October closes."
   - The hero figure changes with the odometer roll (DESIGN.md §3.3), never a crossfade.
   - "Add your income" asks `chooseDialog`: "Every month" (recurring sheet, income) or "Just this
     month" (transaction sheet, income).
4. **Cards**, in `settings.homeCards` order; a card with nothing to show is hidden:
   - `whereItWent` **Where it went**: daily spending only (expense transactions of the period) as a
     `StackedBar` by category, top 5 plus a folded segment "{n} more" when two or more categories
     remain (a single remaining category shows by name; never "Other"; tapping the fold expands the
     legend). Legend rows: icon, name, amount, share; tap opens category detail. Under
     the legend one line "Plus {fixed} in fixed costs" that opens Fixed. Hidden with no expenses.
   - `wallet` **Wallet** (§3.12): the wallet balance as a serif figure (critical ink and "short"
     wording when negative), then for the current period "October adds {x} when it closes" (or
     "takes {x} out" when this month's result is negative), for a past period the wallet counts
     "{name} added {x}" (or "took {x} out"), and no line for a future period or one before the
     wallet's start; tap opens the Wallet screen. Hidden while the wallet has nothing to show
     (balance 0, nothing pending, no movement other than 0,00 €).
   - `owed` **Owed to you** (§3.16): hidden while nobody owes anything.
   - `budgets` **Limits**: one `Meter` row per non-archived category with a budget, at most 5 (over
     first, then warning, then highest share), then "Show all {n}" (opens Categories). Each row:
     "{spent} of {budget}", status icon and text ("{x} left" / "Over by {x}"). Tap opens category
     detail. A future period shows the card only once something counts against a limit. With no
     limits, the current period shows "No monthly limits yet." and a "Set a limit" button (opens
     Categories); other periods leave the card out.
   - `comingUp` **Coming up** (current period only): `upcomingFixed` lines (unpaid, not skipped, due
     today or later in the period), max 4, with a due label ("Today", "Tomorrow", "In 5 days", "Sun
     25 Oct") and the kit `PaidCheck` (DESIGN §9.8; "Mark {name} as paid", test id
     `recurring-paid`). Ticking it runs `setOverride(month, id, { paid: true })` through `withUndo`
     with the toast "Marked {name} as paid", and the row leaves the card. Hidden when empty.
   - `trend` **Last 6 months** ("6 months to {name}" when not current): stacked columns, fixed vs
     daily, legend, tap a column for a tooltip with fixed, daily and income. Only periods ≥
     `firstPeriod`; hidden until two periods have a fixed line or an expense.
   - `recent` **Recent**: last 5 expenses of the period; "See all" opens Daily. Empty, the current
     period shows "No expenses yet. Tap + to add one."; other periods leave the card out.
   - Titles follow the selected period ("This month" vs the period name).
   - The `equation` key does not render a card; it toggles the sum rows inside the hero.
   - When no card has real content (the Limits and Recent invitations above do not count), Home
     shows the EmptyState "Your month starts here" / "Add what you spend with + and the app does the
     sums." in place of the cards, so a first run gets one invitation, not two empty cards.
5. **Banners** (§3.10, §3.15) sit in the Screen's banner slot, under the title row and above the
   hero: storage banners, then at most one other, the first that applies of update ready, the
   install hint (Safari only), the review banner (current period only) and the backup nudge.

### 3.2 Category detail

Pushed onto the current tab's stack. Opens from: Where it went rows, Limits rows, the category row
on Daily and Fixed when a chip is selected, and the category sheet's "See spending" button.

Header: category badge and name, "Edit" button (opens the category sheet; hidden for
Uncategorized). Body: `MonthSwitcher` (compact), the period total (fixed plus daily, test id
`category-total`), the budget `Meter` if set, a daily `ColumnChart` for this category (hidden when
it has no expenses in the period), then sections with day-style headers (Headline):

- "Fixed costs", with its subtotal: the category's fixed costs. A row's subtitle is its schedule,
  with ", paid" added once it is ticked off (this screen has no paid check), "Skipped this month" or
  "Set aside {x} this month".
- "This month" (the period's name in other periods) with "{n} entries" ("1 entry"): its expenses as
  `TransactionRow` with `showDate` and `showCategory={false}`, so line 2 shows the day ("Today",
  "Thu 15 Oct") instead of the category's own name. Empty: "Nothing spent this month." ("Nothing
  spent in {name}.").
- An "Add expense" line under the list opens the transaction sheet with `{ categoryId }`. It is
  hidden for Uncategorized and for archived categories.
- "Last 6 months" (`categoryTrend`; "6 months to {name}" when not current) at the bottom.

Fixed costs and expenses open for editing. A category deleted while its screen is open shows "This
category was deleted".

### 3.3 Daily

Daily-life spending entered by hand. Top to bottom:

1. Large title `MonthSwitcher`; header search button; eye button when `hideAmounts` is on.
2. Summary sentence: current or past "{total} spent, about {avg} a day" (`dailyAverage`); future
   "{total} planned".
3. `ColumnChart` (96px) of spending per day for the current filter. In the current period the
   allowance line "{perDay} a day" is drawn only from today to the end of the period (it is the
   allowance for the remaining days); past periods show the plain bars with a line "Daily budget
   {x}" at floor(available / days) when available > 0. Both lines describe all daily spending, so
   they show only with "All".
4. **Quick add** strip (current period only): one tile per `QuickAdd` (icon, label, amount and a "+"
   glyph so it reads as one-tap logging), then "Edit" (navigates to Home → You → Quick add). Tap adds an
   expense dated today and shows the toast "Added 3,50 € to Coffee & snacks" with Undo. When the
   selected period is not current, the strip is replaced by a "Back to this month" pill.
5. **Category sub-tabs** (`ChipTabs`), directly above the list they filter: "All", then
   non-archived categories of kind `daily` or `both`, plus any category with expenses in this period.
   With a category selected: a `ListRow` (badge, name, "{total} this month" covering fixed plus
   daily, chevron) that opens category detail, and its `Meter` when it has a budget. The chosen chip
   lives in nav (`dailyCategory`, §5.5), so it survives tab switches, and while Daily's root is
   showing it is the category of a new expense from (+) (§3.4).
6. **List** grouped by date, newest first. Group header "Today", "Yesterday" or "Wed 14 Oct" plus the
   day total. Row: category badge, title = note (or category name), subtitle = category name when a
   note exists, amount right-aligned. Tap opens the edit sheet. No swipe actions in v1.
7. Search (header button) reveals a field; it searches notes and category names across all periods,
   results grouped by period.

Expenses only. One-off income lives under Fixed → Income. Empty: "Nothing spent this month yet"
with "Tap + to add an expense." in the current period; "Nothing spent in September 2026" in a past
one and "Nothing planned for November 2026" in a future one, without a message. With a chip chosen
the title names it: "Nothing spent on Eating this month yet".

### 3.4 Transaction sheet

The (+) button opens it for a new expense. One-off income uses the same sheet with kind `income`,
opened from Fixed → Income ("Add one-off income"), the hero's "Add your income", or the equation's
Income row. Editing never changes the kind.

Routes (`SheetRoute` 'transaction', §5.5): no fields for a new expense; `{ kind: 'income' }` for
one-off income; `{ categoryId }` preselects that category, only when it is active; `{ id }` edits,
taking the kind from the stored entry. An `{ id }` that no longer exists shows "This entry no longer
exists" / "It was deleted. Close this sheet to go back."

Layout, top to bottom; it must fit a 375×667 screen with the keypad visible and no scrolling:

1. Grab handle and `SheetHeader`: "Cancel", title "New expense" / "Edit expense" / "One-off income"
   / "Edit income". For expenses the header's action is the "Split" capsule (§3.16).
2. Amount display (figures font, `aria-live="polite"`, label "Amount", test id `amount-display`)
   with a consequence line above or below it for a new expense dated today in the current period:
   "Leaves {todayLeft − amount} for today" in secondary ink, "{x} over today's budget" in warning ink
   when it exceeds today's allowance, and in critical ink when it would make the month's `left`
   negative. Hidden for other dates, other periods, income and while the amount is 0. For expenses
   the line keeps its slot while hidden, so the sheet never changes height while typing; one-off
   income reserves no slot (its group sits 18 under the figure).
3. Expenses: category chips in one horizontally scrolling row in category order, kind `daily` and
   `both`, the selected chip scrolled into view, ending with "All categories", which adds the
   `fixed`-only ones. Default category: the one passed in (`{ categoryId }`: category detail's "Add
   expense", or (+) over a category detail or Daily's chip, §5.5), else `lastUsedCategoryId`, else
   the first daily category. Income: no categories.
4. Note field (label "Note", "From" for income), 16px+, max 80 characters. While the note is empty,
   up to 4 `frequentEntries` suggestion chips for the chosen category sit inside the Note row, to
   the right of the narrowed field, so they add no row (DESIGN.md §9.16); tapping one fills note and
   amount.
5. Date chips "Today", "Yesterday", and "Other" with a calendar glyph (shows the picked date once
   chosen, e.g. "Wed 14 Oct"). A native `<input type="date">` lies over the third chip (opacity 0,
   font-size 16px). An empty value is ignored. Default date: today, always (even when another period
   is selected).
6. `Keypad` (4 rows) with the locale's decimal separator (none for 0-digit currencies). Hidden while
   the note field has focus.
7. Primary button directly under the keypad (test id `sheet-save`): "Add expense", "Add income" or
   "Save changes", disabled until the amount is > 0 and (expenses) a category is chosen.
8. Editing: "Delete" (test id `sheet-delete`) sits beside "Save changes" in the button row (the
   header's trailing slot belongs to "Split", and a row of its own would break the 375×667 budget).
   It runs through `withUndo` ("Deleted {note or category}").

With a split (§3.16) the line under the amount gains "Your share" above the consequence, 22pt more.
Under 700pt of height the sheet takes those 22pt from its gaps, so it still fits 375×667 without
scrolling.

Keypad: when the sheet opens with an existing amount the keypad is pristine; the first digit or
separator replaces the amount, backspace edits it (§4.1).

After saving, the sheet closes and toasts "Added 3,50 € to Coffee & snacks" (masked: "Added to
Coffee & snacks") or "Saved". When the entry's date falls outside the selected period the toast is
"Added 3,50 € to {period name}" with the action "Show" (selects that period). Income names its
period: "Added 50,00 € to October".

A new-item sheet keeps a draft (§5.10) so an interruption does not lose a half-typed entry.

### 3.5 Fixed

- `MonthSwitcher` large title, segmented control "Costs | Income" (test id `fixed-segment`).
- **Costs**: sentence "{total} this month, {paid} of {count} paid" ("{total} in {name}" when not
  current). `{count}` and `{paid}` count only charge lines (§4.4) that are not skipped: a skipped
  cost is not due, so the month can still end "6 of 6 paid". Category chips ("All" plus
  categories that have fixed costs); with a chip selected, the category row as on Daily. In "All",
  rows are grouped under category headers (badge, name, subtotal) in category order; with a chip
  selected the rows are ordered by due date with a "Today" divider between what is due before today
  and what is still to come. The list closes with a "Total {fixed}" row under a sum rule that
  reconciles with "Fixed costs" on Home. Row: badge, name, subtitle, amount (struck through when
  skipped; paid amounts in secondary ink so what is still due carries the weight), and on charge lines
  a light round paid check (test id `recurring-paid`). Subtitles: "Due on the 1st", "Yearly in March", "Every 6 months, March and
  September", "Every 3 months, next in December", "Skipped this month", and for spread non-charge
  lines "Set aside {amount} this month" (no check).
- Section footer: "Fixed costs count in full from the first day of the month, paid or not. Tick them
  off to keep track of what has gone out."
- Then a collapsed "Not this month" group (a disclosure with the count; the label stays "Not this
  month" in other periods): items with no line in the period, subtitle by first match: "Starts
  {name}", "Ended {name}", "Next: {date or name}", "No more charges, ends {name}". It follows the
  Total and the footer, so the Total visibly closes only what counts this month.
- "Add fixed cost" at the end and as a header button. A new cost starts in the selected chip's
  category, else in the first active category of kind fixed or both.
- Empty: "No fixed costs yet" with "Add rent, subscriptions and other costs that repeat every
  month.", the suggestion chips from `RECURRING_SUGGESTIONS` centred under it (prefill name,
  category, interval; a missing or archived category falls back to the first active category of
  kind fixed or both) and a centred secondary "Add fixed cost".
- **Income**: "{total} this month". A "Recurring" group header with its subtotal over the recurring
  income rows (check labelled "Received"), then "One-off this month" with its subtotal (income
  transactions, tap to edit), then income's own collapsed "Not this month" group, so ended or future
  income stays reachable, and the buttons "Add income" (recurring) and "Add one-off income"
  (transaction sheet, income). Empty: "No income yet" / "Add your pay and any other money that
  comes in every month."
- Compact header subtitle (DESIGN.md §9.2): Costs "{paid} of {count} paid", left out when nothing
  is due; Income "{total} this month" ("{total} in {name}" in other periods).

### 3.6 Recurring sheet (fixed cost or recurring income)

**Add**: Name (max 40), Amount (`AmountField`), Category (costs only; all non-archived, `fixed` and
`both` first; a new cost starts in its preset's category, else as in §3.5), How often (Monthly,
Every 2 months, Every 3 months, Every 6 months, Yearly), "Usually paid on" ("Usually arrives on" for
income; "Not set", "1st" … "31st"). A "More options" disclosure row reveals Starts (month, monthly
items only), Ends and Note (max 80). Ends is a picker of "Never" plus the months from 24 before to
36 after the selected period, the stored end always included; an end before the start shows "It
can't end before it starts. Pick a later month." and disables saving.

When How often is not Monthly, "Charged in" and the Spread toggle form their own group right under
How often, with the footer "Pick any month it's charged in."; "Usually paid on" and More options
(Ends, Note) follow in a third group:
- "Charged in" replaces "Starts": a month picker (past and future allowed), default the selected
  month. If the chosen month c is after the selected month m, store `startMonth = addMonths(c, −N ×
  ceil(monthDiff(m, c) / N))`, so the item already counts in m. When editing, the picker shows
  `nextChargeMonth(r, m)`.
- A toggle "Spread over {N} months", default on for 6 and 12, off for 2 and 3, with the live
  subtitle "Counts {floor(amount / N)} every month instead of {amount} once a year" (or "every {N}
  months").
- Changing How often or Charged in on an existing item re-anchors `startMonth` with the formula
  above, for all months: an item has one schedule for all time, so months before the new start
  lose it (product default; keeping the history would mean splitting the item). When the change
  re-plans months before the selected one (the item started earlier and gets a new interval, or a
  charge month that moves its start), the footer says so: "Past months change too. To keep them as
  they are, stop this one after {previous month} and add a new one." (under "Every month" for a
  monthly item, in place of "Pick any month it's charged in." otherwise).

**Edit** shows two groups:
- "This month" (only when the item has a line in the selected period; titled with the period name
  when not current): Paid / Received toggle (charge lines only), "Skip this month" (charge lines of
  items that are not spread, and a spread item that is already skipped, so imported data can be
  undone), "Different amount this month" (a row that reveals an `AmountField` with the usual amount
  as its placeholder, plus "Use the usual amount" to clear it). A different amount equal to the
  usual one, or left empty, is not stored. For spread items these apply to the whole cycle, with
  the footer "These apply to the whole cycle, {start} to {end}." ("September to August 2027"), and
  the group is hidden outside the charge period, where nothing can be offered.
- "Every month": the add fields. Saving a changed amount asks `chooseDialog` "Which months get the
  new amount?": "From this month on" (default) or "Every month, including the past" (that one runs
  through `withUndo`, toast "Changed {name} in every month"). An item charged in no month from the
  selected one on (it ended before it, say) has no months from now on, so its new amount applies to
  every month without asking, through the same `withUndo`.
- Bottom: "Stop after {month}" applies at once, closes the sheet and runs through `withUndo`
  ("Stopped {name} after {month}"). It shows only when the selected period ≥ startMonth and the item
  does not already end in or before that period (there it would extend the item). "Delete" asks
  `chooseDialog` { title "Remove {name}?", message "Stopping keeps it in past months. Deleting
  removes it from every month, including the past, and changes those totals.", options "Stop after
  {month}" (when stopping applies) and "Delete from all months" (destructive) }. Delete runs through
  `withUndo` ("Deleted {name}").
- A save that fails toasts "Couldn't save {name}. Check the fields and try again."

### 3.7 You (settings and personalisation)

Settings open from Home's monogram (route `you`, back capsule "‹ Home"). Every subpage is a pushed
screen with a large title and "‹ You". In every sheet, Return ("done") in a text field puts the
keyboard away. Top to bottom:

- **Profile**: one row, "Name and monogram" (the medallion and the name, or "Add your name"), that
  expands in place as a disclosure: the "Name" field (max 24), the `EmojiPicker` "Monogram" with
  "Use my initial", and the footer "Your name and monogram show at the top of Home." Changes save as
  they are made.
- **Look**: Theme (a `SelectField` picker ending in caret-up-down, combobox "Theme": System, Light,
  Dark), Accent (8 swatches using `--accent-<key>`), "Show cents in the big number", "Home layout"
  (subpage).
- **Money**: Currency (subpage), Number format (subpage), "Month starts on" (subpage), "Monthly
  savings" (its amount, with "This month: {x}" under it when the current period has its own; opens
  the `savingsGoal` sheet).
- An untitled group: **Categories** (count), **Quick add buttons** (count) and "Owed to you" (the
  open total, or "None"; pushes `owed`, §3.16).
- **Privacy**: "App lock" (On or Off; the subpage `you.privacy` belongs to the lock feature, §3.8)
  and the "Hide amounts" toggle. Footer: "With Hide amounts on, numbers show as ••• until you tap the
  eye at the top of the screen."
- An untitled group: **Backup** (subpage) and **About** (subpage). When `needsBackupReminder`, the
  Home monogram (accessible name "Settings, backup due") and the Backup row (named "Backup, backup
  due", an 8px `--critical` dot, test id `backup-due`) carry the reminder dot.

**Home layout subpage**: a switch per Home card named as in `HOME_CARDS` (the `equation` entry reads
"Show the sums above the total") and "Move {name} up" / "Move {name} down" buttons, always shown,
since ordering is this page's purpose. The top card's up and the bottom card's down stay in place,
disabled. A polite status announces "Recent is now first". Footer: "Home shows the cards in this
order and leaves out a card while it has nothing to show. The total at the top always shows."
`settings.homeCards` stores only the shown cards, in order: a card switched off keeps its place for
the visit, and on a later visit it returns after the card that precedes it in the default order.

**Currency subpage**: the searchbox "Search currencies" ("No currency found" when nothing matches)
and the radio list "Currency". Footer: "Changing the currency changes the symbol only. Amounts are
not converted."

**Number format subpage**: the radio list "Number format"; each option shows 1.234,56 in its format
("1.234,56 €"), never masked. Locales that do not group four-digit amounts (it-IT, es-ES, pl-PL)
truthfully show "1234,56 €". Footer: "Sets the decimal mark, the thousands separator and where the
currency symbol goes."

**Month starts on subpage**: the radio grid "Day each month starts on" (1st to 28th), footer "Pick
your payday to make each month run from one payday to the next.", and a live line "This month runs
from {start} to {end}." A tapped day only previews ("This month will run from {start} to {end}.");
the button "Start months on the {nth}" applies it. When data exists it first asks `confirmDialog`
{ title "Start each month on the {nth}?", message "Entries keep their dates and fixed costs their
due days. Totals, limits and savings follow the new months.", confirm "Change" }. The change runs
through `withUndo` ("Months now start on the {nth}").

**Monthly savings sheet** (`savingsGoal`, for `route.month` or else the current period), built like
the recurring sheet: the group "Every month" with "Amount" (`setSavingsGoal(x, today)`; footer "Set
aside before daily spending. It lowers what's left to spend.", plus "Months that have ended keep
what they had." for a past period, because `setSavingsGoal` freezes them), then the month's group
("This month", or the period's name) with "Different amount this month" ("Different amount in
November"), a row that reveals the field, and "Use the usual amount" (`setMonthSavings(month, x |
null)`; footer "Changes this month only. Leave it empty to use the usual amount.").

**Categories subpage**: active categories (named "{category} {kind}[, limit {x}]"), archived ones in
their own group "Archived" (footer "Archived categories leave the pickers. Their entries stay as they
are."), and "Add category". A glass "Reorder" capsule in the header switches to a Reorder mode
("Done" ends it) whose rows show "Move {name} up" / "Move {name} down"; the buttons at the ends stay
in place, disabled. Footers: "Tap a category to change its name, icon, colour or monthly limit." /
"Categories show in this order in pickers, lists and charts."

**Category sheet** (`categoryEdit`; header action "Add" or "Save"): name (max 24), icon (the "Icon"
row, test id `category-icon`, opens an `IconPicker` page with "Done": Phosphor icons from
`CATEGORY_ICONS` plus an Emoji tab), colour (10 swatches; a new category gets the first colour no
active category uses, else the least used), "Show in" (Fixed costs, Daily spending, Both; footer
"Where it's offered first. You can still pick it anywhere."), "Monthly limit" (optional, placeholder
"None"; 0 is stored as no limit; footer "Optional. It counts this category's fixed costs and daily
spending together."), "See spending" (closes the sheet and pushes category detail unless it is
already on top), "Archive category" / "Restore category" (through `withUndo`: "Archived {name}" /
"Restored {name}"), and "Delete category" (test id `sheet-delete`). A new category starts with the
icon `circle` and the kind `daily`.
- Deleting an unused category asks `confirmDialog` { title "Delete {name}?", message "No expenses,
  fixed costs or quick adds use it.", confirm "Delete", destructive }, then runs through `withUndo`
  ("Deleted {name}").
- A used one replaces the sheet body with "Move 2 expenses, 1 fixed cost and 1 quick add to…"
  (only the kinds in use, singular and plural), the radio list "Move them to" (test id `move-to`)
  of the other active categories, and a destructive "Delete {name}" (test id `sheet-delete`); it
  runs through `withUndo`. Afterwards the category's detail screen is popped if it is on top.

**Quick add subpage**: the buttons in order (named "{label} {category} {amount}"), "Add a button",
and the same Reorder mode as Categories. There are at most 8 (`MAX_QUICK_ADDS`; the store throws
past it, §5.4): at 8 "Add a button" goes and the footer reads "You have 8, the most there can be.
Delete one to add another." Other footers: "On Daily, one tap adds the expense, dated today." /
"Daily shows them in this order." Empty: "No quick add buttons" / "Add what you buy often, like a
coffee, and log it on Daily with one tap." with "Add a button". The quick add sheet edits "Name"
(max 16), "Amount", "Category" and the "Icon" row (test id `quick-add-icon`; a new button shows its
category's icon until one is picked), with the footer "On Daily, one tap adds {amount} to
{category}, dated today."; "Delete quick add" (test id `sheet-delete`) runs through `withUndo`
("Deleted {label}").

Sheets opened for an item that no longer exists say so ("This category no longer exists", "This
button no longer exists").

**Backup subpage**:
- "Export backup" and "Export spending as CSV" (footnote "For spreadsheets. To keep everything, use
  Export backup."), both through `saveFile` (§5.7): build the `File` synchronously in the tap handler
  and call share before any `await`. Buttons are disabled while a call is pending.
  `markBackupDone()` and the toast "Backup exported" happen only for `'shared'` or `'downloaded'`; a
  CSV toasts "Spending exported as CSV". A failure toasts "Couldn't export a backup. Close the app
  completely, open it again and try again." ("the CSV file" for the CSV).
- "Import backup" (footer "Replaces everything on this iPhone with the backup you choose. The app
  lock stays as it is."): hidden file input (`accept=".json,application/json"`, test id
  `backup-file-input`), `readBackupFile` (a file over 64 MB is refused unread as not a backup), then
  `confirmDialog` { title "Replace everything on this iPhone?", message "The backup from {date} has
  {n} entries and {r} fixed costs and income items. This iPhone has {m} entries[, {k} of them newer
  than the backup]. Settings and categories are replaced too.[ {d} damaged entries in the file will
  be skipped.]", confirm "Replace", destructive }. Counts use singular and zero forms ("1 entry",
  "no entries", "1 fixed cost or income item", "no fixed costs or income items", "1 damaged
  entry"). Then `importData` (§5.4) and the toast "Backup restored" with Undo for 10 s. The imported
  `settings.lastBackupAt` is the later of the file's value and its `exportedAt` (never later than
  now): the file is itself a backup of that data, so the nudge does not ask for one at once. The app
  lock is not part of backups and stays as it is.
- "Automatic copies on this iPhone": `listSnapshots()` rows, each titled by its label ("End of Fri 17
  Oct", "Before import, 18 Oct") with its entry count as the subtitle ("214 entries"), and a
  "Restore" button; "No copies yet." without any. Restore asks `confirmDialog` { title "Restore
  this copy?", message "“{label}” has {n} entries. It replaces everything on this iPhone, settings
  and categories too. This iPhone has {m} entries now.", confirm "Restore", destructive }, then
  `restoreSnapshot` through `withUndo` ("Copy restored", Undo for 10 s). Footer: "The app keeps a
  copy at the end of each of the last 7 days you used it, and one before each import or restore.
  Copies stay on this iPhone, so keep exporting backups too."
- Status lines: "Last backup {relative time | never}." (the export group's footer); storage
  protection: "Protected from automatic cleanup" in `--good-ink` with `check-circle`, or "Not
  protected:" in `--warning-ink` with the warning icon followed by "iOS may remove the app's data
  when storage runs low. Keep a recent backup." in `--ink`. Unknown counts as not protected.
- Footer: "Your entries live only in this Home Screen app. Removing it from your Home Screen deletes
  them, and a new install starts empty. Backups and CSV files are plain text: anyone with the file
  can read it. Keep them in your own iCloud Drive or Files."

**About subpage**: the identity card (a button named "On a Budget Version x.y.z"; five taps, each
within 1.5 s of the last, push `you.diagnostics`), the install guide (`InstallHint` variant
`inline`, §1 steps), "Where your data lives" ("Space used" from `navigator.storage.estimate()`, the
storage protection line, and a footer saying the entries stay on this iPhone), "Open-source notices"
(every component the app ships, Phosphor Icons, Source Serif 4, React, Zustand, idb-keyval and
Workbox, each a disclosure row with its license text), and "Erase all data" (destructive, footer
"Deletes everything on this iPhone, including the app lock. Export a backup first to keep your
entries.").

**Erase all data**: About opens `EraseSheet` (`{ name: 'erase' }`). Forgot PIN erases inside the
lock screen with the same copy and rules (§3.8), because nothing modal can show above the lock. The
header reads "Erase all data" (with "Cancel"); the body's heading asks "Erase everything on this
iPhone?", then the text "This deletes your entries, fixed costs, categories, settings and PIN. Last
backup: {relative time | never}.", a field "Type erase to confirm", "Export backup first" (About
only), and a destructive "Erase" enabled only when the trimmed lower-cased field equals "erase".
From About with a PIN set, tapping Erase first runs `verifyOwner('Erase all data')` (PIN or Face ID),
right before the destructive step; a failed check erases nothing. Erasing calls `eraseEverything()`
(§5.4), then `forgetBiometric` for the old passkey and `useNav.getState().reset()`.

**Diagnostics** (About, after tapping the version 5 times): app version and build id (the
production bundle's file name, or "Development server"), isSecureContext, standalone and
display-mode, safe-area insets (probe element), innerHeight and visualViewport height/offsetTop,
storage phase, "Saving now", persisted and the last storage error, the service worker's "Supported",
"Registered", "Controls this page" and "New version waiting", platform authenticator availability
and the browser's user agent. No amounts.

### 3.8 App lock (lock feature)

**Privacy subpage** (`you.privacy`, "App lock"):
- "App lock" toggle. Turning it on opens the `pinSetup` sheet (mode `enable`, titled "App lock":
  choose 4 or 6 digits, enter, confirm). "Change PIN" is a tinted action row (it opens a sheet, so no
  chevron); its sheet is titled "Change PIN", and only a change toasts "PIN changed". Turning the
  lock off (toast "App lock is off") and changing the PIN first verify the current PIN or Face ID
  (`verifyOwner('Turn off the app lock')`, `verifyOwner('Change your PIN')`).
- "Unlock with Face ID" toggle (only when a platform authenticator is available; turning it on
  first verifies, `verifyOwner('Turn on Face ID')`, and creates the passkey right after). Footnote:
  "Face ID unlock uses a passkey saved in your Passwords app. If Face ID fails, iOS lets you use
  your iPhone passcode instead, so anyone who knows your passcode can open the app."
- "Set up Face ID again" (tinted) shows whenever Face ID is on, because a passkey deleted in
  Passwords cannot be told apart from a cancel. When no passkey came out of a verify, the toast
  "Face ID wasn't set up." offers "Try again": a fresh tap, in case Safari's user activation from
  the last key press has run out.
- "Lock after": Immediately, 1 minute (default), 5 minutes, 15 minutes, 1 hour.
- The "Hide amounts" toggle with the explanation: "The lock keeps people who pick up your unlocked
  iPhone out of the app. It doesn't encrypt your entries: iOS already encrypts your iPhone while
  it's locked. If you forget your PIN, the only way back in is to erase the app's data and restore a
  backup. iOS may show your last screen in the app switcher; turn on Hide amounts to keep numbers
  out of it."
- When `lockSupport().pin` is false (not a secure context): the toggle is disabled with "App lock
  needs the app's https:// address."
- A change that fails toasts what failed ("Couldn't turn off the app lock. Try again.").

**Verify sheet** (`verifyOwner`, §5.7): titled with the reason, a PIN keypad whose bottom-left key
("Use Face ID") is Face ID when it is on. It asks for Face ID once on its own when it opens (with
Face ID as it was at that moment, so a passkey created right after is never asked for), then keeps
the key.

**Lock screen**: the vault (the engraved rosette with the app mark), "Enter your PIN", dots (test id
`pin-dots`, `data-filled`), `Keypad` variant `pin` whose bottom-left key is Face ID ("Unlock with
Face ID") when enabled, and "Forgot PIN?" (test id `lock-forgot`). A hardware keyboard types digits
and Backspace too.
- A wrong PIN shakes the dots and shows "Wrong PIN". After 5 failures a lockout starts (30 s,
  doubling with each further failure, max 15 min) with the countdown "Try again in 0:30" (role
  `timer`, read only when focused); VoiceOver hears "Too many tries. PIN entry is paused for now."
  once as it starts. The digits are disabled; the Face ID key and "Forgot PIN?" are not. A stored
  `lockoutUntil` more than 15 minutes away counts as expired (the clock was set back), so it never
  shuts the owner out for longer than the schedule allows.
- A Face ID unlock also clears the failed attempts and any lockout.
- When an attempt cannot be saved (so it cannot be checked), the line under the dots reads
  "Couldn't check your PIN. Reopen the app." and the app stays locked. An erase that fails says
  "Couldn't erase the app's data. Close it completely and try again." and stays locked too.
- Toasts, dialogs and sheets never show above the lock: `--z-lock` (90) is above `--z-confirm`,
  `--z-toast` and `--z-sheet`, and those layers go inert while `#app-root` is `aria-hidden` (§5.6).
  So every step of Forgot PIN is a view of the lock screen itself:
  - With Face ID: "Forgot your PIN?" with an explanation, "Use Face ID to choose a new PIN", "Erase
    all data" and "Cancel". After Face ID the "New PIN" view runs `PinSetupFlow` (mode `change`,
    layout `fill`, without the old PIN); the lock screen then unlocks with the toast "PIN changed".
    If Face ID does not confirm: "Face ID didn't confirm it's you. Try again, or erase the app's
    data."
  - Without Face ID, "Forgot PIN?" goes straight to the erase view: the §3.7 copy and rules (no
    "Export backup first"), then `eraseEverything`, `forgetBiometric` and `useNav.getState().reset()`.
- Status `'error'` (the lock settings could not be read; the app stays locked): "Couldn't read the
  app lock settings" with "Close the app completely and open it again. If this keeps happening,
  erase the app's data and restore a backup.", "Reload" and "Erase all data" (the erase view).

**Face ID**:
- Tried automatically at most once per lock episode, only when `document.visibilityState ===
  'visible' && document.hasFocus()`; otherwise on the next window `focus`. After a failure or cancel
  (both NotAllowedError) no automatic retry until the next lock; the Face ID key stays.
- One `AbortController` per attempt: abort the previous one before a new call, and abort on the first
  PIN key press, on unlock, and when the app is hidden.
- A passkey deleted in Passwords fails like a cancel; the PIN keeps working and the Privacy page
  offers "Set up Face ID again".

**Lock triggers**:
- Cold start with a PIN: only the LockScreen renders until the first unlock (no app content mounts).
- Later locks never unmount anything: LockScreen is an opaque full-screen layer above the still
  mounted app, whose root gets `inert` and `aria-hidden="true"`; open sheets keep their input.
- On `visibilitychange` → hidden (and `pagehide`): record `hiddenAt`, reset `amountsRevealed`, lock
  at once when `autoLockMinutes === 0`. On visible: lock when a PIN is set and (`autoLockMinutes ===
  0`, or `Date.now() − hiddenAt ≥ autoLockMinutes × 60 000`, or `Date.now() < hiddenAt`). Read
  settings at event time.
- Never lock on `blur` (Face ID, the share sheet and the file picker blur the page). When the app is
  hidden while a system sheet it started is open (`uiStore.systemSheetOpen`), the hidden/visible
  transition is ignored unless the app stayed away at least max(Lock after, 1 minute): quick round
  trips during a system sheet never lock, and leaving the app with a share sheet open is not a way
  around the lock.

**Privacy cover** (best effort): plain DOM listeners (not React state) set
`document.documentElement.dataset.cover = 'on'` synchronously on hidden and `pagehide` when a PIN is
set or `hideAmounts` is on. CSS shows an opaque `--bg` layer with the mark above everything. It is
removed one animation frame after visible, after the lock state is applied. iOS sends no event when
the app switcher opens, so this cannot be guaranteed; the Privacy text says so.

### 3.9 Onboarding (onboarding feature)

Steps, each with Back; the last reached step is stored in localStorage (`LS_KEYS.onboardingStep`)
and a relaunch resumes there. Back saves the step like Continue, so going back and returning shows
what was typed; only "Skip", "Skip for now" and "Not now" leave a step without writing. Each later
step has a left-aligned large title with a short lead under it and group footers; the compact
header uses a short name ("Money in"), so a title never appears twice. The progress ruler reads
"Step N of M" for VoiceOver. A new step's title takes focus (§5.5).

0. **Install first** (only when `isIOS() && !isStandalone()`; test id `install-gate`): title
   "Install On a Budget first", body "The app keeps your money data inside the Home Screen app.
   Anything you enter here in Safari stays in Safari, and Safari can clear it if you don't visit for
   a while.", the four numbered install steps from §1, and a secondary button "Continue in Safari"
   (e2e uses it) that goes to Welcome.
1. **Welcome**: "On a Budget" and "Your monthly budget, kept on this iPhone." Three short lines:
   fixed costs are counted for you every month; daily spending takes two taps; nothing leaves your
   phone unless you export it. Buttons "Get started" and "Restore from a backup" (the import flow of
   §3.7 through `importWithConfirm(file, { continueOnboarding: true })`; afterwards continue at step
   6, or 7 when step 6 does not apply, because the lock is not part of backups). Undo on "Backup
   restored" brings the first-run data back and returns to Welcome.
2. **About you** ("About you"): name (optional), currency (a select, "Euro (EUR)"; default
   `defaultCurrencyFor`), number format (a select whose options read like "1.234,56 € (Germany)";
   default `defaultNumberLocale`), "Month starts on" (a select from 1st to 28th, default 1st, with
   the §3.7 footer and the live line "This month will run from {start} to {end}.").
3. **Money in**: "What comes in each month?" Lists existing recurring income items of the current
   period as editable rows, plus one amount and label ("Income") when there are none; "Add another"
   (e.g. "Parents", "BAföG", "Job"); an optional "Savings you already have" that sets the wallet's
   opening balance (§3.12); "Skip for now". Footer: "Lines without an amount are left out."
4. **Fixed costs**: "What goes out each month?" Rent (bound to the first expense item in
   `cat-rent`), then existing expense items as rows, then suggestion chips (`RECURRING_SUGGESTIONS`)
   that add a named row with an amount input. Never pre-fill prices. Suggestions that recur every 3,
   6 or 12 months are saved spread, since the typed amount is the full charge (product default), and
   a footer explains it: "Insurance comes once a year: enter what you pay each time, and a share is
   set aside every month." "Skip for now".
5. **Spent so far** (only when today's `dayIndex` > 1): "Spent anything since {start date}?",
   `AmountField` "Daily spending so far this month", footer "A rough total is fine. It keeps this
   month's numbers honest.", "Continue" / "Skip". Continue adds an expense in `cat-other`, dated the
   period start, note `BEFORE_APP_NOTE` ("Before On a Budget").
6. **Lock** (only when `lockSupport().pin`): "Lock the app with a PIN" (`PinSetupFlow`), "Not now".
   With a PIN already set (Back from Done, a relaunch) it says "App lock is on: the app asks for your
   PIN when you open it. You can change it in Settings under App lock." with Continue. After a new
   PIN, when `lockSupport().biometric()` resolves true, the Face ID offer follows: "Unlock with Face
   ID", the lead "Open the app with a glance instead of typing your PIN.", the passkey footnote of
   §3.8, "Use Face ID" (`registerBiometric()` straight from the tap) and "Not now", and an error
   line when registration fails. On short screens the step opens scrolled to the PIN setup, so the
   whole keypad shows; its compact header reads "App lock".
7. **Done** ("You're all set"): Home's hero for this month (the labels and sentences of §3.1;
   without income, "Add your income on Home to see what's left to spend." in place of the button)
   and a "This month" group: Money in, Fixed costs, Savings (only when above 0, which only a restore
   can bring) and Spent so far. "Start budgeting" clears the stored step, then sets
   `settings.onboarded = true` as the last write.

Steps are idempotent: editing a row updates that item (`updateRecurring` / `setRecurringAmount(id,
amount, 'all')`), clearing its amount deletes it, and only rows the user adds create items, with
`startMonth` = the current period.

### 3.12 Wallet (wallet feature)

The wallet is the money kept from month to month. When a month closes, its result (income − fixed
− daily, which is the monthly savings plus what was left over) moves into the wallet; an overspent
month takes the difference out. Nothing has to be done by hand: the balance is computed from the
data (§4.8), so editing a past month updates it.

- The Wallet is the fourth tab (the centre of saving: balance, goals §3.14, passbook). The Home
  `wallet` card opens it with `navigate('wallet')`.
- **Wallet screen** (tab root `wallet`), designed like a savings passbook (DESIGN.md §9.26): the balance
  as the hero figure ("Wallet" label; "Short by" with critical ink when negative); a line for the
  current period ("October adds 334,72 € when it closes": the result, savings 100,00 € plus 234,72 € left / "takes 41,28 € out"); the passbook: one row
  per movement with date, description, signed amount and running balance. Movements: "Opening
  balance", "{name} closed" (each closed period from the start on, its result; periods with a result
  of 0 are listed too so the book has no gaps), "Added" and "Taken out" entries with their notes.
- Wallet sentences ("October adds … when it closes", "September added …") name the period without
  its range, whatever the start day (a range would break the sentence), and add the year when the
  period lies in another year than the current one ("December 2025 added …").
- Buttons "Add money" and "Take money out" open the wallet entry sheet (amount, date up to today,
  note "Note", e.g. "Moved to my savings account"). Passbook taps: the opening opens Wallet
  settings; a month closing selects that period and opens Home on it (month rows are not editable:
  they come from the month itself); an added or taken-out entry opens the entry sheet to edit it,
  with Delete through `withUndo`; a "Paid: …" line opens the transaction sheet for that expense.
- Entry toasts, all through `withUndo`: "Added 50,00 € to your wallet" (masked: "Added money to your
  wallet"), "Took 200,00 € out of your wallet", "Saved" after an edit, and "Deleted {note}" or,
  without a note, "Deleted the 50,00 € you added on 12 Sep". A save or delete that fails says so in
  a critical toast ("Couldn't save this entry. Check the amount and the date, then try again.").
- A "Wallet settings" row opens a sheet with "Opening balance" (`AmountField`, "Money you had
  saved when you started"; empty saves 0) and "Counts from" (a picker from the earliest period with
  data, or the stored start when that is earlier, up to the current period, never a future one;
  default the period the app was set up; footer "Months before this don't change your wallet.").
  Choosing the setup period stores `startMonth` null. Save writes only what changed, through
  `withUndo` ("Saved").
- Empty (no closed month, no opening, no entries): "Your wallet fills up when a month closes.
  Whatever you don't spend lands here, and an overspent month takes the difference out."
- Onboarding step 3 ("Money in") has an optional field "Savings you already have" that sets the
  opening balance.

### 3.13 Pay from the wallet

- The transaction sheet (expenses, new and edit) has a "Pay from wallet" switch. When on, the
  consequence line reads "Wallet after: {balance after}", in critical ink with "short" wording when it
  would go below zero (still allowed). Goals refill from what is left (§3.14).
- A wallet-paid expense leaves the month's budget alone: it is excluded from daily spending, left,
  per day, pace, limits, Where it went, the day chart and the day totals (§4.5). It still appears in
  the Daily list and in category detail with the wallet glyph and the subtitle "Paid from wallet", its amount in
  secondary ink.
- In the wallet it is a withdrawal on its date ("Paid: {note or category}") (§4.8).

### 3.14 Savings goals

The wallet is the centre: there is one balance, and goals are targets added on top of it. Nobody
moves money between pots; the wallet fills the goals by itself.

- The Wallet screen has a "Goals" section under the balance: one row per goal with its icon, name
  and "{filled} of {target}" with a `Meter`, and "Add a goal". The wallet's balance fills the goals in
  their order, top first: each goal takes what it needs up to its target, and what is left fills the
  next one. A full goal shows the brass "Reached" seal.
- "Not set aside: {free}" sits under the balance (the balance minus what the goals take). When the
  wallet shrinks (an overspent month, a purchase paid from the wallet), the lowest goals empty first.
- Order: up/down buttons on each row ("Fill {name} sooner" / "Fill {name} later"). A move swaps the
  goal with its active neighbour and passes every goal id to `reorderGoals` (`goalsInFillOrder`,
  §4.9), so done goals keep their slot and "Put back" returns them to their place.
- Goal sheet (`goal`): name (max 24), icon (`IconPicker`, opened as a second view of the sheet with
  "Cancel" to revert and "Done" to keep), target (required, 1..MAX_CENTS), "Mark as done" (for when
  you have reached it or bought it: the goal leaves the list and stops taking money; through
  `withUndo`, "Marked {name} as done", keeping edits made in the sheet just before) and "Delete
  goal" (through `withUndo`, "Deleted {name}", without a question: deleting a goal never deletes
  money). Done goals are listed collapsed under "Done", shown whenever a goal is done (even with no
  active goals), each with "Put back" to make it active again.

### 3.15 Month-end review

- The first time the app opens after a period has closed (and `settings.lastReviewedMonth` is older),
  Home shows a banner "{name} is closed. {Moved to your wallet: x | Taken from your wallet: x}" with
  "See the review" and "Dismiss". Both set `lastReviewedMonth`: "See the review" in its tap handler,
  as it opens the sheet; "Dismiss" once the banner has collapsed.
- A past period's Home has a "See the review" button under the statement. Its tap handler calls
  `actions.markReviewed(month)` (which only moves forward) and opens the sheet. The sheet itself
  never writes (§5.10).
- Home shows at most one non-critical banner at a time: the review banner before the backup nudge.
- The review (large sheet `monthReview`, a statement; design in docs/design/EXTRAS.md): "{name} statement" and the range; the result
  figure with where it went (wallet); the sum rows; "Where it went": the top 5 categories with their
  amount and the change against the previous period ("12% more than September", an arrow plus words,
  never colour alone; "New" when the previous period had none); the biggest expense; "Days without
  spending: 6"; the number of entries; fixed costs paid; money still owed to you (§3.16); the wallet
  balance after closing. A "Close" button. In the bar and legend, Uncategorized and the "{n} more"
  fold both use `--cat-other` (Uncategorized has no colour); the legend's order tells them apart.
  For a period before the wallet's start the footer reads "Changing entries from {name} updates this
  statement." (that period does not change the wallet).

### 3.16 Split bills

- The transaction sheet (expenses) has a "Split" capsule, the sheet header's action (its top-right
  slot, empty for expenses otherwise), that opens the split editor inside the sheet, in the keypad's
  place (no separate sheet; the splits live in the sheet's form state and draft): a list of people
  with the amount each owes you (person name with suggestions from earlier splits, max 24
  characters; amount), "Split evenly" (n people: amount / (n + 1) each, the remainder stays with
  you), and "Your share: {x}". The splits can never exceed the amount.
- Settled splits (paid back or forgiven) are listed read-only in the editor ("Paid back",
  "Forgiven"), kept as they are on save and left out of "Split evenly", which splits the bill minus
  the settled amounts. A row with a name but no amount (or 0) is dropped on save, like a row without
  a name, and repeated names merge when the name field is left and on save (EXTRAS.md §2.4).
- The budget counts only your share: amount − every split that is not forgiven (§4.5).
- Daily rows of split expenses show your share as the amount with the subtitle "Split, {person} owes
  {x}" (or "Split with {n} people", "Split with {names}, settled"), and "of {amount}" in secondary
  ink.
- "Owed to you" (route `owed`, with `person` to open it at that person; from the Home `owed` card
  and You → "Owed to you"): open splits grouped by person with a total each, largest first (equal
  totals keep the order of each person's most recent open split, §4.9); per entry its date, note and
  amount, with "Paid back" and "Forgive"; "Mark all as paid" per person with two or more items; a
  collapsed "Settled" list whose rows read "{person} paid back {date}" or "Forgave {person} {date}"
  (the list mixes people, so a bill paid back by two people never shows two identical rows). With
  nothing open, the empty state sits right under the title, without a total.
- "Paid back" and "Mark all as paid" act at once through `withUndo` ("Max paid back 9,00 €").
  "Forgive" first asks `confirmDialog` { title "Forgive 9,00 €?", message "It counts as your own
  spending again.", confirm "Forgive" }, a primary button rather than a destructive one (nothing is
  deleted and Undo follows), then runs through `withUndo` ("Forgave Max 9,00 €").
- The Home `owed` card: "Owed to you" with the open total as its meta and the top three people,
  each row opening the screen at that person (`{ name: 'owed', person }`); hidden when nothing is
  open.

### 3.10 App-level states (shell)

- **Loading**: until both `useAppStore.status` and `useSecurityStore.status` leave `'loading'`, show
  the background with the mark. Nothing that reads AppData renders earlier.
- **Storage phases** (`useStorageStatus.phase`, §5.4), rendered after the lock gate:
  - `read-failed`: full screen "The app couldn't open your data. Close it completely and open it
    again." with "Try again" (re-runs `initStore`) and "Use without saving" (fresh data in memory,
    saving off for the session, banner "The app isn't saving. Entries made now will be lost when you
    close it.").
  - `newer-version`: full screen "This data was saved by a newer version of the app. Reload to
    update." with "Reload". No saving.
  - `damaged`: full screen offering the newest automatic copy ("Restore copy from {date}") or, with
    none, "Export raw data" and "Start fresh" (destructive confirmation). No saving until chosen.
  - `conflict`: full screen "The app was changed in another window. Reload to see the latest
    version." with "Reload".
  - `write-failed`: banner "Couldn't save your last changes. Reload to reconnect storage." with
    "Reload" (QuotaExceededError: "Your iPhone is out of storage, so the app can't save. Free up
    space, then open the app again." with "Export backup"). Cleared after the next successful write.
  - After a load that dropped damaged rows: banner "Skipped {n} damaged entries. A copy of the
    original was kept."
- **Install hint** (test id `banner-install`): in iOS Safari when not standalone, after "Continue in
  Safari": "Install On a Budget: tap ••• (or Share), then Share, then Add to Home Screen. Entries
  made in Safari stay in Safari, and Safari may delete them after a week without use." with "Already
  added entries here? Export a backup in Safari, then import it in the installed app." Dismissible.
- **Update ready** (test id `banner-update`): "A new version of On a Budget is ready" with "Reload",
  shown only on a tab root with no sheet open, never over Lock or Onboarding.
- **Backup nudge** (test id `banner-backup`): after 60 days since the last backup, or 30 days with
  none (and `needsBackupReminder`), Home shows "Your entries are only on this iPhone. Export a backup
  to keep them safe." with "Export backup"; dismissing snoozes it 14 days (`LS_KEYS.backupNudgeUntil`).
- **Errors**: `ErrorBoundary` around everything below the lock gate and around each screen and sheet.
  Fallback "Something went wrong. Your entries are still saved on this iPhone." with "Reload" (app
  level) or "Go back"/"Close", plus "Export backup" when unlocked. Never show error text or data.

---

## 4. Domain rules

### 4.1 Money

- **Unit**: every amount is an integer number of hundredths of the major unit (`Cents`), whatever
  the currency. 3,50 € is 350; ¥350 is 35000. Arithmetic stays in integers.
- **Digits**: `currencyDigits(code)` reads the fixed `CURRENCIES` table (0 or 2; unknown → 2) and
  never Intl. It only controls input and display: with 0 digits the keypad has no decimal key,
  parsing rejects a fraction, and formatting rounds half away from zero to whole units.
- **Changing currency never rewrites data.** It only changes the symbol and digits.
- `MAX_CENTS = 9_999_999_999` (8 integer digits). Amount fields (transaction, quick add, amount
  history, override, budget) are integers 1..MAX_CENTS; savings goals 0..MAX_CENTS.
- **Formatting** (`formatMoney`, `createMoneyFormat`): `Intl.NumberFormat(locale, { style:
  'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d })` with d = digits (0
  when cents are hidden); instances cached in a module `Map`. `sign: 'always'` maps to `signDisplay:
  'exceptZero'`; −0 is normalised to 0. Compact (`notation: 'compact'`) for chart ticks only.
- **showCents: false** affects only `BigAmount` (hero, onboarding Done). Everything else always shows
  cents. Rounding in integers: unit = 100, r = sign(c) × floor((|c| + 50) / 100); if r = 0 and c ≠ 0,
  show cents.
- **Masking**: `MoneyFormat.format()` returns `MASKED` ("•••", accessible name "Amount hidden") when
  masked, unless `unmasked: true`. Masked: every displayed amount (Money, BigAmount, list and day
  totals, sentences, chart values, ticks, tooltips and hidden tables, quick-add chip amounts, toasts
  and aria-labels). Unmasked: the keypad display and AmountField while editing, number-format
  samples.
- **Parsing** `parseAmountInput(input, digits, decimalSep)` → `Cents | null`:
  1. `-`, `−` (U+2212) or `(` → null.
  2. Remove all whitespace (`/\s/u`, incl. U+00A0, U+202F, U+2009) and one leading and one trailing
     run of `/[\p{L}\p{Sc}]+/u`. The rest must match `/^[0-9.,'’]+$/` and contain a digit.
  3. k = last index of `.` or `,`; sep = s[k]; tail = s.slice(k + 1). sep is the decimal separator
     iff sep === decimalSep, or (tail.length !== 3 and sep occurs once). If decimal: fraction = tail
     (must be at most `digits` long, else null; with digits 0 any fraction → null; an empty fraction
     "3," counts as none), integer = s.slice(0, k) (must not contain sep).
  4. Integer ('' counts as 0) must match `/^\d+$/` or `/^\d{1,3}([.,'’]\d{3})+$/` with one kind of
     grouping mark; strip marks and leading zeros; more than 8 digits → null.
  5. Result = integer × 100 + fraction padded to 2 digits.
  Tests (input, digits, sep → result): ('1.234', 2, ',') → 123400; ('1,234', 2, ',') → null;
  ('1,234', 2, '.') → 123400; ('1.234', 2, '.') → null; ('3,5', 2, '.') → 350; ('1.234,5', 2, ',') →
  123450; ('3.50', 0, ',') → null; ('1.234', 0, ',') → 123400; ('CHF 1’234.56', 2, '.') → 123456;
  ('1 234,56 €', 2, ',') → 123456; ('1.2.3,4', 2, ',') → null; ('3,', 2, ',') → 300; (',5', 2, ',') →
  50; ('−3,50 €', 2, ',') → null; ('99.999.999,99', 2, ',') → 9999999999; ('100.000.000', 2, ',') →
  null. Property: for every NUMBER_LOCALES entry with its default currency and c ∈ {100, 500, 350,
  123456, 1234567} (whole units only when digits = 0), parse(format(c)) === c.
- **Keypad** state is a canonical string with "." ("", "3", "3.", "3.5"):
  - digit: if current === "0" return the digit; with a "." append only while the fraction has
    fewer than `digits` digits; otherwise append while the integer part has fewer than 8 digits.
  - ".": ignored when digits = 0 or a "." exists; "" → "0."; else append.
  - "back": drop the last char; a result of "0" becomes "".
  - `keypadStringToCents`: "" → 0, "3." → 300, "0.05" → 5, "3.5" → 350.
  - `centsToKeypadString`: 0 → ""; whole amounts → "3"; else the full fraction "3.50", "3.05"
    (digits 0 → whole units, rounded).
  - `formatKeypadString(s, { currency, locale })`: integer part formatted with Intl (grouping and
    symbol position, 0 fraction digits), then the locale's separator and the typed fraction; ""
    renders as 0. ('1234.5', EUR, de-DE) → "1.234,5 €"; ('3.', USD, en-US) → "$3.".
  - Tests: ('0','0') → '0'; ('0','5') → '5'; ('','.') → '0.'; ('0.','back') → ''; ('12345678','9') →
    '12345678'; ('3.50','1') → '3.50'; ('3','.', digits 0) → '3'.

### 4.2 Dates

- `ISODate` strings are local calendar dates, built from `getFullYear/getMonth/getDate`. Never `new
  Date('YYYY-MM-DD')` (UTC) and never `toISOString()` for dates. Day differences use `Date.UTC`
  midnights so DST never produces 23 or 25 hour days.
- All labels are built from fixed English month and weekday names, never `Intl.DateTimeFormat`
  (its output differs between engines). Order follows `dateLocaleFor(numberLocale)`: `en-US` when the
  number locale is `en-US`, else `en-GB`. Range separator " – " (space, U+2013, space).
- `formatDate(d, locale, style)`: short "14 Oct" / "Oct 14"; medium "Wed 14 Oct" / "Wed, Oct 14";
  long "Wednesday 14 October 2026" / "Wednesday, October 14, 2026".
- `formatDayLabel(d, today, locale)`: "Today", "Yesterday", else medium.
- `formatRelativeDue(d, today, locale)`: 0 days "Today", 1 "Tomorrow", 2–6 "In N days", else medium.
  ('2026-10-23', today '2026-10-18') → "In 5 days"; ('2026-10-25', same) → "Sun 25 Oct".
- `formatMonthKey(key, locale, style)`: "October 2026" / "Oct 2026".
- `formatRelativeTime(epochMs, nowMs)`: "just now" (< 1 min), "N minutes ago", "N hours ago",
  "yesterday", "N days ago" (< 30), "N months ago", "over a year ago"; singular forms ("1 day ago").
- `ordinalDay(n)`: "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "31st".

### 4.3 Budget periods

Let s = `settings.monthStartDay` (1..28). Period 'YYYY-MM':

- start = YYYY-MM-s; end = start + 1 month − 1 day (inclusive). s = 1 is the calendar month; with s =
  25, '2026-10' = 2026-10-25 … 2026-11-24 and '2026-12' = 2026-12-25 … 2027-01-24.
- `periodOf(date)`: day ≥ s → the date's month, else the previous month.
- days = inclusive length; dayIndex = 1-based position of a date, null outside.
- Timing: past when end < today, future when start > today, else current.
- daysLeft (incl. today): current → days − dayIndex + 1; past → 0; future → days.
- Names and labels (all from fixed English names, §4.2):
  - `formatPeriodName(month, s, locale, { withYear?, style? })`: "October" / "October 2026" / "Oct
    2026". A period is named after its start month.
  - `formatPeriodRange(month, s, locale)`: null when s = 1; else en-GB "25 Oct – 24 Nov", en-US "Oct
    25 – Nov 24"; across New Year with years "25 Dec 2026 – 24 Jan 2027" / "Dec 25, 2026 – Jan 24,
    2027".
  - `formatPeriodLabel(month, s, locale)` (unambiguous, one string): s = 1 → "October 2026"; else
    "25 Oct – 24 Nov 2026" / "Oct 25 – Nov 24, 2026", across New Year as above.
  - `formatPeriodDates(month, s, locale)` (the dates with the year for every start day; the month
    review's subtitle): s = 1 → "1 Oct – 31 Oct 2026" / "Oct 1 – Oct 31, 2026"; else the same as
    `formatPeriodLabel`.
  - `formatPeriodTitle(month, current, s, locale)` (the month switcher's title and the period's
    name in sentences): `formatPeriodName` with the year only when the period lies in another year
    than the period `current`: "October", "January 2027".
  - Tests: ('2026-10', 25, de-DE) label → "25 Oct – 24 Nov 2026"; ('2026-12', 25, en-US) → "Dec 25,
    2026 – Jan 24, 2027"; ('2027-02', 28, de-DE) → "28 Feb – 27 Mar 2027"; ('2026-10', 1, en-US) →
    "October 2026". Dates: ('2026-10', 1, de-DE) → "1 Oct – 31 Oct 2026"; ('2026-10', 1, en-US) →
    "Oct 1 – Oct 31, 2026"; ('2028-02', 1, fr-FR) → "1 Feb – 29 Feb 2028"; for s ≠ 1 it equals the
    label. Title: ('2026-10', current '2026-10') → "October"; ('2027-01', '2026-10') → "January
    2027"; ('2026-01', '2026-12') → "January". periodDays('2027-01', 28) = 31, ('2027-02', 28) = 28,
    ('2028-02', 28) = 29. periodOf('2027-01-10', 25) = '2026-12'.
  - Property (2024-01-01 … 2028-12-31, s 1..28): `isDateInPeriod(d, periodOf(d, s), s)` and
    `daysLeftInPeriod(periodOf(d, s), d, s) === diffDays(d, end) + 1`.
- **Changing the start day** from a to b (`actions.setMonthStartDay`) remaps period keys in the same
  action so every charge keeps its due date. For each recurring item with a due day d, Δ = (d < a ?
  1 : 0) − (d < b ? 1 : 0) (`shiftForStartDayChange`); apply `addMonths(·, Δ)` to its startMonth,
  endMonth, every `amounts[].from` and the key of each of its overrides. Keys without a date
  (recurring items with dueDay null, with their overrides and amount history; `months[m].savingsGoal`;
  `wallet.startMonth`; `settings.lastReviewedMonth`) move by Δ = (b − a ≥ 16 ? −1 : 0) + (a − b ≥ 16 ? 1 : 0)
  (`periodShiftForStartDayChange`), which keeps them with the new period that holds most of their
  days. a → b → a is the identity. Transactions need no change. `nav.month` resets to null. Property: `dueDateFor(remapped, key + Δ, b) === dueDateFor(original, key, a)` for
  all a, b in 1..28 and dueDay in 1..31. Test: a 1 → b 25, rent dueDay 1: startMonth 2026-01 →
  2025-12, paid override at 2026-10 → 2026-09 (still due 2026-10-01); a gym with dueDay 28 is
  unchanged.

### 4.4 Recurring items (fixed costs and recurring income)

Let N = everyMonths and mod(a, n) = ((a % n) + n) % n.

- `isInRange(r, m)`: startMonth ≤ m and (endMonth = null or m ≤ endMonth).
- `isChargeMonth(r, m)`: isInRange(r, m) && mod(monthDiff(startMonth, m), N) === 0 (range check first).
- `chargePeriodOf(r, m)`: null when not in range; else addMonths(startMonth, N × floor(monthDiff(startMonth,
  m) / N)).
- `baseAmountFor(r, m)`: amount of the last `amounts` entry with from ≤ m (amounts[0] if none).
- `nextChargeMonth(r, from)`: m0 = max(from, startMonth); c = addMonths(m0, mod(−monthDiff(startMonth,
  m0), N)); c when endMonth = null or c ≤ endMonth, else null. Tests: { start 2026-03, N 3 } from
  2026-10 → 2026-12; from 2026-12 → 2026-12; from 2025-01 → 2026-03; { start 2026-01, N 12, end
  2026-11 } from 2026-10 → null.
- **Lines** (`lineFor(r, m, months, s)`), with ov = the override that applies:
  - Not spread (or N = 1): a line exists only in charge periods. ov = months[m]?.overrides?.[r.id];
    scheduledAmount = fullAmount = baseAmountFor(r, m); isChargeMonth = true.
  - Spread (N > 1, spread true): a line exists in every in-range period. c = chargePeriodOf(r, m); ov
    = months[c]?.overrides?.[r.id] (overrides of spread items live at charge periods and apply to the
    whole cycle); base = baseAmountFor(r, c); scheduledAmount = (m === c ? base − (N − 1) ×
    floor(base / N) : floor(base / N)); fullAmount = ov?.amount ?? base; isChargeMonth = (m === c).
    A cycle cut short by endMonth is truncated. An amount change takes effect from the first cycle
    starting at or after its `from`.
  - amount: ov?.skipped → 0; spread → (m === c ? fullAmount − (N − 1) × floor(fullAmount / N) :
    floor(fullAmount / N)); not spread → ov?.amount ?? scheduledAmount.
  - skipped = ov?.skipped === true (then paid = false); paid = isChargeMonth && ov?.paid === true;
    overridden = ov?.amount !== undefined.
  - dueDate: charge periods with dueDay set only. In period m with start day s: dueDay ≥ s → in m's
    calendar month, else in the following calendar month; the day is clamped to that month's length.
    ('2026-10', s 25, dueDay 1) → 2026-11-01; ('2026-11', 25, 31) → 2026-11-30; ('2027-02', 28, 30) →
    2027-02-28; ('2028-02', 28, 31) → 2028-02-29.
  - Tests: 10000 yearly, spread, from 2026-03 → 2026-03: 837, 2026-04: 833, 2027-02: 833, 2027-03:
    837; 2026-03…2027-02 sum to 10000. amounts [{2026-01, 12000}, {2026-07, 14400}], yearly, spread →
    2026-07: 1000, 2026 sums to 12000, 2027-01: 1200. On the first: override {skipped} at 2026-03 →
    every line 2026-03…2027-02 is 0; override {amount 11000} at 2026-03 → 2026-03: 924, the rest 916.
    endMonth 2026-10 → no line in 2026-11; 2026-03…2026-10 sums to 6668.
- `linesFor` returns lines sorted by dueDate (nulls last), then `order`, then name.
- `monthlyEquivalent(r, m)` = Math.round(baseAmountFor(r, m) / N), display only.
- `notThisMonthLabel(r, m, s, locale)`, first match: m < startMonth → "Starts {name}"; endMonth ≠ null
  and m > endMonth → "Ended {name}"; next ≠ null → "Next: {due date medium, or period name}";
  otherwise "No more charges, ends {name}".
- **normalizeRecurring(r)**:
  1. Stable-sort amounts by `from`; keep the last of equal `from`s.
  2. a = last entry with from ≤ startMonth, else amounts[0]; amounts = [{ from: startMonth, amount:
     a.amount }, ...entries with from > startMonth].
  3. endMonth ≠ null → drop entries with from > endMonth.
  4. Merge consecutive entries with equal amounts (keep the earlier).
  5. endMonth < startMonth → endMonth = startMonth; N ∉ {1,2,3,6,12} → 1; spread = spread && N > 1;
     kind income → categoryId null.
  Tests: [{2026-01, 1000}, {2026-06, 1200}] with start moved to 2025-10 → [{2025-10, 1000}, {2026-06,
  1200}]; start moved to 2026-08 → [{2026-08, 1200}]; endMonth 2026-03 → [{2026-01, 1000}].
- `withAmountFrom(r, amount, f)` = normalizeRecurring({ ...r, amounts: [...r.amounts.filter(a => a.from
  < f), { from: max(f, startMonth), amount }] }). ([{2026-01, 1000}], 1000, 2026-05) → [{2026-01,
  1000}]; ([{2026-01, 1000}, {2026-05, 1200}], 1000, 2026-03) → [{2026-01, 1000}].
- Stop after m: endMonth = m (offered only when m ≥ startMonth). Delete: remove the item and all its
  overrides.

### 4.5 Month summary (`computeMonthSummary(data, month, today)`)

With s, range, timing from §4.3:

- incomeLines / fixedLines = `linesFor` for kind income / expense.
- incomeRecurring = Σ incomeLines.amount; incomeOneOff = Σ income transactions in range; income = both.
- fixed = Σ fixedLines.amount; daily = Σ expense transactions in range.
- savings = months[month]?.savingsGoal ?? settings.savingsGoal.
- spent = fixed + daily; available = income − fixed − savings; left = available − daily.
- todaySpent = Σ expenses dated today (current only, else 0).
- perDay: current → floor((left + todaySpent) / daysLeft); future → floor(left / days); past → null.
  todayLeft = current ? perDay − todaySpent : null. Tests: available 100000, days 30, dayIndex 10, 20000
  before today, 1000 today, 30000 dated day 20 → left 49000, perDay 2380, todayLeft 1380; without the
  day-20 expense → perDay 3809, todayLeft 2809; future, available 90000, 30000 already entered, 30
  days → perDay 2000; last day, left 1234, todaySpent 500 → perDay 1734, todayLeft 1234.
- pace (always present): spendRatio = available > 0 ? daily / available : (daily > 0 ? 1 : 0);
  timeRatio = current ? dayIndex / days : null; status = left < 0 ? 'over' : (current && available > 0
  && 10 × daily × days > available × (10 × dayIndex + days)) ? 'ahead' : 'ok' (integer form of
  spendRatio > timeRatio + 0.10). Tests: days 10, dayIndex 7, available 100000, daily 80000 → ok;
  80001 → ahead; income 90000, fixed 100000, daily 5000 → spendRatio 1, over.
- byCategory contains id X when X has a fixed line with amount > 0, or at least one expense in the
  period, or X is an existing non-archived category with budget ≥ 1. Ids not in `data.categories`
  merge into one `UNCATEGORIZED_ID` row (budget null, status none). Each row: fixed, daily, total,
  budget, count (expense transactions), status = budgetStatus(total, budget). Sorted by total desc,
  then category order (Uncategorized last), then id. Tests: archived category with a budget and no
  spending → absent; expenses of 500 on 'cat-x' and 300 on 'cat-y' (both unknown) → one row {
  '__none__', daily 800, count 2 }.
- `budgetStatus(spent, budget)`: none when budget is null or 0; over when spent > budget; warning
  when 100 × spent ≥ 85 × budget; else ok. Tests: (8500, 10000) warning; (8499, 10000) ok; (10000,
  10000) warning; (10001, 10000) over; (500, 0) none.
- transactions: all in range, sorted by date desc, then createdAt desc.

### 4.6 Insights and queries

- `dailySeries(transactions, month, s, categoryId?, categories?)`: one entry per day, expenses only,
  zero-filled. With `categories` (pass all of `data.categories`) a category filter counts expenses the
  way byCategory does (`categoryKeyOf`: deleted categories count as UNCATEGORIZED_ID), so the series
  adds up to the row's `daily`. Every UI filter for one category (category detail lists, the Daily
  list with a chip selected) uses `categoryKeyOf`, and `frequentEntries` gets `categories` too.
- `trend(data, endMonth, count, today)`: oldest first, { month, fixed, daily, income }.
- `categoryTrend(data, categoryId, endMonth, count, today)`: oldest first, { month, fixed, daily,
  total } from byCategory (zeros when absent).
- `upcomingFixed(summary, today, limit = 4)`: current period only; fixedLines that are charge lines,
  not paid, not skipped, with dueDate in [today, range.end]; by dueDate, order, name.
- `dailyAverage(summary)`: current → round(Σ expenses dated ≤ today / dayIndex); past → round(daily /
  days); future → null.
- `frequentEntries(transactions, today, { days = 60, limit = 4, categoryId })`: expenses with 0 ≤
  diffDays(date, today) ≤ days − 1 (future excluded), optional category; key = note trimmed,
  whitespace collapsed, lower-cased + amount + categoryId; skip empty notes; groups with count ≥ 2;
  order count desc, then latest (date, createdAt) desc, then key; note = trimmed note of the latest.
- `lastUsedCategoryId(data)`: category of the expense with the greatest createdAt whose category
  exists, is not archived, and whose note is not `BEFORE_APP_NOTE`; else null.
- `needsBackupReminder(data, now)`: transactions.length + recurring.length ≥ 10 and (lastBackupAt ===
  null ? now − settings.createdAt > 7 days : now − lastBackupAt > 30 days).
- `firstPeriod(data, today)`: the earliest of periodOf(local date of settings.createdAt), periodOf(the
  earliest transaction date) and the earliest recurring startMonth; never after the current period.
- `categoryDisplay(id, map)`: the category's name, icon and colour, or `UNCATEGORIZED_DISPLAY` { name
  "Uncategorized", icon "question", color null }.

### 4.9 Budget amount, splits, goals and the month review

- `myShare(tx)` = tx.amount − Σ amounts of its splits whose status is not 'forgiven' (≥ 0).
- `budgetAmount(tx)` = 0 for income and for wallet-paid expenses (`fromWallet`), else `myShare(tx)`.
  Every monthly figure of §4.5 (daily, todaySpent, perDay, pace, byCategory daily and count) and
  `dailySeries`, `dailyAverage` and the Daily day totals use `budgetAmount`; a wallet-paid expense is
  not counted in byCategory `count`.
- Splits: amount 1..MAX_CENTS each, Σ splits ≤ tx.amount, person 1..24 characters, status
  'open' | 'paid' | 'forgiven', settledAt null when open. Only expenses have splits.
- `owedSummary(data)`: open splits grouped by person (case-insensitive, the latest spelling shown),
  total per person and overall, people sorted by total desc; equal totals keep the person with the
  most recent open split first (a stable sort over expenses newest first).
- Goals fill like a waterfall: remaining = max(0, balance); for each active goal (doneAt null) in
  fill order (`order`, then createdAt, then id in code units): filled = min(target, remaining);
  remaining −= filled. free = balance − Σ filled (negative when the balance is). reached = filled ≥
  target. Tests: balance 63122, goals [120000, 30000] → filled [63122, 0], free 0; balance 200000 →
  [120000, 30000], free 50000; balance −5000 → [0, 0], free −5000.
- `goalsInFillOrder(goals)`: every goal, active and done, in that fill order. A done goal keeps the
  place its `order` gives it, which is where "Put back" returns it, so this is the full list the
  Wallet hands `reorderGoals` after a move. Test: laptop (0), trip (1, done), bike (2), piano (3,
  done) in any input order → [laptop, trip, bike, piano].
- `monthReview(data, month, today)` for a past period:
  - month, previousMonth (the period before it under the current start day), result (§4.8, =
    savings + left), savings, left, income, fixed, daily.
  - categories: the top 5 by daily spending above 0 (byCategory, highest first; ties by category
    order, Uncategorized last, then id), each with the previous period's daily for that category and
    change = (daily − previous) / previous, null when previous is 0 ("New"); rest: every further
    category with daily spending above 0, in the same order and with the same comparison (what the
    "{n} more" fold holds; a single remaining category shows by name with its change);
    moreCategories = rest.length.
  - biggestExpense: the largest budgetAmount, the newest on a tie, never onboarding's "Before On a
    Budget" entry (§3.9 step 5, the total spent before the install).
  - noSpendDays: days without budget spending from the later of the period's first day and the
    install day (the local date of settings.createdAt) to the earlier of its last day and today; 0
    for a period that ended before the install (the review then hides that row).
  - entries: expenses that count against the period (wallet-paid ones do not); fixedPaid: charge
    lines ticked paid; fixedCount: charge lines that are not skipped (a skipped cost is not due);
    owedOpen: Σ open splits on the period's expenses; walletAfter: the running balance after the
    period's closing movement.

### 4.8 Wallet

- result(p) = income(p) − fixed(p) − daily(p) from `computeMonthSummary` (= savings(p) + left(p)).
  `daily` uses `budgetAmount`, so wallet-paid expenses are not in it (§4.9).
- Wallet-paid expenses are withdrawals of `myShare(tx)` on their date ("Paid: {note or category}"),
  counted once dated ≤ today, whatever the wallet's start.
- start = `wallet.startMonth ?? periodOf(localDateOf(settings.createdAt), s)`. (Not `firstPeriod`:
  backdated fixed costs must not drain the wallet for months before the app was used.)
- Closed periods: every p with start ≤ p < the current period (timing past).
- balance = opening + Σ result(p) over closed periods + Σ deposits − Σ withdrawals (entries with
  date ≤ today; the UI never creates future-dated entries).
- pending = result(current period) when the current period ≥ start, else null.
- Movements, oldest first: "opening" (dated start's first day, only when opening > 0), one "month"
  movement per closed period (dated the period's last day), and "deposit" / "withdrawal" entries
  (by date, then createdAt). Ties on the same date: opening, then entries, then the month closing.
  Each carries the running balance after it.
- Changing the start day (§4.3) moves `wallet.startMonth` by the rule for keys without a date.
- Wallet entries: amount 1..MAX_CENTS, valid date, note ≤ 80; opening 0..MAX_CENTS.
- Tests: opening 50000, closed periods with results +15882 and −4128, a withdrawal of 20000 → balance
  41754; a fixed cost backdated before start changes nothing; editing a past expense changes the
  balance; pending is null before start and for a start in the future.

### 4.7 Validation, migration, backups

- `CURRENT_SCHEMA_VERSION = 1`; `MIGRATIONS: Record<number, (raw) => raw>` (MIGRATIONS[n] turns n into
  n + 1), applied in order before validation.
- `normalizeAppData(raw, now)` → `{ data, report }` with `NormalizeReport { migratedFrom: number |
  null; dropped: { transactions, recurring, categories, quickAdds, overrides }; repaired: number }`.
  Throws `DataError` (codes `'not-backup' | 'newer-version' | 'damaged'`) when raw is not an object
  with the expected top-level arrays (damaged) or schemaVersion > current (newer-version).
  `normalizeAppData` is idempotent: normalising its own output changes nothing and reports nothing.
- Repairs (never drop for these):
  - Ids: valid = `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/` (`__none__` excepted as a category reference); a
    missing or invalid id gets `newId()`. Duplicates: drop the later row only if deep-equal to the
    first, else give it a new id.
  - Strings trimmed and truncated to `MAX_LENGTHS` (name 24, category 24, quick-add label 16,
    recurring name 40, note 80).
  - Transactions: income → categoryId null; expense with null categoryId → `UNCATEGORIZED_ID`;
    unknown category ids are kept.
  - Recurring: invalid everyMonths → 1; dueDay outside 1..31 → null; then `normalizeRecurring`.
  - Categories: invalid color → slate, invalid kind → both, budget 0 or invalid → null, invalid icon →
    "circle".
  - Overrides: invalid amount key removed; empty overrides removed; overrides for unknown recurring
    ids removed (counted as dropped).
  - Settings field by field: currency must match `/^[A-Z]{3}$/` and construct an Intl.NumberFormat;
    locale must be a NUMBER_LOCALES entry in any case (stored as listed, even when the engine lacks
    its data, e.g. sq-AL in Chromium) or a locale Intl supports, stored in canonical form
    (`canonicalNumberLocale`); theme, accent
    and homeCards keys must be valid; monthStartDay clamped to 1..28; savingsGoal 0..MAX_CENTS; any
    other invalid field gets its default.
- Drops (counted in the report): a transaction whose kind is invalid, amount is not an integer in
  1..MAX_CENTS, or date is not a valid ISODate; a recurring item with an invalid startMonth or no valid
  amount entry; categories and quick adds missing required fields that cannot be defaulted.
- Records keyed by id are read with `Object.hasOwn` (never plain `in` or an unchecked index).
- **Backup file**: `{ app: 'on-a-budget', kind: 'backup', schemaVersion, exportedAt, data }`, named
  `on-a-budget-backup-YYYY-MM-DD.json` (local date). `parseBackup(text, now)` → `{ data, report,
  exportedAt }`; DataError messages: not-backup "This file isn't an On a Budget backup."; newer-version
  "This backup was made by a newer version of the app. Close the app, open it again to update, then
  import again."; damaged "This backup is damaged and can't be imported." `data.schemaVersion` counts;
  a mismatching outer schemaVersion is damaged.
- **CSV** (`transactionsToCsv`): UTF-8 starting with U+FEFF; every row (incl. the last) ends with CRLF;
  header `date,type,category,note,amount,currency,my_share,paid_from` (my_share = §4.9 myShare for
  expenses, empty for income; paid_from = budget | wallet, empty for income); date ISO; type expense|income; category name
  ("Uncategorized" for unknown ids, empty for income); amount `centsToDecimalString(amount, digits)`
  always positive; currency = settings.currency. Only category and note are escaped: if the value
  starts with `=`, `+`, `-`, `@`, TAB or CR prefix `'`; then quote it when it contains `,` `"` CR or LF,
  doubling inner quotes. Rows by date asc, createdAt asc, id. File `on-a-budget-spending-YYYY-MM-DD.csv`.
  Tests: note `=SUM(A1:A2)` → `'=SUM(A1:A2)`; `-20% sale, shoes` → `"'-20% sale, shoes"`; `Coffee
  "large"` → `"Coffee ""large"""`; EUR 5 → `0.05`; JPY 35000 → `350`.
- The security config is never part of a backup or CSV.

---

## 5. Architecture

### 5.1 Stack and toolchain

- Vite 8, React 19.3, TypeScript 6 (strict), CSS Modules plus global token CSS, Zustand 5,
  idb-keyval 6, vite-plugin-pwa 2 (Workbox generateSW, prompt mode), Phosphor icons (path data
  generated into `src/ui/icons/generated.ts`), Vitest 5, Playwright 1.64, oxlint 1.88. No UI or chart
  library.
- **TypeScript**: strict, `noUncheckedIndexedAccess` (every index access is `T | undefined`: use
  `.at()`, `?.` and guards; `!` only right after a check), `verbatimModuleSyntax` (`import type`),
  `erasableSyntaxOnly` (no enums, namespaces or parameter properties), `@/` alias via `paths` only.
  `ISODate` and `MonthKey` are template literal types; only `dates.ts` constructs them (one `as` cast
  each), everything else narrows with `isValidISODate`/`isValidMonthKey`.
- **Vitest**: two projects, `unit` (node, `src/**/*.test.ts`) and `dom` (jsdom, `src/**/*.test.tsx`);
  `TZ=Europe/Berlin`. `src/test/setup.ts` stubs `matchMedia`, `visualViewport`, `IntersectionObserver`,
  `ResizeObserver`, `scrollIntoView` and `scrollTo` when missing.
- **oxlint** (`npm run lint` uses `--deny-warnings`): react plugin with `rules-of-hooks` and
  `exhaustive-deps` as errors; the React Compiler rules (purity, refs, set-state-in-effect,
  immutability, static-components, use-memo) are on. Layering is enforced with
  `no-restricted-imports`: `src/domain` imports no React, store, ui, app or features; `src/store`
  imports no ui, app or features; `src/ui` imports no store, app or features; features import from
  the shell only `@/app/nav`, `@/app/MonthSwitcher` and `@/app/undo`.
- React rules: never copy props or store values into state in an effect (derive with `useMemo` or
  reset with a `key`); never call `Date.now()`/`new Date()` during render (use `useToday()`); never
  read `ref.current` during render; never declare a component inside another; `actions.*` and
  `toast()` only from event handlers.

### 5.2 Directory layout

```
index.html                    meta tags, inline background style, theme-init script tag
public/theme-init.js          sets data-theme/data-accent, html background and theme-color before first paint
public/                       icons, apple-touch-icon, favicon (generated by scripts/generate-icons.mjs)
scripts/generate-icons.mjs    renders docs/design/app-icon.svg, app-icon-maskable.svg and mark.svg to PNG/SVG icons with sharp
scripts/build-icons.mjs       extracts the Phosphor icons listed in src/ui/icons/manifest.ts into generated.ts
src/
  main.tsx                    starts initStore, initSecurity, the privacy cover and the SW; renders <App/>
  App.tsx                     gates (§5.6)
  domain/                     pure TypeScript, fully unit-tested
  store/                      Zustand stores, IndexedDB, persistence, hooks
  styles/                     tokens.css (from DESIGN.md), global.css
  ui/                         design-system primitives; icons/; charts/
  app/                        shell: Shell, TabBar, nav, ScreenStack, SheetHost, registry, MonthSwitcher,
                              MonthPickerSheet, undo, ErrorBoundary, banners, theme, privacy cover
  features/pwa|home|daily|fixed|you|lock|onboarding
  test/setup.ts
e2e/                          Playwright specs, fixtures
```

### 5.3 Domain API (src/domain)

```ts
// constants.ts
export const APP_NAME = 'On a Budget'; export const APP_ID = 'on-a-budget'
export const MAX_CENTS = 9_999_999_999
export const MAX_LENGTHS = { name: 24, category: 24, quickAdd: 16, recurring: 40, note: 80 } as const
export const MAX_QUICK_ADDS = 8                      // actions.addQuickAdd refuses a ninth (§3.7, §5.4)
export const BEFORE_APP_NOTE = 'Before On a Budget'
export const MAX_MONTH_START_DAY = 28                // settings.monthStartDay is 1..28 (§4.3)
export const LS_PREFIX = 'onabudget:'                // every LS_KEYS value starts with it; erase removes them all
export const LS_KEYS = { theme: 'onabudget:theme', accent: 'onabudget:accent', rescue: 'onabudget:rescue',
  draft: 'onabudget:draft', onboardingStep: 'onabudget:onboardingStep', installHintDismissed:
  'onabudget:installHintDismissed', backupNudgeUntil: 'onabudget:backupNudgeUntil' } as const

// money.ts
export type KeypadKey = '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'.'|'back'
export type CurrencyDigits = 0 | 2
export const MASKED = '•••'
export type MoneySign = 'auto' | 'always' | 'never'
export interface FormatMoneyOptions { currency: string; locale: string; showCents?: boolean; sign?: MoneySign; compact?: boolean; symbol?: boolean }
export interface MoneyParts { number: string; symbol: string; symbolFirst: boolean }   // for hanging units (DESIGN.md §9.6)
export interface MoneyFormatOptions { currency: string; locale: string; showCents: boolean; masked: boolean }
export interface MoneyFormatCallOptions { showCents?: boolean; sign?: MoneySign; compact?: boolean; unmasked?: boolean; symbol?: boolean }
export interface MoneyFormat extends MoneyFormatOptions {
  digits: CurrencyDigits; decimalSeparator: '.' | ','; symbol: string
  format(cents: Cents, o?: MoneyFormatCallOptions): string
  parts(cents: Cents, o?: Omit<MoneyFormatCallOptions, 'symbol'>): MoneyParts  // masked → number MASKED
}
export function createMoneyFormat(o: MoneyFormatOptions): MoneyFormat
export function formatMoneyParts(cents: Cents, o: FormatMoneyOptions): MoneyParts
export function currencyDigits(currency: string): CurrencyDigits
export function formatMoney(cents: Cents, o: FormatMoneyOptions): string
export function centsToDecimalString(cents: Cents, digits: CurrencyDigits): string  // 350 → "3.50"; digits 0 → "4"
export function parseAmountInput(input: string, digits: CurrencyDigits, decimalSep: '.' | ','): Cents | null
export function decimalSeparator(locale: string): '.' | ','
export function currencySymbol(currency: string, locale: string): string
export function applyKeypadKey(current: string, key: KeypadKey, digits: CurrencyDigits): string
export function keypadStringToCents(s: string): Cents
export function centsToKeypadString(cents: Cents, digits: CurrencyDigits): string
export function formatKeypadString(s: string, o: { currency: string; locale: string }): string
export function sumCents(values: readonly Cents[]): Cents
export function ratio(part: number, whole: number): number                       // 0 when whole <= 0

// dates.ts
export function todayISO(now?: Date): ISODate
export function toISODate(y: number, m: number, d: number): ISODate              // m 1..12
export function toMonthKey(y: number, m: number): MonthKey                       // m 1..12
export function parseISODate(s: ISODate): { y: number; m: number; d: number }   // throws on invalid
export function parseMonthKey(key: MonthKey): { y: number; m: number }           // throws on invalid
export function isValidISODate(s: unknown): s is ISODate
export function isValidMonthKey(s: unknown): s is MonthKey
export function daysInMonth(y: number, m: number): number
export function addDays(date: ISODate, n: number): ISODate
export function diffDays(from: ISODate, to: ISODate): number                    // to − from
export function compareISO(a: string, b: string): number                        // also MonthKey
export function weekday(date: ISODate): number                                  // 0 = Sunday
export function monthKeyOf(date: ISODate): MonthKey
export function addMonths(key: MonthKey, n: number): MonthKey
export function monthDiff(from: MonthKey, to: MonthKey): number
export function maxMonth(a: MonthKey, b: MonthKey): MonthKey
export function minMonth(a: MonthKey, b: MonthKey): MonthKey
export function localDateOf(epochMs: number): ISODate
export function dateLocaleFor(numberLocale: string): 'en-US' | 'en-GB'
export function monthName(m: number, style?: 'long' | 'short'): string           // fixed English names: 10 → "October" / "Oct"
export function formatDate(date: ISODate, numberLocale: string, style?: 'short' | 'medium' | 'long'): string
export function formatDayLabel(date: ISODate, today: ISODate, numberLocale: string): string
export function formatRelativeDue(date: ISODate, today: ISODate, numberLocale: string): string
export function formatMonthKey(key: MonthKey, numberLocale: string, style?: 'long' | 'short'): string
export function formatRelativeTime(epochMs: number, nowMs: number): string
export function ordinalDay(day: number): string

// period.ts
export interface PeriodRange { start: ISODate; end: ISODate }
export type PeriodTiming = 'past' | 'current' | 'future'
export function periodRange(month: MonthKey, startDay: number): PeriodRange
export function periodOf(date: ISODate, startDay: number): MonthKey
export function periodDays(month: MonthKey, startDay: number): number
export function dayIndexInPeriod(date: ISODate, month: MonthKey, startDay: number): number | null
export function periodTiming(month: MonthKey, today: ISODate, startDay: number): PeriodTiming
export function daysLeftInPeriod(month: MonthKey, today: ISODate, startDay: number): number
export function isDateInPeriod(date: ISODate, month: MonthKey, startDay: number): boolean
export function formatPeriodName(month: MonthKey, startDay: number, numberLocale: string, o?: { withYear?: boolean; style?: 'long' | 'short' }): string
export function formatPeriodRange(month: MonthKey, startDay: number, numberLocale: string): string | null
export function formatPeriodLabel(month: MonthKey, startDay: number, numberLocale: string): string
export function formatPeriodDates(month: MonthKey, startDay: number, numberLocale: string): string   // "1 Oct – 31 Oct 2026"; s ≠ 1: formatPeriodLabel
export function formatPeriodTitle(month: MonthKey, currentMonth: MonthKey, startDay: number, numberLocale: string): string  // "October", "January 2027"
export function shiftForStartDayChange(dueDay: number | null, from: number, to: number): -1 | 0 | 1

// recurring.ts
export interface RecurringLine { recurring: Recurring; month: MonthKey; amount: Cents; scheduledAmount: Cents; fullAmount: Cents; skipped: boolean; paid: boolean; overridden: boolean; isChargeMonth: boolean; dueDate: ISODate | null }
export function isInRange(r: Recurring, month: MonthKey): boolean
export function isChargeMonth(r: Recurring, month: MonthKey): boolean
export function chargePeriodOf(r: Recurring, month: MonthKey): MonthKey | null
export function baseAmountFor(r: Recurring, month: MonthKey): Cents
export function dueDateFor(r: Recurring, month: MonthKey, startDay: number): ISODate | null
export function lineFor(r: Recurring, month: MonthKey, months: AppData['months'], startDay: number): RecurringLine | null
export function linesFor(items: readonly Recurring[], kind: TxKind, month: MonthKey, months: AppData['months'], startDay: number): RecurringLine[]
export function compareLines(a: RecurringLine, b: RecurringLine): number          // the linesFor order: dueDate (nulls last), order, name
export function nextChargeMonth(r: Recurring, from: MonthKey): MonthKey | null
export function notThisMonthLabel(r: Recurring, month: MonthKey, startDay: number, numberLocale: string): string
export function scheduleLabel(r: Recurring, month: MonthKey, startDay: number, numberLocale: string): string  // §3.5 subtitles
export function withAmountFrom(r: Recurring, amount: Cents, from: MonthKey): Recurring
export function normalizeRecurring(r: Recurring): Recurring
export function monthlyEquivalent(r: Recurring, month: MonthKey): Cents

// summary.ts
export const UNCATEGORIZED_ID = '__none__'
export type BudgetStatus = 'none' | 'ok' | 'warning' | 'over'
export interface CategorySpend { categoryId: string; fixed: Cents; daily: Cents; total: Cents; budget: Cents | null; count: number; status: BudgetStatus }
export interface PaceInfo { timeRatio: number | null; spendRatio: number; status: 'ok' | 'ahead' | 'over' }
export interface MonthSummary {
  month: MonthKey; range: PeriodRange; timing: PeriodTiming; days: number; dayIndex: number | null; daysLeft: number
  incomeRecurring: Cents; incomeOneOff: Cents; income: Cents; fixed: Cents; daily: Cents; savings: Cents
  spent: Cents; available: Cents; left: Cents; perDay: Cents | null; todaySpent: Cents; todayLeft: Cents | null
  pace: PaceInfo; fixedLines: RecurringLine[]; incomeLines: RecurringLine[]; byCategory: CategorySpend[]; transactions: Transaction[]
}
export function computeMonthSummary(data: AppData, month: MonthKey, today: ISODate): MonthSummary
export function budgetStatus(spent: Cents, budget: Cents | null): BudgetStatus
export interface PaceInput { available: Cents; daily: Cents; days: number; dayIndex: number | null }
export function computePace(o: PaceInput): PaceInfo                               // the §4.5 pace rule (dayIndex null: not the current period)

// insights.ts
export interface DayAmount { date: ISODate; amount: Cents }
export interface TrendPoint { month: MonthKey; fixed: Cents; daily: Cents; income: Cents }
export interface CategoryTrendPoint { month: MonthKey; fixed: Cents; daily: Cents; total: Cents }
export interface FrequentEntry { note: string; amount: Cents; categoryId: string; count: number }
export function dailySeries(transactions: readonly Transaction[], month: MonthKey, startDay: number, categoryId?: string, categories?: readonly Category[]): DayAmount[]
export interface FrequentEntriesOptions { days?: number; limit?: number; categoryId?: string; categories?: readonly Category[] }
// summary.ts also exports categoryKeyOf(categoryId: string | null, known: { has(id: string): boolean }): string
export function trend(data: AppData, endMonth: MonthKey, count: number, today: ISODate): TrendPoint[]
export function categoryTrend(data: AppData, categoryId: string, endMonth: MonthKey, count: number, today: ISODate): CategoryTrendPoint[]
export function upcomingFixed(summary: MonthSummary, today: ISODate, limit?: number): RecurringLine[]
export function dailyAverage(summary: MonthSummary): Cents | null
export function frequentEntries(transactions: readonly Transaction[], today: ISODate, o?: FrequentEntriesOptions): FrequentEntry[]

// wallet.ts (§4.8, §4.9)
export type WalletMovementKind = 'opening' | 'month' | 'deposit' | 'withdrawal' | 'payment'
export interface WalletMovement { key: string; kind: WalletMovementKind; date: ISODate; month: MonthKey | null; amount: Cents; balance: Cents; note: string; entryId: string | null; transactionId: string | null }  // amount signed
export interface GoalState { goal: SavingsGoal; filled: Cents; reached: boolean }
export interface GoalFill { goals: GoalState[]; doneGoals: SavingsGoal[]; free: Cents }
export interface WalletSummary { start: MonthKey; balance: Cents; free: Cents; pending: Cents | null; goals: GoalState[]; doneGoals: SavingsGoal[]; movements: WalletMovement[] }  // movements oldest first; goals in fill order
export function monthResult(summary: MonthSummary): Cents        // income − fixed − daily
export function walletStart(data: AppData): MonthKey
export function goalsInFillOrder(goals: readonly SavingsGoal[]): SavingsGoal[]   // every goal, done ones at their order's place: the list for reorderGoals
export function fillGoals(balance: Cents, goals: readonly SavingsGoal[]): GoalFill // the §4.9 waterfall
export function walletSummary(data: AppData, today: ISODate): WalletSummary

// splits.ts (§4.9)
export function myShare(tx: Transaction): Cents
export function budgetAmount(tx: Transaction): Cents
export interface OwedItem { transactionId: string; splitId: string; date: ISODate; note: string; amount: Cents }
export interface OwedPerson { person: string; total: Cents; items: OwedItem[] }
export interface OwedSummary { total: Cents; people: OwedPerson[] }   // people by total desc; ties: the most recent open split first
export function owedSummary(data: AppData): OwedSummary
export function personSuggestions(data: AppData, prefix?: string): string[]   // earlier split names, most recent first, case-insensitive unique

// review.ts (§4.9)
export interface ReviewCategory { categoryId: string; daily: Cents; previous: Cents; change: number | null }  // change: ratio vs previous, null when previous is 0
export interface MonthReview { month: MonthKey; previousMonth: MonthKey; result: Cents; savings: Cents; left: Cents; income: Cents; fixed: Cents; daily: Cents; categories: ReviewCategory[]; rest: ReviewCategory[]; moreCategories: number; biggestExpense: Transaction | null; noSpendDays: number; entries: number; fixedPaid: number; fixedCount: number; owedOpen: Cents; walletAfter: Cents }  // categories: top 5; rest: every further one with spending (the fold); moreCategories = rest.length; fixedCount: charge lines that are not skipped
export function monthReview(data: AppData, month: MonthKey, today: ISODate): MonthReview
export function unreviewedClosedMonth(data: AppData, today: ISODate): MonthKey | null   // the latest closed period newer than settings.lastReviewedMonth (and ≥ the wallet start), else null

// ids.ts
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
export function newId(): string                       // crypto.randomUUID(), else crypto.getRandomValues; always matches ID_PATTERN

// catalog.ts (static lists; hex colours live in tokens.css). Each list's element type is exported
// too (CurrencyOption, NumberLocaleOption, AccentOption, CategoryColorOption, HomeCardOption,
// EveryMonthsOption, RecurringSuggestion, AutoLockOption), as are FALLBACK_NUMBER_LOCALE ('de-DE'),
// FALLBACK_CURRENCY ('EUR') and CATEGORY_ICON_GROUPS (the picker's groups, in order).
export const CURRENCIES: { code: string; name: string; digits: CurrencyDigits }[]  // EUR first: EUR USD GBP CHF ALL(0) PLN CZK HUF RON SEK NOK DKK TRY JPY(0) CNY INR CAD AUD
export const NUMBER_LOCALES: { locale: string; label: string }[]                    // de-DE, de-AT, de-CH, en-IE, en-GB, en-US, fr-FR, it-IT, es-ES, nl-NL, sq-AL, pl-PL
export function defaultCurrencyFor(locale: string, timeZone?: string): string       // time zone first (Europe/Berlin → EUR, Zurich → CHF, London → GBP, Tirane → ALL, …), then locale region, then EUR
export function defaultNumberLocale(navigatorLanguage: string | undefined): string  // supported → itself, else 'de-DE'
export const ACCENTS: { key: AccentKey; name: string }[]                             // navy (default), royal, teal, bottle, burgundy, plum, cognac, graphite
export function canonicalNumberLocale(value: unknown): string | null                // a NUMBER_LOCALES tag as listed, or an Intl-supported tag in canonical form
export const CATEGORY_COLORS: { key: CategoryColor; name: string }[]
export interface CategoryIconOption { key: string; name: string; keywords: string[]; group: string }
export const CATEGORY_ICONS: CategoryIconOption[]                                    // ~60 Phosphor keys (DESIGN.md), incl. 'question' and 'circle'
export const EMOJI_CHOICES: string[]                                                 // Emoji tab and avatars
export const HOME_CARDS: { key: HomeCardKey; name: string; description: string }[]
export const EVERY_MONTHS_OPTIONS: { value: EveryMonths; label: string }[]
export const RECURRING_SUGGESTIONS: { name: string; categoryId: string; everyMonths: EveryMonths }[]
  // Netflix (subscriptions,1), Spotify (subscriptions,1), Deutschlandticket (transport,1), Phone (phone,1),
  // Internet (phone,1), Gym (subscriptions,1), Insurance (insurance,12), Rundfunkbeitrag (other,3). No prices.
export const AUTO_LOCK_OPTIONS: { minutes: number; label: string }[]

// defaults.ts
export const CURRENT_SCHEMA_VERSION = 1
export const DEFAULT_CATEGORY_IDS: { rent: 'cat-rent'; subscriptions: 'cat-subscriptions'; transport: 'cat-transport'; phone: 'cat-phone'; insurance: 'cat-insurance'; eating: 'cat-eating'; groceries: 'cat-groceries'; coffee: 'cat-coffee'; shopping: 'cat-shopping'; goingOut: 'cat-going-out'; health: 'cat-health'; other: 'cat-other' }
export function createDefaultSettings(now: number, navigatorLanguage?: string, timeZone?: string): Settings
export function createDefaultCategories(): Category[]
export function createDefaultQuickAdds(): QuickAdd[]
export function createInitialData(now: number, navigatorLanguage?: string, timeZone?: string): AppData
export function createDefaultWallet(): Wallet
export function createDefaultSecurity(): SecurityConfig
export const DEFAULT_PIN_ITERATIONS = 210_000; export const DEFAULT_AUTO_LOCK_MINUTES = 1

// normalize.ts
export type DataErrorCode = 'not-backup' | 'newer-version' | 'damaged'
export class DataError extends Error { readonly code: DataErrorCode; constructor(code: DataErrorCode, message: string) }  // name 'DataError'
export interface NormalizeReport { migratedFrom: number | null; dropped: { transactions: number; recurring: number; categories: number; quickAdds: number; overrides: number }; repaired: number }
export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>
export function normalizeAppData(raw: unknown, now: number): { data: AppData; report: NormalizeReport }
export function droppedCount(report: NormalizeReport): number
export function isRecord(value: unknown): value is Record<string, unknown>          // a plain object (not null, not an array)
export function ownValue(record: Record<string, unknown>, key: string): unknown     // record[key] only when Object.hasOwn

// backup.ts
export interface BackupFile { app: 'on-a-budget'; kind: 'backup'; schemaVersion: number; exportedAt: string; data: AppData }
export interface ParsedBackup { data: AppData; report: NormalizeReport; exportedAt: string }
export const BACKUP_ERROR_MESSAGES: Readonly<Record<DataErrorCode, string>>   // the §4.7 messages
export function createBackup(data: AppData, now: number): BackupFile
export function serializeBackup(b: BackupFile): string
export function parseBackup(text: string, now: number): ParsedBackup
export function backupFileName(now: number): string
export function transactionsToCsv(data: AppData): string
export function csvFileName(now: number): string

// queries.ts
export interface CategoryUsage { transactions: number; recurring: number; quickAdds: number }
export const UNCATEGORIZED_DISPLAY: { name: 'Uncategorized'; icon: 'question'; color: null }
export function categoryUsage(data: AppData, categoryId: string): CategoryUsage
export function sortedCategories(categories: readonly Category[], o?: { includeArchived?: boolean; kind?: 'fixed' | 'daily' }): Category[] // existing references; kind filter keeps 'both'
export interface CategoryDisplay { name: string; icon: IconRef; color: CategoryColor | null }
export function categoryDisplay(id: string | null, map: Readonly<Record<string, Category>>): CategoryDisplay
export function lastUsedCategoryId(data: AppData): string | null
export function needsBackupReminder(data: AppData, now: number): boolean
export function firstPeriod(data: AppData, today: ISODate): MonthKey
export function nextFreeCategoryColor(categories: readonly Category[]): CategoryColor
export function isIconKey(icon: IconRef): boolean                                    // in CATEGORY_ICONS
export function splitGraphemes(text: string): string[]                               // Intl.Segmenter, else code points
export function isEmoji(value: string): boolean                                      // one grapheme, a symbol, no letter or digit: the Emoji tab's rule
export function isIconRef(value: unknown): value is IconRef                          // a CATEGORY_ICONS key or one emoji
```

Domain functions return existing element references, never clones.

### 5.4 Store, persistence and security (src/store)

```ts
// db.ts — the only module that touches IndexedDB
export interface KvBackend {
  get(key: string): Promise<unknown>
  keys(): Promise<string[]>
  set(key: string, value: unknown): Promise<void>
  del(keys: string[]): Promise<void>
  clear(): Promise<void>
  /** One readwrite transaction: read KEYS.meta; if (meta?.rev ?? null) !== expectedRev reject with ConflictError; else put every entry. */
  commit(expectedRev: number | null, entries: [string, unknown][]): Promise<void>
  /** One readwrite transaction: read `key`, put update(old). */
  update(key: string, update: (old: unknown) => unknown): Promise<void>
}
export class ConflictError extends Error {}
export function getKv(): KvBackend                   // idb-keyval createStore('onabudget', 'kv'); a fresh handle after a failed transaction
export function resetKv(): void
export function setKvBackend(b: KvBackend | null): void   // tests inject memory, failing or slow backends (null restores the default)
export function createMemoryBackend(): KvBackend
export const KEYS = { data: 'data', meta: 'meta', security: 'security', quarantine: 'quarantine' } as const
// snapshots: 'snap:<YYYY-MM-DD>' | 'snap:pre-import' | 'snap:pre-restore' | 'snap:pre-v<N>'

// appStore.ts
export type LoadStatus = 'loading' | 'ready'
export interface AppState { data: AppData; status: LoadStatus }
export const useAppStore: UseBoundStore<StoreApi<AppState>>   // before hydration: { status: 'loading', data: createInitialData(0) }; never saved
export function getData(): AppData

// actions.ts — synchronous; each ends in one setState; untouched branches keep their identity;
// invalid input throws RangeError (never clamps)
export interface NewSplit { id?: string; person: string; amount: Cents; status?: SplitStatus }  // id: change that split in place (updateTransaction); a new split starts 'open'
export interface NewTransaction { kind: TxKind; amount: Cents; categoryId: string | null; date: ISODate; note?: string; fromWallet?: boolean; splits?: NewSplit[] }  // fromWallet and splits: expenses only (§3.13, §3.16)
export interface NewRecurring { kind: TxKind; name: string; categoryId: string | null; amount: Cents; everyMonths?: EveryMonths; spread?: boolean; startMonth: MonthKey; endMonth?: MonthKey | null; dueDay?: number | null; note?: string }
export type RecurringPatch = Partial<Pick<Recurring, 'name' | 'categoryId' | 'everyMonths' | 'spread' | 'startMonth' | 'endMonth' | 'dueDay' | 'note'>>
export interface OverridePatch { amount?: Cents | null; skipped?: boolean; paid?: boolean }
export type NewCategory = Pick<Category, 'name' | 'icon' | 'kind'> & { color?: CategoryColor; budget?: Cents | null }
export type SettingsPatch = Partial<Omit<Settings, 'monthStartDay' | 'savingsGoal' | 'lastBackupAt' | 'lastReviewedMonth' | 'createdAt'>>  // those change through their own actions
export interface NewGoal { name: string; icon: IconRef; target: Cents }
export type GoalPatch = Partial<NewGoal>
export interface NewWalletEntry { kind: 'deposit' | 'withdrawal'; amount: Cents; date: ISODate; note?: string }
export type WalletEntryPatch = Partial<Required<NewWalletEntry>>
export const actions: {
  updateSettings(patch: SettingsPatch): void
  setMonthStartDay(day: number): void                      // §4.3 remap
  setSavingsGoal(amount: Cents, today: ISODate): void      // freezes past periods (below)
  setMonthSavings(month: MonthKey, amount: Cents | null): void
  addCategory(input: NewCategory): Category                // default colour nextFreeCategoryColor
  updateCategory(id: string, patch: Partial<Omit<Category, 'id' | 'order'>>): void
  setCategoryArchived(id: string, archived: boolean): void
  reorderCategories(orderedIds: string[]): void            // unlisted ids keep their order after the listed; order rewritten 0..n-1
  deleteCategory(id: string, moveTo: string | null): void  // throws if used and moveTo null, moveTo === id, or moveTo unknown; moves transactions, recurring, quick adds
  addTransaction(input: NewTransaction): Transaction
  updateTransaction(id: string, patch: Partial<Omit<NewTransaction, 'kind'>>): void
  deleteTransaction(id: string): void
  addRecurring(input: NewRecurring): Recurring
  updateRecurring(id: string, patch: RecurringPatch): void // normalizeRecurring
  setRecurringAmount(id: string, amount: Cents, from: MonthKey | 'all'): void  // withAmountFrom; also clears this item's amount override in `from`
  deleteRecurring(id: string): void                        // also removes its overrides
  setOverride(month: MonthKey, recurringId: string, patch: OverridePatch | null): void
  addQuickAdd(input: Omit<QuickAdd, 'id' | 'order'>): QuickAdd  // RangeError, before reading the input, at MAX_QUICK_ADDS (8); data that came with more keeps them but takes no more
  updateQuickAdd(id: string, patch: Partial<Omit<QuickAdd, 'id' | 'order'>>): void
  deleteQuickAdd(id: string): void
  reorderQuickAdds(orderedIds: string[]): void
  markBackupDone(): void
  setSplitStatus(transactionId: string, splitId: string, status: 'open' | 'paid' | 'forgiven'): void  // settledAt set when paid/forgiven, cleared when open
  addGoal(input: NewGoal): SavingsGoal                     // appended at the end of the fill order
  updateGoal(id: string, patch: GoalPatch): void
  reorderGoals(orderedIds: string[]): void                 // listed ids first, unlisted ones after them in their old order; order rewritten 0..n-1 (the Wallet passes every goal, goalsInFillOrder)
  setGoalDone(id: string, done: boolean): void             // doneAt = now | null; order unchanged, so "Put back" returns a goal to its place
  deleteGoal(id: string): void
  markReviewed(month: MonthKey): void                      // settings.lastReviewedMonth; pass only closed periods (the banner's month, a past period's review)
  setWalletOpening(amount: Cents): void                    // 0..MAX_CENTS
  setWalletStart(month: MonthKey | null): void
  addWalletEntry(input: NewWalletEntry): WalletEntry       // the UI offers dates up to today
  updateWalletEntry(id: string, patch: WalletEntryPatch): void
  deleteWalletEntry(id: string): void
  restore(previous: AppData): void                         // undo
}
```

Action rules:
- Transactions: amount integer 1..MAX_CENTS, valid date, note trimmed and truncated; income →
  categoryId null; an expense without a category throws; updatedAt = Date.now().
- `setOverride`: null removes the override; `amount: null` removes only the amount; `skipped: false`
  and `paid: false` remove those keys; `skipped: true` also removes `paid`. A stored override only
  holds `amount` (1..MAX_CENTS), `skipped: true`, `paid: true`; an empty override is deleted, and
  `months[m]` with neither overrides nor savingsGoal is deleted. Throws when `lineFor` is null for
  that month, and for spread items when the month is not a charge period. Tests: {paid} then {amount
  900} → {paid, amount 900}; then {amount: null} → {paid}; then {paid: false} → the override and
  months['2026-10'] are removed; {skipped: true} on {paid, amount 900} → {amount 900, skipped}.
- `setSavingsGoal(amount, today)`: before changing `settings.savingsGoal`, write the old value into
  `months[p].savingsGoal` for every period p without its own value from `firstPeriod` (max 60 periods
  back) to the period before the current one. Test: data since 2026-08-03, goal 0 → 20000 on
  2026-10-18 → months['2026-08'] and ['2026-09'].savingsGoal = 0; summary('2026-10').savings = 20000.

```ts
// persistence.ts
export type StoragePhase = 'loading' | 'ok' | 'read-failed' | 'newer-version' | 'damaged' | 'write-failed' | 'conflict' | 'memory-only'
export interface StorageStatus { phase: StoragePhase; error: string | null; persisted: boolean | null; saving: boolean; droppedOnLoad: number }
export const useStorageStatus: UseBoundStore<StoreApi<StorageStatus>>
export function isBlockingPhase(p: StoragePhase): boolean   // read-failed, newer-version, damaged, conflict
export function initStore(): Promise<void>                 // idempotent (a second call returns the first promise); never throws
export function flushSaves(): Promise<void>
export function importData(data: AppData): Promise<void>  // flush, snapshot 'snap:pre-import', replace, save
export function listSnapshots(): Promise<{ key: string; label: string; savedAt: number; transactions: number }[]>
export function restoreSnapshot(key: string): Promise<void> // snapshot 'snap:pre-restore' first
export function startFresh(): Promise<void>               // after 'damaged': quarantine kept, data reset, saving on
export function useWithoutSaving(): void                  // after 'read-failed': phase 'memory-only'
export function eraseEverything(): Promise<void>
export function exportRawData(): Promise<string | null>   // the raw stored value as JSON, for 'damaged'
export function __resetPersistenceForTests(): void
```

Persistence rules:
1. **Load** (`initStore`): read `meta` and `data`. A rejected read → phase `read-failed`. No stored
   value → first run (`createInitialData`), phase `ok`. A value whose `meta.schemaVersion` or
   normalisation says newer → `newer-version`. Another `DataError` → copy the raw value to
   `quarantine`, phase `damaged`. Success → set `{ data, status: 'ready' }` first, then attach the save
   subscriber (loading never triggers a save). If the report dropped rows, write the raw value to
   `quarantine` before the first save and set `droppedOnLoad`. If `localStorage[LS_KEYS.rescue]` exists
   and its `basedOnRev` equals the stored `meta.rev`, use its data instead and save it; otherwise move
   it to `quarantine`. Remove the rescue key after the next successful save.
2. **Never write** `data` or `meta` unless this session loaded them successfully (phase `ok` or
   `write-failed`).
3. **Saving**: the subscriber sets `pending = data` and calls `queueMicrotask(pump)` (never rAF or
   timers, which stop in the background). `pump` keeps at most one write in flight and always writes
   the newest pending value. Each write is `commit(loadedRev, [[data], [meta { rev: loadedRev + 1,
   savedAt, schemaVersion }]])`; on success `loadedRev` advances. `flushSaves()` resolves when nothing
   is pending or in flight; it runs on `visibilitychange` → hidden, `pagehide`, before a service-worker
   reload, and before import, restore and erase.
4. **Failure**: retry once on a fresh handle (`resetKv`). If that fails: phase `write-failed`, keep
   `pending`, write `{ basedOnRev: loadedRev, data }` to `localStorage[LS_KEYS.rescue]` (ignore its
   own failure), retry on the next change and on `visibilitychange` → visible; the next success
   returns to `ok`. `QuotaExceededError` sets that message.
5. **Conflicts**: `ConflictError` → phase `conflict`; saving stops. After each save post `{ rev }` on
   `BroadcastChannel('onabudget')`; a window receiving a higher rev goes to `conflict` at once.
6. **Automatic copies**: inside the save, when `meta.savedAt` is on an earlier local date than now,
   first put the stored `data` under `snap:<local date of savedAt>` and delete `snap:<date>` keys
   beyond the newest 7. Also `snap:pre-import`, `snap:pre-restore`, and `snap:pre-v<N>` before the
   first save after migrating from schema N.
7. **Persisted storage**: at start read `navigator.storage?.persisted?.()`; while false, call
   `persist()` once per launch after the first successful save; record the result.
8. **Erase** (`eraseEverything`): stop saving; await the in-flight write; read the stored meta;
   `clear()` the kv store, then write a revision marker `meta { rev: max(loaded, stored) + 1, savedAt,
   schemaVersion }` without data and post `{ rev }` on the channel, so revisions never restart and
   other windows go to `conflict`;
   remove every localStorage key starting with `onabudget:`; reset app data
   (`createInitialData(Date.now(), …)`), security (defaults, unlocked), `amountsRevealed`; resume
   saving. If `clear()` fails, set the error "Couldn't erase the app's data. Close it completely and
   try again." and change nothing else.
9. Mirror `theme` and `accent` to localStorage (`LS_KEYS.theme`, `LS_KEYS.accent`).
10. The root element carries `data-save-state="saving" | "saved" | "error"` (for e2e).

```ts
// securityStore.ts
export interface SecurityState { config: SecurityConfig; status: 'loading' | 'ready' | 'error'; locked: boolean; lockEpisode: number; unlockedOnce: boolean }
export const useSecurityStore: UseBoundStore<StoreApi<SecurityState>>   // before load: defaults, status 'loading', locked true
export function initSecurity(): Promise<void>   // idempotent; missing value → defaults, unlocked; read error → status 'error', locked (fail closed)
export function updateSecurity(patch: Partial<SecurityConfig>): Promise<void> // KvBackend.update merge; never writes after a read error
export function lockApp(): void                  // locked true, lockEpisode + 1, amountsRevealed false
export function unlockApp(): void                // locked false, unlockedOnce true
export function hasPin(): boolean

// uiStore.ts (ephemeral)
export const useUiStore: UseBoundStore<StoreApi<{ amountsRevealed: boolean; setAmountsRevealed(v: boolean): void; systemSheetOpen: boolean; setSystemSheetOpen(v: boolean): void }>>

// today.ts
export function useToday(): ISODate              // updates at local midnight and on visibilitychange → visible
export function getToday(): ISODate

// selectors.ts — plain memoised functions, safe during render
export function memoByData<T>(data: AppData, key: string, compute: () => T): T  // WeakMap<AppData, Map<string, unknown>>
export function getMonthSummary(data: AppData, month: MonthKey, today: ISODate): MonthSummary
export function getWalletSummary(data: AppData, today: ISODate): WalletSummary
export function getOwedSummary(data: AppData): OwedSummary
export function getMonthReview(data: AppData, month: MonthKey, today: ISODate): MonthReview
export function getUnreviewedMonth(data: AppData, today: ISODate): MonthKey | null   // unreviewedClosedMonth

// hooks.ts
export function useData<T>(selector: (d: AppData) => T): T                       // useShallow; selectors return store references or primitives
export function useSettings(): Settings
export function useCategories(o?: { includeArchived?: boolean; kind?: 'fixed' | 'daily' }): Category[]
export function useCategoryMap(): Readonly<Record<string, Category>>            // includes archived; useMemo on the categories array
export function useMonthSummary(month: MonthKey): MonthSummary                 // getMonthSummary(data, month, useToday())
export function useTrend(endMonth: MonthKey, count: number): TrendPoint[]
export function useCategoryTrend(categoryId: string, endMonth: MonthKey, count: number): CategoryTrendPoint[]
export function useWallet(): WalletSummary                                      // getWalletSummary(data, useToday()) memoised in selectors.ts
export function useOwed(): OwedSummary                                          // a new object after any data change: key Owed rows by transaction id plus split id
export function useMonthReview(month: MonthKey): MonthReview
export function useUnreviewedMonth(): MonthKey | null                           // the closed period the review banner offers, or null
export function useMoneyFormat(): MoneyFormat                                  // useMemo over currency, locale, showCents, masked
```

Zustand rules (zustand 5 has no selector equality):
1. A selector returns a store value unchanged, a primitive, or (inside `useShallow`) a flat array or
   object of existing references. Never compute or allocate in a plain selector.
2. Fallbacks are frozen module constants (`const NO_OVERRIDES = Object.freeze({})`), never `?? {}`
   inside a selector.
3. Derived data goes through `selectors.ts` or `useMemo` keyed on store references.
4. Event handlers read current state with `getState()`.

### 5.5 Navigation (src/app/nav.ts)

```ts
export type TabId = 'home' | 'daily' | 'fixed' | 'wallet'
export const TAB_IDS: readonly TabId[]                      // tab-bar order: home, daily, fixed, wallet
export type Route =
  | { name: 'category'; categoryId: string }
  | { name: 'you' }                                         // settings root, pushed from Home's monogram
  | { name: 'owed'; person?: string }                       // person: open the screen at that person (Home's card)
  | { name: 'you.homeLayout' } | { name: 'you.currency' } | { name: 'you.numberFormat' } | { name: 'you.monthStart' }
  | { name: 'you.categories' } | { name: 'you.quickAdds' } | { name: 'you.backup' } | { name: 'you.about' }
  | { name: 'you.diagnostics' } | { name: 'you.privacy' }
export type SheetRoute =
  | { name: 'transaction'; id?: string; kind?: TxKind; categoryId?: string }
  | { name: 'recurring'; id?: string; kind?: TxKind; preset?: { name?: string; categoryId?: string; everyMonths?: EveryMonths } }
  | { name: 'categoryEdit'; id?: string }
  | { name: 'quickAdd'; id?: string }
  | { name: 'savingsGoal'; month?: MonthKey }
  | { name: 'monthPicker' }
  | { name: 'pinSetup'; mode: 'enable' | 'change' }
  | { name: 'verifyOwner'; reason: string }
  | { name: 'erase' }                                       // from About; Forgot PIN erases in a lock-screen view (§3.7, §3.8)
  | { name: 'walletEntry'; id?: string; kind?: 'deposit' | 'withdrawal' }
  | { name: 'walletSettings' }
  | { name: 'goal'; id?: string }
  | { name: 'monthReview'; month: MonthKey }
export type RouteName = Route['name']
export type SheetName = SheetRoute['name']
export type RouteProps<N extends RouteName> = Omit<Extract<Route, { name: N }>, 'name'>
export type SheetProps<N extends SheetName> = { route: Extract<SheetRoute, { name: N }>; onClose: () => void; setDirty: (dirty: boolean) => void }
export interface SheetEntry { key: string; route: SheetRoute }
export type FixedSegment = 'costs' | 'income'
export type StackMotion = 'slide' | 'instant'               // how ScreenStack shows the latest stack change
export interface NavState {
  tab: TabId; stacks: Record<TabId, Route[]>; sheets: SheetEntry[]; month: MonthKey | null; fixedSegment: FixedSegment
  dailyCategory: string | null                // Daily's chip (null: All); (+) starts a new expense in it on Daily's root
  dirty: Readonly<Record<string, true>>       // keys of open sheets with unsaved changes
  stackMotion: StackMotion                    // 'slide' for an in-app push or pop, 'instant' for a system back or a cross-tab link
  setTab(tab: TabId): void                    // tapping the active tab pops it to root
  navigate(tab: TabId, route?: Route): void   // switch tab, stack = route ? [route] : [], close all sheets; a 'you.*' route on 'home' gets the stack [{ name: 'you' }, route] so Back leads to settings
  push(route: Route): void
  pop(): void
  openSheet(route: SheetRoute): string        // returns the entry key
  closeSheet(key?: string): void              // default top-most; unknown key is a no-op
  setMonth(month: MonthKey | null): void      // storing the current period stores null
  setFixedSegment(s: FixedSegment): void
  setDailyCategory(categoryId: string | null): void
  setSheetDirty(key: string, dirty: boolean): void  // SheetHost passes it to each sheet as setDirty
  reset(): void                               // Home at its root, no sheets, current month, costs, no Daily chip; also runs by itself when settings.onboarded turns false (an erase, a restored backup that was never onboarded)
}
export const useNav: UseBoundStore<StoreApi<NavState>>
export function useSelectedMonth(): MonthKey   // month ?? periodOf(today, monthStartDay)
export interface MonthBounds { first: MonthKey; last: MonthKey; current: MonthKey }
export function useMonthBounds(): MonthBounds  // firstPeriod … current + 12
export function newExpenseRoute(state?: Pick<NavState, 'tab' | 'stacks' | 'dailyCategory'>): Extract<SheetRoute, { name: 'transaction' }>  // what (+) opens, below
export function discardTitleFor(route: SheetRoute): string  // 'Discard this expense?' for a new expense, else 'Discard changes?' (§5.10)
export function installNavigation(): () => void  // main.tsx, before the first render: history and the 30-minute month reset
```

- (+) opens `newExpenseRoute()`: a new expense in the category of the visible category detail (not
  Uncategorized), else in Daily's chip category while Daily shows its root, else with no category.
  TransactionSheet ignores an id that is not an active category (§3.4).
- After a push, focus moves to the new screen's title (Screen `focusTitle`), and a pop returns it
  to the control that pushed it, so VoiceOver announces each new screen.

- **History**: `push` and `openSheet` add a history entry (`history.pushState({ onabudget: depth },
  '')`). `popstate` is the only place that pops a screen or closes the top sheet. In-app Back, Cancel,
  save and close call `history.back()`. Pops from the system gesture skip the slide animation.
  `setTab` does not push; tapping the active tab calls `history.go(−depth)`. On load,
  `history.replaceState` to the root. A dirty sheet that the user keeps after a system back pushes its
  entry again.
- `nav.month` resets to null on visible after ≥ 30 minutes hidden. Selecting the current period stores
  null. The previous button is disabled at `first`, next at `last`.
- Inactive tabs stay mounted inside `<Activity mode="hidden">`; each tab root carries
  `data-testid="screen-<tab>"`, pushed screens `screen-<route name>`, the visible one `data-active="true"`.

`src/app/registry.tsx` (imported only by the shell: ScreenStack and SheetHost):
```ts
export const TAB_ROOTS: Record<TabId, ComponentType>
export const SCREENS: { [N in RouteName]: ComponentType<RouteProps<N>> }
export interface SheetDefinition<N extends SheetName> { Component: ComponentType<SheetProps<N>>; label: string; size: 'auto' | 'large'; material?: 'sheet' | 'paper' }
export const SHEETS: { [N in SheetName]: SheetDefinition<N> }   // monthReview: size 'large', material 'paper' (statement paper)
export function sheetLabel(route: SheetRoute): string            // the dialog's name, made specific by the route
```

`sheetLabel` names the dialog after what it shows: "Edit expense", "One-off income", "Edit income",
"New fixed cost", "Edit category", "Take money out", "Edit goal", and for the review "{name}
statement" ("October statement"); otherwise the registry label.

SheetHost renders each entry inside `<Sheet key open label={sheetLabel(route)} size material dirty
discardTitle onClose onExited data-sheet={name}>`; feature sheets render `SheetHeader` plus their
body, never `<Sheet>`. A closing entry stays mounted with `open={false}` until `onExited`. Only the
top sheet reacts to Escape, scrim and drag. Sheets initialise form state with `useState(() =>
fromRoute(route))`.

`src/app/MonthSwitcher.tsx` exports two components that read `useSelectedMonth`, settings and
bounds (DESIGN.md §9.3):
- `MonthStepper()`: the trailing glass capsule in the nav row with "Previous month" (`month-prev`)
  and "Next month" (`month-next`), disabled at the bounds.
- `MonthTitle({ variant?: 'title' | 'compact' })`: the serif month name as a button with a chevron
  (`month-label`; the year when not the current year, the range as a caption when s ≠ 1; opens
  `monthPicker`), and the "Back to this month" pill beside it when the selected period is not the
  current one. `compact` is the smaller form used inside category detail.
- `MonthSwitcher` remains as an alias that renders both in one row, for places without a nav row.

`src/app/undo.ts`: `withUndo(message: string, run: () => void | Promise<void>, o?: { durationMs?:
number }): Promise<void>` records `before = getData()`, runs, records `after`, then shows a toast with
Undo (default 6000 ms) that calls `actions.restore(before)`; the toast dismisses itself as soon as
`getData() !== after`.

### 5.6 App gates (src/App.tsx)

```tsx
export function App() {
  const appReady = useAppStore(s => s.status === 'ready')
  const sec = useSecurityStore(s => s.status)
  const locked = useSecurityStore(s => s.locked)
  const unlockedOnce = useSecurityStore(s => s.unlockedOnce)
  const phase = useStorageStatus(s => s.phase)
  const onboarded = useAppStore(s => s.data.settings.onboarded)
  const money = useMoneyFormat()
  useAutoLock()                                   // features/lock
  if (!appReady || sec === 'loading') return <LoadingScreen />
  return (
    <MoneyFormatContext value={money}>
      <ThemeController />
      {locked && !unlockedOnce ? null : (
        <ErrorBoundary level="app">
          <div id="app-root" inert={locked} aria-hidden={locked || undefined}>
            <BannerOutlet />
            <div className={styles.content}>
              {isBlockingPhase(phase) ? <StorageScreen /> : onboarded ? <Shell /> : <Onboarding />}
            </div>
          </div>
        </ErrorBoundary>
      )}
      {locked && <LockScreen />}
      <AppBanners /><ToastHost /><ConfirmHost />
    </MoneyFormatContext>
  )
}
```

`main.tsx` starts `initStore()`, `initSecurity()`, `installPrivacyCover()` and
`registerServiceWorker()` (production) before the first render; no component starts them.

- **Banners.** `AppBanners` renders the banners into the banner slot (`[data-banner-slot]`) of the
  screen the user sees (every kit `Screen` has one, under its nav and title rows; ScreenStack
  reports the visible layer), and into `BannerOutlet` at the top of `#app-root` when that screen has
  no slot (onboarding). Either way they sit inside `#app-root`: inert under the lock like the rest
  of the app.
- **Layers.** Toasts, dialogs and sheets render under the lock: `--z-lock` (90) is above
  `--z-confirm` (80), `--z-toast` (70) and `--z-sheet` (50), and the dialog and sheet layers go
  inert while `#app-root` is `aria-hidden`. On a cold start with a PIN, SheetHost is not even
  mounted. So the lock screen never relies on a toast, `confirmDialog`, `chooseDialog` or a sheet:
  its Forgot PIN, new PIN and erase steps are views of `LockScreen` (§3.8). A toast it starts ("PIN
  changed") shows once the lock has gone.

### 5.7 Cross-feature contracts

Only these may be imported across feature folders (and by the shell, besides the registry's screens
and sheets):

```ts
// features/lock/pin.ts
export function lockSupport(): { pin: boolean; biometric: () => Promise<boolean> }  // pin: secure context with crypto.subtle; biometric: a platform authenticator (only asked when pin)
export async function setPin(pin: string, length: 4 | 6): Promise<void>       // RangeError unless exactly `length` ASCII digits; resets failed attempts and lockout, keeps Face ID and Lock after
export async function verifyPin(pin: string): Promise<'ok' | 'wrong' | 'lockedOut'>  // persists failedAttempts before comparing
export async function clearPin(): Promise<void>                                // also removes the Face ID credential (forgetBiometric)
// features/lock/biometric.ts
export async function registerBiometric(): Promise<string | null>          // credential id (base64url) or null; call it straight from a tap
export async function verifyBiometric(credentialId: string, signal: AbortSignal): Promise<boolean>  // rawId match and the user-verified flag (§8)
export function forgetBiometric(credentialId: string): void                // signalUnknownCredential, fire and forget
// features/lock/PinSetupFlow.tsx
export function PinSetupFlow(p: { mode: 'enable' | 'change'; onDone(): void; onCancel(): void; cancelLabel?: string; layout?: 'compact' | 'fill' }): JSX.Element
// features/lock/verifyOwner.ts
export function verifyOwner(reason: string): Promise<boolean>   // opens the 'verifyOwner' sheet titled `reason`; see below
// features/lock/useAutoLock.ts
export function useAutoLock(): void
// features/lock/VerifyOwnerSheet.tsx, PinSetupSheet.tsx, LockScreen.tsx, PrivacyScreen.tsx (registered or rendered by the shell)
// features/pwa/platform.ts
export function isStandalone(): boolean   // navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
export function isIOS(): boolean          // /iPhone|iPad|iPod/ or Macintosh with maxTouchPoints > 1
export function needsInstall(): boolean   // isIOS() && !isStandalone(): the onboarding gate and the install banner
// features/pwa/sw.ts
export function registerServiceWorker(): void   // registerSW from 'virtual:pwa-register' with onNeedReload: flushSaves then reload; registration.update() at start and on visible, at most hourly, when online
export const usePwaStore: UseBoundStore<StoreApi<{ updateReady: boolean }>>
export async function applyUpdate(): Promise<void>
// features/pwa/InstallHint.tsx
export function InstallHint(p: { variant: 'banner' | 'gate' | 'inline'; onContinue?(): void; onDismiss?(): void; className?: string }): JSX.Element | null
export function installHintPending(): boolean   // the banner variant would show: needsInstall() and not dismissed (true when storage is blocked)
// features/you/backupIO.ts
export type SaveResult = 'shared' | 'downloaded' | 'cancelled'
export function saveFile(file: File): Promise<SaveResult>    // canShare({ files }) → share({ files }) only; AbortError → 'cancelled'; else <a download> with an object URL revoked after 60 s; sets systemSheetOpen around share
export function exportBackup(): Promise<SaveResult>           // builds the File synchronously; markBackupDone only for shared/downloaded; never toasts (callers say "Backup exported")
export function exportCsv(): Promise<SaveResult>
export function readBackupFile(file: File): Promise<ParsedBackup>  // file.text(); ignores file.type; a file over 64 MB rejects as 'not-backup' unread
export interface BackupFileInputProps { onFile(file: File): void; 'data-testid'?: string; ref?: Ref<HTMLInputElement> }
export function BackupFileInput(p: BackupFileInputProps): JSX.Element  // default test id 'backup-file-input'
export interface ImportOptions { continueOnboarding?: boolean }
export function importWithConfirm(file: File, o?: ImportOptions): Promise<boolean>  // never rejects; see below
// features/daily/TransactionRow.tsx, features/wallet/WalletCard.tsx, features/owed/OwedCard.tsx (Home; signatures in §5.9)
// features/daily/quickAdd.ts
export async function addQuickAdd(quickAdd: QuickAdd, money: MoneyFormat): Promise<void>  // adds the expense dated today with the label as its note, toasts "Added 3,50 € to Coffee & snacks" with Undo (Daily's tiles, the tab bar's long-press menu)
```

- `PinSetupFlow`: `cancelLabel` ("Not now") renders a plain button under the keypad that calls
  `onCancel`; without it the flow never calls `onCancel` and the container gives the way out (a
  sheet's Cancel). `layout` is `compact` (default, for sheets) or `fill` (a full screen, the keypad
  at the bottom: the lock screen's new PIN). The length starts at the stored `pinLength`, chosen with
  the "PIN length" control ("4 digits", "6 digits"). `onDone` runs after `setPin` has stored the PIN.
- `verifyOwner(reason)`: `reason` is the sheet's title, a short sentence-case phrase ("Turn off the
  app lock", "Erase all data"). It resolves true at once when no PIN is set, true once the PIN or
  Face ID is confirmed, and false when the sheet closes any other way (Cancel, scrim, Escape, drag,
  Back), which also ends a Face ID request. It needs the Shell's SheetHost, so call it from a tap
  inside the tabs (never from the lock screen or onboarding). The sheet asks for Face ID once on its
  own when it opens.
- `importWithConfirm(file, o?)` never rejects. A read or parse error toasts the file's problem
  (§4.7) and resolves false; Cancel resolves false. On Replace it runs `withUndo('Backup restored',
  () => importData(data), { durationMs: 10000 })` and resolves true; a failed import toasts that
  nothing was replaced and resolves false. The imported `settings.lastBackupAt` is the later of the
  file's value and its `exportedAt` (capped at now). `continueOnboarding` imports with
  `settings.onboarded` false, so onboarding continues at its lock step (§3.9 step 6).
- `BackupFileInput` is visually hidden, out of the tab order and `aria-hidden`, but not `display:
  none` (iOS may refuse to open the picker of an input that is not rendered). Open it with
  `ref.current?.click()` from a tap; e2e sets its files directly. It accepts
  `.json,application/json`, holds `systemSheetOpen` while the picker is open, and clears its value so
  the same file can be chosen again.

### 5.8 UI kit (src/ui, src/ui/charts, src/ui/icons)

Exported from `src/ui/index.ts` and `src/ui/charts/index.ts`. Every component is typed, accessible,
uses tokens only, accepts `className` where layout needs it, and forwards `TestIdProps = {
'data-testid'?: string; 'data-id'?: string }` to its root interactive element. The UI kit never
imports `@/store`; money settings come from `MoneyFormatContext`.

```ts
MoneyFormatContext; useMoneyFormatContext(): MoneyFormat
MASKED_LABEL = 'Amount hidden'                                                            // what a masked figure reads
Icon({ name: UiIconName; weight?: IconWeight; size?: number; label?: string })             // generated Phosphor paths; decorative unless label; UI_ICON_NAMES lists the names
CategoryIcon({ icon: IconRef; size?: number }); isEmojiIcon(icon: IconRef): boolean       // Phosphor key or emoji
Coin({ size?: CoinSize; tone?: 'ink' | 'muted'; children }); COIN_GLYPH_SIZE: Record<CoinSize, number>   // the hairline ring (sm 26, md 34, lg 56 with the inner rim) around any glyph; glyph sizes 15, 19, 28
CategoryBadge({ icon: IconRef; color: CategoryColor | null; size?: 'sm' | 'md' | 'lg' })   // monochrome coin (DESIGN.md §9.9); the colour is never a tint, only used by charts
Monogram({ name: string; avatar: string; size?: 'sm' | 'md' | 'lg' })                     // SF Pro 600 initial, or the emoji, in the engraved rim; without either the light person glyph (13 / 16 / 28)
Engraving({ kind: 'rosette' | 'seal' | 'medallion'; size?: number; label?: string })      // the static guilloché SVGs of DESIGN.md §3.1; decorative unless label
Button({ variant?: 'primary' | 'secondary' | 'plain' | 'destructive' | 'glass'; size?: 'lg' | 'md' | 'sm'; icon?: UiIconName; block?: boolean;
         filled?: boolean; tinted?: boolean; critical?: boolean; selected?: boolean; …button props })   // filled: destructive with a --critical fill; glass capsule looks: tinted (--accent-ink 600), critical (--critical-ink), selected (--accent fill, --on-accent 600), disabled (--ink-disabled)
IconButton({ icon: UiIconName; label: string; variant?: 'plain' | 'tinted' | 'filled' | 'glass'; size?: 'md' | 'lg'; weight?: IconWeight; iconSize?: number; …button props })
GlassGroup({ label: string; children })                                                    // one glass capsule of plain IconButtons without dividers (the month stepper)
Screen({ title: string; titleContent?: ReactNode; eyebrow?: ReactNode; leading?: ReactNode; largeTitle?: boolean; headerRight?: ReactNode;
         onBack?(): void; backLabel?: string; compactTitle?: ReactNode; compactSubtitle?: ReactNode; compactTitleVariant?: 'text' | 'month';
         bannerSlot?: 'afterTitle' | 'beforeTitle'; focusTitle?: boolean; tabBar?: boolean; scrollRef?: Ref<HTMLDivElement>; children })
Section({ title?: ReactNode; action?: ReactNode | SectionLink; meta?: ReactNode; footer?: ReactNode; variant?: 'card' | 'form' | 'day';
          context?: 'screen' | 'sheet'; bare?: boolean; children })                       // SectionLink = { label: string; onClick(): void } ("See all")
ListRow({ leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; value?: ReactNode; valueTone?: 'default' | 'muted' | 'struck' | 'critical';
          note?: ReactNode; detail?: ReactNode; trailing?: ReactNode; chevron?: boolean | 'right' | 'updown' | 'down'; onClick?(): void;
          destructive?: boolean; tinted?: boolean; disabled?: boolean; label?: string; expanded?: boolean; controls?: string })   // expanded makes a row with onClick a disclosure (aria-expanded; a 'down' chevron turns over); controls: aria-controls
Toggle({ checked: boolean; onChange(v: boolean): void; label: string; description?: ReactNode; disabled?: boolean })
SegmentedControl<T>({ options: { value: T; label: string }[]; value: T; onChange(v: T): void; label: string })
ChipTabs<T>({ items: { value: T; label: string; icon?: IconRef }[]; value: T; onChange(v: T): void; label: string; itemTestId?: string })   // scrolls the selected chip into view
Chip({ selected?: boolean; icon?: IconRef; leading?: ReactNode; size?: 'md' | 'mini'; onClick?(): void; disabled?: boolean; label?: string; children })   // max-width 180px with ellipsis; mini: the 32-tall date and suggestion chips
Keypad({ onKey(k: KeypadKey): void; decimalSeparator: '.' | ',' | null; variant?: 'amount' | 'pin'; leftKey?: ReactNode; label?: string; disabled?: boolean })
TextField({ label: string; value: string; onChange(v: string): void; type?: 'text' | 'search' | 'date' | 'month'; variant?: 'row' | 'form' | 'search';
            min?; max?; placeholder?; inputMode?; enterKeyHint?; maxLength?; error?: string; hideLabel?: boolean; id?: string; clearLabel?: string;
            autoComplete?: string; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'; autoCorrect?: 'on' | 'off'; disabled?: boolean;
            inputRef?: Ref<HTMLInputElement>; onFocus?(): void; onBlur?(): void })    // a clear button ("Clear {label}") while a row or form field is focused and holds text; search: while it holds text
AmountField({ label: string; value: Cents | null; onChange(v: Cents | null): void; placeholder?: string; error?: string; disabled?: boolean;
              hideLabel?: boolean; id?: string; inputRef?: Ref<HTMLInputElement>; variant?: 'row' | 'cell' })   // plain value while focused, formatted on blur; cell: the bare field inside another row (the split editor), error under it; plainAmount(cents, money) gives the plain form
SelectField<T>({ label: string; value: T; options: { value: T; label: string; icon?: IconRef; disabled?: boolean }[]; onChange(v: T): void; disabled?: boolean })   // native <select> in a form row ending in caret-up-down
IconPicker({ value: IconRef; onChange(v: IconRef): void; icons: CategoryIconOption[]; emojis: string[] })   // tabs Icons | Emoji; emoji input keeps the first grapheme (Intl.Segmenter), rejects letters and digits
EmojiPicker({ value: string; onChange(v: string): void; choices: string[]; allowEmpty?: { label: string }; label?: string })   // label default "Emoji"
ColorSwatches<T>({ options: { value: T; name: string; cssVar: string }[]; value: T; onChange(v: T): void; label: string; showLabel?: boolean })
Meter({ value: number; max: number; status: BudgetStatus; label: string; timeRatio?: number | null; showStatus?: boolean; verbose?: boolean; trailing?: ReactNode })
                                                                                           // timeRatio: today's notch; showStatus (default true): the status line; verbose: writes the warning out ("Near the limit, 1,50 € left"); trailing replaces "of {max}"
Banner({ tone: 'info' | 'warning' | 'critical' | 'statement'; children?: ReactNode; action?: { label: string; onClick(): void }; onDismiss?(): void;
         dismissLabel?: string; icon?: UiIconName; label?: string })                       // see below
EmptyState({ title: string; message?: string; action?: ReactNode; icon?: UiIconName })    // the 56px coin's glyph; default 'daily'
Sheet({ open: boolean; onClose(): void; onExited?(): void; label: string; size?: 'auto' | 'large'; material?: 'sheet' | 'paper'; dirty?: boolean;
        discardTitle?: string; 'data-sheet'?: string; children })                          // role=dialog aria-modal, focus trap, inert app root, drag to dismiss, keyboard via useVisualViewport; paper = statement paper (--surface) for the month review; discardTitle default "Discard changes?"
SheetHeader({ title: string; subtitle?: ReactNode; onCancel?(): void; cancelLabel?: string; focusCancel?: boolean; action?: SheetHeaderAction })
                                                                                           // subtitle: a second centred line that also describes the dialog; focusCancel: focus starts on Cancel/Close
SheetHeaderAction = { label: string; onClick(): void; disabled?: boolean; tone?: 'confirm' | 'neutral' | 'destructive'; expanded?: boolean; controls?: string } & TestIdProps
                                                                                           // tone default 'confirm' (tinted "Save"); expanded makes it a disclosure (aria-expanded, the selected look); controls: aria-controls
useVisualViewport(): { top: number; height: number; keyboard: number }
useReducedMotion(): boolean                                                                // prefers-reduced-motion, live
useLedgerColumn<T extends HTMLElement>(): RefCallback<T>                                   // spans a ledger's sum rule and double rule over its widest figure (DESIGN.md §9.6)
toast(o: { message: string; action?: { label: string; onClick(): void }; tone?: 'default' | 'success' | 'critical'; durationMs?: number }): { dismiss(): void }  // one at a time, above sheets, role=status, 4000 ms or 6000 ms with an action
ToastHost()
confirmDialog(o: { title: string; message?: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean }): Promise<boolean>
chooseDialog<T extends string>(o: { title: string; message?: string; options: { value: T; label: string; destructive?: boolean; icon?: IconRef }[]; cancelLabel?: string }): Promise<T | null>  // iOS action sheet; icon: a leading category glyph or emoji (the quick-add menu)
ConfirmHost()
Money({ cents: Cents; sign?: MoneySign; showCents?: boolean; tone?: 'default' | 'income' | 'muted' | 'critical' })   // masked → "•••"
BigAmount({ cents: Cents; tone?: 'default' | 'critical'; animate?: boolean; showCents?: boolean })   // serif figures at 76px with proportional-nums and the half-size unit; shrinks to fit (min 34px, then drops cents); showCents overrides the setting; honours masking; animate → odometer roll on change (DESIGN.md §3.3)
LedgerFigure({ cents: Cents; result?: boolean; tone?: 'default' | 'critical'; ref?: Ref<HTMLSpanElement> })   // bare tabular serif figure aligned on the decimal separator; result adds the hanging unit (MoneyFormat.parts)
withTrueMinus(text): string; firstGrapheme(text): string; emojiFromInput(text): string | null   // text helpers
TotalFigure({ cents: Cents; tone?: 'default' | 'critical'; labelled?: boolean })            // a total standing alone (--text-figure-lg serif, unit at --text-figure-sm --ink-2): category detail, Owed, the Wallet card;
                                                                                            // labelled (default true) adds a visually hidden full amount; false leaves it out for a parent that names the amount (the Wallet card button); data-part="number" | "unit" mark the drawn parts
PaidCheck({ paid: boolean; name: string; kind: TxKind; onToggle(): void })                // the round paid check of DESIGN.md §9.8 (test id recurring-paid): "Mark Netflix as paid" / "Netflix paid" ("received" for income), aria-pressed
AmountDisplay({ keys: string; onEdit?(): void }); keypadFigure(keys: string, money: MoneyFormat): KeypadFigure   // the sheets' typed amount (test id amount-display) with the caret; onEdit makes it a button without a caret (the split panel)
ConsequenceLine({ tone?: 'default' | 'warning' | 'critical'; icon?: UiIconName; live?: boolean; children })   // the 20pt line under the amount; figures in <strong>; live: aria-live polite
MaskedText({ text: string })                                                              // text with every masked "•••" in --ink-3 (MaskedTspans in charts)

// charts: SVG, token colours, role="img" + aria-label + visually hidden table; values masked
PaceBar({ spent: Cents; available: Cents; timeRatio: number | null; status: 'ok' | 'ahead' | 'over'; days?: number; caption?: boolean })
StackedBar({ segments: StackedBarSegment[]; label: string; formatValue?(v: number): string })   // StackedBarSegment = { key: string; value: number; color: CategoryColor | 'other'; label: string }
foldSegments(segments, o?: { limit?: number; foldLabel?(count: number): string }): StackedBarSegment[]   // top `limit` (5) plus one FOLD_KEY segment "{n} more" when two or more remain
FOLD_KEY = '__more__'; segmentColorVar(color: CategoryColor | 'other'): string; formatShare(ratio: number, locale: string): string   // "35 %"
ColumnChart({ data: { key: string; label: string; value: number; title?: string }[]; reference?: { value: number; label: string | ((formatted: string) => string); from?: string };
              formatValue?(v: number): string; label: string; height?: number; highlightKey?: string; highlightLabel?: string; cssVar?: string; highlightCssVar?: string;
              barWidth?: number; grid?: boolean; selectedKey?: string | null; onSelect?(key: string | null): void; tableHeaders?: readonly [string, string] })   // reference.from: the key the line starts at (today)
StackedColumnChart({ data: { key: string; label: string; values: Record<string, number>; title?: string }[]; series: { key: string; label: string; cssVar: string; kind?: 'column' | 'line' }[];
                     formatValue?(v: number): string; label: string; height?: number; selectedKey?: string | null; onSelect?(key: string | null): void;
                     tooltip?(key: string): ReactNode; highlightKey?: string; barWidth?: number; grid?: boolean; legend?: boolean; labelHeader?: string })
TooltipContent({ title: string; rows: readonly { key: string; label?: string; cssVar?: string; value: string }[] })   // the body of a StackedColumnChart tooltip
Legend({ items: { key: string; label: string; cssVar: string; value?: ReactNode; meta?: ReactNode; shape?: 'dot' | 'square' | 'line'; expanded?: boolean }[];
         layout?: 'rows' | 'inline'; onSelect?(key: string): void; label?: string; itemTestId?: string })   // rows: Where it went (dot, name, amount, share in meta); inline: chart keys; onSelect makes rows buttons; expanded marks a row as a disclosure (the '{n} more' fold)
```

- **Screen** draws the nav row (`leading` and `eyebrow` at the start, `headerRight` at the end; the
  leading side truncates first), the title row when `largeTitle` or `titleContent` is set, the
  compact header (`compactTitle`, `compactSubtitle`, serif when `compactTitleVariant` is `month`),
  and an empty `[data-banner-slot]` that the shell's `AppBanners` portals the app banners into:
  `afterTitle` (default) under the title row, `beforeTitle` between the nav row and the title row
  (the Wallet, whose title row is its balance). `focusTitle` moves focus to the heading once on
  mount (onboarding steps); ScreenStack does this for every pushed screen. `tabBar={false}` drops
  the bottom padding that clears the tab bar.
- **Banner**: `statement` is the month-end review's tone (statement paper and the brass seal;
  `icon` is ignored). `dismissLabel` defaults to "Not now". With `label` the banner is a named
  region; unnamed, a critical banner is an alert and every other tone a status message.
  `onDismiss` runs synchronously; a banner that animates away (the review banner) does that
  itself.
- **Section** `variant`: `card` (Title 3 heading, Home), `form` (Footnote heading, form groups),
  `day` (Headline heading with the day total as `meta`). `context="sheet"` uses
  `--surface-raised` groups and 48pt rows; `bare` renders the children without the inset group.
- **ListRow**: `value` is the serif amount on line 1 (`valueTone` muted for paid, struck for
  skipped), `note` sits under it, `detail` is a setting's value before the chevron, `trailing` a
  control outside the row's button (a paid check, a toggle), `tinted` and `destructive` make it an
  action row, `label` names the row button when its text is not enough.

`scripts/build-icons.mjs` reads `src/ui/icons/manifest.ts` (UI icon names with their Phosphor
sources and weights, plus every `CATEGORY_ICONS` key) and writes `src/ui/icons/generated.ts` (path
data only).

### 5.9 Feature components (placeholders exist; owners replace the whole file)

| File | Export | Props |
|---|---|---|
| features/home/HomeScreen.tsx | `HomeScreen` | none |
| features/home/CategoryDetailScreen.tsx | `CategoryDetailScreen` | `RouteProps<'category'>` |
| features/daily/DailyScreen.tsx | `DailyScreen` | none |
| features/daily/TransactionSheet.tsx | `TransactionSheet` | `SheetProps<'transaction'>` |
| features/daily/TransactionRow.tsx | `TransactionRow` | `{ tx: Transaction; onOpen?(): void; showDate?: boolean; showCategory?: boolean }` (cross-feature export: Home's Recent and category detail list expenses exactly like Daily; test id `tx-row` with `data-id`; tap opens the edit sheet unless `onOpen` is given. `showDate` puts the day after line 2 (a split keeps "of {bill}" there and says the day only in its name); `showCategory={false}`, in a list of one category, leaves the category out of line 2 and the name, so a plain row shows its day as line 2) |
| features/fixed/FixedScreen.tsx | `FixedScreen` | none |
| features/fixed/RecurringSheet.tsx | `RecurringSheet` | `SheetProps<'recurring'>` |
| features/you/YouScreen.tsx | `YouScreen` | none |
| features/you/HomeLayoutScreen.tsx | `HomeLayoutScreen` | none |
| features/you/CurrencyScreen.tsx | `CurrencyScreen` | none |
| features/you/NumberFormatScreen.tsx | `NumberFormatScreen` | none |
| features/you/MonthStartScreen.tsx | `MonthStartScreen` | none |
| features/you/CategoriesScreen.tsx | `CategoriesScreen` | none |
| features/you/QuickAddsScreen.tsx | `QuickAddsScreen` | none |
| features/you/BackupScreen.tsx | `BackupScreen` | none |
| features/you/AboutScreen.tsx | `AboutScreen` | none |
| features/you/DiagnosticsScreen.tsx | `DiagnosticsScreen` | none |
| features/you/CategorySheet.tsx | `CategorySheet` | `SheetProps<'categoryEdit'>` |
| features/you/QuickAddSheet.tsx | `QuickAddSheet` | `SheetProps<'quickAdd'>` |
| features/you/SavingsGoalSheet.tsx | `SavingsGoalSheet` | `SheetProps<'savingsGoal'>` |
| features/you/EraseSheet.tsx | `EraseSheet` | `SheetProps<'erase'>` (About only; it never calls setDirty) |
| features/lock/PrivacyScreen.tsx | `PrivacyScreen` | none |
| features/lock/PinSetupSheet.tsx | `PinSetupSheet` | `SheetProps<'pinSetup'>` |
| features/lock/VerifyOwnerSheet.tsx | `VerifyOwnerSheet` | `SheetProps<'verifyOwner'>` |
| features/lock/LockScreen.tsx | `LockScreen` | none |
| features/onboarding/Onboarding.tsx | `Onboarding` | none |
| features/wallet/WalletScreen.tsx | `WalletScreen` | none (TAB_ROOTS.wallet; YouScreen becomes SCREENS.you) |
| features/wallet/WalletEntrySheet.tsx | `WalletEntrySheet` | `SheetProps<'walletEntry'>` |
| features/wallet/WalletSettingsSheet.tsx | `WalletSettingsSheet` | `SheetProps<'walletSettings'>` |
| features/wallet/WalletCard.tsx | `WalletCard` | `{ month: MonthKey }` (the Home card; a cross-feature export Home may import. It returns null when the wallet has nothing to show, so Home renders it unconditionally) |
| features/wallet/GoalSheet.tsx | `GoalSheet` | `SheetProps<'goal'>` |
| features/review/MonthReviewSheet.tsx | `MonthReviewSheet` | `SheetProps<'monthReview'>` (only reads: whoever opens it marks the review, §5.10) |
| features/review/ReviewBanner.tsx | `ReviewBanner` | none (the shell's AppBanners renders it in Home's banner slot under the one-banner priority rule of §3.15; Home never renders it itself) |
| features/owed/OwedScreen.tsx | `OwedScreen` | `RouteProps<'owed'>` (`person`: start scrolled to that person) |
| features/owed/OwedCard.tsx | `OwedCard` | none (the Home card; cross-feature export. It returns null while nobody owes anything) |
| app/MonthPickerSheet.tsx | `MonthPickerSheet` | `SheetProps<'monthPicker'>` |

Data model additions for §3.13–§3.16 (land in `src/domain/types.ts` together with their domain and
store code): `Split { id; person: string; amount: Cents; status: 'open' | 'paid' | 'forgiven';
settledAt: number | null }`; `Transaction` gains `fromWallet: boolean` and `splits: Split[]`;
`SavingsGoal { id; name; icon: IconRef; target: Cents; order: number; createdAt: number; doneAt:
number | null }`; `Wallet` gains `goals: SavingsGoal[]`; `Settings` gains `lastReviewedMonth:
MonthKey | null`; `HomeCardKey` gains `'owed'` (default order: equation, wallet, owed, whereItWent,
budgets, comingUp, trend, recent). Normalisation fills them for data saved before they existed
(false, [], [], null).

### 5.10 Effects, drafts and StrictMode

1. `initStore`, `initSecurity`, `installPrivacyCover`, `registerServiceWorker` run once from `main.tsx`.
2. Document and window listeners read current state at event time (`getState()` or
   `useEffectEvent`); dependency arrays stay complete.
3. One-shot work uses a module guard keyed by an episode plus an `AbortController` (Face ID uses
   `lockEpisode`), so StrictMode's double effects never run it twice.
4. **Drafts**: the new-item TransactionSheet and RecurringSheet write `{ route, fields, savedAt }` to
   `LS_KEYS.draft` on every change (RecurringSheet while the form differs from where it started)
   and remove their own draft on save, on cancel and whenever they unmount, so only a killed app
   keeps one. At start, a draft younger than 15 minutes reopens its sheet with the fields filled.
5. Sheets with unsaved changes call `setDirty(true)`; any dismissal other than their own buttons asks
   `confirmDialog({ title: 'Discard this expense?' | 'Discard changes?', confirmLabel: 'Discard',
   cancelLabel: 'Keep editing', destructive: true })`.
6. Opening something never writes data from an effect. The month review is the case in point: the
   controls that open it (Home's past-period "See the review" and the review banner's "See the
   review") call `actions.markReviewed(month)` in their tap handlers, next to `openSheet`, and
   MonthReviewSheet only reads. Likewise EraseSheet checks the owner when Erase is tapped, not when
   it opens.

### 5.11 Defaults

Categories (stable ids, in this order; icons are Phosphor keys):

| id | icon | name | color | kind |
|---|---|---|---|---|
| cat-rent | house | Rent | blue | fixed |
| cat-subscriptions | repeat | Subscriptions | violet | fixed |
| cat-transport | train | Transport | aqua | both |
| cat-phone | device-mobile | Phone & internet | slate | fixed |
| cat-insurance | shield-check | Insurance | brown | fixed |
| cat-eating | fork-knife | Eating | orange | daily |
| cat-groceries | shopping-cart | Groceries | green | daily |
| cat-coffee | coffee | Coffee & snacks | yellow | daily |
| cat-shopping | shopping-bag | Shopping | magenta | daily |
| cat-going-out | martini | Going out | red | daily |
| cat-health | pill | Health | blue | daily |
| cat-other | package | Other | slate | both |

Quick adds: coffee "Coffee" 350 → cat-coffee; bread "Bakery" 250 → cat-coffee; bowl-food "Mensa" 450
→ cat-eating.

Settings: name "", avatar "" (monogram), currency `defaultCurrencyFor(…)`, locale
`defaultNumberLocale(navigator.language)`, monthStartDay 1, savingsGoal 0, theme "system", accent
"navy" (accent keys: navy, royal, teal, bottle, burgundy, plum, cognac, graphite; DESIGN.md §4.3), showCents true, hideAmounts false, homeCards [equation, wallet, owed, whereItWent,
budgets, comingUp, trend, recent], onboarded false, lastBackupAt null, lastReviewedMonth null,
createdAt now.

Security: no PIN, pinIterations 210000, pinLength 4, no biometric, autoLockMinutes 1, 0 failures.

---

## 6. Design

The visual design is specified in `docs/DESIGN.md` (tokens in `src/styles/tokens.css`, reference
screens in `docs/design/reference.html`). Rules that hold regardless of the visual direction:

- Every colour, type style, space, radius, motion value and z-index comes from a token. Text tokens
  reach 4.5:1 and marks 3:1 against every surface they sit on, in both themes. A control fill differs
  from its container by at least 1.1:1 or has a hairline border.
- Type sizes are rem-based on `html { font: -apple-system-body }` so iOS Text Size applies (17px at the
  default size). Chrome that cannot grow is capped: tab labels min(0.647rem, 13px), keypad digits
  min(1.647rem, 34px), sheet titles min(1rem, 22px). Inputs use max(16px, 1rem). At large sizes list
  titles wrap to two lines; amounts never wrap or truncate.
- `@media (prefers-contrast: more)`: glass becomes solid, secondary ink becomes primary ink, hairlines
  get stronger. `prefers-reduced-motion`: no transforms, opacity fades only.
- Write `-webkit-user-select` next to `user-select`, `-webkit-backdrop-filter` next to
  `backdrop-filter`; `-webkit-touch-callout: none` on controls. Put `backdrop-filter` on the fixed or
  sticky element itself, never on a child of a sticky element. At most two blurred layers on screen
  (tab bar and compact header); sheets, scrims, lock screen and privacy cover are opaque. Without
  backdrop-filter support, glass falls back to the solid surface.
- Charts follow the data-viz rules: thin marks, bars ≤ 24px with 4px rounded data ends square at the
  baseline, 2px surface gaps, hairline grid, text in ink tokens, legend for two or more series, tap
  tooltips, category colour follows the category, status always with icon and text.
- Copy: plain, sentence case, active verbs, no exclamation marks, no all-caps labels, no " · "
  metadata, errors say what happened and how to fix it.

## 7. iOS PWA requirements

- `index.html` (in place from the first deployed build; iOS reads the status-bar style at install):
  - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  - `apple-mobile-web-app-capable` and `mobile-web-app-capable` = yes
  - `apple-mobile-web-app-status-bar-style` = `default`
  - `apple-mobile-web-app-title` = On a Budget; `format-detection` telephone=no
  - one `<meta name="theme-color">` whose content always equals the active `--bg`
  - `<style>html{background:LIGHT_BG}@media (prefers-color-scheme:dark){html{background:DARK_BG}}</style>`
    first in `<head>`, then `<script src="theme-init.js">` (blocking) which applies `data-theme`,
    `data-accent`, the html background and theme-color from `LS_KEYS.theme`/`LS_KEYS.accent`
  - `apple-touch-icon` 180×180 opaque PNG; favicon SVG + 32px PNG
  - production only: CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src
    'none'; base-uri 'none'; form-action 'none'`
- Manifest: name and short_name "On a Budget", description, `display: standalone`, `start_url` and
  `scope` relative to the base, icons 192 and 512 (any) and 512 (maskable, mark inside the 80% safe
  zone). iOS ignores `orientation` and `background_color`.
- Service worker: precache all build assets, `navigateFallback: index.html`, prompt mode; see §5.7
  `registerServiceWorker` and §3.10 for the update banner. Update checks run at start and on visible
  (at most hourly, online only), because a resumed Home Screen app does not reload.
- `BASE_PATH` env var (default `/`), e.g. `/Budget-app/` for a GitHub Pages project site.
- Layout uses `100dvh`. The document never scrolls; each screen scrolls in its own container
  (`overscroll-behavior: contain`); `html, body { overscroll-behavior: none }`. Every top edge uses
  `env(safe-area-inset-top)` (never a hardcoded status-bar height; some iOS 26 builds report 0).
  Tab bar, sheets and lock screen also respect left/right insets; sheets are at most 560px wide and
  centred, and every sheet scrolls in landscape.
- `-webkit-tap-highlight-color: transparent`; `touch-action: manipulation` on controls.
- Secure context: PIN hashing, Face ID, sharing, persistent storage and the service worker need
  HTTPS. Test them on the deployed URL, never on the LAN dev address.

## 8. Security

- PIN: PBKDF2-SHA256 via WebCrypto, 16-byte random salt, 210,000 iterations, 32-byte output, compared
  in constant time over the bytes. The PIN is never stored. `verifyPin` persists `failedAttempts + 1`
  (and `lockoutUntil` at the threshold) before comparing; success resets both.
- Face ID registration (`navigator.credentials.create`): rp { id: location.hostname, name: 'On a
  Budget' }, user { id: TextEncoder('on-a-budget-app-lock'), name and displayName 'On a Budget app
  lock' } (constant, so re-enabling replaces the earlier passkey), random 32-byte challenge,
  pubKeyCredParams ES256 (-7) and RS256 (-257), authenticatorSelection { authenticatorAttachment:
  'platform', residentKey: 'preferred', userVerification: 'required' }, attestation 'none', timeout
  60 s.
- Face ID unlock (`get`): rpId location.hostname, random challenge, allowCredentials [{ type:
  'public-key', id, transports: ['internal'] }], userVerification 'required', timeout 60 s, signal.
  Success only when the returned rawId equals the stored id and the authenticator data carries the
  user-verified flag. This is a local gate; there is no server. A successful unlock clears the
  failed PIN attempts and any lockout (§3.8).
- `verifyPin` treats a stored `lockoutUntil` more than 15 minutes in the future as expired: a clock
  set back can never shut the owner out for longer than the schedule allows. `setPin`, `verifyPin`
  and `clearPin` run one at a time, in call order.
- Turning Face ID off, Forgot PIN → erase and Erase all data call `forgetBiometric`
  (`PublicKeyCredential.signalUnknownCredential` when available, not awaited).
- The lock is a privacy gate, not encryption.

## 9. Testing

- **Unit** (Vitest): every exported domain function, including DST weeks, leap years, month ends,
  custom start days across New Year, spread remainders and cycles, overrides, amount-history edits,
  start-day remapping, parsing tables, CSV escaping, and normalisation of hostile input (guard test:
  `new Date(2026, 2, 29, 12).getTimezoneOffset() === -120`).
- **Store**: `normalizeAppData` is idempotent on action results; persistence with injected backends:
  a rejected first read performs zero writes; a stored schemaVersion 99 stays byte-identical after a
  session with actions; 50 synchronous changes produce at most 2 writes, the last holding the final
  data; a write that fails once then succeeds clears the error; two clients on one backend → the
  stale one gets `conflict` and the stored data is unchanged; a save scheduled just before
  `eraseEverything` leaves nothing behind.
- **UI** (jsdom): Keypad, SegmentedControl, Sheet (focus, Escape, dirty confirm), Money masking,
  chooseDialog.
- **E2E** (Playwright; WebKit "iPhone 15" and Chromium "Pixel 7"): `locale: 'de-DE'`, `timezoneId:
  'Europe/Berlin'`, `serviceWorkers: 'block'` (an offline spec opts in, Chromium only); every spec
  freezes the clock (`page.clock.setFixedTime(new Date('2026-10-14T10:00:00+02:00'))`).
  `e2e/fixtures.ts` dismisses the install hint and deletes `navigator.share`/`canShare` (forces the
  download path). Seed through the import flow from `e2e/fixtures/*.json`; only the onboarding spec
  walks onboarding. Wait for `html[data-save-state="saved"]` before `page.reload()`. Scope locators to
  the visible screen (`[data-active="true"]`). Flows: onboarding, add expense with the keypad, quick
  add plus undo, edit and delete, fixed cost add/paid/skip, amount change from a month on, month
  navigation, category limit, theme and accent, PIN lock and unlock, backup export and import,
  persistence across reload, offline reload (Chromium), the settings entry on Home, the wallet
  (add and take out money, goals, the passbook; `wallet.spec.ts`), split bills and Owed to you
  (split an expense, paid back, forgive, undo; `split-owed.spec.ts`) and the month-end review (the
  banner, the statement, past months; `review.spec.ts`).
- **Test ids** (owner in brackets): `tab-home|daily|add|fixed|wallet` (shell), `open-settings` (the Home monogram button, home), `screen-<tab|route>` with
  `data-active` (shell), `month-prev|label|next` (MonthSwitcher), `banner-install|update|storage|backup`
  (shell), `sheet` with `data-sheet` (Sheet via SheetHost), `sheet-save`, `sheet-delete` (feature
  sheets), `keypad-0…9|dec|back` (Keypad), `toast` (ToastHost), `lock-screen`, `pin-dots`,
  `lock-forgot`, `install-gate`, `onboarding` with `data-step` (lock, onboarding). Row ids carry
  `data-id`. By feature:
  - home: `hero-left`, `hero-per-day`, `hero-today`, `hero-ahead`, `hero-wallet` (the
    over-budget wallet line), `equation-income|fixed|savings|daily|left`, `statement-wallet` (a
    closed month's "Moved to your wallet" line), `budget-row`, `category-row`, `category-total`
    (category detail), and `recurring-paid` on Coming up too.
  - daily: `amount-display`, `category-chip`, `tx-row`, `quick-add`, `daily-search`,
    `pay-from-wallet`, `wallet-consequence`, `split-toggle`, `split-panel`, `split-person`,
    `split-add`, `split-evenly`, `split-share`.
  - fixed: `fixed-segment`, `recurring-row`, `recurring-paid`, `fixed-total`, `income-row`,
    `different-amount`.
  - wallet: `wallet-card`, `wallet-card-balance`, `wallet-card-line` (the Home card),
    `wallet-hero`, `wallet-balance`, `wallet-pending`, `wallet-free`, `wallet-add`,
    `wallet-take`, `wallet-goals`, `goal-row`, `goal-open`, `goal-up`, `goal-down`,
    `goal-add`, `wallet-done`, `goals-done`, `goal-done-row`, `goal-put-back`,
    `wallet-passbook`, `wallet-row`, `wallet-year`, `wallet-empty`, `wallet-opening-cta`,
    `wallet-settings`, and in the sheets `wallet-note`, `wallet-opening`, `wallet-start`,
    `goal-name`, `goal-icon`, `goal-target`.
  - review: `banner-review`, `review-result`, `review-income|fixed|savings|daily`,
    `review-result-line`, `review-wallet`, `review-category`, `review-biggest`,
    `review-no-spend-days`, `review-entries`, `review-fixed-paid`, `review-owed`.
  - owed: `owed-card`, `owed-person`, `owed-more` (the Home card), `owed-total`,
    `owed-person-section`, `owed-item`, `owed-paid`, `owed-forgive`, `owed-all`,
    `owed-settled`, `owed-settled-item`.
  - you: `backup-file-input`, `backup-due`, `category-icon`, `move-to`, `quick-add-icon`.
- **On-device checks** (installed app; before every deploy that touches the shell, lock, sheets or
  persistence): install with the §1 steps, launch online, then offline; top edge legible in light,
  dark and landscape; recurring sheet keyboard (focus Name, then Note, dismiss: the sheet returns to
  the bottom with no gap); Face ID on cold start and resume, cancel then PIN; app switcher with Hide
  amounts off and on; export to Files and import back; CSV opens in Numbers; date picker Reset;
  force-quit right after adding an expense, reopen, entry present; deploy a new build, resume:
  update banner appears and Reload keeps data. Also: turning on Face ID right after the verify
  sheet (the passkey prompt still has Safari's user activation); cancelling the backup file picker
  (no import, no lock); the safe-area insets Diagnostics shows in portrait and landscape; "Protected
  from automatic cleanup" on the Backup page once the app is installed; the onboarding steps with
  the keyboard up (Continue stays reachable); VoiceOver focus on the title of each pushed screen
  and its return on Back.

## 10. Deployment

Any static HTTPS host works. The repository includes a GitHub Actions workflow for GitHub Pages
(`BASE_PATH=/<repo>/`). Deploy to one address and keep it: storage, passkey and install are tied to
it. Before changing host or path, export a backup in the old app. Never keep real entries on the
LAN dev URL.
