import { useNav } from '@/app/nav'
import { compareISO } from '@/domain/dates'
import { formatPeriodTitle, periodOf } from '@/domain/period'
import type { MonthKey } from '@/domain/types'
import { cx } from '@/features/wallet/classes'
import styles from '@/features/wallet/WalletCard.module.css'
import {
  balanceLabel,
  closedPhrase,
  pendingPhrase,
  phraseText,
  type Phrase,
} from '@/features/wallet/walletText'
import { useData, useMoneyFormat, useWallet } from '@/store/hooks'
import { useToday } from '@/store/today'
import { Icon, Money, Section } from '@/ui'

function openWallet(): void {
  useNav.getState().navigate('wallet')
}

/**
 * The Home Wallet card (docs/SPEC.md §3.1 `wallet`, DESIGN.md §9.26 "The Home Wallet card"): today's
 * balance closed by the brass double rule (critical, with "Short by", below zero), then what the
 * selected month does to it: "October adds 334,72 € when it closes" for the current period,
 * "September added 158,82 €" for a past one the wallet counts, nothing for a future one or one
 * before the wallet's start. The whole card is one button to the Wallet tab.
 */
export function WalletCard({ month }: { month: MonthKey }) {
  const wallet = useWallet()
  const money = useMoneyFormat()
  const startDay = useData((d) => d.settings.monthStartDay)
  const locale = useData((d) => d.settings.locale)
  const today = useToday()
  const current = periodOf(today, startDay)
  const name = formatPeriodTitle(month, current, startDay, locale)

  let phrase: Phrase | null = null
  if (month === current) {
    phrase = wallet.pending === null ? null : pendingPhrase(name, wallet.pending)
  } else if (compareISO(month, current) < 0) {
    // A closed period the wallet counts has its closing in the passbook; one before the start has none.
    const closing = wallet.movements.find((movement) => movement.kind === 'month' && movement.month === month)
    phrase = closing === undefined ? null : closedPhrase(name, closing.amount)
  }

  const { balance } = wallet
  // A wallet with nothing to say (a first run, or only months that closed at 0,00 €) leaves the
  // card out, like every Home card with nothing to show (SPEC §3.1).
  const empty =
    balance === 0 && (wallet.pending ?? 0) === 0 && wallet.movements.every((movement) => movement.amount === 0)
  if (empty) return null
  const short = balance < 0
  const parts = money.parts(Math.abs(balance))
  const label = [balanceLabel(money, balance), phrase === null ? null : phraseText(phrase, money, true)]
    .filter((part) => part !== null)
    .map((part) => `${part}.`)
    .join(' ')

  const unit = <span className={cx(styles.unit, parts.symbolFirst ? styles.unitBefore : styles.unitAfter)}>{parts.symbol}</span>
  return (
    <Section title="Wallet" data-testid="wallet-card-section">
      <button type="button" className={styles.card} aria-label={label} onClick={openWallet} data-testid="wallet-card">
        {short && (
          <span className={styles.status}>
            <Icon name="critical" size={16} className={styles.statusIcon} />
            Short by
          </span>
        )}
        <span className={styles.top}>
          <span
            className={cx(styles.figure, short && styles.critical, money.masked && styles.masked)}
            data-testid="wallet-card-balance"
          >
            {/* The absolute balance (the words say "short by"); masked, "•••" without a unit. */}
            {!money.masked && parts.symbolFirst && unit}
            <span className={styles.number}>{parts.number}</span>
            {!money.masked && !parts.symbolFirst && unit}
          </span>
          <Icon name="chevron-right" size={14} className={styles.chevron} />
        </span>
        {phrase !== null && (
          <span className={styles.line} data-testid="wallet-card-line">
            {phrase.before}
            {/* Hidden, the amount is "•••" in --ink-3 (Money's masked style). */}
            <Money cents={phrase.amount} className={money.masked ? undefined : styles.lineAmount} />
            {phrase.after}
          </span>
        )}
      </button>
    </Section>
  )
}
