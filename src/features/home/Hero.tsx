import type { MonthSummary } from '@/domain/summary'
import type { HeroText } from '@/features/home/heroText'
import { BigAmount, Button, Engraving, Icon, MaskedText } from '@/ui'
import { PaceBar } from '@/ui/charts'
import styles from './Hero.module.css'

export interface HeroProps {
  summary: MonthSummary
  text: HeroText
  /** A past period's seal: "Closed 30 Sep" under the brass engraving (DESIGN.md §3.2). */
  closedCaption: string | null
  onAddIncome(): void
  onReviewFixed(): void
}

/**
 * The hero of Home (docs/SPEC.md §3.1, DESIGN.md §9.4): the label row with the pace status, the
 * figure (the odometer rolls it when an entry changes it), the sentence, the today, ahead and
 * wallet lines, a past period's Closed seal, the button of a state that needs one, and the pace bar.
 *
 * VoiceOver reads the words and the figure as one sentence (HeroText.speech): they sit in one
 * named picture, so a swipe gives "Left to spend, 234,72 €. On track. About …". The figure is no
 * live region; the name carries the final value at once. Buttons and the pace bar stay outside it.
 */
export function Hero({ summary, text, closedCaption, onAddIncome, onReviewFixed }: HeroProps) {
  const critical = text.labelTone === 'critical'
  const figure = (
    <BigAmount
      // A new figure (another period, or another kind of figure) appears without rolling.
      key={`${summary.month}|${text.figureKey}`}
      cents={text.figure}
      tone={text.figureTone}
      animate
      className={styles.figure}
      data-testid="hero-left"
    />
  )

  return (
    <div className={styles.hero} data-kind={text.kind}>
      {/* The hero's words read as one sentence, which needs one named element; an <img> cannot
          hold the text and figure that draw it. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <div role="img" aria-label={text.speech} className={styles.words}>
        <div className={styles.labelRow}>
          <span className={critical ? styles.labelCritical : styles.label}>
            {critical && <Icon name="critical" size={16} className={styles.criticalIcon} />}
            <span>{text.label}</span>
          </span>
          {text.status === 'onTrack' && (
            <span className={styles.status}>
              <Icon name="on-track" size={16} />
              On track
            </span>
          )}
          {text.status === 'fast' && (
            <span className={styles.statusFast}>
              <Icon name="warning" size={16} className={styles.warningIcon} />
              Spending fast
            </span>
          )}
        </div>

        {closedCaption === null ? (
          figure
        ) : (
          <div className={styles.figureRow}>
            {figure}
            <span className={styles.seal}>
              <Engraving kind="seal" size={54} />
              <span>{closedCaption}</span>
            </span>
          </div>
        )}

        {text.sentence !== null && (
          <p className={styles.sentence} data-testid={text.perDay ? 'hero-per-day' : undefined}>
            <MaskedText text={text.sentence} />
          </p>
        )}
        {text.today !== null && (
          <p className={text.today.over ? styles.warningLine : styles.subline} data-testid="hero-today">
            {text.today.over && <Icon name="warning" size={16} className={styles.warningIcon} />}
            <span>
              <MaskedText text={text.today.text} />
            </span>
          </p>
        )}
        {text.ahead !== null && (
          <p className={styles.warningLine} data-testid="hero-ahead">
            <Icon name="warning" size={16} className={styles.warningIcon} />
            <span>
              <MaskedText text={text.ahead} />
            </span>
          </p>
        )}
        {text.wallet !== null && (
          <p className={styles.walletLine} data-testid="hero-wallet">
            <MaskedText text={text.wallet} />
          </p>
        )}
      </div>

      {text.action === 'addIncome' && (
        <Button variant="secondary" size="md" className={styles.action} onClick={onAddIncome}>
          Add your income
        </Button>
      )}
      {text.action === 'reviewFixed' && (
        <Button variant="secondary" size="md" className={styles.action} onClick={onReviewFixed}>
          Review fixed costs
        </Button>
      )}
      {text.pace && (
        <PaceBar
          spent={summary.daily}
          available={summary.available}
          timeRatio={summary.pace.timeRatio}
          status={summary.pace.status}
          days={summary.days}
          className={styles.pace}
        />
      )}
    </div>
  )
}
