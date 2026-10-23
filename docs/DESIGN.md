# On a Budget: design system

Direction: **Private bank**. This document is the source of truth for the visual design. Tokens live in
`src/styles/tokens.css`. Reference screens are in `docs/design/reference.html`. Open it with
`?screen=home`, `daily`, `add`, `fixed`, `recurring`, `you`, `category`, `lock`, `welcome`, `over`
or `past`. The Wallet (section 9.26) is `wallet`, `wallet-goals`, `wallet-entry`,
`wallet-settings`, `goal`, `add-wallet`, `daily-wallet` and `home-wallet`. The extra states are
`ahead`, `future`, `short`, `scrolled`, `fixed-sub`, `add-se`, `wallet-empty`, `wallet-short`,
`wallet-paid` and `add-wallet-short` (add `&device=se` to see 375×667). The boards are `kit` (hero
states), `parts` (components), `wallet-states` (every Wallet part) and `motion`. Add
`&theme=dark` or `&accent=royal` to preview a theme or accent, and `&masked=1` to hide amounts.
`docs/SPEC.md` owns behaviour and copy. Section 14 lists the places where this design asks the
spec to change.

---

## 1. Concept

Your month reads like a statement from your own private bank. Every money figure is set in
**Source Serif 4** at its optical size, as if the bank had typeset it. Every word and control stays
plain **SF Pro**, so the app still feels like iOS. By day the ink is deep navy on cool bone paper.
After dark the ink is bone on navy night. Dark mode is designed separately, not inverted.

Colour is rationed and every colour has one job:

| Colour | Means |
|---|---|
| Navy ink (`--ink`) | Information: words, figures, the pace fill, meters |
| Accent (`--accent`, navy by default) | Act here: the add button, primary buttons, links, selection |
| Brass (`--brass`) | Settled: the double rule under a bottom line, and the seal of a closed month or a reached goal |
| Critical (`--critical`) | Over budget, always with an octagon icon and words |
| Warning (`--warning`) | Spending fast or near a limit, always with a triangle icon and words |
| Category inks (`--cat-*`) | Identity on data marks only: the stacked bar, legend dots, chart columns |

Bold things are spent in one place: the figure that answers "what's left?". Everything around it is
quiet. Hairlines, flat inset groups, light icons in hairline "coins", and no shadows under content.

## 2. Signature: the month written as a sum

Two elements form one idea.

1. **The figure.** "Left to spend" is a 76px Source Serif 4 numeral at the Display optical size,
   with proportional figures and a half-size currency unit in `--ink-2`. It is the one bold
   element on Home.
2. **The ledger close.** Under it, "This month" writes the arithmetic as a ledger. The operators
   `+ − − − =` sit in their own column. The addends are bare figures aligned on the decimal comma.
   A single ink **sum rule** closes the addends. The result, `= Left 234,72 €`, is the only figure
   that carries its currency unit, hung in a margin column. It is closed by the accountant's brass
   **double rule**: 1px, a 2px gap, 1px. Both rules span the measured width of the widest figure,
   never the full row, as on real ledger paper. The Fixed list closes its "Total" the same way.

Over budget ("rote Zahlen"), the result turns critical: a true minus (`−41,28 €`) and a critical
double rule. The hero says it in words: an octagon icon with "Over budget by" and the amount in
critical ink.

The Wallet's passbook (section 9.26) is the same idea kept over months: a running balance whose
last figure closes with the brass double rule, and the Home Wallet card repeats that closing
balance with its rule.

## 3. The three flourishes

The client asked for "some creative stuff". These three come from private banking. They are
executed as craft, appear only where a bank would use them, and leave everything else quiet.

### 3.1 Engraving (guilloché)

Banknotes and statements are engraved with fine machine-turned line patterns. The app carries
three static engravings, generated once and stored as SVG. Nothing is generated at runtime.

| Engraving | File | Where | Stroke | Size |
|---|---|---|---|---|
| Rosette | `docs/design/engraving-rosette.svg` | Lock screen (the "vault": the mark at its centre), Welcome (the app icon at its centre) | `--engrave` at `--engrave-opacity`, 0.5px | 236px (lock), 260px (welcome) |
| Seal | `docs/design/engraving-seal.svg` | Closed statements (section 3.2), next to the hero figure. Compact contexts use 22px. In the Wallet: passbook month closings and reached goals (section 9.26). | `--brass`, 0.75px, full opacity | 54px; 22px inline and on a reached goal; 20px in the passbook |
| Medallion rim | `docs/design/engraving-medallion.svg` | The monogram avatar (Home nav row, You) | `--ink` at 55% opacity, 0.6px | 32px, 64px |

- **Geometry.** All curves are closed polar curves sampled at 8 points per lobe (12 for petals).
  They are written as Catmull-Rom splines converted to cubic Béziers at 1 to 2 decimals. A band of
  *m* braided rings is one ring plus *m* rotated `<use>` copies, which keeps each file under 19KB.
  - Rosette (viewBox −150…150):
    - Band A: 9 copies of r = 138 + 8 sin 22θ, rotated by 360/198° each.
    - Band B: 7 copies of r = 113 + 6.5 sin 16θ, rotated by 360/112°.
    - Petals: 6 copies of r = 54 + 40 |cos 6θ|^1.3, rotated by 360/72°.
    - Lace: 6 copies of r = 34 + 9 cos 9θ + 3 cos 18θ, rotated by 360/54°.
  - Seal (viewBox −12…12): a rim of 3 copies of r = 10.3 + 0.95 sin 14θ, and a centre of 2 copies
    of r = 3.2 + 3.8 |cos 4θ|^1.2.
  - Medallion rim (viewBox −16…16): 3 copies of r = 14.2 + 0.8 sin 30θ. At 32px it reads as the
    milled edge of a coin.
- **Rules.** Engraving never sits behind text. The lock title and the welcome title sit below
  their rosettes. Only the seal is brass, because what it marks is settled: a closed month, a
  reached goal. The rosette and rim are ink. Engravings never move or rotate. A goal's seal that
  appears because of something the user did fades in; it never scales.
- **Dark mode.** The geometry is the same. `--engrave-opacity` is 0.12 in light and 0.16 in dark
  (the navy night needs a touch more). Increase Contrast lowers it to 0.08 so the mark stands out.
  The seal uses the dark brass `#CFB57C`.
- **Performance.** Inline each SVG once per screen. Paths use `vector-effect: non-scaling-stroke`,
  so one file works at every size with a fixed hairline. Ids in the files are prefixed (`ro`, `se`,
  `me`). When the same engraving is inlined twice in one document, re-prefix the ids. No filters,
  no masks, no animation: they paint once and are composited like any other vector.

### 3.2 Closed statements

A past month reads as a closed bank statement.

- The ledger's title becomes **"Statement for September"**. With a custom start day it gets the
  range as a subtitle: "25 Aug – 24 Sep".
- The hero keeps the SPEC label ("Left over", or "Over budget by"). The **seal** (54px brass
  engraving) sits to the right of the figure, centred on it, with the caption **"Closed 30 Sep"**
  (Footnote, `--ink-2`, centred under the seal, 5px gap). The date is the last day of the period.
  The pair has `role="img"` and the label "Statement closed on 30 September".
- The pace bar has no today notch, and all ticks take the past colour. The caption reads
  "Spent 512,30 € of 571,12 €" and "30 days".
- An over-budget past month keeps the brass seal (the month is settled) with a critical figure.
- Under the result, the statement says where the month's result went: "Moved to your wallet:
  158,82 €" (section 9.6). In the Wallet's passbook the same month is a row stamped with the seal
  (section 9.26).
- It is static, with no motion.

### 3.3 The odometer

The hero figure is a mechanical counter. When "Left to spend" changes because of something the
user did, its digits roll to the new value, like the drums of a bank's counting machine. This is
the app's one orchestrated motion.

- **Triggers.** It plays when the user adds, edits, deletes, undoes or uses a quick add while
  Home is visible. If the value changed while Home was hidden, it plays when Home appears again,
  once. It never plays on first render, on a month switch, when amounts are masked, or when the
  number of digits changes. In that last case the figure crossfades in `--dur-fade`.
- **Mechanics.** Only the digits that change become drums. Separators, the unit and unchanged
  digits stay still. A drum is an `inline-grid` cell with the old and new glyphs in the same grid
  area. When the value falls, the old glyph moves `0 → +100%` (out at the bottom) and the new
  glyph moves `−100% → 0` (in from the top). When it rises, the directions are reversed. A digit
  that passes several steps (9 → 4 passes 8, 7, 6, 5) rolls a strip of those digits as one piece.
  The duration stays the same whatever the number of steps.
- **Timing.** Each drum runs for `--dur-value` (640ms) with `--ease-counter`. The drums start from
  the right (cents first) with `--dur-value-stagger` (45ms) between them.
- **Widths.** The hero uses proportional figures, so measure the old and new glyph advances once,
  with a hidden span, before starting. Animate each drum's `width` from the old to the new advance
  in the same timing (Web Animations API).
- **Clipping.** Clip each drum with `clip-path: inset(0 -0.1em)`. Do not use `overflow: hidden`:
  it moves the inline baseline and the digits would jump.
- **Accessibility.** The figure is not a live region. The hero sentence and `aria-label` carry the
  final value at once.
- **Reduce Motion.** No roll. `--dur-value` is 0ms, so the new value replaces the old at once.
- **Performance.** Only transforms and one width change per drum (6 to 8 elements). Measure
  before starting and never during the animation.

The reference shows the frames on `?screen=motion`.

## 4. Colour

Every value is a token in `src/styles/tokens.css`.

- Light values sit on `:root`.
- Dark values are redefined twice, with identical content: under
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and under
  `:root[data-theme="dark"]`. Both set `color-scheme: dark`.
- `html` and `theme-color` use `--bg`: **#EDEEEA** light and **#0B1222** dark. These are the
  `LIGHT_BG` and `DARK_BG` of SPEC §7.

### 4.1 Paper and ink

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | #EDEEEA | #0B1222 | The desk: cool bone by day, navy night after dark. Also theme-color, so it is the iOS status bar. |
| `--surface` | #FAFAF8 | #141C30 | Statement paper: inset groups and cards on `--bg`, quick-add tiles, chips |
| `--surface-raised` | #FFFFFF | #1C2639 | Groups inside sheets, menus, dialogs, tooltips |
| `--surface-sheet` | #F0F1ED | #121A2D | Bottom sheets and the month picker |
| `--surface-2` | ink 6% | bone 8% | Control fill: segmented track, fields, mini chips, pressed keys |
| `--surface-2-strong` | ink 10% | bone 13% | Pressed chips and rows; the switch track when off |
| `--thumb` | #FFFFFF | #2B3650 | Segmented-control thumb |
| `--glass` | rgba(248,248,245,.76) | rgba(26,35,56,.76) | Tab bar (with `--glass-blur`) and glass buttons (no blur) |
| `--glass-solid` | #F6F6F3 | #182136 | Glass without backdrop-filter, or with Increase Contrast |
| `--scrim` | rgba(11,18,34,.30) | rgba(2,5,12,.55) | Behind sheets and dialogs |
| `--ink` | #121C33 | #E9EAE6 | Primary text, figures, pace fill, meters, the today notch |
| `--ink-2` | #566074 | #A2AABA | Secondary text, subtitles, the currency unit, placeholders (passes on fills) |
| `--ink-3` | #616A7C | #8E97A9 | Tertiary text: operators, chevrons, past ticks. Never on a fill. |
| `--ink-inverse` | #F7F6F2 | #0B1222 | Text on an `--ink` fill |
| `--ink-disabled` | #A9AEB8 | #4B5466 | Disabled labels only (exempt from contrast) |
| `--mark` | #7F8798 | #6E788C | Non-text marks of at least 3:1: unpaid rings, past-day columns, ticks ahead |
| `--hairline` | ink 13% | bone 11% | 0.5px separators |
| `--hairline-strong` | ink 24% | bone 22% | Coin rings, chip outlines, chart baselines, the grab handle |
| `--track` | ink 9% | bone 10% | Empty part of the pace bar and meters |
| `--toast-bg` / `--toast-ink` / `--toast-action` | #1B2540 / #F2F2EE / #C9D5F2 | #E6E7E2 / #101A31 / #26437F | The toast is a navy pill by day and a bone pill by night |

### 4.2 Brass

| Token | Light | Dark | Role |
|---|---|---|---|
| `--brass` | #A08245 | #CFB57C | The double rule under a bottom line (Home ledger, Fixed total, the Wallet's closing balance in the passbook and on the Home card), the seal (closed statements, passbook month closings, reached goals) |
| `--brass-soft` | brass 14% | brass 16% | Reserved: the seal's inner field if it is ever filled |

Brass is a mark (3.1:1 on `--bg`, 3.5:1 on `--surface`, 8.5:1 dark). It is never used for text,
icons, buttons, charts, meters or decoration. In the Wallet it sits on `--surface` only. The
Coffee & snacks yellow (`--cat-yellow`) is deliberately lighter and more saturated (OKLCH L 0.76,
C 0.15 against brass's 0.62 and 0.09), so it reads as a colour, never as metal (ΔE 15).

### 4.3 Accents: "act here"

The accent fills the add button, primary buttons, the selected chip and segment, switches that are
on, and the month picker's selection. As tinted text (`--accent-ink`) it colours links, plain
buttons and the active tab. It is never used for status, figures, charts or the pace bar.

Each key sets four -l/-d pairs on `:root[data-accent="<key>"]`, and the theme blocks resolve them.
In dark mode the fills are pale and carry deep text, so every accent keeps the "bone button on navy
night" look. Navy's dark fill is the bone itself.

| Key | Name | Light fill / on / ink | Dark fill / on / ink | Swatch light / dark |
|---|---|---|---|---|
| `navy` (default) | Navy | #1D3160 / #F7F6F2 / #26437F | #E6E7E2 / #101A31 / #B4C3E6 | #1D3160 / #B4C3E6 |
| `royal` | Royal blue | #2747B3 / #FFFFFF / #2747B3 | #C5D2FB / #13245F / #A9BBF5 | #2747B3 / #A9BBF5 |
| `teal` | Teal | #0D5C63 / #F2F8F7 / #0D5C63 | #BFE2DE / #06393D / #8ECFC8 | #0D5C63 / #8ECFC8 |
| `bottle` | Bottle green | #1E5136 / #F3F7F2 / #1E5136 | #C6E0CD / #0D2E1C / #94CCA6 | #1E5136 / #94CCA6 |
| `burgundy` | Burgundy | #74233A / #FBF3F4 / #74233A | #F1CAD2 / #4A1323 / #EAA4B3 | #74233A / #EAA4B3 |
| `plum` | Plum | #552D6E / #F8F3FA / #552D6E | #DECEEC / #2F1746 / #C7B0E2 | #552D6E / #C7B0E2 |
| `cognac` | Cognac | #7C4321 / #FBF5F0 / #7C4321 | #EED3BF / #45240F / #E2B190 | #7C4321 / #E2B190 |
| `graphite` | Graphite | #33383F / #F6F6F4 / #33383F | #DCDDDA / #1E2228 / #C6C9CD | #33383F / #C6C9CD |

- `--accent-soft` is the accent ink at 8% (light) or 12% (dark). It is used for selected rows and
  the info banner.
- `--accent-<key>` is the picker swatch for every key, whatever the chosen accent. In dark mode the
  swatch is the accent ink tone. The pale fills read as pastels on navy.
- The coordinator renames `AccentKey` to `'navy' | 'royal' | 'teal' | 'bottle' | 'burgundy' |
  'plum' | 'cognac' | 'graphite'`, with names as above and the default `navy`. SPEC §5.11 says
  "royal" today.
- Every accent reaches 4.5:1 as a fill (with `--on-accent`) and as tinted text on every surface,
  fill and soft background, in both themes (section 13).

### 4.4 Status

| Token | Light | Dark | Role |
|---|---|---|---|
| `--good` / `--good-ink` | #2E7D52 / #276B47 | #6CC08F / #8CCFA8 | Success toasts, "Protected from automatic cleanup" |
| `--warning` | #A35F00 | #E3A740 | Warning icons (triangle) |
| `--warning-mark` | #A35F00 | #D99A30 | The ahead part of the pace bar, a meter near its limit |
| `--warning-ink` / `--warning-soft` | #8A4F00 / #F4E9D6 | #EDBB64 / #2E2615 | Warning text; banner background |
| `--critical` | #B3261E | #F2867B | Over-budget marks: pace bar, overflow nubs, double rule, octagon icon |
| `--critical-ink` / `--critical-soft` | #A8231C / #F6E3E0 | #F59A90 / #34191C | Over-budget figures and labels, destructive labels; banner background |

- Status always comes with an icon and words. Shape encodes severity too: a triangle
  (`warning` fill) for warnings and an octagon (`warning-octagon` fill) for over budget.
- "On track" is not a status colour. It is written in `--ink-2` with a `check-circle` icon.
- Red is never decorative, and green is used only for success.

### 4.5 Category inks

Ten slots in the fixed order of `CATEGORY_COLORS`. They are tuned as a box of statement inks: deep,
slightly muted, distinct from brass and from the status red. They are marks only: stacked-bar
segments, legend dots, chart columns, and the swatches in the category sheet. They are never text,
never a badge tint, and never the colour of a row.

| Slot | Light | Dark | Default categories |
|---|---|---|---|
| `blue` | #2F5FA9 | #547ECD | Rent, Health |
| `orange` | #CC6A29 | #D3773E | Eating |
| `aqua` | #269D93 | #39A89C | Transport |
| `yellow` | #DBAA16 | #B29025 | Coffee & snacks |
| `magenta` | #B44280 | #B55294 | Shopping |
| `green` | #1A6B42 | #2A7645 | Groceries |
| `violet` | #7E5EB9 | #9278C8 | Subscriptions |
| `red` | #8C2A3F | #B04455 | Going out (a wine red, ΔE 8.9 from critical in light) |
| `slate` | #5087C0 | #408FBA | Phone & internet, Other |
| `brown` | #996128 | #955B1E | Insurance |
| `--cat-other` | #7D8494 | #727C8F | The folded "{n} more" segment (neutral) |

Validation with the dataviz `validate_palette.js`, slots in this order, chart surface `--surface`:

| Check | Light (#FAFAF8) | Dark (#141C30) |
|---|---|---|
| Lightness band | PASS (all in 0.43–0.77) | PASS (all in 0.48–0.67) |
| Chroma floor | PASS (all ≥ 0.10) | PASS |
| CVD separation, adjacent | PASS, worst green↔magenta ΔE 10.3 (deutan) | PASS, worst green↔magenta ΔE 11.2 |
| Normal-vision floor | PASS, worst red↔violet ΔE 20.0 | PASS, worst yellow↔aqua ΔE 16.7 |
| Contrast vs surface | WARN: yellow 2.06:1 | PASS, all ≥ 3:1 |

- **Stacked bars sort by amount, so any two categories can touch.** The default bar (Groceries,
  Eating, Going out, Coffee, Shopping, Transport) passes the normal-vision floor in both modes. Its
  weakest CVD pair, Shopping↔Transport, measures 6.8 (light) and 7.9 (dark), which is in the floor
  band. So every categorical chart carries mandatory relief:
  - 2px surface gaps between segments.
  - A legend in segment order, with dot, name and amount.
  - Values in text.
  - A visually hidden table.
- **Light yellow sits below 3:1.** The legend and the table are its relief, so a yellow mark is
  never shown without its label.
- **Category marks sit only on `--surface`**, never on `--bg`: on bone, light aqua drops to 2.85:1.

### 4.6 Chart tokens

| Token | Resolves to | Use |
|---|---|---|
| `--chart-grid` | `--hairline` | Gridlines (solid, never dashed) |
| `--chart-axis` | `--hairline-strong` | Baselines |
| `--chart-ref` | `--ink-2` | Reference lines: the allowance, the daily budget, income |
| `--chart-col` | `--mark` | Past-day columns (≥ 3:1) |
| `--chart-col-now` | `--ink` | Today's column, a selected column |
| `--chart-fixed` / `--chart-daily` | `--mark` / `--ink` | The trend chart's two series |

### 4.7 Where colour may appear

- On Home the only colours are ink, brass (the double rules of the ledger and the Wallet card)
  and the category inks in "Where it went". Warning and critical appear only when something is
  wrong.
- Figures are `--ink`. Paid fixed costs, expenses paid from the wallet, running balances and
  secondary figures are `--ink-2`. Money never takes a category or accent colour. The only
  exceptions are over budget and a wallet below zero: the figure and the result use
  `--critical-ink`.
- Selection uses the accent: the selected chip, the month picker's selected month, switches that
  are on. The segmented-control thumb stays neutral (`--thumb`).

## 5. Type

### 5.1 Families and loading

| Token | Stack | Use |
|---|---|---|
| `--font-ui` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Every word and control |
| `--font-figures` | `"Source Serif 4 Variable", "Source Serif 4", ui-serif, "New York", Georgia, serif` | Money figures and the month name |

- **SF Pro** needs nothing installed. Never put `system-ui` first: in WebKit on Windows it resolves
  to a serif. `@fontsource-variable/inter` is only the mockup stand-in used by the reference. The
  app must not import it.
- **Source Serif 4** (SIL OFL) is bundled. Install `@fontsource-variable/source-serif-4` (5.3.x)
  and use its **optical-size files** (`opsz.css`, axes wght 200–900 and opsz 8–60). Do not use
  `index.css` or `wght.css`: they have no optical sizes. To keep the service-worker precache small,
  do not import all of `opsz.css` (it has seven subsets). Declare only Latin and Latin Extended in
  `src/styles/global.css`:

```css
@font-face {
  font-family: 'Source Serif 4 Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 200 900;
  src: url('@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2') format('woff2-variations');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Source Serif 4 Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 200 900;
  src: url('@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-opsz-normal.woff2') format('woff2-variations');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
```

  The files are 122KB (Latin) and 101KB (Latin Extended, fetched only for symbols such as zł, Kč
  or ₺). Leave `font-optical-sizing: auto` (the default). Safari then sets the optical size to the
  font size in CSS pixels, so the 76px hero gets the high-contrast Display cut (opsz 60) and 18px
  rows get the sturdy Text cut. That automatic switch is the whole point of the opsz files.
- **Base rules** for `src/styles/global.css`:

```css
html { font: -apple-system-body; }   /* 17px at the default size; Dynamic Type on iOS */
body { font: var(--text-body); color: var(--ink); background: var(--bg); -webkit-font-smoothing: antialiased; }
```

### 5.2 Which text is serif

**A figure that stands alone in its own cell is serif. Everything else is SF Pro.**

| Serif (`--font-figures`) | SF Pro (`--font-ui`) |
|---|---|
| The hero figure and its unit; the add-sheet amount and its unit | Every label, title, button, chip, tab and section header |
| Ledger figures and operators (`+ − =`); the result | Sentences, even when they contain money ("About 17,33 € a day…", "Spent 336,40 € of 571,12 €", "Leaves 4,84 € for today", "234,72 € left") |
| Amounts in list rows, legends, limits, totals, day totals, section metas ("336,40 €"), quick-add amounts, form values that are money ("13,99 €") | Day headers ("Today", "Fri 16 Oct"), counts ("12 entries", "4 of 7 paid"), dates, percentages ("35 %") |
| Wallet figures: the hero balance, the Home card balance, goal amounts, passbook amounts and running balances | Wallet words: passbook dates and entries, goal states ("568,78 € to go", "of 1.200,00 €"), "Wallet after: 82,22 €" |
| The month name in the month switcher title ("October"), including its compact form | Screen titles that are not a month ("You", "Coffee & snacks", "Wallet" in the compact header), the greeting, keypad digits, PIN digits, the monogram initial |

### 5.3 Scale

Font tokens are shorthands, used as `font: var(--text-body)`. Sizes are rem on the 17px root, so
iOS Text Size scales them. Chrome that cannot grow is capped with `min()`.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `--text-hero` | 76 / 76, `min(4.4706rem, 76px)` | 400 serif | Left to spend, the Wallet balance (proportional figures, tracking −0.012em) |
| `--text-hero-unit` | 38 | 400 serif | Its currency unit, `--ink-2`, 0.16em gap, on the baseline |
| `--text-amount` / `--text-amount-unit` | 64 / 32 | 400 serif | The amount being entered |
| `--text-month` | 34 / 40, capped at 44 | 500 serif | The month switcher title (tracking −0.005em) |
| `--text-month-compact` | 17 / 22 | 600 serif | The month in the compact header |
| `--text-figure-lg` | 28 / 32 | 400 serif | Category detail total, the Home Wallet card balance |
| `--text-figure` | 18 / 22 | 400 serif | Amounts in rows, goals and the ledger (18px serif matches 17px SF cap height) |
| `--text-figure-strong` | 18 / 22 | 600 serif | The ledger result, totals |
| `--text-figure-sm` | 16 / 20 | 400 serif | Section metas, day totals, quick-add amounts, passbook amounts and balances (the closing balance at 600) |
| `--text-figure-caption` | 13 / 18 | 400 serif | Values in chart tooltips |
| `--text-large-title` | 34 / 41 | 700 | "You", onboarding titles |
| `--text-title1` | 28 / 34 | 700 | Welcome title, category detail title |
| `--text-title2` | 22 / 28 | 600 | Dialog titles |
| `--text-title3` | 20 / 25 | 600 | Section titles ("This month", "Where it went"), lock title |
| `--text-headline` | 17 / 22 | 600 | Day headers, "Total", empty-state titles, button labels |
| `--text-body` | 17 / 22 | 400 | Row titles, ledger labels, sentences |
| `--text-callout` | 16 / 21 | 400 | Reserved |
| `--text-subhead` | 15 / 20 | 400 (500, 600) | Subtitles, labels, chips (500), links (600), the eyebrow (500) |
| `--text-footnote` | 13 / 18 | 400 (600) | Pace caption, limit status, group titles (600), footers |
| `--text-caption` | 12 / 16 | 400 | Chart axis labels |
| `--text-caption2` | 11 / 13 | 500 | Rare small labels |
| `--text-tab` | 11, `min(0.6471rem, 13px)` | 500 (600 active) | Tab labels |
| `--text-keypad` | 28, `min(1.6471rem, 34px)` | 400 | Amount keypad digits (tabular) |
| `--text-sheet-title` | 17, `min(1rem, 22px)` | 600 | Sheet titles |
| `--text-input` | `max(16px, 1rem)` | 400 | Every input: below 16px iOS zooms |

Never add letter-spacing to SF Pro text. Only the hero (−0.012em) and the month title (−0.005em)
are tracked.

### 5.4 Figures

- Source Serif 4's **default figures are tabular lining**, which suits columns. The hero and the
  add-sheet amount must set `font-variant-numeric: proportional-nums`. Everything in a column keeps
  the default and also sets `tabular-nums` for clarity.
- Format money only with `Intl.NumberFormat` through `src/domain/money.ts`. Use the locale's
  currency position: "234,72 €" in de-DE, "€234.72" in en-IE.
- The big figures render the number and the unit as separate spans. Use `formatToParts` to split
  the unit from the number.
- The ledger needs a **format without the symbol**: the addends are bare figures. The result's
  symbol hangs in a 20px margin column after the figure, or before it for prefix locales. The
  implementers add this format option.
- Negative money uses a **true minus** (U+2212): "−41,28 €". Never a hyphen.
- **BigAmount** starts at `--text-hero` and shrinks 1px at a time while the figure overflows its
  width, never below 34px. If it still does not fit, the cents are dropped (SPEC §5.8). Measure the
  available width, not the screen: the hero's content box is 353pt on an iPhone 15.
- **Masked amounts** render "•••" in the same style, in `--ink-3`, without a unit.

### 5.5 Dynamic Type

- Everything that is content scales. Tab labels, keypad, sheet titles, the hero, the amount and
  the month title are capped.
- Rows, ledger lines and legends are size containers. Below 14.4em (accessibility sizes only:
  14.4em sits between iOS's largest standard size and AX1 on a 375pt iPhone, so the default size
  never trips it):
  - The amount moves under the title.
  - The paid check stays on the first line.
  - Titles wrap to at most two lines.
  - Amounts never wrap or truncate.

## 6. Space, size and radii

**Space.** On a 4pt grid:

| Token | Value |
|---|---|
| `--space-0-5` | 2 |
| `--space-1` | 4 |
| `--space-2` | 8 |
| `--space-3` | 12 |
| `--space-4` | 16 |
| `--space-5` | 20 |
| `--space-6` | 24 |
| `--space-7` | 32 |
| `--space-8` | 40 |

**Layout:**

- `--gutter` 20: page text, section titles and the outer edge of inset groups.
- `--group-padding` 16: the inside of groups, so content sits at 36.
- `--section-gap` 36 between Home sections. Group titles in forms sit 26 above their group.

**Sizes:**

- `--touch-min` 44 in both directions. Smaller visuals extend their hit area with a transparent
  pseudo-element: chips 36, the paid ring 26, swatches 30, the segmented control 36, the back
  pill 34.
- Rows: `--row-min` 52 (one line), `--row-2` 62 (two lines), coin column 34, column gap 12.
- Bars: `--nav-height` 44, `--title-height` 52, `--tabbar-height` 62, `--tabbar-inset` 20,
  `--add-button-size` 50.
- `--tabbar-offset` is `max(8px, env(safe-area-inset-bottom) − 13px)`, which is 21px on an
  iPhone 15.
- `--content-bottom` is the tab bar's offset plus its height plus 28.
- `--sheet-inset` 8, `--sheet-max-width` 560.

**Radii.** Concentric with the display (55pt) and with their container:

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 3 | The 6px pace bar (meters use 2) |
| `--radius-data` | 4 | Data ends of columns and stacked bars |
| `--radius-sm` | 8 | Tooltips, small tags |
| `--radius-md` | 14 | Quick-add tiles, pressed keys |
| `--radius-lg` | 22 | Inset groups and cards, banners |
| `--radius-dialog` | 28 | The `confirmDialog` alert card (section 9.17) |
| `--radius-sheet` | 40 | The floating sheet, iOS 26 style (the 55pt display corner minus the 8px inset is 47; 40 keeps content-sized sheets from looking pinched) |
| `--radius-pill` | 999 | Chips, buttons, fields, segmented control, steppers, tab bar, toasts |

## 7. Materials, elevation and the top edge

- **Paper.** Inset groups are flat `--surface` on `--bg`, with no shadows. Separation comes from
  0.5px `--hairline`s inside groups and from the tone step between bone and paper.
- **Glass** (iOS 26 Liquid Glass, approximated) is used only on the floating tab bar and on the
  glass buttons, steppers and capsules in headers and sheet headers. It is `background:
  var(--glass)`, plus:
  - an inner 0.5px `--glass-edge`;
  - a 1px `--glass-highlight` top light;
  - `--shadow-control` (buttons) or `--shadow-float` (tab bar).

  Only the **tab bar** adds `backdrop-filter: var(--glass-blur)` (with
  `-webkit-backdrop-filter`), on the bar element itself. Content scrolls under it. Glass buttons
  always sit on opaque paper (the header, the compact header or a sheet), so a blur would show
  nothing and is left out. Without support, or with Increase Contrast, glass becomes
  `--glass-solid`.
- **Blurred layers.** One blurred layer is on screen: the tab bar. That is within SPEC §6's limit
  of two. Sheets, dialogs, toasts, the scrim, the lock screen and the privacy cover are opaque.
  Sheets use `--surface-sheet` and `--shadow-sheet` over `--scrim`.
- **Top edge.** The status-bar style is `default`. iOS draws its own opaque status bar tinted with
  `theme-color` (= `--bg`), and the web view starts below it, so content never scrolls under 9:41.
  - The **compact header** continues that bar. It is opaque `--bg` (not glass), so the status bar
    and the header read as one band.
  - Below the header is an 18px **scroll-edge fade** from `--bg` to transparent, not a hairline.
  - `theme-color` follows the active theme (SPEC §7).
- **Bottom edge.** A 128px fade from transparent to `--bg` sits behind the tab bar, so text never
  collides with the glass.
- **Light.** `--lens` is the pill behind the active tab. `--press` is the overlay on pressed rows
  and keys.

## 8. Iconography

Phosphor (MIT; credit it in About). Use generated path data only (`scripts/build-icons.mjs`),
drawn with `fill: currentColor` at whole-pixel sizes.

| Use | Weight | Size | Colour |
|---|---|---|---|
| Category glyphs in coins, chips, quick adds, the picker | light | 19 (md coin), 15 (sm), 28 (lg), 17 (chips), 24 (tiles), 26 (picker) | `--ink` |
| Tab bar | regular; fill when active | 25 | `--ink-2`; active `--accent-ink` |
| Glass buttons | regular | 21 | `--ink` |
| Chevrons, steppers | bold | 17 (buttons), 14 (rows), 16 (title caret) | `--ink` / `--ink-3` |
| Status | fill (`warning`, `warning-octagon`); regular (`check-circle`) | 16 (hero), 14 (limits) | status colour / `--ink-2` |
| Paid check, quick-add + | bold | 14 / 9 | `--ink-2` / `--on-accent` |
| Keypad backspace, Face ID | light | 26 / 30 | `--ink` |
| Feature lines | light | 28 | `--ink` |
| Wallet glyph in a list subtitle ("Paid from wallet") | regular | 15 | `--ink-2` |
| Goal order buttons | regular (`arrow-up`, `arrow-down`) | 17 | `--ink-3` |
| "Add a goal" | regular (`plus-circle`) | 22 | `--accent-ink` |

**UI icons** (the names in `src/ui/icons/manifest.ts` and their sources):

| Name | Phosphor | Weights |
|---|---|---|
| `home` | `house-simple` | regular, fill |
| `daily` | `receipt` | regular, fill (light for the Daily empty state) |
| `fixed` | `calendar-check` | regular, fill (light for onboarding) |
| `wallet` | `wallet` | regular, fill (the tab); regular 15 in list subtitles; light for the Wallet empty state |
| `plus` | `plus` | bold |
| `plus-circle` | `plus-circle` | regular |
| `chevron-left`, `chevron-right`, `chevron-down`, `chevron-up` | `caret-left`, `caret-right`, `caret-down`, `caret-up` | bold |
| `chevron-updown` | `caret-up-down` | regular |
| `check` | `check` | bold |
| `on-track` | `check-circle` | regular |
| `warning` | `warning` | fill |
| `critical` | `warning-octagon` | fill |
| `close` | `x` | bold |
| `clear` | `x-circle` | fill |
| `search` | `magnifying-glass` | regular |
| `eye`, `eye-off` | `eye`, `eye-slash` | regular |
| `lock` | `lock-simple` | light |
| `face-id` | `scan-smiley` | light |
| `tap` | `hand-tap` | light |
| `backspace` | `backspace` | light |
| `calendar` | `calendar-blank` | regular |
| `reload` | `arrow-clockwise` | regular |
| `undo` | `arrow-counter-clockwise` | regular |
| `backup` | `cloud-arrow-up` | regular |
| `share` | `export` | regular |
| `download`, `upload` | `download-simple`, `upload-simple` | regular |
| `trash` | `trash` | regular |
| `edit` | `pencil-simple-line` | regular |
| `archive` | `archive` | regular |
| `info` | `info` | regular |
| `more` | `dots-three` | bold |
| `arrow-up`, `arrow-down` | `arrow-up`, `arrow-down` | regular |
| `emoji` | `smiley` | regular |
| `people` | `users` | regular (15, the split line in rows; EXTRAS.md §5) |
| `person` | `user` | light (the medallion without a name or emoji, section 9.9) |
| `owed` | `hand-coins` | light (28, the "Owed to you" empty state) |
| `logo` | `docs/design/mark.svg` | the app mark, drawn for this app (lock screen, loading screen, privacy cover, About) |

`search` also has a light weight, and `repeat` and `sparkle` stay generated for screens that may
use them. The You tab is gone (settings open from the Home monogram), so `user-circle` is no longer
needed.

**`CATEGORY_ICONS`** has 64 keys, in picker order and grouped. Every key exists in
`@phosphor-icons/core/assets/regular`, `light` and `fill` (checked). The list is the one already in
`src/domain/catalog.ts`, with names and search keywords there.

| Group | Keys |
|---|---|
| Food & drink | `fork-knife`, `bowl-food`, `shopping-cart`, `bread`, `coffee`, `pizza`, `beer-stein`, `martini` |
| Home & bills | `house`, `repeat`, `lightning`, `flame`, `wifi-high`, `washing-machine`, `couch` |
| Transport | `train`, `bus`, `bicycle`, `scooter`, `car`, `gas-pump`, `taxi` |
| Shopping | `shopping-bag`, `t-shirt`, `sneaker`, `gift` |
| Health & care | `pill`, `first-aid-kit`, `tooth`, `hand-soap`, `scissors`, `barbell` |
| Fun | `film-slate`, `music-notes`, `game-controller`, `ticket`, `confetti`, `soccer-ball` |
| Money | `piggy-bank`, `bank`, `credit-card`, `coins`, `chart-line-up`, `shield-check` |
| Tech | `device-mobile`, `laptop`, `television`, `headphones` |
| Travel | `airplane`, `suitcase-rolling`, `bed`, `map-trifold` |
| Education | `graduation-cap`, `book-open`, `chalkboard-teacher` |
| Family & pets | `baby`, `users-three`, `heart`, `paw-print` |
| Other | `package`, `briefcase`, `hand-heart`, `question` (Uncategorized), `circle` (fallback) |

## 9. Components

Measurements are CSS px at the default text size. The reference shows each one.

### 9.1 Tab bar and add button

- **Bar.** A glass capsule with left and right `--tabbar-inset` (20), bottom `--tabbar-offset`,
  height 62, padding 4 and `--shadow-float`. It also respects the left and right safe-area insets.
  The grid is `1fr 1fr 62px 1fr 1fr`: Home, Daily, add, Fixed, Wallet (SPEC §3).
- **Tab.** A 54px pill (radius 27) with a 25px icon (regular, fill when active) and a
  `--text-tab` label, 2px apart. Inactive: `--ink-2`. Active: `--accent-ink`, label 600, on a
  `--lens` pill.
- **Wallet tab.** Phosphor `wallet` (regular, fill when active), label "Wallet", test id
  `tab-wallet`. The Home Wallet card and the statement line also lead here.
- **Backup dot.** There is no You tab: settings open from the monogram and greeting on Home
  (route `you`, pushed on the Home stack, so the Home tab stays lit). When a backup is due, the
  monogram shows an 8px `--critical` dot with a 2px `--bg` ring at its top right. The monogram and
  greeting are one button named "Settings", or "Settings, backup due".
- **Add button.** A 50px `--accent` circle with `plus` bold 24 in `--on-accent` and a shadow of
  0 3px 10px (ink 22%). Its accessible name is "Add expense".
  - Press: scale 0.94 over `--dur-press`.
  - Long-press (500ms) opens the quick adds as a native-style menu: glyph, label and amount. A
    choice adds the expense like the Daily strip, with the same toast and Undo.

### 9.2 Screen header

- **Nav row** (44 tall, padding 0 16 0 20).
  - **Leading eyebrow:** Home shows the monogram medallion (32) and "Hi, Alex" (one button that
    opens settings); Daily shows "Daily spending"; Fixed shows "Fixed costs and income". All are
    Subhead 500 `--ink-2`, 10px from the medallion. The Wallet has no eyebrow: it has no month
    title for an eyebrow to explain, and its hero label names it (section 9.26).
  - **Trailing glass controls**, 8 apart and 16 from the edge: the eye button (only when
    `hideAmounts` is on), search (Daily), add (Fixed), then the month stepper. The Wallet is not
    tied to a month, so it has no stepper.
  - When the row runs short (375pt with the eye button on, or large text), the leading side gives
    way first: the eyebrow truncates with an ellipsis, and the trailing controls never shrink.
  - An eyebrow that repeats the screen's heading (Fixed's "Fixed costs and income", which the
    Screen's visually hidden `h1` already says) is `aria-hidden`; Home's greeting is too, inside
    the "Settings" button.
- **Glass button.** A 44px circle with a 21px regular glyph in `--ink`. Glass capsules are 44 tall
  with padding 0 16 and a Body label ("Cancel", "Edit", "‹ Daily"). The tinted variant uses
  `--accent-ink` at 600 ("Save").
- **Large-title row** (52 tall). It holds the month switcher title. A past or future month adds
  the "Back to this month" pill at the trailing end:
  - glass, 34 tall with a 44 hit area, padding 0 14;
  - Subhead 600 in `--accent-ink`.
- **Compact header.** It appears when the large title has scrolled under the nav row, fading in
  over `--dur-fade`. It is opaque `--bg`, 44 tall, with an 18px scroll-edge fade below and no
  hairline. The centred title is the month in `--text-month-compact` (serif). The subtitle is
  Footnote `--ink-2`:

  | Screen | Subtitle |
  |---|---|
  | Home | The figure with its state: "234,72 € left", "58,82 € left over", "571,12 € planned", "41,28 € over budget", "1.115,28 € spent", "Short by 158,88 €". Never the hero's label word for word: the compact header stays in the DOM, and the label must stay the only element with its exact text |
  | Daily | "336,40 € spent" |
  | Fixed | Costs: "4 of 7 paid", left out when nothing is due. Income: "1.450,00 € this month" |
  | Wallet | The title is "Wallet" in Headline (SF Pro: it is not a month). Subtitle "631,22 €", or "Short by 146,50 €" |

  The trailing controls stay, except Daily's search button: it belongs to the expanded header and
  scrolls away with it, as iOS search fields do. With search and the stepper (140) the centred
  subtitle would run into the controls. The greeting text hides, but the medallion stays.
- **Pushed screens** (category detail, You and its subpages) show a glass capsule
  "‹ {previous title}" leading ("‹ Home" on You), with trailing actions as glass capsules. The
  title is `--text-title1` (or a large title for You and its subpages).
- **Banner slot.** Every Screen has an empty slot after the nav and title rows, inside its scroll
  container, that the shell fills with the app's banners (section 9.19). Empty, it takes no space.

### 9.3 Month switcher and month picker

- **Title variant** (Home, Daily, Fixed): the month name in `--text-month` (serif) followed by a
  16px bold `caret-down` in `--ink-3`, 6px apart, nudged 6px down to the x-height. It is one
  button (44 tall, test id `month-label`) that opens the month picker.
  - The year appears when the month is not in the current year: "October 2025".
  - A custom start day adds the range under the title, in Subhead `--ink-2`: "25 Oct – 24 Nov".
- **Stepper.** A glass capsule of 88×44: two 44×44 buttons with bold 17 `caret-left` /
  `caret-right` in `--ink` and no divider. Test ids are `month-prev` / `month-next`. Disabled
  buttons use `--ink-disabled`. Accessible names: "Previous month, September", "Next month,
  November".
- **Compact variant** (category detail): a glass capsule "‹ October ›", 44 + label + 44, label
  Subhead 600.
- **Month picker** (sheet):
  - A year row of 48: 44px chevron buttons in `--accent-ink` and the year in Headline.
  - A 4×3 grid of 44px pills with month names (Jan … Dec) in Body, 6px gaps.
  - The current month has a 1.5px `--ink` ring. The selected month is `--accent` with
    `--on-accent`. Months outside `firstPeriod … current + 12` use `--ink-disabled` and are
    inert.

### 9.4 Hero

Order: label row, figure, sentence, today line, optional ahead line, pace bar, pace caption.

- **Label row** (min 22, 10px under the title row): the label in Subhead 500 `--ink-2` at the
  leading end, and the status at the trailing end in Subhead with a 16px icon, 5px apart.
- **Figure**:
  - 6px below the label, `margin-left: −3px` (the optical side bearing of the first digit);
  - `--text-hero`, `--ink`, proportional figures;
  - the unit in `--text-hero-unit` `--ink-2` on the baseline.
- **Sentence** in Body `--ink`, 10px below. **Today line** in Subhead `--ink-2`, 2px below.
- **Ahead line** in Subhead 500 `--warning-ink`, with a 16px `warning` in `--warning`.

States follow SPEC §3.1 (copy from the spec):

| State | Label row | Figure | Below the figure | Pace bar |
|---|---|---|---|---|
| On track | "Left to spend" + `check-circle` "On track" (`--ink-2`) | `--ink` | "About 17,33 € a day for the next 14 days", "Today: 9,33 € left" | ink fill to the spent ratio |
| Ahead of pace | "Left to spend" + `warning` "Spending fast" (`--warning-ink`) | `--ink` | the two lines, then `warning` "68,19 € more than planned by today" | ink to the notch, `--warning-mark` beyond it |
| Today over | as On track | `--ink` | "Today: 4,96 € over" in `--warning-ink` with `warning` | as On track |
| Last day | as On track | `--ink` | "Last day of this month." + the Today line | as On track |
| Over budget | `warning-octagon` "Over budget by" (600 `--critical-ink`, icon `--critical`) | the amount over, unsigned, `--critical-ink` | "Spent 612,40 € of 571,12 € for daily life." | full `--critical` bar, 2px gap, 11px nub |
| Fixed costs exceed income | as Over budget | `--critical-ink` | SPEC sentence + "Review fixed costs" (secondary md button, 14 below) | none |
| No income | "Spent this month" | `--ink` | "Add your income" (secondary md button) | none |
| Past, left over | "Left over" + the Closed seal (3.2) | `--ink` | "You spent 512,30 € on daily life." | no notch, all ticks past |
| Past, over | "Over budget by" + the Closed seal | `--critical-ink` | as above | full critical bar with nub, no notch |
| Future, planned | "Planned" | `--ink` | "19,03 € a day across 30 days" | none |
| Future, short | `warning-octagon` "Short by" | `--critical-ink` | "Fixed costs and savings are more than the income planned." | none |

- The hero figure is unsigned, because the label says "by". The ledger result shows the signed
  arithmetic ("−41,28 €").
- **Wallet line** (current month over budget, both rows, once the wallet counts this month), in
  Subhead `--ink-2`, 2 below the sentence, balanced over two lines (`text-wrap: balance`). It says
  what the overspend does to the wallet, from the month's result (savings + left, SPEC §3.1):
  "Your savings cover it. October still adds 58,72 € to your wallet." (result above 0), "Your
  savings cover it." (exactly 0), "Your savings cover part of it. 12,00 € comes out of your wallet
  when October closes." (below 0 with savings), or "That comes out of your wallet when October
  closes." (no savings). It joins the hero's sentence for VoiceOver. A closed month says where its
  result went in the statement line instead (section 9.6).
- VoiceOver reads the hero as one sentence: "Left to spend, 234,72 €. On track. About 17,33 € a
  day for the next 14 days. Today, 9,33 € left."
- Per-day figures are floored, never rounded up (SPEC §4.5): the sample's 17,33 € a day.

### 9.5 Pace bar: the month as a ruler

- **Track.** An SVG 26 tall across the content width (353 on iPhone 15). The 6px track
  (`--track`, radius 3) sits at y 6.
- **Fill** from the left, radius 3. It is `--ink`, the money spent of the money for daily life.
- **Day ticks** start 4px below the bar (y 16). There is one per day boundary, 1 … days − 1, and
  the end of the track is the last day. Each is 1px wide and 4px tall, every fifth 8px.
  - Days before today: `--ink-3`.
  - Today and days ahead: `--mark` (paler, still ≥ 3:1).
- **Today notch.** A 2×16 `--ink` bar (y 1–17, radius 1) at `dayIndex / days`. It has no
  knockout, so a fill even 1px past the notch shows.
- **Ahead.** `--ink` up to 1px before the notch, then `--warning-mark` from 1px after it to the
  spent ratio, with a rounded end.
- **Over.** `--critical` to `100% − 13px`, a 2px gap, and an 11px `--critical` nub at the track
  end (radius 3). The notch and ticks stay.
- **Past.** No notch; all ticks use the past colour.
- **Caption** 6px below, Footnote `--ink-2`, tabular: "Spent 336,40 € of 571,12 €" at the
  leading end and "Day 18 of 31" at the trailing end ("30 days" in past months).
- **Accessibility.** `role="img"` with a sentence: "Spent 59 percent of the money for daily life
  on day 18 of 31". Values are masked when amounts are hidden.
- **Motion.** After an entry the fill grows in `--dur-grow` with `--ease-out`. With Reduce Motion
  it does not animate.

### 9.6 The ledger ("This month")

- Section title in `--text-title3`. The group has padding 6 16 14.
- Rows are a grid `22px 1fr auto 20px` (operator, label, figure, unit margin), at least 44 tall.
  Each row is a button that opens its target (SPEC §3.1) and shows the `--press` overlay when
  pressed.
- **Operators** `+ − − −` in the figures font, `--ink-3`, with true minus signs. The result's `=`
  is `--ink`.
- **Separators.** A 0.5px `--hairline` between addends runs from x 22 to the end. The operator
  column stays open, like the margin of ruled paper. There is none above the result.
- **Figures** in `--text-figure`, right-aligned, tabular, with no unit.
- **Result row** (52 tall): "Left" in Body 600, the figure in `--text-figure-strong`, and "€" in
  the margin column in the same style.
  - **Sum rule:** 1px `--ink-3` on the result row's top edge.
  - **Double rule:** 1px, 2px gap, 1px of `--brass`, 9px below the figure box.
  - Both rules span `--colw`, the measured width of the widest figure in the ledger, aligned
    right with the figure column.
- **Over budget.** The result figure and unit use `--critical-ink` with a true minus. The double
  rule uses `--critical`. The label stays `--ink`.
- Savings is hidden when it is 0. The table semantics are `role="table"` with row headers.
- **Statement line** (a past month the wallet counts): the last row of the statement group, under
  the result. "Moved to your wallet: 158,82 €", or "Taken from your wallet: 41,28 €" when the
  month's result (savings + left) was negative. It is a button to the Wallet tab: 44 tall, inset
  16 on both sides, a 0.5px `--hairline` above, Subhead `--ink-2` with the amount in `--ink`, and
  a 14px bold `caret-right` in `--ink-3` at the trailing end. The ledger's bottom padding drops
  from 14 to 8 above it, and the group ends 2 below it.

### 9.7 Sections and inset groups

- Home sections: 36 above (`--section-gap`) and 10 below the title.
  - The title is `--text-title3`.
  - An optional trailing meta in `--text-figure-sm` `--ink-2` (serif, money only: "336,40 €",
    "28,99 €").
  - Or a link in Subhead 600 `--accent-ink` with a 44 hit area ("See all", "Edit").
- Groups: margin 0 20, `--surface`, radius 22, no border, no shadow. Inside sheets they use
  `--surface-raised` with margin 0 16.
- Group titles in forms: Footnote 600 `--ink-2`, sentence case, 26 above and 7 below, indented
  to the content (36). Examples: "This month", "Every month", "Look", "Money".
- Footers: Footnote `--ink-2`, 8 below, indented to 36.

### 9.8 List rows

- **Grid.** `34px 1fr` (coin and main), with `28px` added for a paid check. Column gap 12,
  padding 11 16, min height 62 (two lines) or 52 (one line).
- **Line 1:** the title in Body `--ink` (wraps to two lines at most) and the amount in
  `--text-figure`, sharing the first baseline. The amount never wraps.
- **Line 2:** the subtitle in Subhead `--ink-2`, running the full width beneath the title and
  amount. It never wraps under a narrow column. An optional trailing note ("Today", "Yesterday")
  sits right-aligned under the amount (Recent).
- **Separators:** 0.5px `--hairline` from the text column (x 62) to the trailing edge. A group
  without coins starts them at 16. There is none after the last row.
- **Paid fixed costs** show their amount in `--ink-2`, so what is still due carries the weight.
  Skipped ones are `--ink-2` and struck through. A spread item's share outside its charge month
  ("Set aside 5,00 € this month", no check) is `--ink-2` too: nothing is due that month.
- **Expenses paid from the wallet** keep their coin and title, say "Paid from wallet" with the
  wallet glyph, and show their amount in `--ink-2` (section 9.26).
- **Paid check** (test id `recurring-paid`): a 26px ring with a 44 hit area, centred on line 1,
  in its own 28px column at the trailing end.
  - Unpaid: a 1.5px `--mark` ring.
  - Paid: a 1.25px `--ink-2` ring with a bold 14 `check` in `--ink-2`. It is a light outline,
    never a filled disc.
  - Accessible names are "Mark Netflix as paid" and "Netflix paid". The motion is in section 10.
- **Today divider** (Fixed with a chip selected, current month): a 30px row inside the group. It
  holds "Today" in Footnote 600 `--ink`, then a 1px `--ink` line to the trailing edge, 10px apart.
  Unpaid items above it are overdue at a glance.
- **Category group header** (Fixed, "All"): 22 above and 8 below. A 26px coin, the name in
  Subhead 600 `--ink`, and the subtotal in `--text-figure-sm` `--ink-2`, aligned with the row
  amounts (padding-right 56). Rows under it carry no coins.
- **Total row** (Fixed): on `--bg` under the last group, aligned to the group's columns (grid
  `1fr auto 28px`, padding 18 16 12).
  - "Total" in Headline; the figure in `--text-figure-strong`.
  - A 1px `--ink-3` sum rule 10px above the figure, and the brass double rule 7px below it. Both
    span the figure.
  - It reconciles with "Fixed costs" on Home.
- **Form rows:** min 50 (48 in sheets).
  - Label in Body `--ink`.
  - Value in Body `--ink-2`. User-entered text is `--ink`; money is serif `--text-figure`.
  - Navigation rows end with a 14px bold `caret-right` in `--ink-3`. Pickers end with a 14px
    `caret-up-down`.
  - **Disclosure rows** ("More options", "Not this month", "Settled", "Done", "Name and monogram")
    end with a 14px bold `caret-down` in `--ink-3` that turns up while the rows below are open. The
    row carries `aria-expanded` (and `aria-controls`). An action row that reveals is tinted:
    "More options" in `--accent-ink`.
  - **Action rows** without a chevron: tinted (`--accent-ink`: "Change PIN", "Stop after October",
    "Use the usual amount") or destructive (`--critical-ink`: "Delete").

### 9.9 Coin badges and the monogram

- **Coin** (`CategoryBadge`): a circle with a hairline ring and a light Phosphor glyph in `--ink`.
  It is monochrome, like an engraved coin. The category colour never tints it.

  | Size | Coin | Glyph | Ring |
  |---|---|---|---|
  | `sm` | 26 | 15 | 0.75px `--hairline-strong` |
  | `md` | 34 | 19 | 0.75px `--hairline-strong` |
  | `lg` | 56 | 28 | 1px ring plus an inner 0.75px `--hairline` ring inset 4px: the coin's rim |

  Emoji categories render the emoji at glyph size inside the same ring.
- **Monogram** (`Monogram`): the engraved medallion rim (3.1) around the initial in SF Pro 600 in
  `--ink`. It is 32 with a 15px initial (nav row) or 64 with a 26px initial (You); `sm` is 26. An
  emoji avatar replaces the initial. Without a name or an emoji it holds the light `person` glyph in
  `--ink`: 13 (sm), 16 (md) or 28 (lg).

### 9.10 Chips and sub-tabs

- 36 tall with a 44 hit area, padding 0 14, `--radius-pill`. The chip is `--surface` with a 0.5px
  `--hairline-strong` ring. The label is Subhead 500 `--ink`, with an optional 17px light glyph,
  6px apart.
- Max width 180 with an ellipsis.
- Selected: `--accent` fill, `--on-accent` label and glyph, no ring.
- Rows scroll horizontally with 8 gaps, 20 side padding and a 28px fade mask at the trailing edge.
  The selected chip scrolls into view.
- **Mini chips** (date chips in the add sheet) are 32 tall, padding 0 12, on `--surface-2`.
  Selected: `--accent`.

### 9.11 Segmented control

36 tall with a 44 hit area, 2px padding, a `--surface-2` track and `--radius-pill`. The thumb is
`--thumb` with `--shadow-thumb`. Labels are Subhead 500, centred; the selected one is 600. The
thumb slides in `--dur-fade` with `--ease-standard` (it fades with Reduce Motion).

### 9.12 Buttons

| Variant | Height | Style |
|---|---|---|
| Primary | 54 (md 44) | `--accent` fill, `--on-accent` Headline, capsule, full width in sheets and onboarding |
| Secondary | 54 / 44 | `--surface-2` fill, `--accent-ink` label |
| Plain | min 44 | `--accent-ink` Body, no fill |
| Destructive | min 44 | `--critical-ink` label (plain). For confirmations: `--critical` fill with white text. |
| Glass icon | 44 circle | Glass, 21px regular glyph `--ink` |
| Glass capsule | 44 | Glass, Body label, padding 0 16, in one of three tones: neutral (`--ink` 400: "Cancel", "Edit", "Split"), confirm or tinted (`--accent-ink` 600: "Save", "Add", "Done") and destructive (`--critical-ink` 400: the entry sheet's "Delete") |
| Glass capsule, selected | 44 | `--accent` fill with an `--on-accent` 600 label, no glass, like a selected chip: a disclosure capsule while what it opens is showing (the Split capsule with its panel open) |

- Press: the `--press` overlay and scale 0.97 over `--dur-press`.
- Disabled: 40% opacity for text buttons. A disabled primary uses a `--surface-2` fill with an
  `--ink-disabled` label. A disabled glass capsule keeps its glass and shows its label in
  `--ink-disabled`.
- Focus: a 2px `--focus-ring` outline with a 2px offset.

### 9.13 Toggles

- 51×31, radius 16.
- Off: a `--surface-2-strong` track and a `--switch-knob` knob.
- On: an `--accent` track and an `--on-accent` knob. In dark navy that is a navy knob on a bone
  track.
- The knob is 27 with a soft shadow, inset 2. It moves in `--dur-fade` with `--ease-standard`.
- A toggle always sits in a form row with a visible label. The row is exactly the form-row height
  (50; 48 in sheets, 44 under 700pt of height): the switch adds no padding of its own. A row with a
  description line ("Counts 5,00 € every month instead of 60,00 € once a year") keeps 10 above and
  below its two lines.

### 9.14 Text and amount fields

- **Labelled row** (in a group: Note, Name, From):
  - A 48px label column in Body `--ink-2`, then the input in `--text-input` `--ink`.
  - A trailing clear button while the field is focused and holds text: `x-circle` fill 19 in
    `--ink-3` in a 44 hit area, accessible name "Clear note". At rest the row shows no clear
    button.
  - Max lengths per SPEC.
- **Form row** (`variant="form"`: the label in Body `--ink` at the start, the value right-aligned,
  like a settings value): the clear button as above, while focused and holding text.
- A label that wraps ("Daily spending so far this month" at 375pt) gets 11 above and below, so it
  never touches the group's edges; a one-line row stays 50 tall.
- **Search field** (Daily):
  - A 44px capsule on `--surface-2`, with a leading 17px `magnifying-glass` in `--ink-2`.
  - A placeholder in `--ink-2`, which passes 4.5:1 on fills.
  - The clear button while the field holds text, focused or not, and "Cancel" plain to its right.
- **AmountField**: an inline field in a form row, right-aligned and tabular, in the figures font
  (`--text-figure`, at least 16px). It shows the plain value while focused ("13,99") and the
  formatted value on blur ("13,99 €"), with `inputmode="decimal"`. Errors are Footnote
  `--critical-ink` under the row. Its **cell** form is the bare right-aligned field inside another
  row (the split panel's "Lea owes"): no label column, and the error sits under the row without
  breaking its grid.

### 9.15 Keypads

- **Amount keypad:** 3×4 with no tiles.
  - Keys are 56 tall (48 on screens under 700px tall), with digits in `--text-keypad`.
  - The decimal key shows the locale separator, raised 6px to the optical centre. It is absent
    for currencies with no minor unit.
  - Backspace is light 26.
  - **Hairline grid:** 0.5px `--hairline` verticals either side of the middle column (inset 12 top
    and bottom), and horizontal rules between rows (inset 14 at the outer ends).
  - Press: a `--surface-2` fill with radius 14 for `--dur-press`.
  - Test ids are `keypad-0…9|dec|back`.
- **PIN keypad:** 76px circles with a 0.75px `--hairline-strong` ring (engraved coins), with digits
  in SF Pro Light 34, tabular. Gaps are 14 vertical and 28 horizontal.
  - The bottom-left key is Face ID (`scan-smiley` light 30, bare) when enabled. The bottom-right
    key is backspace (bare).
  - Press: a `--surface-2` fill.

### 9.16 Bottom sheets

- **Floating sheet:**
  - 8px from the sides and bottom (`--sheet-inset`), `--radius-sheet`, `--surface-sheet`,
    `--shadow-sheet`, over `--scrim`.
  - Max width 560, centred. It respects the left and right safe areas.
  - Large sheets start 10px below the top of the web view. Content sheets size to their content.
  - The bottom padding is `max(10px, env(safe-area-inset-bottom) − 8px)`.
- **Grab handle:** 36×5, `--hairline-strong`, 6px from the top.
- **Header** (`SheetHeader`): min 52, grid `1fr auto 1fr`, padding 0 12.
  - A leading glass capsule "Cancel".
  - A centred title in `--text-sheet-title`.
  - A trailing glass capsule action in one of the tones of section 9.12: confirm ("Save", "Add",
    tinted), neutral ("Split") or destructive ("Delete" on the wallet entry sheet, `--critical-ink`
    400). A disclosure action that is open takes the selected look (`--accent` fill, `--on-accent`
    600), and a disabled one keeps its glass with the label in `--ink-disabled`.
- **Transaction sheet**, top to bottom. It fits 375×667 with the keypad and button visible
  (`?screen=add&device=se`, and with "Pay from wallet" on, `add-wallet&device=se`):
  1. Grab handle and header ("Cancel", "New expense").
  2. **Amount** (test id `amount-display`, `aria-live="polite"`), centred, 10 below the header.
     The figure is `--text-amount` with proportional figures. A 2px × 50 `--accent-ink` caret sits
     between the figure and the unit (`--text-amount-unit`, `--ink-2`).
  3. **Consequence line**, 10 below, Subhead, centred. It is one line, 20 tall in every state
     (the 16px icon sits inline, 6 before the text), so the sheet never changes height while
     typing. It is hidden for other dates, other periods, income and an amount of 0, except that
     the wallet cases show for any date.

     | Case | Copy | Style |
     |---|---|---|
     | Fits today | "Leaves **4,84 €** for today" | `--ink-2`, the figure `--ink` |
     | More than today's allowance | `warning` + "2,66 € over today's budget" | `--warning-ink` |
     | More than the month's money left | `warning-octagon` + "41,28 € over this month's budget" | `--critical-ink` |
     | Pay from wallet on | "Wallet after: **82,22 €**" | `--ink-2`, the figure `--ink` |
     | Pay from wallet on, below zero | `warning-octagon` + "Wallet after: short by 67,78 €" | `--critical-ink` |

     One-off income has no consequence line and reserves no slot: its group sits 18 under the
     figure. With a split the slot holds "Your share" above the consequence (EXTRAS §2.2), 22
     taller; under 700pt of height the sheet takes those 22 from its gaps, so it still fits
     375×667 without scrolling.
  4. **Category chips**, 18 below, scrolling, with the selected chip in view.
  5. **Note, Date and wallet group**, 14 below. Rows 48 tall (44 on screens under 700px tall):
     - "Note" + input + clear button. The input is one line; a long note ends in an ellipsis.
       While the note is empty, up to four suggestion mini chips (SPEC §3.4) sit inside this row,
       to the right of the narrowed field, so they add no row. Tapping one fills the note and the
       amount.
     - "Date" + mini chips "Today", "Yesterday" and "Other" (calendar glyph; shows the picked date,
       e.g. "Wed 14 Oct", once chosen). The native date input lies over the third chip.
     - "Pay from wallet" (expenses only, new and edit): the label in Body `--ink` and a switch
       at the trailing end (section 9.26).
     - On screens under 360pt of content width: label 42, chip padding 10, gaps 5.
  6. **Keypad**, 10 below. It is hidden while the note field has focus.
  7. **Primary button** "Add expense" (test id `sheet-save`), 12 below: 54 tall, or 50 on small
     screens. When editing, "Delete" (`sheet-delete`, `--critical-ink`) sits beside "Save
     changes" in the same row: the header's trailing slot belongs to "Split", and a row of its own
     would break the 375×667 budget.

  On 375×667 the sheet then sits exactly 10 below the top of the web view: its height budget is
  spent. Anything the sheet gains later (the suggestion chips of SPEC §3.4, "Split" of §3.16)
  must take the place of something, not add a row.
- **Recurring sheet:** a large sheet. The header reads "Cancel", the item name, and "Save". The
  first group starts 12 under the header. Then come the "This month" group (Paid, Skip this month,
  Different amount this month) and the "Every month" group (Name, Amount, Category, How often).
  For an item that is not monthly, "Charged in" and the Spread toggle form their own group under
  How often (footer "Pick any month it's charged in."), and "Usually paid on" and More options
  (Ends, Note) follow in a third group; a monthly item keeps them in "Every month". The last group
  holds "Stop after October" (tinted) and "Delete" (`--critical-ink`).

### 9.17 Dialogs and action sheets

- **`confirmDialog`:**
  - An opaque centred card, `--surface-raised`, radius 28, width `min(320px, 100% − 48px)`,
    padding 22 20 16, over `--scrim`.
  - The title in Headline, centred; the message in Subhead `--ink-2`, centred, 6 below.
  - Buttons 16 below, side by side, each 48 tall and pill-shaped, 10 apart:
    - Cancel: secondary.
    - Confirm: primary, or a `--critical` fill with white text when destructive.
  - Focus moves to Cancel for destructive dialogs.
- **`chooseDialog`** (action sheet), anchored 8px above the bottom safe area and 8px from the
  sides:
  - The options sit in one `--surface-raised` group (radius 22). Each is a 56px row with a
    centred Body label in `--accent-ink` (`--critical-ink` when destructive), with hairlines
    between rows.
  - An optional title and message in Footnote `--ink-2` head the group.
  - A separate "Cancel" group sits 8 below, in Headline.
- Both enter with a fade and an 8px rise in `--dur-fade` (a fade only with Reduce Motion).

### 9.18 Toasts

- An opaque pill, min 52, `--toast-bg` with `--toast-ink` Subhead, padding 0 8 0 20.
- The action ("Undo", "Show") is 40 tall, Subhead 600 in `--toast-action`.
- It sits 12px above the tab bar (above sheets when one is open, `--z-toast`), 20 from the sides.
- Enter: a fade and a rise of 8px in `--dur-grow` with `--ease-out`. Leave: a fade in
  `--dur-fade`. One at a time. Example copy: "Added 3,50 € to Coffee & snacks".

### 9.19 Banners

- In the content flow under the header, never floating.
- Radius 22, padding 14 16, grid `22px 1fr` with a 12 gap: the icon (22), then the text in
  Subhead `--ink` with `text-wrap: pretty`. A leading sentence in `<strong>` is 600 ("October is
  closed.").
- Actions sit under the text, 8 below, 18 apart. The main action is Subhead 600 in the tone's ink
  (`--accent-ink`, `--warning-ink`, `--critical-ink`). The dismiss action is `--ink-2` 400 and
  reads "Not now", or "Dismiss" on the review banner, which does not come back.

| Tone | Background | Icon | Main action | Used for |
|---|---|---|---|---|
| Info | `--accent-soft` | `arrow-clockwise` (`--accent-ink`) | `--accent-ink` | Update ready |
| Warning | `--warning-soft` | `cloud-arrow-up` / `warning` (`--warning`) | `--warning-ink` | Backup nudge, install hint |
| Critical | `--critical-soft` | `warning-octagon` (`--critical`) | `--critical-ink` | Storage errors |
| Statement | `--surface` (statement paper) | the 22px brass Closed seal, 0.75px stroke, `aria-hidden` | `--accent-ink` | The month-end review (EXTRAS §1.6) |

- **Roles.** A banner with a name is a labelled region ("October is closed"). Unnamed, a critical
  banner is an alert and every other tone a status message.
- **Placement.** The shell renders banners into the Screen's banner slot: 2 under the title row,
  6 above the content and 10 between banners, all as margins of the slot's children, so an empty
  slot takes no space. On the Wallet the slot sits above the balance, between the nav row and
  the hero. Onboarding has no slot, so banners there sit at the top of the app.
- Dismissing is immediate: the kit calls `onDismiss` at once. A banner that collapses as it goes
  (the review banner, EXTRAS §1.9) animates its own wrapper.

### 9.20 Empty states

Centred, padding 26 28:

- A 56px coin with a light 28 glyph in `--ink-2`.
- A title in Headline, 12 below, balanced over its lines (`text-wrap: balance`).
- A message in Subhead `--ink-2`, 4 below, max width 280.
- An optional secondary md button, 16 below.

The copy invites the next action, for example "Nothing spent this month yet" / "Tap + to add an
expense.".

### 9.21 Meters (limits)

- **Row:** a coin, then line 1 with the name (Body) and the spent amount (`--text-figure`).
- **Meter**, 9 below:
  - 4 tall, radius 2, on `--track`, spanning the text column.
  - The fill is `--ink`.
  - In the current month a 1×12 `--ink-2` notch marks today's share of the month, so a limit
    running ahead of time shows without words.
- **Status line**, 7 below, in Footnote:

  | State | Leading status | Meter fill |
  |---|---|---|
  | OK | "61,40 € left" in `--ink-2` | `--ink` |
  | Warning | `warning` 14 + "1,50 € left" in 500 `--warning-ink` | `--warning-mark` |
  | Over | `warning-octagon` + "Over by 6,60 €" in 600 `--critical-ink` | `--critical` to `100% − 12px`, a 2px gap, a 10px nub |

  The trailing part is "of 180,00 €" in `--ink-2`, right-aligned under the amount, so the two
  figures form one clean column. Accessible text: "Coffee & snacks, 38,50 € of 40,00 €, near the
  limit, 1,50 € left".

### 9.22 Charts

All charts:

- are SVG with `role="img"` and a sentence label;
- have a visually hidden table of the values;
- use ink tokens for all text;
- mask values when amounts are hidden;
- have tap targets of at least 24px;
- sit on `--surface`.

- **Stacked bar** (Where it went):
  - 10 tall, with 2px `--surface` gaps between segments and 4px rounded outer ends.
  - Segments are in category inks, sorted by amount.
  - The legend rows below follow the same order. Each row is a grid `18px 1fr auto 46px`, 40
    tall: a 9px dot in the category ink, the name in Body, the amount in `--text-figure`, and the
    share in Footnote `--ink-2`, tabular ("35 %").
  - Then "Plus 778,88 € in fixed costs" in Subhead `--ink-2` with a 14px chevron, on a 44 row
    with a hairline above. It opens Fixed.
  - Folding follows section 14.
- **Daily columns** (Daily, category detail):
  - In a group with padding 14 16 10. The SVG is 96 tall: a 72 plot and a 24 axis.
  - One 6px column per day, centred in its 1/days slot, with a 3px rounded top and square at the
    baseline. Past days are `--chart-col` and today is `--chart-col-now`. Days with nothing spent
    draw nothing.
  - The baseline is 0.75px `--chart-axis`.
  - **In the current month** the allowance starts at today: a 2.5px-radius `--chart-ref` dot at
    today's column, then a 1px line to the period end. Its label "17,33 € a day" sits in Caption
    `--ink-2`, right-aligned 6 above the line's end.
  - **Past months** draw the "Daily budget 18,42 €" line across the whole month.
  - Both lines describe all daily spending, so Daily draws them only with the "All" chip.
  - Axis labels in Caption: "1 Oct" (leading), "Today" (600 `--ink`, centred under today's
    column) and "31 Oct" (trailing).
  - Category detail draws its columns in the category ink. Light yellow relies on the list below
    for its values.
  - Tap a column for a tooltip: `--surface-raised`, radius 8, `--shadow-float`, the date in
    Footnote 600 and the amount in `--text-figure-caption`.
- **Trend** (Last 6 months):
  - A 124 plot plus a 22 axis, with six 22px columns.
  - Fixed costs sit at the bottom in `--chart-fixed`, then a 2px gap, then daily spending on top
    in `--chart-daily` with 4px rounded top corners.
  - Income is a 1.5px `--chart-ref` line labelled "Income 1.450,00 €" at the right.
  - Month labels in Caption `--ink-2`. The current month's label is 600 `--ink`, only when the
    current period is one of the six (a chart that ends in a past month has no highlighted label).
  - A legend under the plot uses 10px rounded keys, and a line key for income.
  - Selection keeps the tapped column at full opacity and fades the others to 35%. A tooltip
    above the plot shows the month in Footnote 600, then fixed, daily and income values in the
    figures font.

### 9.23 Quick add tiles (Daily)

- Three per row (then horizontal scrolling), 8 gaps.
- Each tile: 64 tall, radius 14, `--surface`, grid `30px 1fr`, padding 0 10.
  - The icon box (30) holds the light 24 glyph in `--ink`. A **15px `--accent` "+" badge** with a
    9px bold `plus` in `--on-accent` sits on it at the bottom right, with a 2px `--surface` ring.
    The "+" makes the tile read as one-tap logging, not navigation.
  - The label is Subhead 600. The amount is `--text-figure-sm` in `--ink-2`.
- The accessible name is "Add Coffee, 3,50 €".
- A tap adds the expense and shows the toast with Undo. The tile scales to 0.97 on press.
- "Edit" sits in the section header.
- When the selected month is not current, the strip is replaced by the "Back to this month" pill.

### 9.24 Lock screen, privacy cover and loading

- **Lock screen** (opaque `--bg`, `--z-lock`, test id `lock-screen`), top to bottom:
  - The **vault**: an engraved rosette, 10 under the top bar, with the mark (the kit's
    `Icon name="logo"`, built from `docs/design/mark.svg`) in `--ink` at its centre. It is 236px
    with a 64px mark when there is room. On short screens it shrinks to `clamp(96px, the space
    left, 236px)`, the mark in proportion (about 130px on 375×667), so the keypad and "Forgot
    PIN?" always fit. In landscape the screen scrolls.
  - "Enter your PIN" in Title 3, 6 below.
  - PIN dots 20 below: four or six 13px dots, 20 apart. Filled dots are `--ink`; empty ones have
    a 1.5px `--ink-3` ring.
  - The PIN keypad, pushed to the bottom.
  - "Forgot PIN?" in Body `--accent-ink`, 44 tall, 14 above the bottom margin of 38.
- **Wrong PIN:** the dots shake (±10px, 400ms; with Reduce Motion they flash `--critical`
  instead), and "Wrong PIN" appears in Footnote `--critical-ink`. **Lockout:** "Try again in
  0:30" in Footnote `--ink-2`, with the digits disabled; the Face ID key and "Forgot PIN?" stay.
  "Couldn't check your PIN. Reopen the app." takes the same line when an attempt cannot be saved.
- **The other views of the lock screen.** Nothing modal can show above the lock (SPEC §5.6), so
  every step of Forgot PIN is a view of the same opaque layer. Each view's title takes focus.
  - **Forgot PIN** (with Face ID): the vault, "Forgot your PIN?" in Title 3, an explanation, then
    full-width "Use Face ID to choose a new PIN" (primary, 54), "Erase all data" (destructive)
    and "Cancel" (plain). When Face ID does not confirm, a line under the explanation says so.
  - **New PIN**: a page with a sheet-style header ("Cancel", "New PIN") over `PinSetupFlow` with
    `layout="fill"`: the dots at the top, the keypad pushed to the bottom like the lock itself.
    It unlocks with the toast "PIN changed".
  - **Erase**: a page with the header "Cancel", "Erase all data" over the erase form of SPEC
    §3.7: the heading "Erase everything on this iPhone?", the text with the last backup, "Type
    erase to confirm", and a filled destructive "Erase" (54). Without Face ID, "Forgot PIN?"
    opens this view directly.
  - **Error** (the lock settings could not be read): the vault, "Couldn't read the app lock
    settings" in Title 3, how to fix it, "Reload" (primary, 54) and "Erase all data"
    (destructive), which opens the erase view.
- **Privacy cover and loading screen:** `--bg` with the 64px mark centred in `--ink-3`. There is
  no rosette: it must paint in the first frame.

### 9.25 Onboarding

- **Welcome** (test id `onboarding`, step 1):
  - A 260px engraved rosette with the 92px app icon at its centre (radius 20.6, hairline ring,
    `--shadow-float`). This is the certificate moment. The icon is the installed one,
    `pwa-192.png` with `pwa-512.png` in its `srcset`, loaded through `import.meta.env.BASE_URL`.
  - "On a Budget" in `--text-title1`, centred. The lead in Body `--ink-2`, balanced.
  - Three feature lines: 28px light glyphs (`calendar-check`, `hand-tap`, `lock-simple`) with
    Subhead text, 18 apart, balanced.
  - At the bottom: "Get started" (primary, full width) and "Restore from a backup" (plain).
- **Later steps:**
  - A left-aligned large title ("What comes in each month?").
  - Form groups.
  - A primary "Continue" pinned above the bottom safe area and "Skip for now" (plain).
  - **Progress** is a small ruler, like the pace bar: one tick per step on a 1px
    `--hairline-strong` baseline, done steps `--ink-3`, steps ahead `--mark`, and the current step
    a 2px `--ink` notch. No numbers on screen; VoiceOver reads "Step 3 of 7".
- **The lock step on short screens** (iPhone SE, and 393×659): it opens scrolled to the PIN setup,
  so the whole keypad shows. The title and lead slide under the nav row, and the compact header
  reads "App lock".

### 9.26 Wallet, goals and paying from the wallet

The Wallet is the fourth tab and the centre of saving (SPEC §3.12 to §3.14, §4.8, §4.9). It is
written as a savings passbook (a Sparbuch): one balance, the goals that balance fills, and a book
of every movement. It is built from parts the system already has: the hero, meter rows, the
ledger's rules, the seal and the sheets. It adds no token, and nothing in it is orchestrated.

Reference: `?screen=wallet`, `wallet-goals`, `wallet-entry`, `wallet-settings`, `goal`,
`add-wallet`, `daily-wallet`, `home-wallet`; the extra states `wallet-empty`, `wallet-short`,
`wallet-paid`, `add-wallet-short`; and the board `wallet-states`. The sample: 500,00 € opening
on 1 Aug 2026, August closed +122,40 €, birthday money from grandma +50,00 € on 12 Sep, September
closed +158,82 €, 200,00 € moved to a savings account on 5 Oct. The balance is 631,22 €.

#### The Wallet tab (tab root `wallet`)

Top to bottom:

1. **Nav row** (44). No eyebrow and no month stepper: the wallet is not tied to the selected
   month, and the hero label names the tab. The eye button sits at the trailing end when
   `hideAmounts` is on. A visually hidden `h1` reads "Wallet".
   The app banners (section 9.19) sit under the nav row, above the balance: the balance is the
   title row, so the banner slot comes before it.
2. **Hero** (padding 14 20 0). The balance is the title of the screen.
   - **Label row** (min 22): "Wallet" in Subhead 500 `--ink-2`. Below zero it is a 16px
     `warning-octagon` in `--critical` and "Short by" in Subhead 600 `--critical-ink`, 6 apart.
   - **Figure**, 6 below, shifted 3px left like the Home hero: `BigAmount` at `--text-hero`,
     proportional figures, the unit in `--text-hero-unit` `--ink-2`. It shows the absolute
     balance, in `--critical-ink` below zero (the label says "by"). It shrinks like the Home hero
     (section 5.4).
   - **Sentence**, 10 below, Body `--ink`: "October adds 334,72 € when it closes", or "October
     takes 41,28 € out when it closes" when this month's result (savings + left) is negative.
     Hidden while the current month is before the wallet's start.
   - **Subline**, 2 below, Subhead `--ink-2`: "Not set aside: 0,00 €", the balance minus what the
     goals hold. Shown only when there are active goals and the balance is 0 or more.
   - No pace bar, seal or engraving: the figure is the one bold thing on the screen.
3. **Actions**, 22 below: "Add money" and "Take money out", secondary buttons 44 tall in a
   `1fr 1fr` grid with a 10 gap, Subhead 600 `--accent-ink`. Each opens the wallet entry sheet
   with its kind.
4. **Goals** (below).
5. **Passbook** (below), then its footer: "When a month closes, its savings and what was left
   over move here. An overspent month takes the difference out."
6. **Wallet settings**: a one-row group 26 below, 50 tall: "Wallet settings" in Body and a 14px
   bold `caret-right` in `--ink-3`. It opens the settings sheet.

- **Compact header**: "Wallet" in Headline (SF Pro, since it is not a month) over the balance in
  Footnote `--ink-2` ("631,22 €", or "Short by 146,50 €"). It is opaque `--bg` with the scroll-edge
  fade, as on the other tabs.
- On iPhone 15 the first screen holds the hero, the actions and the whole Goals section; the
  passbook starts below the fold (`?screen=wallet`, then `wallet-goals`).

#### Goals: the balance fills them from the top

The section header is "Goals" (`--text-title3`, 36 above, 10 below). The group holds one row per
active goal in fill order, then "Add a goal". The footer reads "Your wallet fills goals from the
top." (Footnote `--ink-2`, 8 below, indented to 36). With no goals the group holds only "Add a
goal", and the footer reads "Saving for something? Add it here and your wallet fills it."

- **Goal row**: min 88, padding 14 16, grid `34px minmax(0, 1fr) 28px`, column gap 12. It is the
  Limits row of section 9.21 with an order column:
  - An md coin (34) with the goal's light glyph in `--ink`, aligned to the top.
  - **Line 1** (min 22, baseline-aligned, gap 10): the name in Body `--ink` (one line with an
    ellipsis; two lines at accessibility sizes), and what the goal holds in `--text-figure`,
    tabular, `--ink`.
  - **Meter**, 9 below: 4 tall, radius 2, `--track`, filled in `--ink` to filled ÷ target. There
    is no today notch: a goal has no pace.
  - **Line 3**, 7 below (min 18), Footnote `--ink-2`: the state at the leading end and "of
    1.200,00 €" at the trailing end, right-aligned under the amount, so the two figures form one
    column (SPEC's "{filled} of {target}").

  | State | When | Leading text | Meter |
  |---|---|---|---|
  | Filling | 0 < filled < target | "568,78 € to go" | `--ink` to the share |
  | Waiting | nothing in it, a goal above is not full | "Fills after Japan trip" (the goal above) | empty |
  | Nothing yet | nothing in it and first in line (balance 0 or less) | "Nothing set aside yet" | empty |
  | Reached | filled = target | the seal (22, brass) and "Reached", 6 apart | full `--ink` |

  A reached goal keeps its money until it is marked as done. The seal says so: settled, like a
  closed month. The meter stays ink, because brass is a mark and never a fill.
- **Order column** (28 wide): two 44×44 buttons stacked, reaching 16 into the trailing padding
  and 14 into the top and bottom padding, so together they fill the row's height. `arrow-up` is
  centred on line 1 and `arrow-down` on line 3, regular 17 in `--ink-3`. The first goal has no
  up button and the last has no down button; their cells stay empty, so nothing shifts. Names:
  "Fill New bike sooner" and "Fill Japan trip later".
- The rest of the row (coin, lines and meter) is one button that opens the goal sheet, with the
  `--press` overlay.
- Separators: 0.5px `--hairline` from x 62 to the trailing edge, also above "Add a goal".
- **Add a goal** (min 50, grid `34px 1fr`, gap 12, padding 0 16): `plus-circle` regular 22
  centred in the coin column and "Add a goal" in Body `--accent-ink` at the text column. It opens
  the goal sheet for a new goal.
- **Done**: a group of its own, 14 below the footer, hidden when no goal is done. It starts
  collapsed every time.
  - Header row (min 50, gap 8): "Done" in Body `--ink`, the count in Body `--ink-2` (tabular),
    then a 14px bold `caret-down` in `--ink-3` (`caret-up` when open). It carries
    `aria-expanded`.
  - Open, each done goal is a row (min 62, grid `34px minmax(0, 1fr) auto`, gap 12, padding 9 6 9
    16, a hairline from x 62 above). It holds the coin, the name in Body, "120,00 €, done 3 Oct"
    in Subhead `--ink-2`, and "Put back" (Subhead 600 `--accent-ink`, 44 tall, padding 0 10).

#### The passbook

Every movement, oldest first, so the book reads down like a real passbook and ends on today's
balance. The section header is "Passbook".

- **Grid.** One grid on `--surface` (padding 0 16 16) with four columns: date `44px`, entry
  `minmax(0, 1fr)`, amount `auto` and balance `auto`, column gap 10. The header and each row are
  subgrids (`grid-template-columns: subgrid`), so the columns line up down the whole book. On
  iPhone 15 the entry column is 134 wide.
- **Header row**: padding 13 0 7, Footnote `--ink-2`: "Date", "Entry", then "Amount" and
  "Balance" right-aligned. A 0.5px `--hairline-strong` rule runs under it, the full width.
- **Rows**: min 44, padding 11 0, aligned on the first baseline. An entry may take two lines; the
  figures stay on the first. The 0.5px `--hairline` between rows starts at the entry column (x 54
  in the group): the date column is a margin, like the ledger's operator column.
- **Column rule**: a 0.5px `--hairline` on the leading edge of the balance column, from 12 below
  the top of the book to 16 above its end, as on passbook paper.
- **Cells**:
  - Date: Footnote `--ink-2`, tabular, the day right-aligned in 2ch ("1 Aug", "12 Sep"). The
    cell never shows a year. A book that spans years gets a year row at each year's first
    movement: 30 tall, the year in Footnote 600 `--ink`, then a 0.5px `--hairline-strong` line
    to the trailing edge, 10 apart, like the Today divider in Fixed. A year row also follows
    "Brought forward", so the visible lines are dated by year.
  - Entry: Subhead `--ink`, at most two lines, then an ellipsis.
  - Amount: `--text-figure-sm` serif, tabular, `--ink`, always signed: "+122,40", "−200,00" (a
    true minus).
  - Balance: `--text-figure-sm` serif, tabular, `--ink-2`, with 10 of left padding; signed only
    below zero.
- **The closing balance** (last row): 600 `--ink`, closed by the brass double rule (1, a 2 gap,
  1) 7 below the figure box, spanning the balance column from its padding. Below zero it is
  `--critical-ink` with a `--critical` double rule. It always equals the hero figure.
- **Movements** (SPEC §4.8):

  | Kind | Date cell | Entry | A tap opens |
  |---|---|---|---|
  | Opening | the start month's first day | "Opening balance" | the Wallet settings sheet |
  | Month closing | the seal | "August closed" (listed even when the result is 0,00) | Home on that month |
  | Added | its date | the note, else "Added" | the wallet entry sheet, to edit |
  | Taken out | its date | the note, else "Taken out" | the wallet entry sheet, to edit |
  | Paid | its date | "Paid: Laptop" (the note, else the category name) | the transaction sheet, to edit |

- **The stamp.** A month closing carries the Closed seal at 20px (a 0.75px brass stroke) centred
  in the date column, in place of its date, with the date as visually hidden text. The row's name
  already says which month. The seal says the month settled it, which is also why the row cannot
  be edited here. This is the passbook's only flourish: no perforation, no paper texture.
- **Brought forward.** A long book (more than 36 movements) opens on the latest 24, under a first
  row "Brought forward" with no date and no amount: the entry and the balance before them are in
  `--ink-2`. Tapping it shows 24 more. Nothing else changes.
- **Small widths and large text.** The book is a size container. Below 17em of inner width
  (289px at the default text size, so every iPhone, the SE included, keeps four columns at that
  size), each movement takes two lines: the date and the entry, then the amount at the leading
  end and the balance at the trailing end. The header row and the column rule go, and the date
  column is 3em wide instead of 44px, so "12 Sep" never runs into the entry at large text sizes.

#### The empty wallet (`?screen=wallet-empty`)

With no closed month, no opening balance and no entries, the hero shows 0,00 € and the
sentence, and Goals shows only "Add a goal". The passbook group holds the empty state of section
9.20: a 56px coin with the light `wallet` glyph, "Your wallet fills up when a month closes",
"Whatever you don't spend lands here, and an overspent month takes the difference out.", and a
secondary md button "Set an opening balance" that opens Wallet settings.

#### The Home Wallet card (SPEC §3.1 `wallet`)

- The section header is "Wallet". The card is one button: a `--surface` group (radius 22,
  padding 14 16 16) that opens the Wallet tab (`navigate('wallet')`).
- **Top line**: the balance in `--text-figure-lg` serif with proportional figures, `--ink`; the
  unit in `--text-figure-sm` `--ink-2`, 0.3em after it; a 14px bold `caret-right` in `--ink-3` at
  the trailing end, centred on the figure.
- **The brass double rule**, 9 below the figure box, spans number and unit. The card shows the
  passbook's closing balance, so it closes the same way.
- **The line**, 19 below the figure (clear of the rule), Subhead `--ink-2` with the amount in
  `--ink`:

  | Selected month | Line |
  |---|---|
  | Current, result 0 or more | "October adds 334,72 € when it closes" |
  | Current, result below 0 | "October takes 41,28 € out when it closes" |
  | Past, counted by the wallet | "September added 158,82 €" or "September took 41,28 € out" |
  | Future, or before the wallet's start | no line |

- **Below zero**: a label row (min 22, 4 above the figure): a 16px `warning-octagon` in
  `--critical` and "Short by" in Subhead 600 `--critical-ink`. The figure and unit turn
  `--critical-ink` and the double rule `--critical`.
- **Hidden amounts**: "•••" in `--ink-3` with no unit; the rule spans the dots, and the line's
  amount is "•••".
- The card always shows today's balance: the wallet is not a monthly figure. By default it is the
  first card after the hero. It is hidden while the wallet has nothing to show (balance 0, nothing
  pending, no movement other than 0,00 €): `WalletCard` then renders nothing.
- Over budget with savings still covering it, the card says "October adds 58,72 € when it closes"
  and the hero says "Your savings cover it. October still adds 58,72 € to your wallet." (section
  9.4): the overspend comes out of what October would have added.

#### The wallet entry sheet (`walletEntry`)

The transaction sheet without categories (`?screen=wallet-entry`):

1. Grab handle and header: "Cancel" and the title "Add money" or "Take money out". When editing,
   the title is "Edit entry" and the trailing slot holds a glass capsule "Delete" in
   `--critical-ink`, which runs through `withUndo`.
2. **Amount**, as in the transaction sheet, then the consequence line: "Wallet after: 531,22 €"
   (`--ink-2`, the figure `--ink`). Taking out more than the balance shows `warning-octagon` and
   "Wallet after: short by 68,78 €" in `--critical-ink`; it is still allowed.
3. **Note and Date group**, 18 below: "Note" (placeholder "Optional"; for example "Moved to my
   savings account", max 80, one line) and the date chips. The native date input has `max` set to
   today, since the wallet has no future entries. Once a date is picked, "Other" shows it in the
   short form ("12 Sep"): with the weekday the three chips overflow the row on an iPhone 15. The
   input's name keeps the long date ("Other date, Saturday 12 September 2026").
4. **Keypad** and the primary button: "Add money", "Take money out" or "Save changes".

It sizes to its content: on 375×667 it sits 100 below the top of the web view.

#### The Wallet settings sheet (`walletSettings`)

A content-sized sheet with the header "Cancel", "Wallet settings" and a tinted "Save". It has
two groups, 12 and 26 below the header:

- "Opening balance": an `AmountField` (serif, right-aligned). Footer: "Money you had saved when
  you started."
- "Counts from": the month ("August 2026") with a 14px `caret-up-down`. It opens the month
  picker. Footer: "Months before this don't change your wallet."

#### The goal sheet (`goal`)

A content-sized sheet like the recurring sheet:

- **Header**: "Cancel", the goal's name ("New goal" for a new one), and a tinted "Save" ("Add"
  for a new one). The action is disabled until the name and target are valid.
- **Group** (12 below, rows 48):
  - "Name": the value in Body `--ink` (placeholder "Required"), max 24, with a clear button
    while focused.
  - "Icon": the glyph in an sm coin (26) and a 14px bold `caret-right`. It opens `IconPicker`
    (`CATEGORY_ICONS` and Emoji) as a second view of the sheet, whose header has "Cancel"
    (reverts the icon) and "Done" (keeps it). Focus moves to the chosen glyph and back to the Icon
    row. A new goal starts with `piggy-bank`.
  - "Target": an `AmountField`, 1 to MAX_CENTS.
  - Footer: "631,22 € is set aside for it so far. It fills first, before New bike." For a new
    goal: "New goals fill last. Move them up on the Wallet."
- **Group** (26 below): "Mark as done" in Body `--accent-ink`. Footer: "For when you have reached
  it or bought it. It stops taking money and moves to Done." It is not shown for a new goal.
- **Group** (26 below): "Delete goal" in `--critical-ink`. It runs through `withUndo` (toast
  "Deleted Japan trip", with Undo) and asks no confirmation: deleting a goal never deletes money.

#### Pay from the wallet (the transaction sheet, SPEC §3.13)

- The third row of the Note and Date group is "Pay from wallet" (expenses only, new and edit):
  the label in Body `--ink` and the switch of section 9.13 at the trailing end, test id
  `pay-from-wallet`. It starts off, even when the sheet opens over the Wallet tab.
- On, the consequence line becomes "Wallet after: 82,22 €" for any date, as long as the amount is
  above 0. When editing a wallet-paid expense, the line counts its old amount back in first.
  Below zero the line shows `warning-octagon` and "Wallet after: short by 67,78 €" in
  `--critical-ink`. The expense is still allowed. Off, the budget line of section 9.16 comes
  back.
- The line keeps the same 20px height in every state and is `aria-live="polite"`.
- **375×667.** The new row costs 44. Under 700px of height, rows are 44 and keypad keys 48, so
  the sheet sits exactly 10 below the top (`?screen=add-wallet&device=se`, and the short state
  `add-wallet-short`).

#### Wallet-paid expenses in lists (Daily, category detail, Recent)

- The row keeps its category coin and its title. The subtitle reads "Paid from wallet" after the
  `wallet` glyph (regular 15, `--ink-2`, 5 apart), in place of the category name. The amount is
  `--ink-2`, like a paid fixed cost: the money went out, but not from this month's budget.
- It stays out of the day total, the Daily sentence and chart, category totals and limits, and
  every Home figure. If every entry of a day was paid from the wallet, the day header shows "From
  your wallet" in Subhead `--ink-2` in place of a 0,00 € total.
- Its name: "Laptop, Shopping, 549,00 €, paid from wallet". The category is said aloud because
  only the coin shows it.

#### Copy

| Where | Copy |
|---|---|
| Hero | "Wallet", "Short by"; "October adds {x} when it closes", "October takes {x} out when it closes"; "Not set aside: {x}" |
| Actions | "Add money", "Take money out", "Wallet settings" |
| Goals | "Goals", "{x} to go", "Fills after {goal}", "Nothing set aside yet", "Reached", "of {target}", "Add a goal", "Your wallet fills goals from the top.", "Done", "{target}, done {date}", "Put back" |
| Passbook | "Passbook", "Date", "Entry", "Amount", "Balance", "Opening balance", "{Month} closed", "Added", "Taken out", "Paid: {note or category}", "Brought forward" |
| Empty | "Your wallet fills up when a month closes", "Whatever you don't spend lands here, and an overspent month takes the difference out.", "Set an opening balance" |
| Home | "{month} adds {x} when it closes", "{month} added {x}", "{month} took {x} out"; "Moved to your wallet: {x}", "Taken from your wallet: {x}"; "That comes out of your wallet when {month} closes." |
| Sheets | "Add money", "Take money out", "Edit entry", "Wallet after: {x}", "Wallet after: short by {x}", "Opening balance", "Counts from", "New goal", "Name", "Icon", "Target", "Mark as done", "Delete goal", "Pay from wallet" |
| Lists | "Paid from wallet", "From your wallet" |

#### Accessibility

- **Hero**: one label, "Wallet, 631,22 €. October adds 334,72 € when it closes. Not set aside:
  0,00 €." Below zero it starts "Wallet, short by 146,50 €". It is not a live region.
- **Goals**: a list named "Goals, filled from the top". Each row's button reads "Japan trip,
  631,22 € of 1.200,00 €, 568,78 € to go" (or "..., reached"). The meter is hidden from VoiceOver,
  since the words carry it. After a move, a polite announcement says "New bike fills first now".
  Focus stays on the button just used; when the move takes the goal to an end, where that button
  goes away, focus moves to its other order button.
- **Passbook**: `role="table"` named "Passbook", with column headers. Each entry is a button
  named for the whole line: "5 October, taken out, Moved to my savings account, minus 200,00 €,
  balance 631,22 €", or "31 August, August closed, plus 122,40 €, balance 622,40 €". The seal is
  `aria-hidden`.
- **Done**: `aria-expanded` on its header; "Put back Winter jacket".
- **Pay from wallet**: `role="switch"` with its visible label. The consequence line updates
  politely.
- **Hidden amounts**: every wallet figure shows "•••" and reads "amount hidden". Meters stay,
  because they show shares, not money.
- Every control is at least 44×44: the order buttons, "Put back", rows.
- With Increase Contrast, the passbook's rules and the column rule turn 1px with the stronger
  hairlines, like every other rule; the seal stays brass.

#### Motion

Nothing new is orchestrated:

- The Wallet figure uses the odometer of section 3.3, with Home's triggers: an entry added,
  edited, deleted or undone, a wallet-paid expense, or a change of opening balance, while the
  Wallet is visible, or once when it appears again.
- Goal meters grow and shrink together in `--dur-grow` with `--ease-out`. There is no waterfall
  stagger: the order is already in the list. With Reduce Motion they change at once.
- A goal that reaches its target because of something the user did shows its seal with a fade in
  `--dur-stamp`, without scaling (engravings never move). On first render it is simply there.
- A reorder lets the two rows trade places in `--dur-fade` with `--ease-standard` (transforms
  only). With Reduce Motion they swap at once.
- A new passbook row and the opened Done rows fade in over `--dur-fade`. Nothing slides.

#### Tokens

None are new. The Wallet uses `--surface`, `--hairline`, `--hairline-strong`, `--hairline-width`,
`--track`, `--ink`, `--ink-2`, `--ink-3`, `--brass`, `--critical`, `--critical-ink`,
`--accent-ink`, `--rule-width`, `--double-rule-gap`, and the type, space and motion tokens named
above. It adds no colour pair: brass marks sit on `--surface` (3.5:1 light, 8.5:1 dark), the
order arrows are `--ink-3` (5.2:1 and 5.8:1), and the critical double rule is 6.3:1 and 6.8:1.

#### Sample arithmetic

A month's result is income − fixed − daily, which is savings + left (SPEC §4.8). September:
100,00 + 58,82 = 158,82 €, the "+158,82" in the book. October so far: 100,00 + 234,72 =
334,72 €, so the reference says "October adds 334,72 € when it closes". Left alone (234,72 €)
would leave out the month's savings. The goals take the whole 631,22 €: Japan trip holds all of
it (568,78 € to go), New bike waits, and nothing is left unassigned. Over budget (daily 612,40 €),
the month still adds 58,72 €.

## 10. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 120ms | Press feedback |
| `--dur-fade` | 200ms | Fades, toggles, chip and segment selection, the compact header |
| `--dur-grow` | 320ms | Pace fill and meters after an entry, toast enter |
| `--dur-stamp` | 220ms | A paid check pressed in |
| `--dur-push` | 420ms | Screen push and pop (`--ease-push`) |
| `--dur-sheet` | 480ms | Sheet present and dismiss (`--ease-sheet`) |
| `--dur-value` / `--dur-value-stagger` | 640ms / 45ms | The odometer (section 3.3, `--ease-counter`) |
| `--ease-standard` | cubic-bezier(0.2, 0, 0, 1) | Default |
| `--ease-out` / `--ease-in` | cubic-bezier(0, 0, 0, 1) / cubic-bezier(0.3, 0, 1, 1) | Arriving / leaving |
| `--ease-sheet` | cubic-bezier(0.32, 0.72, 0, 1) | Sheets |
| `--ease-push` | cubic-bezier(0.2, 0.8, 0.2, 1) | Push and pop |
| `--ease-counter` | cubic-bezier(0.25, 0.9, 0.3, 1) | Odometer drums: quick start, soft landing |

- Motion answers an action. Nothing moves on its own, and engravings never move.
- **The odometer is the only orchestrated motion** (section 3.3).
- **Paid check:** ticking presses the check in like a bank stamp. Over `--dur-stamp` the ring
  scales 1 → 0.9 → 1 with `--ease-standard`, the check fades in, and the amount crossfades to
  `--ink-2`. Unticking fades the check out in `--dur-fade`. With Reduce Motion there is no scale,
  only a 120ms fade.
- **Sheets** rise from the bottom with `--ease-sheet`. A drag follows the finger and a fast
  release dismisses. The scrim fades in `--dur-fade`.
- **Screens** push with a 30% parallax on the outgoing screen. A pop from the system gesture skips
  the animation (SPEC §5.5).
- **The Wallet** reuses these: the odometer on its balance, meter growth on its goals, and a fade
  for a reached goal's seal. Its only motion of its own is two goal rows trading places when the
  order changes (section 9.26).
- **With Reduce Motion:** no transforms, opacity only, at most 200ms. The tokens already switch:
  `--dur-value` and `--dur-stamp` drop to 0, and sheets, pushes and growth fade.

## 11. Copy

- English, sentence case, active verbs. No exclamation marks, no all-caps, no " · " joins, no
  arrows appended to buttons. Errors say what happened and how to fix it.
- Money goes through `Intl` (de-DE by default: "1.234,56 €"), with a true minus "−41,28 €". Lists
  always show cents. The big figure follows "Show cents in the big number".
- Dates use `Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })`:
  "Fri 16 Oct". Relative labels are "Today", "Yesterday", "Tomorrow", "In 4 days". Ordinals read
  "Due on the 22nd". Never hand-write a weekday. In the sample, 18 October 2026 is a Sunday.
- **Status words:** "On track", "Spending fast", "Over budget by", "Short by", "Left over",
  "Planned". **Consequences:** "Leaves 4,84 € for today", "2,66 € over today's budget",
  "41,28 € over this month's budget".
- **Statement words:** "Statement for September", "Closed 30 Sep", "Moved to your wallet:
  158,82 €".
- **Eyebrows:** "Hi, Alex", "Daily spending", "Fixed costs and income". The Wallet has none.
- **Wallet words** (section 9.26): "October adds 334,72 € when it closes", "Not set aside: 0,00 €",
  "Wallet after: 82,22 €", "Paid from wallet", "Paid: Laptop", "Fills after Japan trip",
  "Reached". Money moves "to" and "from" the wallet; goals are "set aside", never "saved into".

## 12. Accessibility

- Every text token reaches 4.5:1 and every mark 3:1 on every surface it sits on, in both themes
  and with all eight accents. A script checked 444 pairs (section 13). Control fills differ from
  their container by at least 1.12:1. Chips have a hairline.
- **Increase Contrast** (`prefers-contrast: more`):
  - Glass becomes solid.
  - `--ink-2` and `--ink-3` become `--ink`.
  - Hairlines go to 1px and get stronger. `--mark` and `--track` darken.
  - Engraving fades to 0.08 so the content leads.
- Status is never colour alone: icon shape and words carry it. Charts have hidden tables.
- **VoiceOver:**
  - The hero reads as one sentence.
  - The ledger is a table with row headers. It is a CSS grid of `div`s with explicit ARIA table
    roles (`table`, `row`, `rowheader`, `cell`), because WebKit drops the native semantics of a
    `<table>` laid out with `display: grid`.
  - A pushed screen and each onboarding step move focus to their title, so VoiceOver announces
    the new screen; Back returns focus to the control that pushed it.
  - Ticks, steppers and the month title have names that say the action ("Mark Netflix as paid",
    "Previous month, September", "October, choose month").
  - The seal reads "Statement closed on 30 September".
  - The passbook is a table with column headers, and each movement is one button named for its
    whole line. The goals are a list, and their order buttons say what they do ("Fill New bike
    sooner").
- Touch targets are 44×44 everywhere (section 6).

## 13. Validation

- **Contrast.** A check script reads `src/styles/tokens.css` and composites translucent fills over
  the surfaces they sit on: `node docs/design/check-contrast.mjs`. It checked 444 pairs in both
  themes and all eight accents, and all pass.
  - Light: `--ink` 14.5:1 on `--bg`, `--ink-2` 4.8:1 on its worst fill, `--ink-3` 4.7:1, brass
    3.1:1 on `--bg`.
  - Accents: every `--on-accent` on `--accent` is at least 7.1:1. Every `--accent-ink` is at least
    5.8:1 on every surface and fill. Every `--accent` fill is at least 6.6:1 against the paper
    around it.
- **Categories.** The dataviz `validate_palette.js` result is in section 4.5. Light passes with
  one contrast WARN (yellow, relieved by the legend and table). Dark passes cleanly.
- **Wallet.** It adds no token and no colour pair. Its marks were checked on `--surface`: brass
  3.5:1 (light) and 8.5:1 (dark), the `--ink-3` order arrows 5.2:1 and 5.8:1, the critical double
  rule 6.3:1 and 6.8:1, the `--ink` meter fill 13.6:1 and 10.8:1 on `--track`.

## 14. Spec notes

Where this design adds to or differs from `docs/SPEC.md`. Change the spec deliberately:

1. **§5.11** The default accent is `navy`. `AccentKey` becomes navy, royal, teal, bottle,
   burgundy, plum, cognac, graphite (section 4.3).
2. **§3.1, §3.3, §3.5 headers.**
   - The month stepper sits in the nav row as a trailing glass capsule.
   - The large-title row holds the month title and, away from the current month, the "Back to
     this month" pill.
   - Tab roots carry a nav-row eyebrow: "Hi, {name}" (Home, with the monogram), "Daily spending",
     and "Fixed costs and income". The Wallet has neither eyebrow nor stepper (section 9.26).
3. **§3.1 hero.** A trailing status in the label row: "On track" (`--ink-2`, `check-circle`) or
   "Spending fast" (warning), derived from the PaceBar status.
4. **§3.1 past months.**
   - The ledger title reads "Statement for {name}".
   - The Closed seal and "Closed {last day}" sit beside the figure (section 3.2).
5. **§3.1 Where it went.** Fold the tail into "{n} more" only when it holds two or more
   categories. A single remaining category shows by name. The reference shows all six.
6. **§3.4.** The third date chip reads "Other" with a calendar glyph until a date is picked.
7. **§5.8 `CategoryBadge`.** A monochrome coin (section 9.9); the category colour is never a tint.
   **`Monogram`** gets the engraved rim.
8. **§5.8 `BigAmount`.** It starts at 76px and must set proportional figures (Source Serif 4's
   default figures are tabular).
9. **§5.8 money formatting.** A variant without the currency symbol, for the ledger addends, and
   `formatToParts` for the hanging unit.
10. **Hero motion.** The odometer (section 3.3) replaces any crossfade of the big figure.
11. **§3 tab bar.** A long-press on the add button offers the quick adds (section 9.1). The tab
    bar itself is unchanged.
12. **§6 materials.** The compact header is opaque `--bg` (it continues the iOS status bar),
    and the tab bar is the only blurred layer.
13. **Sample data.** 18 October 2026 is a Sunday: "Yesterday" is Sat 17 Oct, then "Fri 16 Oct".
    Netflix (22 Oct) is a Thursday and Phone (28 Oct) a Wednesday.
14. **§3.12 Wallet screen.** The balance is the title: no eyebrow, no stepper, no large-title
    row. A month closing carries the seal in the passbook's date column. A book of more than 36
    movements opens on the latest 24 under "Brought forward". The empty state adds the button
    "Set an opening balance". Tapping "Opening balance" opens Wallet settings.
15. **§3.12 Wallet entry sheet.** It shows "Wallet after: {x}" under the amount (critical, with
    "short by", below zero). When editing, the title is "Edit entry" and "Delete" is a header
    capsule.
16. **§3.13 "Paid from {goal}".** A transaction has `fromWallet` but no goal, so that subtitle
    cannot be derived. The design shows "Paid from wallet" only: drop the goal variant, or add a
    goal reference to the data model first.
17. **§3.13 details.** The switch starts off, even on the Wallet tab. "Wallet after" shows for any
    date while the amount is above 0. A day whose entries were all paid from the wallet shows
    "From your wallet" in place of a 0,00 € total.
18. **§3.14 goal states.** Each row says where it stands: "{x} to go", "Fills after {goal}",
    "Nothing set aside yet" or "Reached". "Not set aside: {free}" shows only with active goals and
    a balance of 0 or more (below zero, the hero's "Short by" already says it).
19. **§3.14 wording.** The sheet's action reads "Mark as done": a bare "Done" reads like a sheet's
    finish button next to "Cancel" and "Save". The list section keeps "Done". The order buttons
    are named "Fill {name} sooner" and "Fill {name} later": "Fill this first" is true only for a
    move to the top.
20. **§3.1 over-budget line.** Settled in the spec: the line follows the month's result, so when
    savings cover the overspend it reads "Your savings cover it. October still adds 58,72 € to
    your wallet." (section 9.4). The reference renders still show "That comes out of your wallet
    when October closes." for that case.
21. **§3.4 on small screens.** With "Pay from wallet", rows are 44 and keypad keys 48 under 700px
    of height. The sheet's height on 375×667 is then fully used: §3.4's suggestion chips and
    §3.16's "Split" must replace something, not add a row.
22. **§3.3 compact header.** On Daily, search scrolls away with the large title. The compact
    header keeps the stepper only.
23. **Sample data for the Wallet.** October's pending result is 334,72 € (savings 100,00 + left
    234,72, §4.8), not 234,72 €. The "Paid: Laptop" movement (549,00 € on 18 Oct) appears in the
    states after the purchase (`wallet-paid`, `daily-wallet`); before it, the balance is 631,22 €.

## 15. Files

| File | What it is |
|---|---|
| `src/styles/tokens.css` | Every colour, type, space, radius, material, motion and layer token |
| `docs/design/reference.html` | The reference screens (mockup code, not for copying). It embeds static font cuts only because the screenshot browser cannot render variable fonts. |
| `docs/design/app-icon.svg` | 1024×1024, opaque, no text: an iPhone switch in the On position on a bone tile. The brass-framed navy track carries banknote waves; its knob is a brass coin with a ring of guilloché, struck with the navy double rule (the sign under every statement's bottom line) and set off from the frame by a navy gap. |
| `docs/design/app-icon-maskable.svg` | The same artwork for the maskable 512 icon, with the switch scaled by 0.99253 and recentred so the switch and its frame stay inside the safe zone (a circle of 40% of the width). Only the soft shadows reach past it. |
| `docs/design/mark.svg` | Monochrome (`currentColor`): the On switch, a 64×40 pill whose knob is a coin with the double rule cut out, set off from the pill's rim by a clear ring. One even-odd path on a 4-unit grid. Used for the lock screen, privacy cover, loading screen and SVG favicon. |
| `docs/design/engraving-rosette.svg` | The lock and welcome rosette (`currentColor`, non-scaling 0.5px strokes) |
| `docs/design/engraving-seal.svg` | The Closed seal (stroke `--brass`) |
| `docs/design/engraving-medallion.svg` | The monogram rim |
| `docs/design/check-contrast.mjs` | The contrast check of section 13 (no dependencies) |

**App icon exports.** `npm run icons` (`scripts/generate-icons.mjs`, with `sharp`) renders the
180px `apple-touch-icon`, the 192 and 512 manifest icons and the 32px favicon PNG from
`app-icon.svg`, and the maskable 512 icon from its own file, `app-icon-maskable.svg`: the switch of
`app-icon.svg` reaches about 1px past the safe zone. Every PNG is flattened onto its SVG's solid
base colour (#EDEEEA), so none has transparent pixels. The SVG favicon is `mark.svg`, with `fill`
set to #121C33 and a `prefers-color-scheme` style for #E9EAE6.

**To install:** `@fontsource-variable/source-serif-4` (dependency), with the two `@font-face`
rules of section 5.1. Nothing else.

## 16. Do and don't

Do:

- Let the figure be the only bold thing on a screen.
- Set money in Source Serif 4 and every word in SF Pro.
- Close every bottom line with the sum rule and the brass double rule, spanning the figure only.
  The Wallet's balance is a running balance, not a sum: it takes the double rule alone, in the
  passbook and on the Home card.
- Keep groups flat, glyphs light in hairline coins, amounts right-aligned and tabular.
- Use ink for information, the accent for actions, brass for what is settled, and red only with an
  octagon and words.
- Check every new colour with `check-contrast.mjs` and every category ink with the validator.

Don't:

- Add card shadows, gradients, tinted icon tiles, emoji decoration or all-caps labels.
- Put a category colour on text, a badge or a row, or the accent on a figure or chart.
- Use brass anywhere but under a bottom line or on the seal (a closed month, a reached goal).
  Never fill a meter with it.
- Stagger goal meters or animate the waterfall: the order of the list already says it.
- Put engraving behind text, animate it, or add it to more places.
- Use `tabular-nums` on the big figures, `system-ui` first in a stack, or a hyphen as a minus.
- Animate anything the user did not touch, or add a second orchestrated motion.
