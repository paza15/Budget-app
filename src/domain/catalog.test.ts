import { describe, expect, it } from 'vitest'
import {
  ACCENTS,
  AUTO_LOCK_OPTIONS,
  canonicalNumberLocale,
  CATEGORY_COLORS,
  CATEGORY_ICON_GROUPS,
  CATEGORY_ICONS,
  CURRENCIES,
  defaultCurrencyFor,
  defaultNumberLocale,
  EMOJI_CHOICES,
  EVERY_MONTHS_OPTIONS,
  FALLBACK_CURRENCY,
  FALLBACK_NUMBER_LOCALE,
  HOME_CARDS,
  NUMBER_LOCALES,
  RECURRING_SUGGESTIONS,
} from '@/domain/catalog'
import { createDefaultCategories, createDefaultQuickAdds, DEFAULT_AUTO_LOCK_MINUTES } from '@/domain/defaults'
import { currencyDigits } from '@/domain/money'
import { isEmoji, isIconKey, isIconRef } from '@/domain/queries'
import { withoutAlbanianLocaleData } from '@/domain/test-helpers/intlFixtures'
import type { AccentKey, CategoryColor, HomeCardKey } from '@/domain/types'

/**
 * Checks over whole lists collect the offending entries and expect none, so a failure names
 * every entry that breaks the rule.
 */

/** The part of node:fs these tests use. */
interface NodeFs {
  existsSync(path: URL): boolean
}

/**
 * node:fs, imported through a variable: the app's tsconfig has no Node types, so a static import
 * would not type-check. Vitest runs this file in Node, where the module exists.
 */
async function loadFs(): Promise<NodeFs> {
  const specifier: string = 'node:fs'
  return (await import(/* @vite-ignore */ specifier)) as NodeFs
}

/** The SVG of a Phosphor icon in @phosphor-icons/core, as scripts/build-icons.mjs reads it. */
function phosphorFile(key: string, weight: 'regular' | 'light'): URL {
  const file = weight === 'regular' ? `${key}.svg` : `${key}-${weight}.svg`
  return new URL(`../../node_modules/@phosphor-icons/core/assets/${weight}/${file}`, import.meta.url)
}

/** Sentence case: a capital first letter, no surrounding spaces and no full stop at the end. */
function isSentenceCase(text: string): boolean {
  return text === text.trim() && /^\p{Lu}/u.test(text) && !text.endsWith('.')
}

const CURRENCY_CODES = new Set(CURRENCIES.map(({ code }) => code))
const ICON_KEYS = CATEGORY_ICONS.map(({ key }) => key)

describe('CURRENCIES', () => {
  it('lists the §5.3 currencies in order, euro first', () => {
    expect(CURRENCIES.map(({ code }) => code)).toEqual([
      'EUR',
      'USD',
      'GBP',
      'CHF',
      'ALL',
      'PLN',
      'CZK',
      'HUF',
      'RON',
      'SEK',
      'NOK',
      'DKK',
      'TRY',
      'JPY',
      'CNY',
      'INR',
      'CAD',
      'AUD',
    ])
  })

  it('has whole units only for the Albanian lek and the yen', () => {
    expect(CURRENCIES.filter(({ digits }) => digits === 0).map(({ code }) => code)).toEqual(['ALL', 'JPY'])
    expect(CURRENCIES.filter(({ digits }) => digits !== 0 && digits !== 2)).toEqual([])
  })

  it('agrees with the digits table money.ts keeps', () => {
    expect(CURRENCIES.map(({ code }) => [code, currencyDigits(code)])).toEqual(
      CURRENCIES.map(({ code, digits }) => [code, digits]),
    )
  })

  it('names every currency once and uses codes Intl can format', () => {
    expect(CURRENCIES.filter(({ name }) => !isSentenceCase(name))).toEqual([])
    const unformattable = CURRENCIES.filter(
      ({ code }) => new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().currency !== code,
    )
    expect(unformattable).toEqual([])
    expect(CURRENCY_CODES.size).toBe(CURRENCIES.length)
  })

  it('includes the fallback currency', () => {
    expect(FALLBACK_CURRENCY).toBe('EUR')
    expect(CURRENCY_CODES.has(FALLBACK_CURRENCY)).toBe(true)
  })
})

describe('NUMBER_LOCALES', () => {
  it('lists the §5.3 number formats in order', () => {
    expect(NUMBER_LOCALES.map(({ locale }) => locale)).toEqual([
      'de-DE',
      'de-AT',
      'de-CH',
      'en-IE',
      'en-GB',
      'en-US',
      'fr-FR',
      'it-IT',
      'es-ES',
      'nl-NL',
      'sq-AL',
      'pl-PL',
    ])
  })

  it.each(NUMBER_LOCALES.map(({ locale }) => locale))(
    'uses the canonical tag %s, which Intl writes the same where it has the locale data',
    (locale) => {
      expect(Intl.NumberFormat.supportedLocalesOf([locale])).toEqual([locale])
    },
  )

  it('labels each format by its country, once', () => {
    const labels = NUMBER_LOCALES.map(({ label }) => label)
    expect(labels.filter((label) => !isSentenceCase(label))).toEqual([])
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('includes the fallback format de-DE', () => {
    expect(FALLBACK_NUMBER_LOCALE).toBe('de-DE')
    expect(NUMBER_LOCALES.map(({ locale }) => locale)).toContain(FALLBACK_NUMBER_LOCALE)
  })
})

describe('defaultCurrencyFor', () => {
  const EUROZONE_CAPITALS = [
    'Europe/Amsterdam',
    'Europe/Athens',
    'Europe/Berlin',
    'Europe/Bratislava',
    'Europe/Brussels',
    'Europe/Dublin',
    'Europe/Helsinki',
    'Europe/Lisbon',
    'Europe/Ljubljana',
    'Europe/Luxembourg',
    'Europe/Madrid',
    'Europe/Malta',
    'Asia/Nicosia',
    'Europe/Paris',
    'Europe/Riga',
    'Europe/Rome',
    'Europe/Sofia',
    'Europe/Tallinn',
    'Europe/Vienna',
    'Europe/Vilnius',
    'Europe/Zagreb',
  ]

  it('covers the capitals of all 21 eurozone members', () => {
    expect(EUROZONE_CAPITALS).toHaveLength(21)
  })

  it.each(EUROZONE_CAPITALS)('reads %s as EUR, whatever the language', (zone) => {
    expect(defaultCurrencyFor('en-US', zone)).toBe('EUR')
    expect(defaultCurrencyFor('en-GB', zone)).toBe('EUR')
  })

  it.each([
    ['Europe/Zurich', 'CHF'],
    ['Europe/London', 'GBP'],
    ['Europe/Tirane', 'ALL'],
    ['Europe/Warsaw', 'PLN'],
    ['Europe/Prague', 'CZK'],
    ['Europe/Budapest', 'HUF'],
    ['Europe/Bucharest', 'RON'],
    ['Europe/Stockholm', 'SEK'],
    ['Europe/Oslo', 'NOK'],
    ['Europe/Copenhagen', 'DKK'],
    ['Europe/Istanbul', 'TRY'],
    ['Asia/Tokyo', 'JPY'],
    ['America/New_York', 'USD'],
    ['America/Chicago', 'USD'],
    ['America/Denver', 'USD'],
    ['America/Los_Angeles', 'USD'],
    ['Asia/Shanghai', 'CNY'],
    ['Asia/Kolkata', 'INR'],
    ['Asia/Calcutta', 'INR'],
    ['America/Toronto', 'CAD'],
    ['Australia/Sydney', 'AUD'],
  ])('reads %s as %s before the language region', (zone, currency) => {
    expect(defaultCurrencyFor('de-DE', zone)).toBe(currency)
  })

  it('reaches every offered currency from some time zone', () => {
    const zones = [
      'Europe/Berlin',
      'America/New_York',
      'Europe/London',
      'Europe/Zurich',
      'Europe/Tirane',
      'Europe/Warsaw',
      'Europe/Prague',
      'Europe/Budapest',
      'Europe/Bucharest',
      'Europe/Stockholm',
      'Europe/Oslo',
      'Europe/Copenhagen',
      'Europe/Istanbul',
      'Asia/Tokyo',
      'Asia/Shanghai',
      'Asia/Kolkata',
      'America/Toronto',
      'Australia/Sydney',
    ]
    expect(new Set(zones.map((zone) => defaultCurrencyFor('', zone)))).toEqual(CURRENCY_CODES)
  })

  it('matches time zones without regard to case or surrounding spaces', () => {
    expect(defaultCurrencyFor('de-DE', ' europe/zurich ')).toBe('CHF')
    expect(defaultCurrencyFor('de-DE', 'EUROPE/LONDON')).toBe('GBP')
  })

  it.each([
    ['en-GB', undefined, 'GBP'],
    ['de-CH', 'UTC', 'CHF'],
    ['sq-AL', 'Etc/GMT-1', 'ALL'],
    ['pl-PL', undefined, 'PLN'],
    ['cs-CZ', undefined, 'CZK'],
    ['hu-HU', undefined, 'HUF'],
    ['ro-RO', undefined, 'RON'],
    ['sv-SE', undefined, 'SEK'],
    ['nb-NO', undefined, 'NOK'],
    ['da-DK', undefined, 'DKK'],
    ['tr-TR', undefined, 'TRY'],
    ['ja-JP', undefined, 'JPY'],
    ['en-US', 'Asia/Dubai', 'USD'],
    ['zh-Hans-CN', undefined, 'CNY'],
    ['en-IN', undefined, 'INR'],
    ['fr-CA', undefined, 'CAD'],
    ['en-AU', '', 'AUD'],
    ['fr-FR', 'Africa/Abidjan', 'EUR'],
    ['de_AT', undefined, 'EUR'],
    ['en-us', undefined, 'USD'],
  ])('falls back to the region of %s (time zone %j): %s', (locale, zone, currency) => {
    expect(defaultCurrencyFor(locale, zone)).toBe(currency)
  })

  it.each([
    ['de', undefined],
    ['en', 'Etc/UTC'],
    ['', undefined],
    ['not a language tag', undefined],
    ['es-MX', 'America/Mexico_City'],
    ['ru-RU', 'Europe/Moscow'],
  ])('falls back to EUR for %j in %j, which name no offered currency', (locale, zone) => {
    expect(defaultCurrencyFor(locale, zone)).toBe('EUR')
  })

  it('returns an offered currency for every time zone and number format', () => {
    const unknown: string[] = []
    for (const zone of [...Intl.supportedValuesOf('timeZone'), 'Not/A_Zone']) {
      for (const { locale } of NUMBER_LOCALES) {
        const currency = defaultCurrencyFor(locale, zone)
        if (!CURRENCY_CODES.has(currency)) unknown.push(`${locale} ${zone}: ${currency}`)
      }
    }
    expect(unknown).toEqual([])
  })
})

describe('defaultNumberLocale', () => {
  it.each(NUMBER_LOCALES.map(({ locale }) => locale))('keeps the supported format %s', (locale) => {
    expect(defaultNumberLocale(locale)).toBe(locale)
  })

  it.each([
    ['en-us', 'en-US'],
    ['DE-de', 'de-DE'],
    ['pl_PL', 'pl-PL'],
    [' sq-AL ', 'sq-AL'],
  ])('matches %j to %s without regard to case, underscores or spaces', (language, locale) => {
    expect(defaultNumberLocale(language)).toBe(locale)
  })

  it.each(['en', 'de', 'ja-JP', 'en-AU', 'fr-CA', 'not a tag', ''])('falls back to de-DE for %j', (language) => {
    expect(defaultNumberLocale(language)).toBe('de-DE')
  })

  it('falls back to de-DE without a language', () => {
    expect(defaultNumberLocale(undefined)).toBe('de-DE')
  })
})

describe('canonicalNumberLocale', () => {
  it.each(NUMBER_LOCALES.map(({ locale }) => locale))('keeps the offered format %s', (locale) => {
    expect(canonicalNumberLocale(locale)).toBe(locale)
  })

  it.each([
    ['en-us', 'en-US'],
    ['DE-de', 'de-DE'],
    ['SQ-al', 'sq-AL'],
  ])('writes the offered format %j as listed, %s', (value, locale) => {
    expect(canonicalNumberLocale(value)).toBe(locale)
  })

  it('keeps offered formats the engine has no data for', () => {
    withoutAlbanianLocaleData()
    expect(Intl.NumberFormat.supportedLocalesOf(['sq-AL'])).toEqual([])
    expect(canonicalNumberLocale('sq-AL')).toBe('sq-AL')
    expect(canonicalNumberLocale('sq-al')).toBe('sq-AL')
    // Not offered, so it needs the engine's support.
    expect(canonicalNumberLocale('sq-XK')).toBeNull()
  })

  it.each([
    ['ja-JP', 'ja-JP'],
    ['fr-ch', 'fr-CH'],
    ['sq-XK', 'sq-XK'],
  ])('accepts %j, which Intl supports, as %s', (value, locale) => {
    expect(canonicalNumberLocale(value)).toBe(locale)
  })

  it.each(['', 'not a locale', 'en_US', ' de-DE', 'de-DE ', 'x', 5, null, undefined, ['de-DE'], { locale: 'de-DE' }])(
    'rejects %j',
    (value) => {
      expect(canonicalNumberLocale(value)).toBeNull()
    },
  )
})

describe('ACCENTS', () => {
  it('lists the eight accents in picker order, navy first', () => {
    expect(ACCENTS).toEqual([
      { key: 'navy', name: 'Navy' },
      { key: 'royal', name: 'Royal blue' },
      { key: 'teal', name: 'Teal' },
      { key: 'bottle', name: 'Bottle green' },
      { key: 'burgundy', name: 'Burgundy' },
      { key: 'plum', name: 'Plum' },
      { key: 'cognac', name: 'Cognac' },
      { key: 'graphite', name: 'Graphite' },
    ])
  })

  it('covers every AccentKey', () => {
    const all: Record<AccentKey, true> = {
      navy: true,
      royal: true,
      teal: true,
      bottle: true,
      burgundy: true,
      plum: true,
      cognac: true,
      graphite: true,
    }
    expect(ACCENTS.map(({ key }) => key).toSorted()).toEqual(Object.keys(all).toSorted())
  })
})

describe('CATEGORY_COLORS', () => {
  it('lists the ten colour slots in token order', () => {
    expect(CATEGORY_COLORS).toEqual([
      { key: 'blue', name: 'Blue' },
      { key: 'orange', name: 'Orange' },
      { key: 'aqua', name: 'Aqua' },
      { key: 'yellow', name: 'Yellow' },
      { key: 'magenta', name: 'Magenta' },
      { key: 'green', name: 'Green' },
      { key: 'violet', name: 'Violet' },
      { key: 'red', name: 'Red' },
      { key: 'slate', name: 'Slate' },
      { key: 'brown', name: 'Brown' },
    ])
  })

  it('covers every CategoryColor', () => {
    const all: Record<CategoryColor, true> = {
      blue: true,
      orange: true,
      aqua: true,
      yellow: true,
      magenta: true,
      green: true,
      violet: true,
      red: true,
      slate: true,
      brown: true,
    }
    expect(CATEGORY_COLORS.map(({ key }) => key).toSorted()).toEqual(Object.keys(all).toSorted())
  })
})

describe('CATEGORY_ICONS', () => {
  it('offers about 60 icons, each once', () => {
    expect(CATEGORY_ICONS.length).toBeGreaterThanOrEqual(55)
    expect(CATEGORY_ICONS.length).toBeLessThanOrEqual(70)
    expect(new Set(ICON_KEYS).size).toBe(ICON_KEYS.length)
  })

  it('uses Phosphor file names that exist in the regular and light weights', async () => {
    const { existsSync } = await loadFs()
    // Guards against a vacuous pass: a key that is not a Phosphor icon must be reported missing.
    expect(existsSync(phosphorFile('not-a-phosphor-icon', 'regular'))).toBe(false)
    expect(existsSync(phosphorFile('coffee', 'regular'))).toBe(true)
    const missing = ICON_KEYS.flatMap((key) =>
      (['regular', 'light'] as const).filter((weight) => !existsSync(phosphorFile(key, weight))).map((weight) => `${key} (${weight})`),
    )
    expect(missing).toEqual([])
    expect(ICON_KEYS.filter((key) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key))).toEqual([])
  })

  it('includes every default category and quick-add icon of §5.11, question and circle', () => {
    const required = [
      'house',
      'repeat',
      'train',
      'device-mobile',
      'shield-check',
      'fork-knife',
      'shopping-cart',
      'coffee',
      'shopping-bag',
      'martini',
      'pill',
      'package',
      'bread',
      'bowl-food',
      'question',
      'circle',
      ...createDefaultCategories().map(({ icon }) => icon),
      ...createDefaultQuickAdds().map(({ icon }) => icon),
    ]
    expect(required.filter((icon) => !ICON_KEYS.includes(icon))).toEqual([])
  })

  it('groups the picker into twelve sections in a fixed order', () => {
    expect(CATEGORY_ICON_GROUPS).toEqual([
      'Food & drink',
      'Home & bills',
      'Transport',
      'Shopping',
      'Health & care',
      'Fun',
      'Money',
      'Tech',
      'Travel',
      'Education',
      'Family & pets',
      'Other',
    ])
  })

  it('lists icons section by section, every section with at least three', () => {
    const sections = CATEGORY_ICONS.map(({ group }) => group).filter((group, i, all) => group !== all[i - 1])
    expect(sections).toEqual(CATEGORY_ICON_GROUPS)
    const small = CATEGORY_ICON_GROUPS.filter((group) => CATEGORY_ICONS.filter((icon) => icon.group === group).length < 3)
    expect(small).toEqual([])
  })

  it('names each picture once, in sentence case, for screen readers', () => {
    const names = CATEGORY_ICONS.map(({ name }) => name)
    expect(names.filter((name) => !isSentenceCase(name))).toEqual([])
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives each icon trimmed, lower-case, distinct search keywords', () => {
    const offenders = CATEGORY_ICONS.filter(
      ({ keywords }) =>
        keywords.length === 0 ||
        new Set(keywords).size !== keywords.length ||
        keywords.some((keyword) => keyword !== keyword.trim().toLowerCase() || keyword.length < 2),
    )
    expect(offenders).toEqual([])
  })

  it("finds each default category's icon by the category's name", () => {
    const unfindable = createDefaultCategories().filter(({ name, icon }) => {
      const option = CATEGORY_ICONS.find(({ key }) => key === icon)
      const searchable = `${option?.name ?? ''} ${option?.keywords.join(' ') ?? ''}`.toLowerCase()
      const firstWord = name.toLowerCase().split(' ')[0] ?? ''
      return !searchable.includes(firstWord)
    })
    expect(unfindable).toEqual([])
  })

  it('gives every option its own keyword array, so editing one leaves the others alone', () => {
    const lists = CATEGORY_ICONS.map(({ keywords }) => keywords)
    expect(new Set(lists).size).toBe(lists.length)
  })
})

describe('EMOJI_CHOICES', () => {
  it('offers about 80 emoji, each once', () => {
    expect(EMOJI_CHOICES.length).toBeGreaterThanOrEqual(70)
    expect(EMOJI_CHOICES.length).toBeLessThanOrEqual(90)
    expect(new Set(EMOJI_CHOICES).size).toBe(EMOJI_CHOICES.length)
  })

  it('uses single code points that render as emoji without a variation selector', () => {
    expect(EMOJI_CHOICES.filter((emoji) => !/^\p{Emoji_Presentation}$/u.test(emoji))).toEqual([])
  })

  it('offers only symbols that categories, quick adds and avatars accept', () => {
    expect(EMOJI_CHOICES.filter((emoji) => !isEmoji(emoji) || !isIconRef(emoji) || isIconKey(emoji))).toEqual([])
  })
})

describe('HOME_CARDS', () => {
  it('lists every card in the default Home order of §5.9 with the names of §3.1, §3.7 and §3.16', () => {
    expect(HOME_CARDS.map(({ key, name }) => [key, name])).toEqual([
      ['equation', 'Show the sums above the total'],
      ['wallet', 'Wallet'],
      ['owed', 'Owed to you'],
      ['whereItWent', 'Where it went'],
      ['budgets', 'Limits'],
      ['comingUp', 'Coming up'],
      ['trend', 'Last 6 months'],
      ['recent', 'Recent'],
    ])
  })

  it('describes the Owed to you card (§3.16)', () => {
    expect(HOME_CARDS.find(({ key }) => key === 'owed')).toEqual({
      key: 'owed',
      name: 'Owed to you',
      description: 'Money people owe you from shared bills',
    })
  })

  it('covers every HomeCardKey once and describes each card', () => {
    const all: Record<HomeCardKey, true> = {
      equation: true,
      wallet: true,
      owed: true,
      whereItWent: true,
      budgets: true,
      comingUp: true,
      trend: true,
      recent: true,
    }
    const keys = HOME_CARDS.map(({ key }) => key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.toSorted()).toEqual(Object.keys(all).toSorted())
    expect(HOME_CARDS.filter(({ name, description }) => !isSentenceCase(name) || !isSentenceCase(description))).toEqual([])
  })
})

describe('EVERY_MONTHS_OPTIONS', () => {
  it('lists the intervals of the recurring sheet (§3.6)', () => {
    expect(EVERY_MONTHS_OPTIONS).toEqual([
      { value: 1, label: 'Monthly' },
      { value: 2, label: 'Every 2 months' },
      { value: 3, label: 'Every 3 months' },
      { value: 6, label: 'Every 6 months' },
      { value: 12, label: 'Yearly' },
    ])
  })
})

describe('RECURRING_SUGGESTIONS', () => {
  it('suggests the §5.3 fixed costs with category and interval, never a price', () => {
    expect(RECURRING_SUGGESTIONS).toEqual([
      { name: 'Netflix', categoryId: 'cat-subscriptions', everyMonths: 1 },
      { name: 'Spotify', categoryId: 'cat-subscriptions', everyMonths: 1 },
      { name: 'Deutschlandticket', categoryId: 'cat-transport', everyMonths: 1 },
      { name: 'Phone', categoryId: 'cat-phone', everyMonths: 1 },
      { name: 'Internet', categoryId: 'cat-phone', everyMonths: 1 },
      { name: 'Gym', categoryId: 'cat-subscriptions', everyMonths: 1 },
      { name: 'Insurance', categoryId: 'cat-insurance', everyMonths: 12 },
      { name: 'Rundfunkbeitrag', categoryId: 'cat-other', everyMonths: 3 },
    ])
  })

  it('points at default categories', () => {
    const ids = new Set(createDefaultCategories().map(({ id }) => id))
    expect(RECURRING_SUGGESTIONS.filter(({ categoryId }) => !ids.has(categoryId))).toEqual([])
  })
})

describe('AUTO_LOCK_OPTIONS', () => {
  it('offers the lock delays of §3.8, including the default', () => {
    expect(AUTO_LOCK_OPTIONS).toEqual([
      { minutes: 0, label: 'Immediately' },
      { minutes: 1, label: '1 minute' },
      { minutes: 5, label: '5 minutes' },
      { minutes: 15, label: '15 minutes' },
      { minutes: 60, label: '1 hour' },
    ])
    expect(AUTO_LOCK_OPTIONS.map(({ minutes }) => minutes)).toContain(DEFAULT_AUTO_LOCK_MINUTES)
  })
})
