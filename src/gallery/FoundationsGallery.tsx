import { useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ACCENTS, CATEGORY_COLORS, CATEGORY_ICONS, EMOJI_CHOICES } from '@/domain/catalog'
import { createMoneyFormat } from '@/domain/money'
import type { AccentKey, CategoryColor, Cents } from '@/domain/types'
import styles from '@/gallery/FoundationsGallery.module.css'
import {
  AmountField,
  Banner,
  BigAmount,
  Button,
  CategoryBadge,
  CategoryIcon,
  Chip,
  ChipTabs,
  ColorSwatches,
  EmojiPicker,
  EmptyState,
  Engraving,
  GlassGroup,
  Icon,
  IconButton,
  IconPicker,
  LedgerFigure,
  ListRow,
  Meter,
  Money,
  MoneyFormatContext,
  Monogram,
  PaidCheck,
  Screen,
  Section,
  SegmentedControl,
  SelectField,
  TextField,
  Toggle,
  TotalFigure,
  UI_ICON_NAMES,
  useLedgerColumn,
} from '@/ui'

// Dev-only board of the UI foundations (docs/DESIGN.md §3–§9) with the sample data of DESIGN.md:
// October 2026, today Sunday 18 October (day 18 of 31), de-DE euros.

const EUROS = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false })
const MASKED = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })
const NO_CENTS = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: false, masked: false })
const DOLLARS = createMoneyFormat({ currency: 'USD', locale: 'en-US', showCents: true, masked: false })

const TODAY_RATIO = 18 / 31

const CATEGORIES = {
  rent: { name: 'Rent', icon: 'house', color: 'blue' },
  subs: { name: 'Subscriptions', icon: 'repeat', color: 'violet' },
  transport: { name: 'Transport', icon: 'train', color: 'aqua' },
  eating: { name: 'Eating', icon: 'fork-knife', color: 'orange' },
  groceries: { name: 'Groceries', icon: 'shopping-cart', color: 'green' },
  coffee: { name: 'Coffee & snacks', icon: 'coffee', color: 'yellow' },
  shopping: { name: 'Shopping', icon: 'shopping-bag', color: 'magenta' },
  goingOut: { name: 'Going out', icon: 'martini', color: 'red' },
} as const satisfies Record<string, { name: string; icon: string; color: CategoryColor }>

type CategoryKey = keyof typeof CATEGORIES

const CHIP_ITEMS: { value: CategoryKey | 'all'; label: string; icon?: string }[] = [
  { value: 'all', label: 'All' },
  ...(['transport', 'eating', 'groceries', 'coffee', 'shopping', 'goingOut'] as const).map((key) => ({
    value: key,
    label: CATEGORIES[key].name,
    icon: CATEGORIES[key].icon,
  })),
]

const ACCENT_SWATCHES = ACCENTS.map(({ key, name }) => ({ value: key, name, cssVar: `--accent-${key}` }))
const CATEGORY_SWATCHES = CATEGORY_COLORS.map(({ key, name }) => ({ value: key, name, cssVar: `--cat-${key}` }))

const LEDGER: { op: string; label: string; cents: Cents }[] = [
  { op: '+', label: 'Income', cents: 145000 },
  { op: '−', label: 'Fixed costs', cents: 77888 },
  { op: '−', label: 'Savings', cents: 10000 },
  { op: '−', label: 'Daily spending', cents: 33640 },
]

function Board({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className={styles.board}>
      <h2 className={styles.boardTitle}>{title}</h2>
      {children}
      {note !== undefined && <p className={styles.note}>{note}</p>}
    </section>
  )
}

/** A small card of the kit board: a caption naming the state, then the hero parts. */
function HeroCard({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={styles.heroCard}>
      <p className={styles.caption}>{caption}</p>
      {children}
    </div>
  )
}

function OnTrack() {
  return (
    <span className={styles.status}>
      <Icon name="on-track" size={16} />
      On track
    </span>
  )
}

/** The odometer: adding Mensa 4,50 € rolls 239,22 € to 234,72 €; Undo rolls it back. */
function OdometerDemo() {
  const [added, setAdded] = useState(false)
  return (
    <HeroCard caption="The odometer">
      <div className={styles.heroTop}>
        <span className={styles.heroLabel}>Left to spend</span>
        <OnTrack />
      </div>
      <BigAmount cents={added ? 23472 : 23922} animate className={styles.heroFigure} data-testid="odometer" />
      <div className={styles.heroButton}>
        <Button variant="secondary" onClick={() => setAdded((value) => !value)} data-testid="odometer-toggle">
          {added ? 'Undo' : 'Add Mensa 4,50 €'}
        </Button>
      </div>
    </HeroCard>
  )
}

/**
 * The ledger as Home lays it out (docs/DESIGN.md §9.6): operator, label, figure and a 20px margin
 * for the hanging unit. The sum rule and the double rule span the widest figure, never the row:
 * useLedgerColumn writes its width to --colw and keeps it right once Source Serif 4 has loaded.
 */
function Ledger({ over = false, title }: { over?: boolean; title: string }) {
  const ledgerRef = useLedgerColumn<HTMLDivElement>()
  const daily = over ? 61240 : 33640
  const rows = LEDGER.map((row) => (row.label === 'Daily spending' ? { ...row, cents: daily } : row))
  const left = 145000 - 77888 - 10000 - daily
  return (
    <Section title={title}>
      <div ref={ledgerRef} className={styles.ledger}>
        {rows.map((row) => (
          <div key={row.label} className={styles.ledgerRow}>
            <span className={styles.ledgerOp} aria-hidden="true">
              {row.op}
            </span>
            <span>{row.label}</span>
            <span className={styles.ledgerCell}>
              <LedgerFigure cents={row.cents} />
            </span>
            <span />
          </div>
        ))}
        <div className={`${styles.ledgerRow} ${styles.ledgerResult}`} data-over={over || undefined}>
          <span className={styles.ledgerOp} aria-hidden="true">
            =
          </span>
          <span className={styles.ledgerLabel}>
            Left
          </span>
          <span className={styles.ledgerCell}>
            <span className={styles.ledgerRules}>
              <LedgerFigure cents={left} result tone={over ? 'critical' : 'default'} />
            </span>
          </span>
          <span />
        </div>
      </div>
    </Section>
  )
}

/** The kit's paid check with its state held here; a tick stamps it. */
function PaidCheckDemo({ initial, name }: { initial: boolean; name: string }) {
  const [paid, setPaid] = useState(initial)
  return <PaidCheck paid={paid} name={name} kind="expense" onToggle={() => setPaid((value) => !value)} />
}

function ChipsDemo() {
  const [category, setCategory] = useState<CategoryKey | 'all'>('eating')
  const [date, setDate] = useState<'today' | 'yesterday' | 'other'>('today')
  return (
    <>
      <ChipTabs items={CHIP_ITEMS} value={category} onChange={setCategory} label="Categories" itemTestId="category-chip" />
      <div className={`${styles.inset} ${styles.chipRow}`}>
        <Chip size="mini" selected={date === 'today'} onClick={() => setDate('today')}>
          Today
        </Chip>
        <Chip size="mini" selected={date === 'yesterday'} onClick={() => setDate('yesterday')}>
          Yesterday
        </Chip>
        <Chip size="mini" selected={date === 'other'} onClick={() => setDate('other')} leading={<Icon name="calendar" size={16} />}>
          Other
        </Chip>
      </div>
      <div className={`${styles.inset} ${styles.chipRow}`}>
        <Chip icon="repeat">Netflix</Chip>
        <Chip icon="train">Deutschlandticket</Chip>
        <Chip icon="device-mobile">Phone</Chip>
        <Chip icon="package">A very long suggestion that ends in an ellipsis</Chip>
      </div>
    </>
  )
}

function ControlsDemo() {
  const [segment, setSegment] = useState<'costs' | 'income'>('costs')
  const [cents, setCents] = useState(true)
  const [hide, setHide] = useState(false)
  const [spread, setSpread] = useState(true)
  return (
    <>
      <div className={styles.inset}>
        <SegmentedControl
          options={[
            { value: 'costs', label: 'Costs' },
            { value: 'income', label: 'Income' },
          ]}
          value={segment}
          onChange={setSegment}
          label="Costs or income"
          data-testid="fixed-segment"
        />
      </div>
      <Section variant="form" title="Look">
        <Toggle label="Show cents in the big number" checked={cents} onChange={setCents} />
        <Toggle label="Hide amounts" checked={hide} onChange={setHide} />
        <Toggle
          label="Spread over 12 months"
          description="Counts 5,00 € every month instead of 60,00 € once a year"
          checked={spread}
          onChange={setSpread}
        />
        <Toggle label="Unlock with Face ID" checked={false} onChange={() => {}} disabled />
      </Section>
    </>
  )
}

function FieldsDemo() {
  const [note, setNote] = useState('Mensa')
  const [name, setName] = useState('Netflix')
  const [amount, setAmount] = useState<Cents | null>(1399)
  const [opening, setOpening] = useState<Cents | null>(null)
  const [often, setOften] = useState(1)
  const [category, setCategory] = useState<CategoryKey>('subs')
  const [query, setQuery] = useState('Cappu')
  const [date, setDate] = useState('2026-10-14')
  const [month, setMonth] = useState('2026-10')
  return (
    <>
      <div className={`${styles.inset} ${styles.searchRow}`}>
        <TextField type="search" label="Search" placeholder="Search notes and categories" value={query} onChange={setQuery} data-testid="daily-search" />
        <Button variant="plain">Cancel</Button>
      </div>
      <div className={styles.sheetSurface}>
        <Section context="sheet">
          <TextField label="Note" value={note} onChange={setNote} maxLength={80} placeholder="What was it?" />
          <TextField label="Date" type="date" value={date} onChange={setDate} />
        </Section>
        <Section variant="form" context="sheet" title="Every month">
          <TextField variant="form" label="Name" value={name} onChange={setName} maxLength={40} />
          <AmountField label="Amount" value={amount} onChange={setAmount} data-testid="amount-field" />
          <SelectField
            label="Category"
            value={category}
            onChange={setCategory}
            options={(['rent', 'subs', 'transport'] as const).map((key) => ({
              value: key,
              label: CATEGORIES[key].name,
              icon: CATEGORIES[key].icon,
            }))}
          />
          <SelectField
            label="How often"
            value={often}
            onChange={setOften}
            options={[
              { value: 1, label: 'Monthly' },
              { value: 3, label: 'Every 3 months' },
              { value: 12, label: 'Yearly' },
            ]}
          />
          <TextField variant="form" type="month" label="Starts" value={month} onChange={setMonth} />
          <ListRow title="More options" tinted chevron="down" onClick={() => {}} />
        </Section>
        <Section variant="form" context="sheet" title="When something is wrong">
          <AmountField label="Opening balance" value={opening} onChange={setOpening} error="Enter an amount above 0." />
          <TextField variant="form" label="Name" value="" onChange={() => {}} placeholder="Required" error="Give the category a name." />
        </Section>
      </div>
    </>
  )
}

function PickersDemo() {
  const [icon, setIcon] = useState('coffee')
  const [avatar, setAvatar] = useState('')
  const [accent, setAccent] = useState<AccentKey>('navy')
  const [color, setColor] = useState<CategoryColor>('yellow')
  const [wallet, setWallet] = useState(false)
  return (
    <>
      <Section variant="form" title="Look">
        <ListRow title="Theme" detail="System" chevron onClick={() => {}} />
        <ColorSwatches options={ACCENT_SWATCHES} value={accent} onChange={setAccent} label="Accent" showLabel />
        <Toggle label="Show cents in the big number" checked onChange={() => {}} />
      </Section>
      <div className={styles.sheetSurface}>
        <Section variant="form" context="sheet" title="Colour">
          <ColorSwatches options={CATEGORY_SWATCHES} value={color} onChange={setColor} label="Colour" />
        </Section>
        <Section variant="form" context="sheet" title="Icon">
          <div className={styles.pickerPad}>
            <IconPicker value={icon} onChange={setIcon} icons={CATEGORY_ICONS} emojis={EMOJI_CHOICES} data-testid="icon-picker" />
          </div>
        </Section>
        <Section variant="form" context="sheet" title="Payment">
          <Toggle label="Pay from wallet" checked={wallet} onChange={setWallet} />
        </Section>
        <Section variant="form" context="sheet" title="Monogram">
          <div className={styles.pickerPad}>
            <EmojiPicker value={avatar} onChange={setAvatar} choices={EMOJI_CHOICES.slice(0, 21)} allowEmpty={{ label: 'Use my initial' }} label="Monogram" />
          </div>
        </Section>
      </div>
    </>
  )
}

/** Finds the Screen's banner slot inside a frame, as the app's AppBanners does in a screen layer. */
function useBannerSlot(): [HTMLElement | null, (frame: HTMLDivElement | null) => void] {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const findSlot = useCallback((frame: HTMLDivElement | null) => {
    setSlot(frame?.querySelector<HTMLElement>('[data-banner-slot]') ?? null)
  }, [])
  return [slot, findSlot]
}

/**
 * A phone-sized frame holding a Screen; `scrolled` starts it scrolled to show the compact header.
 * `banner` is portalled into the Screen's banner slot, as the shell does with the app banners.
 */
function HomeFrame({ scrolled = false, banner }: { scrolled?: boolean; banner?: ReactNode }) {
  const [slot, findSlot] = useBannerSlot()
  return (
    <div ref={banner === undefined ? undefined : findSlot} className={styles.frame}>
      {slot !== null && banner !== undefined && createPortal(banner, slot)}
      <Screen
        title="Home"
        largeTitle
        leading={<Monogram name="Alex" avatar="" />}
        eyebrow="Hi, Alex"
        titleContent={
          <span className={styles.monthTitle}>
            October
            <Icon name="chevron-down" size={16} className={styles.monthCaret} />
          </span>
        }
        compactTitle="October"
        compactTitleVariant="month"
        compactSubtitle={
          <>
            <Money cents={23472} /> left
          </>
        }
        headerRight={
          <GlassGroup label="Month">
            <IconButton icon="chevron-left" label="Previous month, September" iconSize={17} />
            <IconButton icon="chevron-right" label="Next month, November" iconSize={17} />
          </GlassGroup>
        }
        scrollRef={(element) => {
          if (element && scrolled) element.scrollTop = 140
        }}
      >
        <div className={styles.hero}>
          <div className={styles.heroTop}>
            <span className={styles.heroLabel}>Left to spend</span>
            <OnTrack />
          </div>
          <BigAmount cents={23472} className={styles.heroFigure} />
          <p className={styles.sentence}>About 17,34 € a day for the next 14 days</p>
          <p className={styles.subline}>Today: 9,34 € left</p>
        </div>
        <Section title="Recent" action={{ label: 'See all', onClick: () => {} }}>
          <ListRow leading={<CategoryBadge icon="coffee" color="yellow" />} title="Cappuccino" subtitle="Coffee & snacks" value={<Money cents={350} />} note="Today" onClick={() => {}} />
          <ListRow leading={<CategoryBadge icon="fork-knife" color="orange" />} title="Mensa" subtitle="Eating" value={<Money cents={450} />} note="Today" onClick={() => {}} />
          <ListRow leading={<CategoryBadge icon="shopping-cart" color="green" />} title="Edeka" subtitle="Groceries" value={<Money cents={2380} />} note="Yesterday" onClick={() => {}} />
        </Section>
      </Screen>
    </div>
  )
}

function PushedFrame() {
  return (
    <div className={`${styles.frame} ${styles.frameShort}`}>
      <Screen
        title="Coffee & snacks"
        onBack={() => {}}
        backLabel="Daily"
        headerRight={<Button variant="glass">Edit</Button>}
        titleContent={
          <span className={styles.categoryTitle}>
            <CategoryBadge icon="coffee" color="yellow" size="lg" />
            <span className={styles.title1}>Coffee &amp; snacks</span>
          </span>
        }
      >
        <div className={styles.limitCard}>
          <div className={styles.limitLine}>
            <span>Monthly limit</span>
            <Money cents={4000} className={styles.figure} />
          </div>
          <Meter value={3850} max={4000} status="warning" label="Coffee & snacks limit" timeRatio={TODAY_RATIO} verbose trailing="Day 18 of 31" />
        </div>
      </Screen>
    </div>
  )
}

/**
 * Every foundation of the UI kit in realistic states (docs/DESIGN.md §3–§9): the hero figure and
 * the odometer, the ledger, rows, coins, the monogram, engravings, buttons, chips and controls,
 * fields, meters, banners, empty states, pickers, screens and the icon set.
 */
export function FoundationsGallery() {
  return (
    <div className={styles.gallery}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Reference</p>
        <h1 className={styles.largeTitle}>Foundations</h1>
      </header>

      <Board title="Hero figure" note="76px Source Serif 4, proportional figures, the unit at half size in --ink-2. It shrinks to 34px, then drops the cents.">
        <div className={styles.cards}>
          <HeroCard caption="On track">
            <div className={styles.heroTop}>
              <span className={styles.heroLabel}>Left to spend</span>
              <OnTrack />
            </div>
            <BigAmount cents={23472} className={styles.heroFigure} data-testid="hero-left" />
          </HeroCard>
          <HeroCard caption="Over budget">
            <div className={styles.heroTop}>
              <span className={`${styles.heroLabel} ${styles.critical}`}>
                <Icon name="critical" size={16} className={styles.criticalIcon} />
                Over budget by
              </span>
            </div>
            <BigAmount cents={4128} tone="critical" className={styles.heroFigure} />
          </HeroCard>
          <HeroCard caption="Past month, closed">
            <div className={styles.heroTop}>
              <span className={styles.heroLabel}>Left over</span>
            </div>
            <div className={styles.figureRow}>
              <BigAmount cents={5859} className={styles.heroFigure} />
              {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
              <span className={styles.seal} role="img" aria-label="Statement closed on 30 September">
                <Engraving kind="seal" size={54} />
                <span aria-hidden="true">Closed 30 Sep</span>
              </span>
            </div>
          </HeroCard>
          <HeroCard caption="Past month, over">
            <div className={styles.heroTop}>
              <span className={`${styles.heroLabel} ${styles.critical}`}>Over budget by</span>
              {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
              <span className={styles.sealChip} role="img" aria-label="Statement closed on 31 August">
                <Engraving kind="seal" size={22} />
                <span aria-hidden="true">Closed 31 Aug</span>
              </span>
            </div>
            <BigAmount cents={1805} tone="critical" className={styles.heroFigure} />
          </HeroCard>
          <OdometerDemo />
          <HeroCard caption="Hidden amounts, cents off, a prefix unit">
            <MoneyFormatContext value={MASKED}>
              <BigAmount cents={23472} className={styles.heroFigure} />
            </MoneyFormatContext>
            <MoneyFormatContext value={NO_CENTS}>
              <BigAmount cents={23472} className={styles.heroFigure} />
            </MoneyFormatContext>
            <MoneyFormatContext value={DOLLARS}>
              <BigAmount cents={23472} className={styles.heroFigure} />
            </MoneyFormatContext>
          </HeroCard>
          <HeroCard caption="Fit to width: 240px, then 150px">
            <div className={styles.narrow}>
              <BigAmount cents={1234567890} />
            </div>
            <div className={styles.narrower}>
              <BigAmount cents={1234567890} />
            </div>
          </HeroCard>
        </div>
      </Board>

      <Board title="Total figure" note="A total standing alone (category detail, Owed, the Wallet card): 28/32 serif, the unit at 16 in --ink-2, 0.3em away on the locale's side.">
        <div className={`${styles.inset} ${styles.row}`}>
          <TotalFigure cents={3850} />
          <TotalFigure cents={-1200} tone="critical" />
          <MoneyFormatContext value={DOLLARS}>
            <TotalFigure cents={3850} />
          </MoneyFormatContext>
          <MoneyFormatContext value={MASKED}>
            <TotalFigure cents={3850} />
          </MoneyFormatContext>
        </div>
      </Board>

      <Board title="The ledger" note="Bare tabular figures aligned on the decimal separator; only the result carries its unit, hung in the margin.">
        <Ledger title="This month" />
        <Ledger title="Over budget" over />
        <MoneyFormatContext value={DOLLARS}>
          <Ledger title="In dollars" />
        </MoneyFormatContext>
      </Board>

      <Board title="Rows">
        <Section variant="day" title="Today" meta={<Money cents={800} />}>
          <ListRow leading={<CategoryBadge icon="coffee" color="yellow" />} title="Cappuccino" subtitle="Coffee & snacks" value={<Money cents={350} />} onClick={() => {}} data-testid="tx-row" data-id="tx-1" />
          <ListRow leading={<CategoryBadge icon="fork-knife" color="orange" />} title="Mensa" subtitle="Eating" value={<Money cents={450} />} onClick={() => {}} />
          <ListRow leading={<CategoryBadge icon="martini" color="red" />} title="Bar with friends after the seminar on Thursday evening" subtitle="Going out" value={<Money cents={1800} />} onClick={() => {}} />
        </Section>
        <Section variant="form" title="Fixed costs">
          <ListRow title="Rent" subtitle="Due on the 1st" value={<Money cents={64000} />} valueTone="muted" onClick={() => {}} trailing={<PaidCheckDemo initial name="Rent" />} data-testid="recurring-row" data-id="rec-rent" />
          <ListRow title="Netflix" subtitle="Due on the 22nd" value={<Money cents={1399} />} onClick={() => {}} trailing={<PaidCheckDemo initial={false} name="Netflix" />} />
          <ListRow title="Gym" subtitle="Skipped this month" value={<Money cents={2990} />} valueTone="struck" onClick={() => {}} trailing={<span />} />
        </Section>
        <Section variant="form" title="Money" footer="Changing the currency changes the symbol only. Amounts are not converted.">
          <ListRow title="Currency" detail="Euro" chevron onClick={() => {}} />
          <ListRow title="Number format" detail={<Money cents={123456} />} chevron onClick={() => {}} />
          <ListRow title="Category" detail="Subscriptions" chevron="updown" onClick={() => {}} />
          <ListRow title="Stop after October" tinted onClick={() => {}} />
          <ListRow title="Delete" destructive onClick={() => {}} />
        </Section>
        <MoneyFormatContext value={MASKED}>
          <Section variant="form" title="Hidden amounts">
            <ListRow leading={<CategoryBadge icon="coffee" color="yellow" />} title="Cappuccino" subtitle="Coffee & snacks" value={<Money cents={350} />} />
            <ListRow leading={<CategoryBadge icon="fork-knife" color="orange" />} title="Mensa" subtitle="Eating" value={<Money cents={450} />} />
          </Section>
        </MoneyFormatContext>
      </Board>

      <Board title="Coins, monogram, engravings">
        <div className={`${styles.inset} ${styles.row}`}>
          <CategoryBadge icon="shopping-cart" color="green" size="sm" />
          <CategoryBadge icon="shopping-cart" color="green" />
          <CategoryBadge icon="shopping-cart" color="green" size="lg" />
          <CategoryBadge icon="🥐" color="yellow" />
          <CategoryBadge icon="question" color={null} />
          <Monogram name="Alex" avatar="" />
          <Monogram name="Alex" avatar="" size="lg" />
          <Monogram name="Alex" avatar="🦊" size="lg" />
          {/* No name and no emoji: the light person glyph (EXTRAS.md §3.1). */}
          <Monogram name="" avatar="" size="sm" />
          <Monogram name="" avatar="" />
          <Monogram name="" avatar="" size="lg" />
        </div>
        {/* The lock screen's vault: the 236px rosette with the 64px mark at its centre. */}
        <div className={styles.vault}>
          <Engraving kind="rosette" className={styles.rosette} />
          <Icon name="logo" size={64} className={styles.mark} />
        </div>
        <div className={`${styles.inset} ${styles.engravings}`}>
          <span className={styles.seal}>
            <Engraving kind="seal" size={54} />
            Closed 30 Sep
          </span>
          <span className={styles.sealChip}>
            <Engraving kind="seal" size={22} />
            Closed 31 Aug
          </span>
          <Engraving kind="medallion" size={64} />
        </div>
      </Board>

      <Board title="Buttons">
        <div className={`${styles.inset} ${styles.stack}`}>
          <Button variant="primary" size="lg" block>
            Add expense
          </Button>
          <div className={styles.row}>
            <Button variant="secondary">Add your income</Button>
            <Button variant="secondary" size="sm" icon="plus">
              Add
            </Button>
          </div>
          <div className={styles.row}>
            <Button variant="plain">Restore from a backup</Button>
            <Button variant="destructive">Delete</Button>
          </div>
          <div className={styles.row}>
            <IconButton icon="search" label="Search" variant="glass" />
            <IconButton icon="eye" label="Hide amounts" variant="glass" />
            <GlassGroup label="Month">
              <IconButton icon="chevron-left" label="Previous month, September" iconSize={17} />
              <IconButton icon="chevron-right" label="Next month, November" iconSize={17} />
            </GlassGroup>
            <Button variant="glass">Cancel</Button>
            <Button variant="glass" tinted>
              Save
            </Button>
          </div>
          <div className={styles.row}>
            <IconButton icon="plus" label="Add expense" variant="filled" size="lg" />
            <Button variant="destructive" filled>
              Erase
            </Button>
            <Button variant="primary" disabled>
              Add expense
            </Button>
          </div>
        </div>
      </Board>

      <Board title="Chips">
        <ChipsDemo />
      </Board>

      <Board title="Controls">
        <ControlsDemo />
      </Board>

      <Board title="Fields">
        <FieldsDemo />
      </Board>

      <Board title="Meters">
        <Section title="Limits" action={{ label: 'Show all 4', onClick: () => {} }}>
          {(
            [
              ['groceries', 11860, 18000, 'ok'],
              ['coffee', 3850, 4000, 'warning'],
              ['eating', 15660, 15000, 'over'],
            ] as const
          ).map(([key, spent, budget, status]) => (
            <div key={key} className={styles.limit} data-row="coin" data-testid="budget-row" data-id={key}>
              <CategoryBadge icon={CATEGORIES[key].icon} color={CATEGORIES[key].color} />
              <div>
                <div className={styles.limitLine}>
                  <span>{CATEGORIES[key].name}</span>
                  <Money cents={spent} className={styles.figure} />
                </div>
                <Meter value={spent} max={budget} status={status} label={`${CATEGORIES[key].name} limit`} timeRatio={TODAY_RATIO} />
              </div>
            </div>
          ))}
        </Section>
      </Board>

      <Board title="Banners">
        <div className={`${styles.inset} ${styles.stack}`}>
          <Banner tone="info" action={{ label: 'Reload', onClick: () => {} }}>
            A new version of On a Budget is ready.
          </Banner>
          <Banner tone="warning" icon="backup" action={{ label: 'Export backup', onClick: () => {} }} onDismiss={() => {}}>
            Your entries are only on this iPhone. Export a backup to keep them safe.
          </Banner>
          <Banner tone="critical" action={{ label: 'Reload', onClick: () => {} }}>
            Couldn&apos;t save your last changes. Reload to reconnect storage.
          </Banner>
          {/* The month-end review banner (EXTRAS.md §1.6): statement paper and the brass seal. */}
          <Banner
            tone="statement"
            label="October is closed"
            action={{ label: 'See the review', onClick: () => {} }}
            onDismiss={() => {}}
            dismissLabel="Dismiss"
            data-testid="banner-statement"
          >
            <strong>October is closed.</strong> Moved to your wallet: {EUROS.format(13282)}.
          </Banner>
          <Banner
            tone="statement"
            label="September is closed"
            action={{ label: 'See the review', onClick: () => {} }}
            onDismiss={() => {}}
            dismissLabel="Dismiss"
          >
            <strong>September is closed.</strong> Taken from your wallet: {EUROS.format(4128)}.
          </Banner>
        </div>
      </Board>

      <Board title="Empty states">
        <div className={`${styles.inset} ${styles.stack}`}>
          <div className={styles.group}>
            <EmptyState title="Nothing spent this month yet" message="Tap + to add an expense." />
          </div>
          <div className={styles.group}>
            <EmptyState
              icon="fixed"
              title="No fixed costs yet"
              message="Add rent, subscriptions and other costs that repeat every month."
              action={<Button variant="secondary">Add fixed cost</Button>}
            />
          </div>
        </div>
      </Board>

      <Board title="Pickers">
        <PickersDemo />
      </Board>

      <Board
        title="Screens"
        note="The nav row with the monogram and the month stepper; scrolled, the compact header takes over on opaque --bg with an 18px fade. A banner goes into the slot under the title row: 2 below it, 6 above the hero."
      >
        <HomeFrame />
        <HomeFrame scrolled />
        <HomeFrame
          banner={
            <Banner
              tone="statement"
              label="September is closed"
              action={{ label: 'See the review', onClick: () => {} }}
              onDismiss={() => {}}
              dismissLabel="Dismiss"
              data-testid="frame-banner"
            >
              <strong>September is closed.</strong> Moved to your wallet: {EUROS.format(15882)}.
            </Banner>
          }
        />
        <PushedFrame />
      </Board>

      <Board title="Icons" note="Every UI icon in its design weight, and the category glyphs in light.">
        <div className={`${styles.inset} ${styles.icons}`}>
          {UI_ICON_NAMES.map((name) => (
            <span key={name} className={styles.iconCell} title={name}>
              <Icon name={name} size={24} />
            </span>
          ))}
        </div>
        <div className={`${styles.inset} ${styles.icons}`}>
          {CATEGORY_ICONS.map((option) => (
            <span key={option.key} className={styles.iconCell} title={option.name}>
              <CategoryIcon icon={option.key} size={24} />
            </span>
          ))}
        </div>
      </Board>
    </div>
  )
}
