import { vi } from 'vitest'

/**
 * Intl doubles for engines whose locale data differs from the test runner's (docs/SPEC.md §4.7,
 * §5.3 NUMBER_LOCALES). Call them inside a test; vite.config.ts sets restoreMocks, so every spy
 * is removed again after the test.
 */

/**
 * Makes Intl behave like Chromium, whose ICU data has no Albanian. supportedLocalesOf drops every
 * 'sq' tag (sq-AL included), while new Intl.NumberFormat('sq-AL') still works and formats in
 * Intl's default locale.
 */
export function withoutAlbanianLocaleData(): void {
  const supportedLocalesOf = Intl.NumberFormat.supportedLocalesOf.bind(Intl.NumberFormat)
  vi.spyOn(Intl.NumberFormat, 'supportedLocalesOf').mockImplementation((locales, options) =>
    supportedLocalesOf(locales, options).filter((locale) => locale.split('-')[0] !== 'sq'),
  )
}
