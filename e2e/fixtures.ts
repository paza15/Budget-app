import { test as base, expect } from '@playwright/test'
import { LS_KEYS } from '../src/domain/constants.ts'

/**
 * The test every spec uses (docs/SPEC.md §9). Before each test it:
 * - freezes the clock at Wednesday 14 October 2026, 10:00 in Berlin (Date only; timers still run),
 * - marks the Safari install hint as dismissed, so no banner sits above the hero,
 * - deletes navigator.share and navigator.canShare, so exports take the download path (§5.7).
 */

/** "Now" in every spec: day 14 of the 31-day October 2026 period, 18 days left including today. */
export const NOW = new Date('2026-10-14T10:00:00+02:00')

export const test = base.extend({
  page: async ({ page }, provide) => {
    await page.clock.setFixedTime(NOW)
    await page.addInitScript((installHintKey: string) => {
      try {
        window.localStorage.setItem(installHintKey, '1')
      } catch {
        // Storage can be unavailable in an opaque document such as about:blank.
      }
      Reflect.deleteProperty(Navigator.prototype, 'share')
      Reflect.deleteProperty(Navigator.prototype, 'canShare')
    }, LS_KEYS.installHintDismissed)
    await provide(page)
  },
})

export { expect }
export * from './helpers.ts'
