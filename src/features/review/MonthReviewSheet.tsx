import { Fragment, useId } from 'react'
import { useMonthBounds, useNav, type SheetProps } from '@/app/nav'
import { compareISO, formatDate } from '@/domain/dates'
import { sumCents, type MoneyFormat } from '@/domain/money'
import { formatPeriodDates, formatPeriodName } from '@/domain/period'
import { categoryDisplay } from '@/domain/queries'
import type { MonthReview, ReviewCategory } from '@/domain/review'
import { budgetAmount } from '@/domain/splits'
import type { Category, CategoryColor, Cents } from '@/domain/types'
import {
  changeWords,
  closedCaption,
  closedLabel,
  endedBeforeInstall,
  foldNames,
  formatCount,
  heroSentenceParts,
  reviewHero,
  reviewLedger,
  type ChangeWords,
  type ReviewHero,
  type ReviewLedger,
  type SentencePart,
} from '@/features/review/reviewModel'
import styles from '@/features/review/MonthReviewSheet.module.css'
import { useCategoryMap, useMoneyFormat, useMonthReview, useMonthSummary, useSettings, useWallet } from '@/store/hooks'
import { BigAmount, Engraving, Icon, LedgerFigure, Money, SheetHeader, useLedgerColumn, withTrueMinus } from '@/ui'
import { FOLD_KEY, segmentColorVar, StackedBar, type StackedBarSegment } from '@/ui/charts'

/**
 * The month-end review (docs/SPEC.md §3.15, docs/design/EXTRAS.md §1): the statement of a closed
 * period, printed straight onto statement paper (the registry opens it as a large sheet of material
 * 'paper'). Top to bottom: the result and where it went, the month as a sum ("Money in and out"),
 * "Where it went" with the change against the period before, "The month in numbers", a footer.
 * It is computed from the data every time (never stored) and nothing in it moves. It only reads:
 * the taps that open it (Home's "See the review", the review banner) record the review.
 */
export function MonthReviewSheet({ route, onClose }: SheetProps<'monthReview'>) {
  const { month } = route
  const settings = useSettings()
  const { monthStartDay: startDay, locale } = settings
  const review = useMonthReview(month)
  const summary = useMonthSummary(month)
  const previousSummary = useMonthSummary(review.previousMonth)
  const wallet = useWallet()
  const { first } = useMonthBounds()
  const categoryMap = useCategoryMap()
  const money = useMoneyFormat()

  const closed = summary.timing === 'past'
  const name = formatPeriodName(month, startDay, locale)
  const previousName = formatPeriodName(review.previousMonth, startDay, locale)
  // A period before the wallet's start moved nothing into it: Home's past hero and ledger instead.
  const beforeWallet = compareISO(month, wallet.start) < 0
  const hero = reviewHero({ ...review, spent: summary.spent }, beforeWallet)
  const ledger = reviewLedger(review, beforeWallet)
  const end = summary.range.end

  return (
    <>
      <SheetHeader
        title={`${name} statement`}
        subtitle={formatPeriodDates(month, startDay, locale)}
        cancelLabel="Close"
        onCancel={onClose}
        focusCancel
      />
      <div className={styles.body}>
        <Result
          hero={hero}
          money={money}
          seal={closed ? { caption: closedCaption(end, locale), label: closedLabel(end, locale) } : null}
        />
        <MoneyInAndOut ledger={ledger} money={money} walletAfter={beforeWallet ? null : review.walletAfter} />
        <WhereItWent
          name={name}
          daily={review.daily}
          rows={legendRows({
            review,
            // No line 2 when the period before has nothing to compare with (EXTRAS.md §1.4).
            names:
              previousSummary.daily > 0 && compareISO(review.previousMonth, first) >= 0
                ? { period: name, previous: previousName }
                : null,
            categoryMap,
            locale,
            money,
          })}
        />
        <MonthInNumbers
          facts={{
            biggest:
              review.biggestExpense === null
                ? null
                : {
                    cents: budgetAmount(review.biggestExpense),
                    detail: `${
                      review.biggestExpense.note.trim() || categoryDisplay(review.biggestExpense.categoryId, categoryMap).name
                    }, ${formatDate(review.biggestExpense.date, locale, 'medium')}`,
                  },
            noSpendDays: endedBeforeInstall(end, settings.createdAt) ? null : review.noSpendDays,
            entries: review.entries,
            fixedPaid: review.fixedCount > 0 ? { paid: review.fixedPaid, count: review.fixedCount } : null,
            owedOpen: review.owedOpen,
          }}
          locale={locale}
          money={money}
        />
        <p className={styles.footer}>
          {beforeWallet
            ? `Changing entries from ${name} updates this statement.`
            : `Changing entries from ${name} updates this statement and your wallet.`}
        </p>
      </div>
    </>
  )
}

/** An amount as VoiceOver should say it: the formatted amount, or "amount hidden" when masked. */
function spokenAmount(money: MoneyFormat, cents: Cents): string {
  return money.masked ? 'amount hidden' : withTrueMinus(money.format(cents))
}

function spokenParts(parts: readonly SentencePart[], money: MoneyFormat): string {
  return parts.map((part) => (typeof part === 'string' ? part : spokenAmount(money, part.cents))).join('')
}

function Parts({ parts }: { parts: readonly SentencePart[] }) {
  return parts.map((part, index) =>
    typeof part === 'string' ? (
      // The parts never change order within a sentence, so the index is a stable key.
      <Fragment key={index}>{part}</Fragment>
    ) : (
      <Money key={index} cents={part.cents} />
    ),
  )
}

// ---------------------------------------------------------------------------------------------
// The result (EXTRAS.md §1.2)

interface ResultProps {
  hero: ReviewHero
  money: MoneyFormat
  /** The Closed seal and its words; null for a period that is not closed yet. */
  seal: { caption: string; label: string } | null
}

/**
 * The one bold thing of the statement: the label, the figure beside the brass seal, and the
 * sentence. VoiceOver reads it as one sentence ("Moved to your wallet, 132,82 €. 100,00 € of
 * savings and 32,82 € left over. Statement closed on 31 October."), so the printed parts are
 * hidden from it.
 */
function Result({ hero, money, seal }: ResultProps) {
  const parts = hero.sentence === null ? null : heroSentenceParts(hero.sentence)
  const spoken = [
    `${hero.label}, ${spokenAmount(money, hero.cents)}.`,
    parts === null ? null : spokenParts(parts, money),
    seal === null ? null : `${seal.label}.`,
  ]
    .filter((part) => part !== null)
    .join(' ')
  return (
    <section className={styles.result}>
      <p className="visually-hidden">{spoken}</p>
      <div aria-hidden="true">
        <p className={hero.critical ? styles.labelCritical : styles.label}>
          {hero.critical && <Icon name="critical" size={16} className={styles.labelIcon} />}
          {hero.label}
        </p>
        <div className={styles.figureRow}>
          <BigAmount
            cents={hero.cents}
            tone={hero.critical ? 'critical' : 'default'}
            className={styles.figure}
            data-testid="review-result"
          />
          {seal !== null && (
            <div className={styles.seal}>
              <Engraving kind="seal" size={54} />
              <span className={styles.sealCaption}>{seal.caption}</span>
            </div>
          )}
        </div>
        {parts !== null && (
          <p className={styles.sentence}>
            <Parts parts={parts} />
          </p>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Money in and out (EXTRAS.md §1.3)

interface SectionHeadingProps {
  id: string
  title: string
  /** A money figure at the end of the heading (serif, --ink-2). */
  meta?: Cents
}

/** A review section's heading: Headline, an optional figure, and the printed rule 9 below. */
function SectionHeading({ id, title, meta }: SectionHeadingProps) {
  return (
    <div className={styles.heading}>
      <h3 id={id} className={styles.headingTitle}>
        {title}
      </h3>
      {meta !== undefined && (
        <span className={styles.headingMeta}>
          <Money cents={meta} />
        </span>
      )}
    </div>
  )
}

interface MoneyInAndOutProps {
  ledger: ReviewLedger
  money: MoneyFormat
  /** The wallet's balance after the period closed; null for a period before the wallet's start. */
  walletAfter: Cents | null
}

function openWallet(): void {
  // navigate closes every sheet, this one included.
  useNav.getState().navigate('wallet')
}

/**
 * The month written as a sum that ends where the money went: the ledger of DESIGN.md §9.6 printed
 * on the paper (no group), then the carry row to the Wallet.
 */
function MoneyInAndOut({ ledger, money, walletAfter }: MoneyInAndOutProps) {
  const headingId = useId()
  const columnRef = useLedgerColumn<HTMLTableElement>()
  const { result } = ledger
  const short = walletAfter !== null && walletAfter < 0
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <SectionHeading id={headingId} title="Money in and out" />
      {/* A table with row headers (DESIGN.md §12); the operators are print, not data. */}
      <table ref={columnRef} aria-labelledby={headingId} className={styles.ledger}>
        <tbody>
          {ledger.lines.map((line) => (
            <tr key={line.key} className={styles.line} data-testid={`review-${line.key}`}>
              <td className={styles.operator} aria-hidden="true">
                <span className={styles.operatorGlyph}>{line.operator}</span>
              </td>
              <th scope="row" className={styles.lineLabel}>
                {line.label}
              </th>
              <td className={styles.lineFigure}>
                <LedgerFigure cents={line.cents} />
              </td>
            </tr>
          ))}
          <tr className={result.critical ? styles.resultLineCritical : styles.resultLine} data-testid="review-result-line">
            <td className={styles.operator} aria-hidden="true">
              <span className={styles.operatorGlyph}>=</span>
            </td>
            <th scope="row" className={styles.lineLabel}>
              {result.label}
            </th>
            <td className={styles.lineFigure}>
              <LedgerFigure
                cents={result.cents}
                result
                tone={result.critical ? 'critical' : 'default'}
                className={styles.resultFigure}
              />
            </td>
          </tr>
        </tbody>
      </table>
      {walletAfter !== null && (
        <button
          type="button"
          className={styles.carry}
          onClick={openWallet}
          aria-label={`Wallet after closing, ${short ? 'short by ' : ''}${spokenAmount(money, Math.abs(walletAfter))}`}
          data-testid="review-wallet"
        >
          <span className={styles.carryText} aria-hidden="true">
            {'Wallet after closing: '}
            {short ? (
              <>
                {'short by '}
                <Money cents={-walletAfter} tone="critical" />
              </>
            ) : (
              <Money cents={walletAfter} className={styles.carryValue} />
            )}
          </span>
          <Icon name="chevron-right" size={14} className={styles.chevron} />
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Where it went (EXTRAS.md §1.4)

interface LegendRow {
  key: string
  color: CategoryColor | 'other'
  name: string
  cents: Cents
  /** Line 2: the change words, the folded names (no arrow), or nothing. */
  line2: ChangeWords | null
  /** The whole row for VoiceOver: "Groceries, 186,30 €, 8 percent more than September". */
  spoken: string
}

interface LegendInput {
  review: Pick<MonthReview, 'categories' | 'rest'>
  /** The names the change words use; null hides every change line. */
  names: { period: string; previous: string } | null
  categoryMap: Readonly<Record<string, Category>>
  locale: string
  money: MoneyFormat
}

/**
 * One row per segment, in segment order: the top five, then the categories past them
 * (MonthReview.rest) folded into "2 more" with their names, or the single remaining category by
 * name with its change.
 */
function legendRows({ review, names, categoryMap, locale, money }: LegendInput): LegendRow[] {
  const row = ({ categoryId, daily, change }: ReviewCategory): LegendRow => {
    const category = categoryDisplay(categoryId, categoryMap)
    const line2 = names === null ? null : changeWords(change, names, locale)
    return {
      key: categoryId,
      color: category.color ?? 'other',
      name: category.name,
      cents: daily,
      line2,
      spoken: [category.name, spokenAmount(money, daily), line2?.spoken].filter(Boolean).join(', '),
    }
  }
  const rows = review.categories.map(row)
  const { rest } = review
  const [single] = rest
  if (rest.length === 1 && single !== undefined) {
    rows.push(row(single))
  } else if (rest.length > 1) {
    const cents = sumCents(rest.map((category) => category.daily))
    const name = `${rest.length} more`
    const text = foldNames(rest.map((category) => categoryDisplay(category.categoryId, categoryMap).name))
    rows.push({
      key: FOLD_KEY,
      color: 'other',
      name,
      cents,
      line2: { arrow: null, text, spoken: text },
      spoken: `${name}, ${spokenAmount(money, cents)}, ${text}`,
    })
  }
  return rows
}

interface WhereItWentProps {
  name: string
  daily: Cents
  rows: LegendRow[]
}

/** The stacked bar of daily spending by category and its legend, with the change in words. */
function WhereItWent({ name, daily, rows }: WhereItWentProps) {
  const headingId = useId()
  if (rows.length === 0) return null
  const segments: StackedBarSegment[] = rows.map((row) => ({ key: row.key, value: row.cents, color: row.color, label: row.name }))
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <SectionHeading id={headingId} title="Where it went" meta={daily} />
      <StackedBar segments={segments} label={`Daily spending in ${name} by category`} className={styles.bar} />
      <ul className={styles.legend}>
        {rows.map((row) => (
          <li key={row.key} className={styles.legendRow} data-testid="review-category" data-id={row.key}>
            <span className="visually-hidden">{row.spoken}</span>
            <span
              className={styles.dot}
              style={{ background: `var(${segmentColorVar(row.color)})` }}
              aria-hidden="true"
            />
            <span className={styles.legendName} aria-hidden="true">
              {row.name}
            </span>
            <span className={styles.legendValue} aria-hidden="true">
              <Money cents={row.cents} />
            </span>
            {row.line2 !== null && (
              <span className={styles.change} aria-hidden="true">
                {row.line2.arrow !== null && (
                  <Icon name={row.line2.arrow === 'up' ? 'arrow-up' : 'arrow-down'} size={13} className={styles.changeIcon} />
                )}
                {row.line2.text}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// The month in numbers (EXTRAS.md §1.5)

interface Facts {
  biggest: { cents: Cents; detail: string } | null
  /** null hides the row: the period ended before the install, so no day was tracked. */
  noSpendDays: number | null
  entries: number
  /** null hides the row: the period had no fixed costs due. */
  fixedPaid: { paid: number; count: number } | null
  owedOpen: Cents
}

function openOwed(): void {
  // Owed to you lives on the Home stack (SPEC §3.16); navigate closes this sheet on the way.
  useNav.getState().navigate('home', { name: 'owed' })
}

function MonthInNumbers({ facts, locale, money }: { facts: Facts; locale: string; money: MoneyFormat }) {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <SectionHeading id={headingId} title="The month in numbers" />
      <dl className={styles.facts}>
        {facts.biggest !== null && (
          <div className={styles.fact} data-testid="review-biggest">
            <dt className={styles.factLabel}>Biggest expense</dt>
            <dd className={styles.factMoney}>
              <Money cents={facts.biggest.cents} />
            </dd>
            <dd className={styles.factDetail}>{facts.biggest.detail}</dd>
          </div>
        )}
        {facts.noSpendDays !== null && (
          <div className={styles.fact} data-testid="review-no-spend-days">
            <dt className={styles.factLabel}>Days without spending</dt>
            <dd className={styles.factCount}>{facts.noSpendDays === 0 ? 'None' : formatCount(facts.noSpendDays, locale)}</dd>
          </div>
        )}
        <div className={styles.fact} data-testid="review-entries">
          <dt className={styles.factLabel}>Entries</dt>
          <dd className={styles.factCount}>{formatCount(facts.entries, locale)}</dd>
        </div>
        {facts.fixedPaid !== null && (
          <div className={styles.fact} data-testid="review-fixed-paid">
            <dt className={styles.factLabel}>Fixed costs paid</dt>
            <dd className={styles.factCount}>
              {`${formatCount(facts.fixedPaid.paid, locale)} of ${formatCount(facts.fixedPaid.count, locale)}`}
            </dd>
          </div>
        )}
        {facts.owedOpen > 0 && (
          <div className={styles.factLink}>
            <dt className={styles.factLabel}>Still owed to you</dt>
            <dd className={styles.factMoney}>
              {/* The whole row is this button (its hit area covers the row); named by the row. */}
              <button
                type="button"
                className={styles.factButton}
                onClick={openOwed}
                aria-label={`Still owed to you, ${spokenAmount(money, facts.owedOpen)}`}
                data-testid="review-owed"
              >
                <span aria-hidden="true">
                  <Money cents={facts.owedOpen} />
                </span>
                <Icon name="chevron-right" size={14} className={styles.chevron} />
              </button>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}
