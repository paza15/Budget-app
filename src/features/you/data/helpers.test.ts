import { describe, expect, it } from 'vitest'
import { NOW } from '@/domain/test-helpers/dataFixtures'
import { buildLabel } from '@/features/you/data/diagnostics'
import { snapshotSubtitle, snapshotTitle } from '@/features/you/data/snapshots'
import { formatBytes } from '@/features/you/data/storageUsage'

const HOUR = 3_600_000

describe('formatBytes', () => {
  it('counts in steps of 1000 with English units and the number locale', () => {
    expect(formatBytes(0, 'de-DE')).toBe('0 bytes')
    expect(formatBytes(1, 'de-DE')).toBe('1 byte')
    expect(formatBytes(512, 'en-GB')).toBe('512 bytes')
    expect(formatBytes(412_000, 'de-DE')).toBe('412 kB')
    expect(formatBytes(1_400_000, 'de-DE')).toBe('1,4 MB')
    expect(formatBytes(1_400_000, 'en-US')).toBe('1.4 MB')
    expect(formatBytes(23_000_000, 'de-DE')).toBe('23 MB')
    expect(formatBytes(2_500_000_000_000, 'en-GB')).toBe('2,500 GB')
  })

  it('never shows a negative size', () => {
    expect(formatBytes(-5, 'en-GB')).toBe('0 bytes')
  })
})

describe('automatic copy rows', () => {
  it('names a daily copy by its day and the others by what they were taken before, with the date', () => {
    const daily = { key: 'snap:2026-10-13', label: 'End of Tue 13 Oct', savedAt: NOW - 20 * HOUR, transactions: 214 }
    const beforeImport = { key: 'snap:pre-import', label: 'Before import', savedAt: NOW - HOUR, transactions: 1 }
    const beforeUpdate = { key: 'snap:pre-v1', label: 'Before update', savedAt: NOW - 48 * HOUR, transactions: 0 }
    expect(snapshotTitle(daily, 'de-DE')).toBe('End of Tue 13 Oct')
    expect(snapshotTitle(beforeImport, 'de-DE')).toBe('Before import, 14 Oct')
    expect(snapshotTitle(beforeImport, 'en-US')).toBe('Before import, Oct 14')
    expect(snapshotTitle(beforeUpdate, 'de-DE')).toBe('Before update, 12 Oct')
    expect(snapshotSubtitle(daily)).toBe('214 entries')
    expect(snapshotSubtitle(beforeImport)).toBe('1 entry')
    expect(snapshotSubtitle(beforeUpdate)).toBe('No entries')
  })
})

describe('buildLabel', () => {
  it("shows the build's id in production and names the dev server otherwise", () => {
    expect(buildLabel(true, '3f9c2ab')).toBe('3f9c2ab')
    expect(buildLabel(false, '3f9c2ab')).toBe('Development server')
  })
})
