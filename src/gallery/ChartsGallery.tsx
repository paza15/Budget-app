import { type CSSProperties, type ReactNode, useState } from 'react'
import { formatDate, toISODate } from '@/domain/dates'
import { createMoneyFormat } from '@/domain/money'
import {
  type ChartSeries,
  ColumnChart,
  type ColumnDatum,
  foldSegments,
  formatShare,
  Legend,
  PaceBar,
  segmentColorVar,
  StackedBar,
  type StackedBarSegment,
  StackedColumnChart,
  type StackedColumnDatum,
} from '@/ui/charts'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { MoneyFormatContext, useMoneyFormatContext } from '@/ui/MoneyFormatContext'

// ── Sample data (docs/DESIGN.md: October 2026, today Sunday 18 October, day 18 of 31) ────────

const LOCALE = 'de-DE'
const INCOME = 145000
const FIXED = 77888
const SAVINGS = 10000
const AVAILABLE = INCOME - FIXED - SAVINGS // 571,12 €
const TODAY_INDEX = 18
const OCTOBER_DAYS = 31

/** Daily spending per day, 1–18 October; sums to 336,40 €. */
const OCTOBER_SPENDING = [
  1240, 3120, 890, 2250, 680, 1430, 2760, 970, 1820, 450, 3540, 1690, 1130, 2410, 2480, 1680, 4300, 800,
]

/** Coffee & snacks per day, 1–18 October (category detail). */
const COFFEE_SPENDING = [0, 380, 0, 350, 120, 0, 350, 0, 220, 470, 0, 350, 120, 380, 350, 0, 120, 350]

/** September, 30 days, adding up to 512,30 €. */
const SEPTEMBER_SPENDING = withTotal(
  [
    1650, 2240, 980, 1720, 3100, 1240, 760, 2030, 1450, 1980, 2650, 1120, 870, 2340, 1560, 1890, 3220, 940, 1310,
    2080, 1770, 1030, 2460, 1190, 1640, 2810, 1380, 990, 1710,
  ],
  51230,
)

const WHERE_IT_WENT: StackedBarSegment[] = [
  { key: 'cat-groceries', label: 'Groceries', color: 'green', value: 11860 },
  { key: 'cat-eating', label: 'Eating', color: 'orange', value: 9630 },
  { key: 'cat-going-out', label: 'Going out', color: 'red', value: 5200 },
  { key: 'cat-coffee', label: 'Coffee & snacks', color: 'yellow', value: 3850 },
  { key: 'cat-shopping', label: 'Shopping', color: 'magenta', value: 2100 },
  { key: 'cat-transport', label: 'Transport', color: 'aqua', value: 1000 },
]

const MORE_CATEGORIES: StackedBarSegment[] = [
  ...WHERE_IT_WENT,
  { key: 'cat-health', label: 'Health', color: 'blue', value: 650 },
  { key: 'cat-other', label: 'Other', color: 'slate', value: 400 },
]

const TREND_SERIES: ChartSeries[] = [
  { key: 'fixed', label: 'Fixed costs', cssVar: '--chart-fixed' },
  { key: 'daily', label: 'Daily spending', cssVar: '--chart-daily' },
  { key: 'income', label: 'Income', cssVar: '--chart-ref', kind: 'line' },
]

const TREND: StackedColumnDatum[] = [
  ['05', 'May', 'May', 77888, 48210],
  ['06', 'Jun', 'June', 77888, 52990],
  ['07', 'Jul', 'July', 77888, 61500],
  ['08', 'Aug', 'August', 74890, 58917],
  ['09', 'Sep', 'September', 77888, 51230],
  ['10', 'Oct', 'October', 77888, 33640],
].map(([month, label, name, fixed, daily]) => ({
  key: `2026-${month}`,
  label: String(label),
  title: `${String(name)} 2026`,
  values: { fixed: Number(fixed), daily: Number(daily), income: INCOME },
}))

const MASKED_FORMAT = createMoneyFormat({ currency: 'EUR', locale: LOCALE, showCents: true, masked: true })

/** Pads `values` with one last day so they add up to `total`. */
function withTotal(values: number[], total: number): number[] {
  return [...values, total - values.reduce((sum, value) => sum + value, 0)]
}

/** One datum per day of the month, from 1st October (or September), zero after the data. */
function dailyData(month: number, days: number, spending: readonly number[]): ColumnDatum[] {
  return Array.from({ length: days }, (_, index) => {
    const date = toISODate(2026, month, index + 1)
    return {
      key: date,
      label: formatDate(date, LOCALE, 'short'),
      title: formatDate(date, LOCALE, 'medium'),
      value: spending[index] ?? 0,
    }
  })
}

const OCTOBER = dailyData(10, OCTOBER_DAYS, OCTOBER_SPENDING)
const OCTOBER_COFFEE = dailyData(10, OCTOBER_DAYS, COFFEE_SPENDING)
const SEPTEMBER = dailyData(9, 30, SEPTEMBER_SPENDING)
const TODAY_KEY = toISODate(2026, 10, TODAY_INDEX)

// ── Layout (the app's section and group styles, from tokens) ────────────────────────────────

const styles = {
  page: {
    display: 'grid',
    gap: 'var(--space-8)',
    margin: '0 var(--space-1)',
    color: 'var(--ink)',
    font: 'var(--text-body)',
  },
  section: { display: 'grid', gap: 'var(--space-3)' },
  title: { margin: 0, font: 'var(--text-title3)', color: 'var(--ink)' },
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' },
  meta: { font: 'var(--text-figure-sm)', color: 'var(--ink-2)', whiteSpace: 'nowrap' },
  note: { margin: 0, font: 'var(--text-footnote)', color: 'var(--ink-3)' },
  hero: { display: 'grid', gap: 'var(--space-5)' },
  breakdown: {
    padding: 'var(--space-4) var(--group-padding) calc(var(--space-1) + var(--space-0-5))',
    background: 'var(--surface)',
    borderRadius: 'var(--radius-lg)',
  },
  legend: { marginTop: 'var(--space-2)' },
  plusLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    minHeight: 'var(--touch-min)',
    marginTop: 'var(--space-1)',
    borderTop: 'var(--hairline-width) solid var(--hairline)',
    font: 'var(--text-subhead)',
    color: 'var(--ink-2)',
  },
  chevron: { marginLeft: 'auto', color: 'var(--ink-3)' },
  chartGroup: {
    padding: 'calc(var(--space-3) + var(--space-0-5)) var(--group-padding) calc(var(--space-2) + var(--space-0-5))',
    background: 'var(--surface)',
    borderRadius: 'var(--radius-lg)',
  },
  button: {
    minHeight: 'var(--touch-min)',
    padding: '0 var(--space-4)',
    border: 0,
    borderRadius: 'var(--radius-pill)',
    background: 'var(--surface-2)',
    font: 'var(--text-subhead)',
    fontWeight: 600,
    color: 'var(--accent-ink)',
  },
} satisfies Record<string, CSSProperties>

function Section({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section style={styles.section} aria-label={title}>
      <div style={styles.head}>
        <h2 style={styles.title}>{title}</h2>
        {meta !== undefined && <span style={styles.meta}>{meta}</span>}
      </div>
      {children}
    </section>
  )
}

function Example({ note, children }: { note: string; children: ReactNode }) {
  return (
    <div>
      <p style={{ ...styles.note, marginBottom: 'var(--space-2)' }}>{note}</p>
      {children}
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────────────────────

function PaceBars() {
  const [extra, setExtra] = useState(0)
  const timeRatio = TODAY_INDEX / OCTOBER_DAYS
  return (
    <Section title="Pace bar">
      <div style={styles.hero}>
        <Example note="On track: day 18 of 31">
          <PaceBar spent={33640 + extra} available={AVAILABLE} timeRatio={timeRatio} status="ok" days={OCTOBER_DAYS} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button type="button" style={styles.button} onClick={() => setExtra((value) => value + 2450)}>
              Add 24,50 €
            </button>
            <button type="button" style={styles.button} onClick={() => setExtra(0)}>
              Reset
            </button>
          </div>
        </Example>
        <Example note="Spending fast">
          <PaceBar spent={39980} available={AVAILABLE} timeRatio={timeRatio} status="ahead" days={OCTOBER_DAYS} />
        </Example>
        <Example note="Over budget">
          <PaceBar spent={61240} available={AVAILABLE} timeRatio={timeRatio} status="over" days={OCTOBER_DAYS} />
        </Example>
        <Example note="Past month: September, closed">
          <PaceBar spent={51230} available={AVAILABLE} timeRatio={null} status="ok" days={30} />
        </Example>
        <Example note="Past month, over: August">
          <PaceBar spent={58917} available={AVAILABLE} timeRatio={null} status="over" days={31} />
        </Example>
      </div>
    </Section>
  )
}

function WhereItWent({ segments, title = 'Where it went' }: { segments: readonly StackedBarSegment[]; title?: string }) {
  const money = useMoneyFormatContext()
  const folded = foldSegments(segments)
  const total = folded.reduce((sum, segment) => sum + segment.value, 0)
  return (
    <Section title={title} meta={<Money cents={total} />}>
      <div style={styles.breakdown}>
        <StackedBar segments={folded} label="Daily spending by category" />
        <div style={styles.legend}>
          <Legend
            label="Categories"
            itemTestId="category-row"
            onSelect={() => {}}
            items={folded.map((segment) => ({
              key: segment.key,
              label: segment.label,
              cssVar: segmentColorVar(segment.color),
              value: <Money cents={segment.value} />,
              meta: formatShare(segment.value / total, money.locale),
            }))}
          />
        </div>
        <div style={styles.plusLine}>
          Plus {money.format(FIXED)} in fixed costs
          <span style={styles.chevron}>
            <Icon name="chevron-right" weight="bold" size={14} />
          </span>
        </div>
      </div>
    </Section>
  )
}

function DailyCharts() {
  const money = useMoneyFormatContext()
  return (
    <Section title="Daily">
      <Example note="Current month: the allowance runs from today">
        <div style={styles.chartGroup}>
          <ColumnChart
            data={OCTOBER}
            label="Spending per day in October"
            highlightKey={TODAY_KEY}
            highlightLabel="Today"
            reference={{ value: 1734, label: (value) => `${value} a day`, from: TODAY_KEY }}
          />
        </div>
      </Example>
      <Example note="Past month: the daily budget across the month">
        <div style={styles.chartGroup}>
          <ColumnChart
            data={SEPTEMBER}
            label="Spending per day in September"
            reference={{ value: Math.floor(AVAILABLE / 30), label: (value) => `Daily budget ${value}` }}
          />
        </div>
      </Example>
      <Example note="Category detail: Coffee & snacks">
        <div style={styles.chartGroup}>
          <ColumnChart
            data={OCTOBER_COFFEE}
            label="Coffee and snacks per day in October"
            height={64}
            cssVar="--cat-yellow"
            highlightKey={TODAY_KEY}
            highlightLabel="Today"
            formatValue={(value) => money.format(value)}
          />
        </div>
      </Example>
      <Example note="Kit option: a hairline value grid, labelled after the plot">
        <div style={styles.chartGroup}>
          <ColumnChart
            data={OCTOBER}
            label="Spending per day in October, with a value grid"
            highlightKey={TODAY_KEY}
            highlightLabel="Today"
            reference={{ value: 1734, label: (value) => `${value} a day`, from: TODAY_KEY }}
            grid
          />
        </div>
      </Example>
    </Section>
  )
}

function Trend({ initial }: { initial: string | null }) {
  const [selected, setSelected] = useState<string | null>(initial)
  return (
    <Section title="Last 6 months">
      <div style={styles.chartGroup}>
        <StackedColumnChart
          data={TREND}
          series={TREND_SERIES}
          label="Fixed costs and daily spending, May to October"
          highlightKey="2026-10"
          selectedKey={selected}
          onSelect={setSelected}
        />
      </div>
    </Section>
  )
}

/** Every chart with the DESIGN.md sample data, then the same charts with amounts hidden. */
export function ChartsGallery() {
  return (
    <div style={styles.page} data-testid="charts-gallery">
      <PaceBars />
      <WhereItWent segments={WHERE_IT_WENT} />
      <WhereItWent segments={MORE_CATEGORIES} title="Where it went, folded" />
      <DailyCharts />
      <Section title="Daily, tapped">
        <TappedDaily />
      </Section>
      <Trend initial="2026-09" />
      <MoneyFormatContext value={MASKED_FORMAT}>
        <Section title="Amounts hidden">
          <PaceBar spent={33640} available={AVAILABLE} timeRatio={TODAY_INDEX / OCTOBER_DAYS} status="ok" days={31} />
        </Section>
        <WhereItWent segments={WHERE_IT_WENT} title="Where it went, hidden" />
        <Section title="Daily, hidden">
          <TappedDaily />
        </Section>
        <Trend initial="2026-10" />
      </MoneyFormatContext>
    </div>
  )
}

function TappedDaily() {
  const [selected, setSelected] = useState<string | null>(toISODate(2026, 10, 16))
  return (
    <div style={styles.chartGroup}>
      <ColumnChart
        data={OCTOBER}
        label="Spending per day in October"
        highlightKey={TODAY_KEY}
        highlightLabel="Today"
        reference={{ value: 1734, label: (value) => `${value} a day`, from: TODAY_KEY }}
        selectedKey={selected}
        onSelect={setSelected}
      />
    </div>
  )
}
