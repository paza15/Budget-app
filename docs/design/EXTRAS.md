# On a Budget: extras

The month-end review (SPEC §3.15), split bills (SPEC §3.16, §4.9) and the settings entry on Home
(SPEC §3 intro), designed in the **Private bank** system. This document extends `docs/DESIGN.md`:
every token, type style, component and rule there applies here, and nothing here overrides it
except where section 7 says so. `docs/SPEC.md` owns behaviour; section 7 lists where this design
asks it to change.

**Reference:** `docs/design/reference-extras.html` (built like `reference.html`: the real
`src/styles/tokens.css`, the same font stand-ins). Open it with `?screen=`:

| Screen | Shows |
|---|---|
| `review` | The review sheet "October statement" over November's Home |
| `review-end` | The same sheet scrolled to its end |
| `review-banner` | Home on Sun 1 Nov with the "October is closed" banner |
| `past-review` | Home with October selected: the statement and "See the review" |
| `add-split` | The transaction sheet with the split panel open (add `&device=se` for 375×667) |
| `daily-split` | Daily, scrolled to Saturday's split bills |
| `owed` | The "Owed to you" screen |
| `home-owed` | Home scrolled to the "Owed to you" card |
| `home-settings` | Home with the monogram button and the backup dot |
| `states` | A board with every other state: banner, result, change words, rows, errors, dialogs, the settings button |

Add `&theme=dark` or `&accent=royal` (any accent key) to preview.

**Sample data.** As in DESIGN.md: October 2026, today Sunday 18 October (day 18 of 31), 336,40 €
spent, 234,72 € left, wallet 631,22 €. Splits, all on Saturday 17 October:

- "Bar with friends", Going out, 18,00 €. Max owes 9,00 €. Your share 9,00 €.
- "Pizza night", Eating, 32,00 €. Lea owes 8,00 €, Max owes 8,00 €. Your share 16,00 €.
- Settled in September: "Bowling", Going out, Sat 19 Sep, 24,00 €. Jonas paid back 12,00 € on
  Thu 1 Oct.

Saturday therefore totals 50,00 € (shares), and Thursday 15 Oct carries 7,00 € less than in
`reference.html`, so October still adds up to 336,40 €. The review screens are seen on **Sunday
1 November**, the first open after October closed. October closed with 538,30 € of daily
spending, 32,82 € left over and 132,82 € moved to the wallet, which then holds 764,04 €.

---

## 1. The month-end review

A closed month deserves the bank's best paper. The review is the month's statement: printed on
statement paper, closed with the brass seal, and written as a sum. It is static, like every closed
statement (DESIGN §3.2).

### 1.1 The sheet

- **Material.** A large sheet (top 10, sides and bottom 8, `--radius-sheet`, `--shadow-sheet`
  over `--scrim`) whose background is **`--surface`, statement paper**, not `--surface-sheet`.
  Content is printed straight onto it: no inset groups, no cards. Sections are separated by space
  and printed rules. This is deliberate:
  - the category inks are validated on `--surface` only (DESIGN §4.5). On `--surface-raised` in
    dark mode green, wine red and brown fall to 2.72–2.75:1;
  - brass reads 3.48:1 (light) and 8.52:1 (dark) on `--surface`, so the seal keeps its contrast;
  - a statement is one sheet of paper, not a form.
- **Grab handle** as every sheet (36×5, `--hairline-strong`, 6 from the top).
- **Header** (`SheetHeader`, min 52, grid `1fr auto 1fr`, padding 0 12), opaque `--surface`:
  - leading glass capsule **"Close"** (44 tall, padding 0 16, Body `--ink`);
  - centred, two lines: **"October statement"** in `--text-sheet-title`, then the range
    **"1 Oct – 31 Oct 2026"** in Footnote `--ink-2` (same day-month form as DESIGN's ranges,
    with the year);
  - trailing: nothing.
  - When content scrolls under the header, an 18px scroll-edge fade from `--surface` to
    transparent appears below it (as the compact header, DESIGN §7).
- **Body** scrolls under the header, padding-bottom 34 plus the bottom safe area. Side margins are
  `--gutter` (20), so the content box is 337 wide on an iPhone 15 (377 sheet).

Top to bottom: the result (1.2), "Money in and out" (1.3), "Where it went" (1.4), "The month in
numbers" (1.5), a footer.

### 1.2 The result

The hero of the review is the month's **result** (income − fixed − daily, SPEC §4.8): what moved
to the wallet. It is the one bold thing in the sheet.

- **Label row** (min 22, 8 below the header): the label in Subhead 500 `--ink-2`.
- **Figure row** (flex, space-between, centred): the figure on the leading side, the **Closed
  seal** on the trailing side.
  - Figure: `BigAmount` at `--text-hero` (76, proportional figures, tracking −0.012em), margin-top
    4, margin-left −3, unit in `--text-hero-unit` `--ink-2` 0.16em after the number. 132,82 €
    measures 204 wide.
  - Seal block: the 54px brass seal engraving (`--brass`, 0.75px stroke), with **"Closed 31 Oct"**
    in Footnote `--ink-2` centred 5 below it. The block is 85 wide. `role="img"`, label
    "Statement closed on 31 October". The date is the period's last day.
  - BigAmount measures the space left of the seal: content width − seal block − 12. It shrinks
    1px at a time, never below 34, then drops the cents (DESIGN §5.4).
- **Sentence** in Body `--ink`, 10 below.

| Case | Label | Figure | Sentence |
|---|---|---|---|
| result > 0, left ≥ 0, savings > 0 | "Moved to your wallet" | `--ink` | "100,00 € of savings and 32,82 € left over." |
| result > 0, left < 0 (savings covered it) | "Moved to your wallet" | `--ink` | "100,00 € of savings, less 23,40 € over budget." |
| result > 0, savings 0 | "Moved to your wallet" | `--ink` | none (the figure is what was left over) |
| result = 0 | "Moved to your wallet" | "0,00 €" `--ink` | "Income and spending came out even." |
| result < 0 | `warning-octagon` 16 + "Taken from your wallet" in 600 `--critical-ink` (icon `--critical`) | unsigned, `--critical-ink` | "You spent 41,28 € more than came in." |
| period before the wallet's start | as Home's past hero: "Left over" or "Over budget by" | as Home | "You spent 512,30 € on daily life." |

The seal stays brass in every case: the month is settled, even when it went wrong (as Home's past
over-budget hero, DESIGN §3.2).

### 1.3 Money in and out

The month written as a sum that ends where the money went.

- **Section heading** (34 above, used by every review section): the title in `--text-headline`
  and an optional meta in `--text-figure-sm` `--ink-2` (serif, money only), on a shared baseline.
  9 below the title runs a 0.5px `--hairline-strong` rule across the full content width, like the
  header rule of the wallet passbook. Then the content.
- **Ledger** exactly as DESIGN §9.6, without the group (padding 2 0 8): rows `22px 1fr auto 20px`,
  44 tall, operators in the figures font `--ink-3`, hairlines from x 22.
  - `+ Income 1.450,00`, `− Fixed costs 778,88`, `− Daily spending 538,30`.
  - Result row (52): `=` in `--ink`, **"To your wallet"** in Body 600, the figure in
    `--text-figure-strong` with "€" hung in the margin column. The sum rule (1px `--ink-3`) and
    the brass double rule span `--colw`, the widest figure.
  - Savings is not a subtraction here: it went to the wallet together with what was left over.
    The hero sentence names both parts, so the statement reconciles with Home's "Left 32,82 €"
    and its "Moved to your wallet: 132,82 €" line.
  - Negative result: the label reads **"From your wallet"**, the figure carries a true minus
    ("−41,28"), figure and unit in `--critical-ink`, and the double rule turns `--critical`.
- **Carry row** under the ledger (44, hairline above, full width): **"Wallet after closing:
  764,04 €"**, Subhead `--ink-2` with the value in `--ink`, and a bold 14 chevron in `--ink-3`.
  It is a button: it closes the sheet and opens the Wallet tab (`navigate('wallet')`). When the
  balance after closing is negative: "Wallet after closing: short by 12,00 €" with the value in
  `--critical-ink`. Hidden for periods before the wallet's start.

### 1.4 Where it went

- Heading "Where it went" with the meta "538,30 €" (daily spending, your shares).
- **Stacked bar** 16 below the rule: 10 tall, 2px gaps on paper, `--radius-data` outer ends, the
  top five categories by amount, then the fold in `--cat-other` (DESIGN §9.22).
- **Legend**, one row per segment, in segment order. Each row is a grid `18px minmax(0,1fr) auto`,
  padding 10 0 11 (63.5 tall), hairlines from x 18:
  - line 1: a 9px dot in the category ink (centred on line 1), the name in Body, the amount in
    `--text-figure`, right-aligned and tabular;
  - line 2, 2 below, under the name: the **change against the previous period** in Footnote
    `--ink-2`, led by a 13px `arrow-up` or `arrow-down` (regular, `--ink-2`, 5 gap).

| Change (rounded to whole percent) | Line 2 |
|---|---|
| more | `arrow-up` + "8 % more than September" |
| less | `arrow-down` + "14 % less than September" |
| rounds to 0 % | "Same as September" (no arrow) |
| the previous period had none in that category | "New in October" (no arrow) |
| the previous period has no expenses at all, or is before the first period | no line 2 |

  Never colour: up is not red and down is not green. The words carry the meaning, the arrow the
  shape. Format the percentage with the chosen number format (`Intl.NumberFormat(locale, { style:
  'percent', maximumFractionDigits: 0 })`), so de-DE reads "8 %".
- **The fold** (only when two or more categories remain, DESIGN §14.5): the row "2 more" with the
  folded amount, and line 2 naming them in amount order: "Shopping and Transport"; with more than
  three, "Shopping, Transport, Health and 2 more". A single remaining category shows by name with
  its change.
- Rows are not buttons in the review (the statement is read, not explored).

### 1.5 The month in numbers

Heading "The month in numbers", then fact rows: grid `minmax(0,1fr) auto`, min 48, padding 13 0,
first-baseline aligned, full-width hairlines between rows. The label is Body `--ink`. Counts are SF
Pro Body `--ink`, tabular (DESIGN §5.2: counts are not serif); money is `--text-figure`.

| Row | Value | Notes |
|---|---|---|
| "Biggest expense" | "41,30 €" | Line 2 in Subhead `--ink-2`, 2 below: "Edeka, Sat 24 Oct" (note, or category name, then the date). By `budgetAmount`, so a split counts your share. Hidden without expenses. |
| "Days without spending" | "4" | "None" when 0. |
| "Entries" | "64" | Expense transactions counted (SPEC §4.9). |
| "Fixed costs paid" | "6 of 6" | Charge lines ticked paid of all charge lines. Hidden when the period has none. |
| "Still owed to you" | "25,00 €" | Open splits on the period's expenses. A button with a 14px chevron column: it closes the sheet and opens "Owed to you". Hidden when 0. |

**Footer**, 22 below, Footnote `--ink-2`: "Changing entries from October updates this statement
and your wallet." (The review is computed, never stored: SPEC §4.8.) For a period before the
wallet's start, which does not change the wallet, it reads "Changing entries from October updates
this statement."

### 1.6 The review banner

The first open after a period closes (SPEC §3.15).

- **Tone "statement"**, new beside info, warning and critical (DESIGN §9.19): background
  `--surface` (statement paper, a card on the desk), icon the **22px brass Closed seal** (stroke
  0.75px). Layout as every banner: radius 22, padding 14 16, grid `22px 1fr`, gap 12, text in
  Subhead `--ink` with `text-wrap: pretty`.
- **Copy:** "**October is closed.**" (600) then " Moved to your wallet: 132,82 €." or " Taken from
  your wallet: 41,28 €." The amount stays SF Pro (a sentence, DESIGN §5.2).
- **Actions**, 8 below, 18 apart: **"See the review"** (Subhead 600 `--accent-ink`) opens the
  review and **"Dismiss"** (Subhead `--ink-2`). Both set `lastReviewedMonth`. It says "Dismiss",
  not "Not now", because the banner will not return; the review stays on that month's Home (1.7).
- **Place:** in the Screen's banner slot on the current period's Home, 2 under the title row,
  margin 0 20, the hero 6 below, 10 between two banners (measured: 353×108 at y 157 on an iPhone
  15). The spacing is margins of the slot's children (2 above the first, 6 below the last, 10
  between), not padding of the slot, so a banner that collapses takes its spacing with it (1.9).
- **With other banners:** at most one non-critical banner shows. Order: storage errors (critical),
  update ready, install hint, **the review banner**, backup nudge. While the review banner shows,
  the backup nudge waits; the monogram's dot still says a backup is due.
- **Hidden amounts:** the second sentence is left out: "October is closed."
- Never on a past or future period's Home, and never for a period before the wallet's start
  (SPEC `unreviewedClosedMonth`).

### 1.7 "See the review" on a past month

- Under the statement group of any closed period ("Statement for October", with its "Moved to
  your wallet" carry row): a **secondary button**, full content width (353), 44 tall,
  `--surface-2` fill, label Subhead 600 `--accent-ink`, `--radius-pill`, 14 below the group. The
  next section keeps its 36 gap.
- It opens the review of that period. Shown for every closed period from the first period on;
  never on the current or a future period.

### 1.8 Accessibility

- The sheet is `role="dialog"`, `aria-modal="true"`, labelled by its title, described by its range.
  Focus starts on "Close".
- The result reads as one sentence: "Moved to your wallet, 132,82 €. 100,00 € of savings and
  32,82 € left over. Statement closed on 31 October."
- The ledger is a table with row headers (DESIGN §12). The carry row reads "Wallet after closing,
  764,04 €, button".
- The stacked bar is `role="img"` ("Daily spending in October by category") with a visually
  hidden table. Each legend row reads "Groceries, 186,30 €, 8 percent more than September"; the
  arrows are `aria-hidden`.
- The facts are a description list (`dl`, `dt`, `dd`); the two navigating facts are buttons
  named by their row: "Still owed to you, 25,00 €".
- The banner is a `region` named "October is closed"; its seal is `aria-hidden` (the words say
  closed).
- Hidden amounts: every figure renders "•••" in `--ink-3` without a unit (DESIGN §5.4).

### 1.9 Motion

- The sheet presents and dismisses like every sheet (`--dur-sheet`, `--ease-sheet`; a fade with
  Reduce Motion). Nothing inside moves: no odometer, no growing bars. A closed statement is still.
- Dismissing the banner collapses it: height and opacity to 0 over `--dur-grow` with `--ease-out`,
  and the hero rises with it. With Reduce Motion it fades in `--dur-fade` and the layout jumps.
  The kit `Banner` calls `onDismiss` at once and never animates; the review banner collapses its
  own wrapper, starting from that wrapper's computed height and margins and ending at 0, so the
  hero lands exactly where it sits without a banner.
  When the review was opened from the banner, the banner is removed behind the sheet, without
  animation.

---

## 2. Split bills

You paid the whole bill. The app records the bill, who owes you what, and counts only your share
in the budget.

### 2.1 The Split capsule

- The transaction sheet's `SheetHeader` **action** (its trailing slot, otherwise empty for
  expenses, new and edit): a glass capsule **"Split"** (44 tall, padding 0 16, Body), the neutral
  tone with `expanded` and `controls` (DESIGN §9.12, §9.16). Measured 69×44, 12 from the sheet's
  trailing edge. It costs no height, which keeps the sheet inside 375×667 with "Pay from wallet".
- Not shown for income. Disabled (`--ink-disabled`) while the amount is 0.
- **States:**

| State | Look |
|---|---|
| No split, keypad showing | Glass, label `--ink` |
| Split panel open | `--accent` fill, label `--on-accent` 600, like a selected chip |
| Keypad showing, a split is set | Glass, label `--accent-ink` 600 (tinted) |

- Tapping it opens or closes the split panel (2.3). It is a disclosure: `aria-expanded`,
  `aria-controls="split-panel"`, name "Split".

### 2.2 The share line

The consequence line slot under the amount (DESIGN §9.16) changes while a split exists:

- Line 1, 10 below the amount, centred, Subhead `--ink-2` with the figure in `--ink`:
  **"Your share: 16,00 €"**. Always shown while a split exists, for any date.
- Line 2, 2 below, only for an expense dated today in the current period: the consequence of
  DESIGN §9.16 computed on **your share** ("Leaves 0,34 € for today", the warning or critical
  variants). With "Pay from wallet" on, line 2 is the wallet's "Wallet after: …" line, computed
  on your share (SPEC §4.8).
- **Error** when what others owe is more than the bill: line 1 becomes `warning-octagon` 16
  (`--critical`) + "Others owe more than the bill of 18,00 €" in `--critical-ink`, and "Add
  expense" (or "Save changes") is disabled until it fits. Line 2 hides.
- Line 1 is `aria-live="polite"`, so a new share is announced after "Split evenly" or an edit.

### 2.3 The split panel

The split editor is not a separate sheet. It takes **the keypad's place** inside the transaction
sheet, so the amount, category, note, date and "Pay from wallet" stay in view, and nothing else
moves.

- **Opening:** "Split" swaps the keypad for the panel. **Closing:** tapping the amount display
  (while the panel is open it shows no caret, and its name is "Amount, 32,00 €, the whole bill.
  Edit amount") or "Split" again brings the keypad back. The split is kept either way.
- **Box:** margin 0 16, padding 10 0 4, content-sized with a **max-height equal to the keypad
  box**: 10 + 4 × 56 = 234 (10 + 4 × 48 = 202 on screens under 700pt). The sheet resizes to the
  panel. Taller content scrolls inside the panel: its title row stays pinned, a 20px fade
  (`mask-image`) on the bottom edge shows there is more, and the share line above never scrolls
  away.
- **Title row** (28 tall, sticky at the panel's top on `--surface-sheet`): **"Who owes you"** in
  Footnote 600 `--ink-2`, indented 16 (on the group's text edge, like the "Note" label), and at
  the trailing end **"Split evenly"** in Subhead 600 `--accent-ink`, padding 0 16, with a 44 hit
  area.
- **People group:** `--surface-raised`, `--radius-lg`. Rows 48 tall (44 under 700pt), grid
  `26px minmax(0,1fr) auto 32px`, gap 10, padding-left 16; hairlines from x 52 to the trailing
  edge:
  - a **person coin**, 26: the initial in SF Pro 600 12, `--ink`, in a 0.75px `--hairline-strong`
    ring (people have plain coins; the engraved rim stays the owner's monogram);
  - the **name**, a text input in Body at `--text-input` (≥ 16px), `--ink`, one line with an
    ellipsis, max 24 characters, `enterkeyhint="next"`;
  - the **amount owed**, an `AmountField` (DESIGN §9.14): `--text-figure`, right-aligned,
    tabular, "8,00 €" on blur, the plain value while focused, `inputmode="decimal"`. Empty shows
    the placeholder "Amount" in `--ink-2`;
  - **remove**: `x-circle` fill 19 in `--ink-3` in a 44 hit area that reaches 12 into the
    padding, named "Remove Lea".
- **Add row** (same grid): `plus-circle` regular 22 in `--accent-ink` in the coin column, **"Add
  person"** in Body `--accent-ink`, then **suggestion chips** right-aligned with 16 padding: mini
  chips (32 tall, padding 0 12, `--surface-2`, Subhead 500 `--ink`, 6 apart) with the most recent
  names from earlier splits that are not already in this split, as many as fit (one or two).
  Tapping a chip adds that person at once.
- **Fit, measured:**

| Screen | Keypad layout | Panel, 2 people | Panel, 3 people |
|---|---|---|---|
| 375×667 | sheet 629 (top at 30) | panel 174, sheet 601 (top at 58) | panel stops at 202 and scrolls; sheet 629 |
| 393×852 | keypad box 234 | panel 186 | panel 234, no scrolling |

  The sheet is never taller with the panel than with the keypad. `?screen=add-split&device=se`
  shows two people on 375×667; add `&people=3` for three.

### 2.4 Behaviour (proposed, see section 7)

- **Even by default.** Adding a person while the split is even (or empty) re-splits evenly:
  each person owes floor(amount / (n + 1)) and the remainder stays with you (32,00 € with two
  people: 10,66 € each, your share 10,68 €). Typing an amount by hand stops this. **"Split
  evenly"** re-applies it at any time. Changing the bill on the keypad re-splits only while the
  split is still even.
- **Adding a new name:** "Add person" inserts a row with the name focused and the keyboard up.
  The add row stays below it and its chips filter by the typed prefix (`personSuggestions`,
  case-insensitive). "Next" moves to the amount; "Done" closes the keyboard. The sheet keeps the
  focused row above the keyboard (`useVisualViewport`).
- **Removing** the last person removes the split: the share line goes, the capsule returns to
  glass, and the panel shows only its add row.
- A name left empty when the keyboard closes removes its row. Two rows with the same name
  (case-insensitive) merge into one, amounts added, when the name field is left and again on save.
  A row with a name but no amount, or 0, is dropped on save, like a row without a name.
- **Settled splits** (paid back or forgiven) are listed read-only in the panel, labelled "Paid
  back" or "Forgiven". Saving keeps them as they are, and "Split evenly" leaves them out: it
  splits the bill minus the settled amounts among the open people and you.
- The panel's state is part of the sheet's draft (SPEC §5.10) and makes the sheet dirty.

### 2.5 A split expense in lists

Daily, category detail and Recent show split expenses as ordinary list rows (DESIGN §9.8) with:

- **The amount** on line 1: your share (`budgetAmount`), `--text-figure` `--ink`.
- **Line 2, leading:** a 15px `users` glyph (regular, `--ink-2`, 5 gap) and the split, in
  Subhead `--ink-2`, like the wallet's "Paid from wallet" line:

| Open splits | Line 2 |
|---|---|
| one person still owes | "Split, Max owes 9,00 €" |
| two or more still owe | "Split with 2 people" |
| everyone paid back | "Split with Max, settled" ("Split with Lea and Max, settled") |
| everything forgiven | no split line: the row is an ordinary expense again |

- **Line 2, trailing:** "of 18,00 €" (the whole bill) in Subhead `--ink-2`, tabular, never
  wrapping, right-aligned under the amount. The leading text wraps if it must; "of …" stays on
  the first line of line 2.
- Day totals, the Daily sentence and the chart count shares only.
- A split that was also paid from the wallet shows the wallet line ("Paid from wallet") with the
  "of …" trailing part.
- With the date shown (Recent, category detail), a split row keeps "of 18,00 €" in line 2's
  trailing place; the day is said only in its accessible name.
- VoiceOver reads the row as one sentence: "Bar with friends, Going out, 9,00 €, your share of
  18,00 €. Split, Max owes 9,00 €." The category is in the name when the title is the note, as on
  wallet-paid rows (DESIGN §9.26).

### 2.6 The Home "Owed to you" card

- Home card key `owed`, after the wallet card in the default order (SPEC §5.9). Hidden when
  nothing is open.
- **Section** (DESIGN §9.7): title "Owed to you" in `--text-title3`, meta **"25,00 €"** (the
  open total) in `--text-figure-sm` `--ink-2`.
- **Group** with up to three people, by total, largest first. Each row is a two-line list row
  (62 tall, separators from x 62) and a button:
  - a 34px person coin with the initial in SF Pro 600 15;
  - the name in Body, the person's total in `--text-figure`;
  - line 2 in Subhead `--ink-2`: the bill's note when the person owes for one bill ("Pizza
    night"), otherwise "2 bills".
  - Tapping opens "Owed to you" scrolled to that person, through the route
    (`{ name: 'owed', person: 'Max' }`). Name: "Max owes you 17,00 €, 2 bills".
- With four or more people, a last line (44, hairline above): "Plus 6,40 € from 1 more person"
  ("from 3 more people") in Subhead `--ink-2` with a bold 14 chevron in `--ink-3`, like "Plus …
  in fixed costs". It opens the screen.
- No chevrons on the person rows, as on every other Home row.

### 2.7 The "Owed to you" screen

A pushed screen (route `owed`) on the Home stack, laid out like category detail (DESIGN §9.2).

- **Nav row:** the back capsule "‹ Home" ("‹ Settings" when it came from settings).
- **Title:** "Owed to you" in `--text-title1`, padding 8 20 0.
- **Total**, 10 below: "25,00 €" in `--text-figure-lg` (serif 28) with its unit in
  `--text-figure-sm` `--ink-2`, 0.3em after it; under it, 3 below, Subhead `--ink-2`: "2 people
  owe you for 2 bills." (one person: "Max owes you for 2 bills."; one bill: "for 1 bill").
- **Per person** (people by total, largest first; within a person, newest first):
  - **Header** (24 above, 8 below, padding 0 36 0 20): a 26px person coin, the name in
    `--text-headline` `--ink`, the person's total in `--text-figure` `--ink`, right-aligned with
    the row amounts.
  - **Group** of the person's open items. Each item is a list row (padding 11 16 8):
    - coin: the expense's category coin;
    - line 1: the note (or category name) in Body, and what this person owes in
      `--text-figure`;
    - line 2: the date ("Sat 17 Oct") in Subhead `--ink-2`, and "of 18,00 €" trailing, as in 2.5;
    - line 3, 5 below: two text buttons, 22 apart, each 30 tall with a 44 hit area: **"Paid
      back"** in Subhead 600 `--accent-ink` and **"Forgive"** in Subhead `--ink-2`.
  - **"Mark all as paid"** closes a group with two or more items: a 50 tall row, Body
    `--accent-ink`, hairline above from x 16.
- **Settled**, 24 below the last group: one group with a disclosure row (50 tall): "Settled" in
  Body, the count in Body `--ink-2` tabular, a bold 14 `caret-down` in `--ink-3` (the same row as
  the wallet's "Done" goals). Collapsed by default. Open, it lists settled items as rows without
  actions, amounts in `--ink-2`, line 2 "Max paid back Thu 1 Oct" or "Forgave Lea Sat 3 Oct". The
  list mixes people, so each row says who settled: a bill paid back by Lea and Max shows two
  different rows.
- **Footer** (Footnote `--ink-2`, 8 below, indented 36): "Your budget counts only your share.
  Forgiving a split counts it as your own spending again."
- **Nothing open** (reached from settings, since the Home card hides): the empty state of DESIGN
  §9.20 with a `hand-coins` coin, right under the title with no total or sentence: "Nobody owes
  you anything" / "When you split a bill, what others owe you shows up here." Then Settled, when
  it has entries.
- **Actions:**
  - "Paid back" acts at once through `withUndo`. Toast: "Max paid back 9,00 €" with "Undo".
  - "Mark all as paid": toast "Max paid back 17,00 €" with "Undo".
  - "Forgive" asks first with `confirmDialog`: title "Forgive 9,00 €?", message "It counts as
    your own spending again.", buttons "Cancel" and **"Forgive"**. The confirm is primary, not
    destructive: nothing is deleted and Undo follows. Toast: "Forgave Max 9,00 €" with "Undo".

### 2.8 Accessibility

- The split panel is a `group` labelled "Who owes you". Inputs are named "Name" and "Lea owes";
  remove buttons "Remove Lea"; chips "Add Jonas". The share line is a polite live region.
- Every touch target is 44: the chips (32) and the action buttons (30) extend their hit areas
  with transparent pseudo-elements, as DESIGN §6.
- On the Owed screen each person is a `section` headed "Max, 17,00 €". "Paid back" and "Forgive"
  keep their visible names and point `aria-describedby` at their item ("Bar with friends, 9,00
  €"), so VoiceOver reads "Paid back, button, Bar with friends, 9,00 €" and Voice Control still
  matches "Paid back". "Settled" is a disclosure with `aria-expanded`.
- When an item leaves the list, focus moves to the next item's "Paid back", or to the person's
  header when it was the last one.
- Hidden amounts: "•••" in `--ink-3` everywhere, including "of •••". The transaction sheet shows
  what you type, as it already does.
- Dynamic Type: rows, the panel and the cards are size containers (DESIGN §5.5). Below 20em the
  "of …" part moves under the amount, and the action buttons wrap to a second line rather than
  shrink.

### 2.9 Motion

- **Keypad ↔ panel:** the incoming panel or keypad fades in with an 8px rise over `--dur-grow`
  and `--ease-out`. The sheet's height follows with `--ease-sheet` over `--dur-grow`. Reduce
  Motion: a fade, and the height jumps.
- **Rows:** a new person fades in. Rows do not animate their height, and "Split evenly" changes
  the amounts without a crossfade: an input cannot crossfade its own value, and a height animation
  inside the capped panel would fight the sheet's own resize. No odometer here: it belongs to the
  hero alone.
- **Owed:** a settled item collapses over `--dur-grow` with `--ease-out` while the person's total
  and the screen total crossfade; a person's last item takes the whole section with it. Reduce
  Motion: fades only.

---

## 3. The settings entry on Home

Settings ("You") moved off the tab bar (SPEC §3): the fourth tab is Wallet. The monogram and the
greeting at the top of Home are now one button that pushes settings, like the account button in
Apple's own apps.

### 3.1 The button

- **Where:** the leading end of Home's nav row (44 tall, padding 0 16 0 20, DESIGN §9.2).
- **Content:** the monogram medallion (32, engraved rim, SF Pro 600 15 initial; DESIGN §9.9) and,
  10 after it, the greeting "Hi, Alex" ("Hi there" without a name) in Subhead 500 `--ink-2`. The
  medallion stays at x 20.
- **Box:** one button, 44 tall, padding 0 12 0 8 with margin-left −8, so its pill starts 8 left of
  the medallion and ends 12 after the greeting (measured 117×44 at x 12 for "Hi, Alex").
  `--radius-pill`.
- No chevron, no glass: the medallion reads as the account button, and the nav row stays calm.
- **No name, no emoji:** the medallion holds the light `person` glyph in `--ink` (the kit
  `Monogram` draws it at 13, 16 or 28 for sm, md and lg; 16 here) and the greeting reads "Hi
  there". **Emoji avatar:** the emoji at 17px replaces the initial.
- **Compact header:** the greeting hides (DESIGN §9.2) and the medallion alone stays a button, 44
  hit area, medallion still at x 20, with the dot.

### 3.2 The backup dot

- When `needsBackupReminder`: an 8px `--critical` dot with a 2px `--bg` ring (`box-shadow: 0 0 0
  2px var(--bg)`), its box at the medallion box's top-right corner (top 0, right 0 of the 32px
  medallion, so its centre sits on the rim at about 45°). In the compact header the ring is
  `--bg` too.
- Contrast: `--critical` on `--bg` 5.61:1 light, 7.54:1 dark. The dot is never the only signal:
  the button's name says it and the Backup row in settings carries its own dot (SPEC §3.7).
- The tab bar no longer has a dot (DESIGN §9.1's "You, backup due" goes away with the You tab).

### 3.3 States

| State | Look |
|---|---|
| Default | No fill |
| Pressed | `--press` pill, scale 0.97, over `--dur-press` |
| Focus (keyboard) | 2px `--focus-ring` outline, 2px offset, on the pill |
| Backup due | the dot (3.2) |

### 3.4 Accessibility and motion

- Accessible name **"Settings"**, or **"Settings, backup due"** with the dot (SPEC §3). The
  medallion and the greeting are `aria-hidden`: the greeting is a greeting, not the button's
  label. Voice Control users say "Tap Settings"; its "Show names" overlay shows that name.
- Test id `open-settings`.
- Pushing settings uses the screen push (`--dur-push`, `--ease-push`). The dot never pulses:
  nothing moves on its own.

---

## 4. Tokens

**No new tokens.** Everything above uses `src/styles/tokens.css` as it is. New pairings, checked
with the same compositing as `check-contrast.mjs`:

| Pair | Light | Dark | Needs |
|---|---|---|---|
| `--brass` seal on `--surface` (review sheet, banner) | 3.48 | 8.52 | 3 (mark) |
| Category inks on `--surface` (review bar and dots) | validated palette (DESIGN §4.5); yellow 2.06 relieved by its label | all ≥ 3.05 | 3 (mark) |
| Category inks on `--surface-raised`, for comparison | yellow 2.15 | green 2.72, red 2.75, brown 2.74: **fail**, hence 1.1 | 3 |
| `--critical` dot on `--bg` | 5.61 | 7.54 | 3 (mark) |
| `--ink-2` on `--surface` (review, banner, card) | 6.05 | 7.26 | 4.5 |
| `--accent-ink` on `--surface` (banner action) | as DESIGN §13 (≥ 5.8 every accent) | | 4.5 |
| `--on-accent` on `--accent` (Split capsule on) | ≥ 7.1 every accent | | 4.5 |
| `--ink-3` on `--surface-raised` (remove glyph, mark) | 5.44 | 5.16 | 3 |
| `--accent-ink` on `--surface-raised` (Add person) | as DESIGN §13 | | 4.5 |

Materials used in new roles (no value changes): `--surface` as the review sheet's background and
the statement banner's background; `--accent` / `--on-accent` as the selected state of a glass
capsule; `--bg` as the backup dot's ring on the nav row.

## 5. Icons

Add to `src/ui/icons/manifest.ts` (Phosphor, path data only):

| Name | Phosphor | Weight | Size | Use |
|---|---|---|---|---|
| `people` | `users` | regular | 15 | The split line in rows (2.5) |
| `person` | `user` | light | 16 | The medallion without a name or emoji (3.1) |
| `owed` | `hand-coins` | light | 28 | The empty state of "Owed to you" (2.7) |

Already there: `arrow-up`, `arrow-down` (regular, 13 in the review), `plus-circle` (22, add
person), `clear` (`x-circle` fill, 19, remove), `chevron-down` (Settled), `critical` (16). The
seal and the medallion are the existing engravings (DESIGN §3.1).

## 6. Copy

All English, sentence case, money through `Intl` with a true minus, dates in the en-GB short form
(DESIGN §11).

| Where | Copy |
|---|---|
| Review sheet title, range | "October statement", "1 Oct – 31 Oct 2026" |
| Review header button | "Close" |
| Review result labels | "Moved to your wallet", "Taken from your wallet" |
| Seal caption | "Closed 31 Oct" (VoiceOver: "Statement closed on 31 October") |
| Result sentences | "100,00 € of savings and 32,82 € left over.", "100,00 € of savings, less 23,40 € over budget.", "Income and spending came out even.", "You spent 41,28 € more than came in." |
| Review sections | "Money in and out", "Where it went", "The month in numbers" |
| Ledger result | "To your wallet", "From your wallet" |
| Carry row | "Wallet after closing: 764,04 €", "Wallet after closing: short by 12,00 €" |
| Change lines | "8 % more than September", "14 % less than September", "Same as September", "New in October" |
| Fold | "2 more", "Shopping and Transport", "Shopping, Transport, Health and 2 more" |
| Facts | "Biggest expense", "Days without spending", "Entries", "Fixed costs paid", "6 of 6", "Still owed to you", "None" |
| Review footer | "Changing entries from October updates this statement and your wallet."; before the wallet's start "Changing entries from October updates this statement." |
| Banner | "October is closed. Moved to your wallet: 132,82 €.", "September is closed. Taken from your wallet: 41,28 €.", "See the review", "Dismiss" |
| Past month | "See the review" |
| Transaction sheet | "Split", "Your share: 16,00 €", "Who owes you", "Split evenly", "Add person", "Name", "Amount", "Others owe more than the bill of 18,00 €" |
| Rows | "Split, Max owes 9,00 €", "Split with 2 people", "Split with Max, settled", "of 18,00 €" |
| Home card | "Owed to you", "2 bills", "Plus 6,40 € from 1 more person" |
| Owed screen | "Owed to you", "2 people owe you for 2 bills.", "Paid back", "Forgive", "Mark all as paid", "Settled", "Max paid back Thu 1 Oct", "Forgave Lea Sat 3 Oct", "Your budget counts only your share. Forgiving a split counts it as your own spending again." |
| Owed empty | "Nobody owes you anything", "When you split a bill, what others owe you shows up here." |
| Forgive dialog | "Forgive 9,00 €?", "It counts as your own spending again.", "Cancel", "Forgive" |
| Toasts | "Max paid back 9,00 €", "Forgave Max 9,00 €" (both with "Undo") |
| Settings button (VoiceOver) | "Settings", "Settings, backup due" |

## 7. Spec notes

Where this design adds to or differs from `docs/SPEC.md` and `docs/DESIGN.md`:

1. **§3.16 split editor.** Not a sheet: an inline panel of the transaction sheet that takes the
   keypad's box (2.3), opened by a "Split" capsule in the header's trailing slot (2.1). Drop
   "sheet `split`" (it is also missing from `SheetRoute`); the splits live in the sheet's form
   state and draft.
2. **§3.4 consequence line.** With a split: "Your share: {x}" first, then the consequence computed
   on the share for today's expenses (2.2). The error "Others owe more than the bill of {x}"
   disables saving (the spec's "never exceed" made visible).
3. **§3.16 split behaviour.** Even by default, "Split evenly" re-applies it; blank names drop;
   duplicate names merge (2.4). `personSuggestions` feeds one or two chips in the add row.
4. **§3.16 rows.** The `users` glyph before the split line, plus "Split with {names}, settled"
   when everyone paid back, and only the people still owing in the other forms (2.5).
5. **§3.16 Home card.** Section meta for the total, three person rows with "{n} bills" or the
   bill's note, then "Plus {x} from {n} more people" (2.6).
6. **§3.16 Owed screen.** Pushed-screen header (title1 and the total in `--text-figure-lg`),
   "Mark all as paid" only with two or more items, Forgive confirmed as primary (not
   destructive), toasts as in section 6, the empty state (2.7). Settings has an "Owed to you" row
   (the open total as its value, or "None") in the untitled group after Money, with Categories
   and Quick add buttons (SPEC §3.7).
7. **§3.15 review.**
   - The ledger closes on "To your wallet" (income − fixed − daily), and the hero sentence names
     savings and what was left over (1.2, 1.3).
   - "Wallet after closing" is the ledger's carry row and opens the Wallet; "Still owed to you"
     opens Owed; both hide when they do not apply.
   - "Where it went" gets the "{n} more" fold row, and change lines hide when the previous period
     has no data (1.4).
   - Periods before the wallet's start get Home's past hero and ledger.
   - `MonthReview` needs `fixedCount` (charge lines, for "6 of 6"), the folded categories
     (`rest: ReviewCategory[]`, every category past the top five, with `previous` and `change`)
     and the previous period's name. `biggestExpense` is
     already a `Transaction` (note, date, category).
8. **§3.15 banner.** A new `Banner` tone `'statement'` (`--surface`, the 22px seal). The dismiss
   action is "Dismiss". At most one non-critical banner at a time, the review before the backup
   nudge (1.6).
9. **§3.1 past periods.** "See the review" is a full-width secondary button under the statement
   (1.7).
10. **§3 settings entry.** The monogram and greeting are one button with the name "Settings" or
    "Settings, backup due"; the compact header keeps the medallion as that button (3.1).
11. **DESIGN §3.1 seal.** Two new places, both announcing a closed month: the review's hero (54)
    and the review banner (22). Nowhere else.
12. **DESIGN §9.16 sheets.** The review sheet is statement paper (`--surface`) with content
    printed on it (1.1). Every other sheet keeps `--surface-sheet`.
13. **DESIGN §9.1 tab bar.** The fourth tab is Wallet; the backup dot moves to the monogram.

## 8. Do not miss

- The split panel never makes the transaction sheet taller than its keypad layout: measure on
  375×667 with "Pay from wallet" present (`?screen=add-split&device=se`).
- Every budget figure uses `budgetAmount` (your share): the hero, day totals, the Daily sentence,
  the chart, limits, Where it went, the review's facts. Only the "of …" part shows the bill.
- The review is computed, never stored. Editing an October expense changes the review, Home's
  statement, the banner's amount and the wallet together.
- The seal in the review is next to the figure, brass, and never moves. Category marks in the
  review sit on `--surface` (the sheet), never on `--surface-raised`.
- "Dismiss" and opening the review both set `lastReviewedMonth`; the banner never comes back for
  that month.
- Undo for "Paid back", "Mark all as paid" and "Forgive" goes through `withUndo`.
- Format percentages and money with the chosen number format; never colour the change lines.
- The settings button's accessible name is "Settings" (", backup due"), not the greeting.
