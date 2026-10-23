import { describe, expect, it } from 'vitest'
import { createMoneyFormat } from '@/domain/money'
import { TODAY } from '@/domain/test-helpers/dataFixtures'
import type { WalletEntry } from '@/domain/types'
import type { WalletMovement } from '@/domain/wallet'
import { walletSummary } from '@/domain/wallet'
import { BIKE, GRANDMA, JAPAN, SAVINGS, walletData } from '@/features/wallet/testData'
import {
  balanceLabel,
  bookDate,
  bookFigure,
  broughtForwardLabel,
  closedPhrase,
  compactBalance,
  doneGoalSubtitle,
  entryAddedMessage,
  entryDeletedMessage,
  goalLabel,
  goalPhase,
  goalPhaseWords,
  goalSheetFooter,
  moneyText,
  moveAnnouncement,
  movementLabel,
  movementText,
  pendingPhrase,
  phraseText,
  shortDate,
  spokenDate,
  walletAfterText,
} from '@/features/wallet/walletText'

const EUR = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false })
const HIDDEN = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })
const USD = createMoneyFormat({ currency: 'USD', locale: 'en-US', showCents: true, masked: false })

/** Intl puts U+00A0 before "€"; the tests write plain spaces. */
const plain = (text: string) => text.replace(/\s/g, ' ')

function movement(patch: Partial<WalletMovement>): WalletMovement {
  return {
    key: 'entry:x',
    kind: 'deposit',
    date: '2026-10-05',
    month: null,
    amount: 5000,
    balance: 63122,
    note: '',
    entryId: 'x',
    transactionId: null,
    ...patch,
  }
}

describe('sentences about the open and closed months (DESIGN.md §9.26 Copy)', () => {
  it('says what the open month adds or takes out when it closes', () => {
    expect(plain(phraseText(pendingPhrase('October', 33472), EUR))).toBe('October adds 334,72 € when it closes')
    expect(plain(phraseText(pendingPhrase('October', -4128), EUR))).toBe('October takes 41,28 € out when it closes')
    expect(plain(phraseText(pendingPhrase('October', 0), EUR))).toBe('October adds 0,00 € when it closes')
  })

  it('says what a closed month added or took out', () => {
    expect(plain(phraseText(closedPhrase('September', 15882), EUR))).toBe('September added 158,82 €')
    expect(plain(phraseText(closedPhrase('September', -4128), EUR))).toBe('September took 41,28 € out')
  })

  it('hides the amount, and speaks it as hidden', () => {
    expect(phraseText(pendingPhrase('October', 33472), HIDDEN)).toBe('October adds ••• when it closes')
    expect(phraseText(pendingPhrase('October', 33472), HIDDEN, true)).toBe('October adds amount hidden when it closes')
  })
})

describe('the balance', () => {
  it('reads "Wallet, 631,22 €" or "Wallet, short by 146,50 €"', () => {
    expect(plain(balanceLabel(EUR, 63122))).toBe('Wallet, 631,22 €')
    expect(plain(balanceLabel(EUR, -14650))).toBe('Wallet, short by 146,50 €')
    expect(balanceLabel(HIDDEN, -14650)).toBe('Wallet, short by amount hidden')
  })

  it('gives the compact header its subtitle', () => {
    expect(plain(compactBalance(EUR, 63122))).toBe('631,22 €')
    expect(plain(compactBalance(EUR, -14650))).toBe('Short by 146,50 €')
    expect(compactBalance(HIDDEN, -14650)).toBe('•••')
  })

  it('formats with a true minus', () => {
    expect(plain(moneyText(EUR, -4128))).toBe('−41,28 €')
    expect(moneyText(USD, -4128)).toBe('−$41.28')
  })
})

describe('goal states (DESIGN.md §9.26 Goals)', () => {
  const data = walletData()
  const { goals } = walletSummary(data, TODAY) // balance 1.450,00 €: Japan trip 1.450,00 of 2.000,00, New bike waits

  it('fills from the top: filling, then waiting for the goal above', () => {
    expect(goalPhase(goals, 0)).toEqual({ kind: 'filling', toGo: 55000 })
    expect(goalPhase(goals, 1)).toEqual({ kind: 'waiting', after: 'Japan trip' })
    expect(goalPhaseWords(goalPhase(goals, 1))).toBe('Fills after Japan trip')
  })

  it('is reached when it holds its target, and empty first in line', () => {
    const rich = walletSummary(walletData({ goals: [{ ...JAPAN, target: 100000 }, BIKE] }), TODAY).goals
    expect(goalPhase(rich, 0)).toEqual({ kind: 'reached' })
    expect(goalPhase(rich, 1)).toEqual({ kind: 'reached' })
    const debt: WalletEntry = { id: 'entry-debt', kind: 'withdrawal', amount: 500000, date: '2026-10-01', note: '', createdAt: 1 }
    const broke = walletSummary(walletData({ entries: [GRANDMA, SAVINGS, debt] }), TODAY).goals
    expect(goalPhase(broke, 0)).toEqual({ kind: 'empty' })
    expect(goalPhaseWords(goalPhase(broke, 0))).toBe('Nothing set aside yet')
    expect(goalPhaseWords(goalPhase(broke, 1))).toBe('Fills after Japan trip')
  })

  it('says nothing is set aside when the goal above took the last of it', () => {
    const exact = walletSummary(walletData({ goals: [{ ...JAPAN, target: 145000 }, BIKE] }), TODAY).goals
    expect(goalPhase(exact, 0)).toEqual({ kind: 'reached' })
    expect(goalPhase(exact, 1)).toEqual({ kind: 'empty' })
  })

  it('names each row for VoiceOver', () => {
    const [japan, bike] = goals
    if (japan === undefined || bike === undefined) throw new Error('two goals')
    expect(plain(goalLabel(EUR, japan, goalPhase(goals, 0)))).toBe('Japan trip, 1.450,00 € of 2.000,00 €, 550,00 € to go')
    expect(plain(goalLabel(EUR, bike, goalPhase(goals, 1)))).toBe('New bike, 0,00 € of 300,00 €, fills after Japan trip')
    expect(goalLabel(HIDDEN, japan, goalPhase(goals, 0))).toBe('Japan trip, amounts hidden, filling')
    expect(goalLabel(HIDDEN, bike, goalPhase(goals, 1))).toBe('New bike, amounts hidden, fills after Japan trip')
    expect(plain(goalLabel(EUR, { ...bike, filled: 30000, reached: true }, { kind: 'reached' }))).toBe(
      'New bike, 300,00 € of 300,00 €, reached',
    )
  })

  it('writes the goal sheet footer from its place in the fill order', () => {
    expect(plain(goalSheetFooter(EUR, goals, 0))).toBe('1.450,00 € is set aside for it so far. It fills first, before New bike.')
    expect(goalSheetFooter(EUR, goals, 1)).toBe('Nothing is set aside for it yet. It fills after Japan trip.')
    const three = [...goals, { goal: { ...BIKE, id: 'c', name: 'Camera' }, filled: 0, reached: false }]
    expect(goalSheetFooter(EUR, three, 1)).toBe('Nothing is set aside for it yet. It fills after Japan trip, before Camera.')
    const only = goals.slice(0, 1)
    expect(plain(goalSheetFooter(EUR, only, 0))).toBe('1.450,00 € is set aside for it so far.')
    const reached = [{ ...goals[0]!, filled: 200000, reached: true }]
    expect(plain(goalSheetFooter(EUR, reached, 0))).toBe("It's reached: 2.000,00 € is set aside for it.")
  })

  it('announces a move', () => {
    expect(moveAnnouncement('New bike', undefined)).toBe('New bike fills first now')
    expect(moveAnnouncement('Japan trip', 'New bike')).toBe('Japan trip fills after New bike now')
  })

  it('dates a done goal', () => {
    expect(plain(doneGoalSubtitle(EUR, BIKE, '2026-10-03', TODAY, 'de-DE'))).toBe('300,00 €, done 3 Oct')
    expect(shortDate('2025-10-03', TODAY, 'de-DE')).toBe('3 Oct 2025')
    expect(shortDate('2025-10-03', TODAY, 'en-US')).toBe('Oct 3, 2025')
  })
})

describe('the passbook (DESIGN.md §9.26 The passbook)', () => {
  it('writes each movement as the design does', () => {
    expect(movementText(movement({ kind: 'opening', key: 'opening', entryId: null }), 1, 'de-DE')).toBe('Opening balance')
    expect(movementText(movement({ kind: 'month', month: '2026-08', date: '2026-08-31', entryId: null }), 1, 'de-DE')).toBe('August closed')
    expect(movementText(movement({ kind: 'deposit', note: 'Birthday money' }), 1, 'de-DE')).toBe('Birthday money')
    expect(movementText(movement({ kind: 'deposit', note: '' }), 1, 'de-DE')).toBe('Added')
    expect(movementText(movement({ kind: 'withdrawal', note: ' ' }), 1, 'de-DE')).toBe('Taken out')
    expect(movementText(movement({ kind: 'payment', note: 'Paid: Laptop', entryId: null }), 1, 'de-DE')).toBe('Paid: Laptop')
  })

  it('splits the date cell in the locale order', () => {
    expect(bookDate('2026-09-12', 'de-DE')).toEqual({ day: '12', month: 'Sep', dayFirst: true })
    expect(bookDate('2026-08-01', 'en-US')).toEqual({ day: '1', month: 'Aug', dayFirst: false })
    expect(spokenDate('2026-10-05', 'de-DE', false)).toBe('5 October')
    expect(spokenDate('2026-10-05', 'en-US', true)).toBe('October 5, 2026')
  })

  it('signs amounts and leaves balances bare above zero', () => {
    expect(bookFigure(EUR, 12240, true)).toBe('+122,40')
    expect(bookFigure(EUR, -20000, true)).toBe('−200,00')
    expect(bookFigure(EUR, 0, true)).toBe('0,00')
    expect(bookFigure(EUR, 63122, false)).toBe('631,22')
    expect(bookFigure(EUR, -14650, false)).toBe('−146,50')
    expect(bookFigure(HIDDEN, 63122, false)).toBe('•••')
  })

  it('names each line for VoiceOver', () => {
    const out = movement({ kind: 'withdrawal', amount: -20000, balance: 63122, note: 'Moved to my savings account' })
    expect(plain(movementLabel(EUR, out, 'Moved to my savings account', 'de-DE', false))).toBe(
      '5 October, taken out, Moved to my savings account, minus 200,00 €, balance 631,22 €',
    )
    const closing = movement({ kind: 'month', month: '2026-08', date: '2026-08-31', amount: 12240, balance: 62240 })
    expect(plain(movementLabel(EUR, closing, 'August closed', 'de-DE', false))).toBe(
      '31 August, August closed, plus 122,40 €, balance 622,40 €',
    )
    const bare = movement({ kind: 'deposit', amount: 5000, balance: -100 })
    expect(plain(movementLabel(EUR, bare, 'Added', 'de-DE', true))).toBe('5 October 2026, Added, plus 50,00 €, balance minus 1,00 €')
    expect(movementLabel(HIDDEN, out, 'Moved to my savings account', 'de-DE', false)).toBe(
      '5 October, taken out, Moved to my savings account, amounts hidden',
    )
    expect(plain(broughtForwardLabel(EUR, 63122))).toBe('Brought forward, balance 631,22 €. Show earlier movements')
    expect(broughtForwardLabel(HIDDEN, 63122)).toBe('Brought forward, balance amount hidden. Show earlier movements')
  })
})

describe('entry messages', () => {
  it('confirms what was added or taken out', () => {
    expect(plain(entryAddedMessage(EUR, 'deposit', 5000))).toBe('Added 50,00 € to your wallet')
    expect(plain(entryAddedMessage(EUR, 'withdrawal', 20000))).toBe('Took 200,00 € out of your wallet')
    expect(entryAddedMessage(HIDDEN, 'deposit', 5000)).toBe('Added money to your wallet')
  })

  it('names what was deleted', () => {
    const entry = { kind: 'deposit' as const, amount: 5000, date: '2026-09-12' as const, note: 'Birthday money' }
    expect(entryDeletedMessage(EUR, entry, TODAY, 'de-DE')).toBe('Deleted Birthday money')
    expect(plain(entryDeletedMessage(EUR, { ...entry, note: '' }, TODAY, 'de-DE'))).toBe('Deleted the 50,00 € you added on 12 Sep')
    expect(entryDeletedMessage(HIDDEN, { ...entry, kind: 'withdrawal', note: '' }, TODAY, 'en-US')).toBe(
      'Deleted the money you took out on Sep 12',
    )
  })

  it('says what the wallet holds after an entry', () => {
    expect(plain(walletAfterText(EUR, 53122))).toBe('Wallet after: 531,22 €')
    expect(plain(walletAfterText(EUR, -6878))).toBe('Wallet after: short by 68,78 €')
  })
})
