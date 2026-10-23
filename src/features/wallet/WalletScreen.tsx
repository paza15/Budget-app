import { useState } from 'react'
import { useNav } from '@/app/nav'
import { formatPeriodTitle, periodOf } from '@/domain/period'
import type { Cents, ISODate } from '@/domain/types'
import type { WalletSummary } from '@/domain/wallet'
import { AmountsButton } from '@/features/wallet/AmountsButton'
import { GoalsSection } from '@/features/wallet/Goals'
import { Passbook } from '@/features/wallet/Passbook'
import styles from '@/features/wallet/WalletScreen.module.css'
import {
  balanceLabel,
  compactBalance,
  pendingPhrase,
  phraseText,
  spokenMoney,
  moneyText,
} from '@/features/wallet/walletText'
import { useData, useMoneyFormat, useWallet } from '@/store/hooks'
import { useToday } from '@/store/today'
import { BigAmount, Button, Icon, ListRow, Screen, Section } from '@/ui'

/**
 * The Wallet tab (docs/SPEC.md §3.12 to §3.14, DESIGN.md §9.26): a savings passbook. The balance is
 * the screen's title (no eyebrow, no month stepper, no large-title row), then what the open month
 * will add, the two entry buttons, the goals the balance fills, the passbook and the settings row.
 * Every figure comes from walletSummary (useWallet).
 */

function openEntry(kind: 'deposit' | 'withdrawal'): void {
  useNav.getState().openSheet({ name: 'walletEntry', kind })
}

function openSettings(): void {
  useNav.getState().openSheet({ name: 'walletSettings' })
}

/**
 * Whether the balance may roll (the odometer, DESIGN.md §3.3): it answers what the user did, so a
 * balance that changes because the day turned (a month closing at midnight) arrives quietly. The
 * balance seen when the day turned is remembered until it changes again; React's pattern for
 * information from earlier renders (state adjusted during render), never an effect.
 */
function useRollingBalance(balance: Cents, today: ISODate): boolean {
  const [turn, setTurn] = useState<{ today: ISODate; quiet: Cents | null }>({ today, quiet: null })
  if (turn.today !== today) setTurn({ today, quiet: balance })
  else if (turn.quiet !== null && turn.quiet !== balance) setTurn({ today, quiet: null })
  return turn.today === today && turn.quiet === null
}

export function WalletScreen() {
  const wallet = useWallet()
  const money = useMoneyFormat()
  const startDay = useData((d) => d.settings.monthStartDay)
  const locale = useData((d) => d.settings.locale)
  const today = useToday()
  const current = periodOf(today, startDay)
  const animate = useRollingBalance(wallet.balance, today)

  return (
    <Screen
      title="Wallet"
      titleContent={<WalletHero wallet={wallet} periodName={formatPeriodTitle(current, current, startDay, locale)} animate={animate} />}
      headerRight={<AmountsButton />}
      compactSubtitle={compactBalance(money, wallet.balance)}
      // The balance is the screen's hero: banners go above it, under the nav row.
      bannerSlot="beforeTitle"
    >
      <div className={styles.body}>
        <div className={styles.actions}>
          <Button variant="secondary" block className={styles.action} onClick={() => openEntry('deposit')} data-testid="wallet-add">
            Add money
          </Button>
          <Button
            variant="secondary"
            block
            className={styles.action}
            onClick={() => openEntry('withdrawal')}
            data-testid="wallet-take"
          >
            Take money out
          </Button>
        </div>
        <GoalsSection goals={wallet.goals} doneGoals={wallet.doneGoals} />
        <Passbook movements={wallet.movements} />
        <Section className={styles.settings}>
          <ListRow title="Wallet settings" chevron onClick={openSettings} data-testid="wallet-settings" />
        </Section>
      </div>
    </Screen>
  )
}

interface WalletHeroProps {
  wallet: WalletSummary
  /** The current period's name: "October". */
  periodName: string
  animate: boolean
}

/**
 * The hero: "Wallet" (or "Short by" below zero), the balance as the big figure, what the open
 * month adds when it closes (hidden while it is before the wallet's start) and, with active goals
 * and a balance of 0 or more, what the goals leave free. VoiceOver reads it as one label.
 */
function WalletHero({ wallet, periodName, animate }: WalletHeroProps) {
  const money = useMoneyFormat()
  const { balance, pending, free, goals } = wallet
  const short = balance < 0
  const phrase = pending === null ? null : pendingPhrase(periodName, pending)
  const showFree = goals.length > 0 && !short
  const label = [
    balanceLabel(money, balance),
    phrase === null ? null : phraseText(phrase, money, true),
    showFree ? `Not set aside: ${spokenMoney(money, free)}` : null,
  ]
    .filter((part) => part !== null)
    .map((part) => `${part}.`)
    .join(' ')

  return (
    <div className={styles.hero} data-testid="wallet-hero">
      <p className="visually-hidden">{label}</p>
      <div aria-hidden="true">
        <div className={styles.label}>
          {short ? (
            <span className={styles.short}>
              <Icon name="critical" size={16} className={styles.shortIcon} />
              Short by
            </span>
          ) : (
            'Wallet'
          )}
        </div>
        <div className={styles.figure}>
          <BigAmount cents={Math.abs(balance)} tone={short ? 'critical' : 'default'} animate={animate} data-testid="wallet-balance" />
        </div>
        {phrase !== null && (
          <p className={styles.sentence} data-testid="wallet-pending">
            {phraseText(phrase, money)}
          </p>
        )}
        {showFree && (
          <p className={styles.subline} data-testid="wallet-free">
            Not set aside: {moneyText(money, free)}
          </p>
        )}
      </div>
    </div>
  )
}
