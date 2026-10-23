import { describe, expect, it } from 'vitest'
import { CATEGORY_COLORS, HOME_CARDS, NUMBER_LOCALES } from '@/domain/catalog'
import { MAX_LENGTHS } from '@/domain/constants'
import {
  createDefaultCategories,
  createDefaultQuickAdds,
  createDefaultSecurity,
  createDefaultSettings,
  createDefaultWallet,
  createInitialData,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_AUTO_LOCK_MINUTES,
  DEFAULT_CATEGORY_IDS,
  DEFAULT_PIN_ITERATIONS,
} from '@/domain/defaults'
import { ID_PATTERN } from '@/domain/ids'
import { normalizeAppData } from '@/domain/normalize'
import { isIconKey } from '@/domain/queries'
import { INSTALLED_AT, NOW } from '@/domain/test-helpers/dataFixtures'

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is 1, the first schema', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
  })
})

describe('DEFAULT_CATEGORY_IDS', () => {
  it('names the stable ids of §5.3', () => {
    expect(DEFAULT_CATEGORY_IDS).toEqual({
      rent: 'cat-rent',
      subscriptions: 'cat-subscriptions',
      transport: 'cat-transport',
      phone: 'cat-phone',
      insurance: 'cat-insurance',
      eating: 'cat-eating',
      groceries: 'cat-groceries',
      coffee: 'cat-coffee',
      shopping: 'cat-shopping',
      goingOut: 'cat-going-out',
      health: 'cat-health',
      other: 'cat-other',
    })
  })

  it('lists them in the default category order', () => {
    expect(createDefaultCategories().map(({ id }) => id)).toEqual(Object.values(DEFAULT_CATEGORY_IDS))
  })
})

describe('createDefaultSettings', () => {
  it('returns the §5.11 defaults for a German phone in Berlin', () => {
    expect(createDefaultSettings(NOW, 'de-DE', 'Europe/Berlin')).toEqual({
      name: '',
      avatar: '',
      currency: 'EUR',
      locale: 'de-DE',
      monthStartDay: 1,
      savingsGoal: 0,
      theme: 'system',
      accent: 'navy',
      showCents: true,
      hideAmounts: false,
      homeCards: ['equation', 'wallet', 'owed', 'whereItWent', 'budgets', 'comingUp', 'trend', 'recent'],
      onboarded: false,
      lastBackupAt: null,
      lastReviewedMonth: null,
      createdAt: NOW,
    })
  })

  it('shows every Home card, in HOME_CARDS order', () => {
    expect(createDefaultSettings(NOW).homeCards).toEqual(HOME_CARDS.map(({ key }) => key))
  })

  it('puts the wallet and what is owed to you right after the sums (§5.9)', () => {
    expect(createDefaultSettings(NOW).homeCards.slice(0, 3)).toEqual(['equation', 'wallet', 'owed'])
  })

  it('has no month reviewed yet (§3.15)', () => {
    expect(createDefaultSettings(NOW).lastReviewedMonth).toBeNull()
  })

  it.each([
    ['en-US', 'Europe/Zurich', 'CHF', 'en-US'],
    ['en-GB', 'Europe/London', 'GBP', 'en-GB'],
    ['sq-AL', 'Europe/Tirane', 'ALL', 'sq-AL'],
    ['pl-PL', undefined, 'PLN', 'pl-PL'],
    ['de-CH', undefined, 'CHF', 'de-CH'],
    ['en-us', 'America/Chicago', 'USD', 'en-US'],
    ['ja-JP', 'Asia/Tokyo', 'JPY', 'de-DE'],
    ['en-AU', undefined, 'AUD', 'de-DE'],
  ])('takes currency and number format from %s in %s: %s, %s', (language, zone, currency, locale) => {
    const settings = createDefaultSettings(NOW, language, zone)
    expect(settings.currency).toBe(currency)
    expect(settings.locale).toBe(locale)
  })

  it('uses EUR and de-DE without a language or time zone', () => {
    const settings = createDefaultSettings(NOW)
    expect(settings.currency).toBe('EUR')
    expect(settings.locale).toBe('de-DE')
  })

  it('takes the currency from the time zone even without a language', () => {
    expect(createDefaultSettings(NOW, undefined, 'Europe/Warsaw').currency).toBe('PLN')
  })

  it('records the install time', () => {
    expect(createDefaultSettings(0).createdAt).toBe(0)
    expect(createDefaultSettings(INSTALLED_AT).createdAt).toBe(INSTALLED_AT)
  })

  it('returns new objects every call', () => {
    const first = createDefaultSettings(NOW)
    const second = createDefaultSettings(NOW)
    expect(second).not.toBe(first)
    expect(second.homeCards).not.toBe(first.homeCards)
  })

  it.each(NUMBER_LOCALES.map(({ locale }) => locale))('passes normalisation unchanged for %s', (locale) => {
    const data = { ...createInitialData(NOW), settings: createDefaultSettings(NOW, locale) }
    const { data: normalized, report } = normalizeAppData(data, NOW)
    expect(normalized.settings).toEqual(data.settings)
    expect(report.repaired).toBe(0)
  })
})

describe('createDefaultCategories', () => {
  it('returns the twelve categories of §5.11 in order', () => {
    expect(createDefaultCategories().map(({ id, icon, name, color, kind }) => [id, icon, name, color, kind])).toEqual([
      ['cat-rent', 'house', 'Rent', 'blue', 'fixed'],
      ['cat-subscriptions', 'repeat', 'Subscriptions', 'violet', 'fixed'],
      ['cat-transport', 'train', 'Transport', 'aqua', 'both'],
      ['cat-phone', 'device-mobile', 'Phone & internet', 'slate', 'fixed'],
      ['cat-insurance', 'shield-check', 'Insurance', 'brown', 'fixed'],
      ['cat-eating', 'fork-knife', 'Eating', 'orange', 'daily'],
      ['cat-groceries', 'shopping-cart', 'Groceries', 'green', 'daily'],
      ['cat-coffee', 'coffee', 'Coffee & snacks', 'yellow', 'daily'],
      ['cat-shopping', 'shopping-bag', 'Shopping', 'magenta', 'daily'],
      ['cat-going-out', 'martini', 'Going out', 'red', 'daily'],
      ['cat-health', 'pill', 'Health', 'blue', 'daily'],
      ['cat-other', 'package', 'Other', 'slate', 'both'],
    ])
  })

  it('orders them 0..11, with no limits and none archived', () => {
    const categories = createDefaultCategories()
    expect(categories.map(({ order }) => order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(categories.every(({ budget, archived }) => budget === null && !archived)).toBe(true)
  })

  it('uses valid ids, catalog icons and colours, and names within the length limit', () => {
    const colors = new Set(CATEGORY_COLORS.map(({ key }) => key))
    const offenders = createDefaultCategories().filter(
      ({ id, icon, color, name }) =>
        !ID_PATTERN.test(id) || !isIconKey(icon) || !colors.has(color) || name.length > MAX_LENGTHS.category,
    )
    expect(offenders).toEqual([])
  })

  it('returns new objects every call', () => {
    const first = createDefaultCategories()
    const second = createDefaultCategories()
    expect(second).toEqual(first)
    expect(second[0]).not.toBe(first[0])
  })
})

describe('createDefaultQuickAdds', () => {
  it('returns Coffee, Bakery and Mensa of §5.11', () => {
    expect(createDefaultQuickAdds().map(({ icon, label, amount, categoryId, order }) => [icon, label, amount, categoryId, order])).toEqual([
      ['coffee', 'Coffee', 350, 'cat-coffee', 0],
      ['bread', 'Bakery', 250, 'cat-coffee', 1],
      ['bowl-food', 'Mensa', 450, 'cat-eating', 2],
    ])
  })

  it('uses stable, valid and distinct ids, catalog icons and short labels', () => {
    const quickAdds = createDefaultQuickAdds()
    expect(quickAdds.map(({ id }) => id)).toEqual(createDefaultQuickAdds().map(({ id }) => id))
    expect(new Set(quickAdds.map(({ id }) => id)).size).toBe(quickAdds.length)
    const offenders = quickAdds.filter(
      ({ id, icon, label }) => !ID_PATTERN.test(id) || !isIconKey(icon) || label.length > MAX_LENGTHS.quickAdd,
    )
    expect(offenders).toEqual([])
  })

  it('points at default categories', () => {
    const ids = new Set(createDefaultCategories().map(({ id }) => id))
    expect(createDefaultQuickAdds().filter(({ categoryId }) => !ids.has(categoryId))).toEqual([])
  })
})

describe('createInitialData', () => {
  it('holds the defaults and no entries', () => {
    expect(createInitialData(NOW, 'de-DE', 'Europe/Berlin')).toEqual({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings: createDefaultSettings(NOW, 'de-DE', 'Europe/Berlin'),
      categories: createDefaultCategories(),
      recurring: [],
      transactions: [],
      quickAdds: createDefaultQuickAdds(),
      months: {},
      wallet: { opening: 0, startMonth: null, entries: [], goals: [] },
    })
  })

  it('starts with the empty default wallet', () => {
    expect(createInitialData(NOW).wallet).toEqual(createDefaultWallet())
  })

  it('passes the language and time zone on to the settings', () => {
    const settings = createInitialData(NOW, 'en-GB', 'Europe/London').settings
    expect([settings.currency, settings.locale]).toEqual(['GBP', 'en-GB'])
  })

  it('is valid data that normalisation leaves untouched', () => {
    const data = createInitialData(NOW, 'de-DE', 'Europe/Berlin')
    const { data: normalized, report } = normalizeAppData(data, NOW + 1)
    expect(normalized).toEqual(data)
    expect(report).toEqual({
      migratedFrom: null,
      dropped: { transactions: 0, recurring: 0, categories: 0, quickAdds: 0, overrides: 0 },
      repaired: 0,
    })
  })

  it('is valid even before hydration, created at epoch 0 (§5.4)', () => {
    const data = createInitialData(0)
    expect(normalizeAppData(data, NOW).data).toEqual(data)
  })
})

describe('createDefaultWallet', () => {
  it('has no opening balance, no entries and no goals, and counts from the setup period (§4.8, §3.14)', () => {
    expect(createDefaultWallet()).toStrictEqual({ opening: 0, startMonth: null, entries: [], goals: [] })
  })

  it('returns new objects every call, so adding to one wallet leaves the next alone', () => {
    const first = createDefaultWallet()
    const second = createDefaultWallet()
    expect(second).not.toBe(first)
    expect(second.entries).not.toBe(first.entries)
    expect(second.goals).not.toBe(first.goals)
  })

  it('is a wallet that normalisation leaves untouched', () => {
    const data = { ...createInitialData(NOW), wallet: createDefaultWallet() }
    const { data: normalized, report } = normalizeAppData(data, NOW + 1)
    expect(normalized.wallet).toStrictEqual(createDefaultWallet())
    expect(report.repaired).toBe(0)
  })
})

describe('createDefaultSecurity', () => {
  it('has no PIN or Face ID and locks after 1 minute (§5.11)', () => {
    expect(createDefaultSecurity()).toEqual({
      pinHash: null,
      pinSalt: null,
      pinIterations: 210_000,
      pinLength: 4,
      biometricCredentialId: null,
      autoLockMinutes: 1,
      failedAttempts: 0,
      lockoutUntil: null,
    })
  })

  it('uses the exported constants', () => {
    expect(createDefaultSecurity().pinIterations).toBe(DEFAULT_PIN_ITERATIONS)
    expect(createDefaultSecurity().autoLockMinutes).toBe(DEFAULT_AUTO_LOCK_MINUTES)
  })
})
