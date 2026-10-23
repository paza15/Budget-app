import { describe, expect, it } from 'vitest'
import type { ParsedBackup } from '@/domain/backup'
import type { NormalizeReport } from '@/domain/normalize'
import { makeData, makeRecurring, makeTransaction, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import {
  backupDateLabel,
  countOf,
  entriesNewerThan,
  entriesPhrase,
  importConfirmMessage,
  recurringPhrase,
} from '@/features/you/data/importMessage'

const HOUR = 3_600_000

const CLEAN: NormalizeReport = {
  migratedFrom: null,
  dropped: { transactions: 0, recurring: 0, categories: 0, quickAdds: 0, overrides: 0 },
  repaired: 0,
}

function transactions(n: number, createdAt = NOW - 48 * HOUR): AppData['transactions'] {
  return Array.from({ length: n }, (_, i) => makeTransaction({ id: `tx-${i}`, createdAt, updatedAt: createdAt }))
}

function backup(o: { entries?: number; items?: number; exportedAt?: string; report?: NormalizeReport } = {}): ParsedBackup {
  const data = makeData({
    transactions: transactions(o.entries ?? 9),
    recurring: Array.from({ length: o.items ?? 2 }, (_, i) => makeRecurring({ id: `rec-${i}` })),
  })
  // 14 Oct 2026, 09:50 in Berlin.
  return { data, report: o.report ?? CLEAN, exportedAt: o.exportedAt ?? '2026-10-14T07:50:00.000Z' }
}

describe('counts in words', () => {
  it('uses the singular for one and the plural otherwise', () => {
    expect(countOf(1, 'entry', 'entries')).toBe('1 entry')
    expect(countOf(3, 'entry', 'entries')).toBe('3 entries')
    expect(entriesPhrase(0)).toBe('no entries')
    expect(entriesPhrase(1)).toBe('1 entry')
    expect(entriesPhrase(41)).toBe('41 entries')
    expect(recurringPhrase(0)).toBe('no fixed costs or income items')
    expect(recurringPhrase(1)).toBe('1 fixed cost or income item')
    expect(recurringPhrase(9)).toBe('9 fixed costs and income items')
  })
})

describe('entriesNewerThan', () => {
  it('counts entries added or changed after the time', () => {
    const since = NOW - HOUR
    const data = makeData({
      transactions: [
        makeTransaction({ id: 'old', createdAt: since - HOUR, updatedAt: since - HOUR }),
        makeTransaction({ id: 'edited', createdAt: since - HOUR, updatedAt: since + 1 }),
        makeTransaction({ id: 'added', createdAt: since + HOUR, updatedAt: since + HOUR }),
        makeTransaction({ id: 'same-moment', createdAt: since, updatedAt: since }),
      ],
    })
    expect(entriesNewerThan(data, since)).toBe(2)
    expect(entriesNewerThan(makeData(), since)).toBe(0)
  })
})

describe('backupDateLabel', () => {
  it('names the local day, with the year only when it is not this year', () => {
    expect(backupDateLabel(Date.parse('2026-10-14T07:50:00.000Z'), '2026-10-18', 'de-DE')).toBe('14 Oct')
    // 23:30 UTC on New Year's Eve is already 1 January 2026 in Berlin: this year.
    expect(backupDateLabel(Date.parse('2025-12-31T23:30:00.000Z'), '2026-10-18', 'de-DE')).toBe('1 Jan')
    expect(backupDateLabel(Date.parse('2025-12-30T12:00:00.000Z'), '2026-10-18', 'de-DE')).toBe('30 Dec 2025')
    expect(backupDateLabel(Date.parse('2025-12-30T12:00:00.000Z'), '2026-10-18', 'en-US')).toBe('Dec 30, 2025')
    expect(backupDateLabel(Date.parse('2026-10-14T07:50:00.000Z'), '2026-10-18', 'en-US')).toBe('Oct 14')
  })
})

describe('importConfirmMessage (docs/SPEC.md §3.7)', () => {
  it('says what the backup and this iPhone hold, and that settings and categories go too', () => {
    const current = makeData({ transactions: transactions(41) })
    expect(importConfirmMessage(backup(), current, NOW)).toBe(
      'The backup from 14 Oct has 9 entries and 2 fixed costs and income items. This iPhone has 41 entries. Settings and categories are replaced too.',
    )
  })

  it('counts the entries on this iPhone that are newer than the backup', () => {
    const exportedAt = Date.parse('2026-10-14T07:50:00.000Z')
    const current = makeData({
      transactions: [...transactions(3), ...transactions(2, exportedAt + HOUR).map((tx, i) => ({ ...tx, id: `new-${i}` }))],
    })
    expect(importConfirmMessage(backup(), current, NOW)).toContain('This iPhone has 5 entries, 2 of them newer than the backup.')
  })

  it('tells how many damaged rows the file loses', () => {
    const report: NormalizeReport = { ...CLEAN, dropped: { ...CLEAN.dropped, transactions: 2, recurring: 1 } }
    expect(importConfirmMessage(backup({ report }), makeData(), NOW)).toMatch(
      /Settings and categories are replaced too\. 3 damaged entries in the file will be skipped\.$/,
    )
    const one: NormalizeReport = { ...CLEAN, dropped: { ...CLEAN.dropped, overrides: 1 } }
    expect(importConfirmMessage(backup({ report: one }), makeData(), NOW)).toMatch(/ 1 damaged entry in the file will be skipped\.$/)
  })

  it('reads naturally for an empty backup and an empty iPhone', () => {
    expect(importConfirmMessage(backup({ entries: 1, items: 0 }), makeData(), NOW)).toBe(
      'The backup from 14 Oct has 1 entry and no fixed costs or income items. This iPhone has no entries. Settings and categories are replaced too.',
    )
  })
})
