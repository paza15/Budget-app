import { describe, expect, it } from 'vitest'
import type { OwedItem, OwedPerson } from '@/domain/splits'
import { makeSplit, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import {
  billCount,
  focusAfterItem,
  focusAfterPerson,
  initialOf,
  morePeople,
  owedItemKey,
  owedSentence,
  owedView,
  personDetail,
  settledItems,
  settledText,
  withoutItem,
  withoutPerson,
} from '@/features/owed/owedModel'

function item(transactionId: string, splitId: string, amount: number, note = ''): OwedItem {
  return { transactionId, splitId, date: '2026-10-17', note, amount }
}

function person(name: string, items: OwedItem[]): OwedPerson {
  return { person: name, total: items.reduce((sum, entry) => sum + entry.amount, 0), items }
}

const barMax = item('tx-bar', 's-max', 900, 'Bar with friends')
const pizzaMax = item('tx-pizza', 's-max', 800, 'Pizza night')
const pizzaLea = item('tx-pizza', 's-lea', 800, 'Pizza night')
/** A bill by its note, as the card names it (the category when it has none). */
const billName = (entry: OwedItem): string => entry.note || 'Eating'
const max = person('Max', [barMax, pizzaMax])
const lea = person('Lea', [pizzaLea])

describe('words of "Owed to you" (EXTRAS.md §2.6, §2.7)', () => {
  it('keys rows by transaction and split', () => {
    expect(owedItemKey(barMax)).toBe('tx-bar:s-max')
  })

  it('counts bills, not splits', () => {
    expect(billCount([barMax, pizzaMax, pizzaLea])).toBe(2)
    expect(billCount([])).toBe(0)
  })

  it('says who owes for how many bills', () => {
    expect(owedSentence([max, lea])).toBe('2 people owe you for 2 bills.')
    expect(owedSentence([max])).toBe('Max owes you for 2 bills.')
    expect(owedSentence([lea])).toBe('Lea owes you for 1 bill.')
  })

  it('names a single bill on the card, else counts them', () => {
    expect(personDetail(lea, billName)).toBe('Pizza night')
    expect(personDetail(person('Ana', [item('tx-1', 's-1', 100)]), billName)).toBe('Eating')
    expect(personDetail(max, billName)).toBe('2 bills')
    // Two parts of one bill are still one bill.
    expect(personDetail(person('Max', [item('tx-1', 's-1', 100, 'Dinner'), item('tx-1', 's-2', 200, 'Dinner')]), billName)).toBe(
      'Dinner',
    )
  })

  it('counts the rest of the card', () => {
    expect(morePeople(1)).toBe('1 more person')
    expect(morePeople(3)).toBe('3 more people')
  })

  it('takes the initial of a name, or its first emoji', () => {
    expect(initialOf('max')).toBe('M')
    expect(initialOf('  Lea')).toBe('L')
    expect(initialOf('🍕 crew')).toBe('🍕')
    expect(initialOf('')).toBe('')
  })
})

describe('settledItems', () => {
  const day = 86_400_000
  const settledAt = Date.UTC(2026, 9, 1, 10)

  it('lists paid back and forgiven splits of expenses, the latest settled first', () => {
    const transactions = [
      makeTransaction({
        id: 'tx-bowling',
        amount: 2400,
        note: 'Bowling',
        date: '2026-09-19',
        splits: [
          makeSplit({ id: 's-jonas', person: 'Jonas ', amount: 1200, status: 'paid', settledAt }),
          makeSplit({ id: 's-open', person: 'Max', amount: 600, status: 'open' }),
        ],
      }),
      makeTransaction({
        id: 'tx-cinema',
        amount: 3000,
        note: 'Cinema',
        date: '2026-09-20',
        splits: [makeSplit({ id: 's-lea', person: 'Lea', amount: 1500, status: 'forgiven', settledAt: settledAt + 2 * day })],
      }),
      makeTransaction({ id: 'tx-old', date: '2026-08-01', splits: [makeSplit({ id: 's-old', status: 'paid', settledAt: null })] }),
      makeTransaction({ id: 'tx-income', kind: 'income', splits: [] }),
    ]
    const settled = settledItems(transactions)
    // A split without settledAt (data from before it was recorded) comes last.
    expect(settled.map((entry) => entry.key)).toEqual(['tx-cinema:s-lea', 'tx-bowling:s-jonas', 'tx-old:s-old'])
    expect(settled[1]).toEqual({
      key: 'tx-bowling:s-jonas',
      transactionId: 'tx-bowling',
      splitId: 's-jonas',
      person: 'Jonas',
      amount: 1200,
      status: 'paid',
      settledAt,
      date: '2026-09-19',
      note: 'Bowling',
      categoryId: 'cat-coffee',
      bill: 2400,
    })
  })

  it('says who settled and when', () => {
    expect(settledText({ person: 'Jonas', status: 'paid', settledAt }, 'de-DE')).toBe('Jonas paid back Thu 1 Oct')
    expect(settledText({ person: 'Lea', status: 'forgiven', settledAt: settledAt + 2 * day }, 'de-DE')).toBe(
      'Forgave Lea Sat 3 Oct',
    )
    expect(settledText({ person: 'Lea', status: 'forgiven', settledAt: null }, 'de-DE')).toBe('Forgave Lea')
    expect(settledText({ person: 'Jonas', status: 'paid', settledAt }, 'en-US')).toBe('Jonas paid back Thu, Oct 1')
  })
})

/** The view as text: a person or item that is leaving carries a "*". */
const keys = (view: ReturnType<typeof owedView>) =>
  view.map((entry) => `${entry.key}${entry.leaving ? '*' : ''}[${entry.items.map((row) => row.key + (row.leaving ? '*' : '')).join(' ')}]`)

describe('owedView: what leaves collapses in place (EXTRAS.md §2.9)', () => {
  it('draws the open splits as they are', () => {
    expect(keys(owedView([max, lea]))).toEqual(['Max[tx-bar:s-max tx-pizza:s-max]', 'Lea[tx-pizza:s-lea]'])
  })

  it('keeps an item that left in its old place, marked leaving', () => {
    const before = owedView([max, lea])
    const after = owedView([person('Max', [pizzaMax]), lea], before)
    expect(keys(after)).toEqual(['Max[tx-bar:s-max* tx-pizza:s-max]', 'Lea[tx-pizza:s-lea]'])
    // The person shows the new total at once.
    expect(after[0]?.total).toBe(800)
    // Still gone on the next change: still leaving, until it has collapsed.
    const later = owedView([person('Max', [pizzaMax]), lea], after)
    expect(keys(later)).toEqual(['Max[tx-bar:s-max* tx-pizza:s-max]', 'Lea[tx-pizza:s-lea]'])
    expect(keys(withoutItem(later, 'Max', 'tx-bar:s-max'))).toEqual(['Max[tx-pizza:s-max]', 'Lea[tx-pizza:s-lea]'])
  })

  it('keeps a person whose last item left, as a whole', () => {
    const before = owedView([max, lea])
    const after = owedView([max], before)
    expect(keys(after)).toEqual(['Max[tx-bar:s-max tx-pizza:s-max]', 'Lea*[tx-pizza:s-lea]'])
    expect(after[1]?.total).toBe(800)
    expect(keys(withoutPerson(after, 'Lea'))).toEqual(['Max[tx-bar:s-max tx-pizza:s-max]'])
    // Only leaving people are removed.
    expect(withoutPerson(after, 'Max')).toHaveLength(2)
  })

  it('puts a person who left first back at the top', () => {
    const after = owedView([lea], owedView([max, lea]))
    expect(keys(after)).toEqual(['Max*[tx-bar:s-max tx-pizza:s-max]', 'Lea[tx-pizza:s-lea]'])
  })

  it('brings items back that come back (Undo)', () => {
    const before = owedView([max, lea])
    const left = owedView([person('Max', [pizzaMax])], before)
    expect(keys(owedView([max, lea], left))).toEqual(['Max[tx-bar:s-max tx-pizza:s-max]', 'Lea[tx-pizza:s-lea]'])
  })

  it('keeps nothing once nobody owes anything: the empty state shows at once', () => {
    expect(owedView([], owedView([max, lea]))).toEqual([])
  })
})

describe('focus after something left (EXTRAS.md §2.8)', () => {
  const view = owedView([max, lea, person('Ana', [item('tx-ana', 's-ana', 500)])])

  it("moves to the next item's Paid back, else to the person's header", () => {
    expect(focusAfterItem(view, 'Max', 'tx-bar:s-max')).toBe('paid:tx-pizza:s-max')
    expect(focusAfterItem(view, 'Max', 'tx-pizza:s-max')).toBe('person:Max')
  })

  it("moves to the next person when the person's only item left, else the one before", () => {
    expect(focusAfterItem(view, 'Lea', 'tx-pizza:s-lea')).toBe('person:Ana')
    expect(focusAfterItem(view, 'Ana', 'tx-ana:s-ana')).toBe('person:Lea')
    expect(focusAfterPerson(view, 'Max')).toBe('person:Lea')
    expect(focusAfterPerson(owedView([lea]), 'Lea')).toBe('empty')
  })
})
