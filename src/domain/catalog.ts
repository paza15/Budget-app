import type { CurrencyDigits } from '@/domain/money'
import type { AccentKey, CategoryColor, EveryMonths, HomeCardKey } from '@/domain/types'

/**
 * Static option lists (docs/SPEC.md §5.3). No hex colours here: those live in
 * src/styles/tokens.css and are referenced by key.
 */

export interface CurrencyOption {
  /** ISO 4217 code. */
  code: string
  name: string
  digits: CurrencyDigits
}

export interface NumberLocaleOption {
  /** BCP 47 locale used for number formatting only. */
  locale: string
  label: string
}

export interface AccentOption {
  key: AccentKey
  name: string
}

export interface CategoryColorOption {
  key: CategoryColor
  name: string
}

/** A Phosphor icon offered for categories and quick adds. */
export interface CategoryIconOption {
  /** The Phosphor file name, stored as Category.icon and QuickAdd.icon. */
  key: string
  /** What the picture shows ("Coffee cup"): the icon's accessible name in the picker. */
  name: string
  /** Lower-case search terms for the icon picker: what people use the icon for. */
  keywords: string[]
  /** Picker section the icon is listed under, one of CATEGORY_ICON_GROUPS. */
  group: string
}

export interface HomeCardOption {
  key: HomeCardKey
  name: string
  description: string
}

export interface EveryMonthsOption {
  value: EveryMonths
  label: string
}

/** A fixed cost suggested on an empty Fixed screen and in onboarding. Never carries a price. */
export interface RecurringSuggestion {
  name: string
  categoryId: string
  everyMonths: EveryMonths
}

export interface AutoLockOption {
  minutes: number
  label: string
}

// ---------------------------------------------------------------------------------------------
// Money

/**
 * EUR first: EUR USD GBP CHF ALL(0) PLN CZK HUF RON SEK NOK DKK TRY JPY(0) CNY INR CAD AUD.
 * money.ts keeps the same digits in its own table (it cannot import this module); a test checks
 * that the two agree.
 */
export const CURRENCIES: CurrencyOption[] = [
  { code: 'EUR', name: 'Euro', digits: 2 },
  { code: 'USD', name: 'US dollar', digits: 2 },
  { code: 'GBP', name: 'British pound', digits: 2 },
  { code: 'CHF', name: 'Swiss franc', digits: 2 },
  { code: 'ALL', name: 'Albanian lek', digits: 0 },
  { code: 'PLN', name: 'Polish złoty', digits: 2 },
  { code: 'CZK', name: 'Czech koruna', digits: 2 },
  { code: 'HUF', name: 'Hungarian forint', digits: 2 },
  { code: 'RON', name: 'Romanian leu', digits: 2 },
  { code: 'SEK', name: 'Swedish krona', digits: 2 },
  { code: 'NOK', name: 'Norwegian krone', digits: 2 },
  { code: 'DKK', name: 'Danish krone', digits: 2 },
  { code: 'TRY', name: 'Turkish lira', digits: 2 },
  { code: 'JPY', name: 'Japanese yen', digits: 0 },
  { code: 'CNY', name: 'Chinese yuan', digits: 2 },
  { code: 'INR', name: 'Indian rupee', digits: 2 },
  { code: 'CAD', name: 'Canadian dollar', digits: 2 },
  { code: 'AUD', name: 'Australian dollar', digits: 2 },
]

/**
 * Number formats offered in You → Number format, labelled by the country whose conventions they
 * follow. The screen shows a live sample next to each ("1.234,56 €").
 */
export const NUMBER_LOCALES: NumberLocaleOption[] = [
  { locale: 'de-DE', label: 'Germany' },
  { locale: 'de-AT', label: 'Austria' },
  { locale: 'de-CH', label: 'Switzerland' },
  { locale: 'en-IE', label: 'Ireland' },
  { locale: 'en-GB', label: 'United Kingdom' },
  { locale: 'en-US', label: 'United States' },
  { locale: 'fr-FR', label: 'France' },
  { locale: 'it-IT', label: 'Italy' },
  { locale: 'es-ES', label: 'Spain' },
  { locale: 'nl-NL', label: 'Netherlands' },
  { locale: 'sq-AL', label: 'Albania' },
  { locale: 'pl-PL', label: 'Poland' },
]

/** The number format used when the device language is not one of NUMBER_LOCALES. */
export const FALLBACK_NUMBER_LOCALE = 'de-DE'

/** The currency used when neither the time zone nor the language region names one. */
export const FALLBACK_CURRENCY = 'EUR'

/** IANA time zones by the currency used there (the first clue defaultCurrencyFor reads). */
const CURRENCY_ZONES: Readonly<Record<string, readonly string[]>> = {
  // Every eurozone capital (Bulgaria joined on 1 January 2026), the eurozone's other European
  // zones, and the microstates and Montenegro, which use the euro too.
  EUR: [
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
    'Europe/Paris',
    'Europe/Riga',
    'Europe/Rome',
    'Europe/Sofia',
    'Europe/Tallinn',
    'Europe/Vienna',
    'Europe/Vilnius',
    'Europe/Zagreb',
    'Asia/Nicosia',
    'Europe/Nicosia',
    'Atlantic/Azores',
    'Atlantic/Canary',
    'Atlantic/Madeira',
    'Africa/Ceuta',
    'Europe/Mariehamn',
    'Europe/Andorra',
    'Europe/Monaco',
    'Europe/Podgorica',
    'Europe/San_Marino',
    'Europe/Vatican',
  ],
  CHF: ['Europe/Zurich', 'Europe/Vaduz'],
  GBP: ['Europe/London', 'Europe/Belfast', 'Europe/Guernsey', 'Europe/Isle_of_Man', 'Europe/Jersey'],
  ALL: ['Europe/Tirane'],
  PLN: ['Europe/Warsaw'],
  CZK: ['Europe/Prague'],
  HUF: ['Europe/Budapest'],
  RON: ['Europe/Bucharest'],
  SEK: ['Europe/Stockholm'],
  NOK: ['Europe/Oslo'],
  DKK: ['Europe/Copenhagen'],
  TRY: ['Europe/Istanbul', 'Asia/Istanbul'],
  JPY: ['Asia/Tokyo'],
  USD: [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Anchorage',
    'America/Detroit',
    'Pacific/Honolulu',
  ],
  CNY: ['Asia/Shanghai'],
  // ICU still reports India as Asia/Calcutta.
  INR: ['Asia/Kolkata', 'Asia/Calcutta'],
  CAD: [
    'America/Toronto',
    'America/Montreal',
    'America/Vancouver',
    'America/Edmonton',
    'America/Winnipeg',
    'America/Regina',
    'America/Halifax',
    'America/St_Johns',
  ],
  AUD: [
    'Australia/Sydney',
    'Australia/Melbourne',
    'Australia/Brisbane',
    'Australia/Perth',
    'Australia/Adelaide',
    'Australia/Hobart',
    'Australia/Darwin',
    'Australia/Canberra',
  ],
}

/** ISO 3166 regions by the currency used there (the second clue, from the language tag). */
const CURRENCY_REGIONS: Readonly<Record<string, readonly string[]>> = {
  // The 21 eurozone members, then Andorra, Åland, Montenegro, Monaco, San Marino, the Vatican
  // and Kosovo.
  EUR: [
    'AT', 'BE', 'BG', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV',
    'MT', 'NL', 'PT', 'SI', 'SK', 'AD', 'AX', 'ME', 'MC', 'SM', 'VA', 'XK',
  ],
  CHF: ['CH', 'LI'],
  GBP: ['GB', 'GG', 'IM', 'JE'],
  ALL: ['AL'],
  PLN: ['PL'],
  CZK: ['CZ'],
  HUF: ['HU'],
  RON: ['RO'],
  SEK: ['SE'],
  NOK: ['NO'],
  DKK: ['DK', 'FO', 'GL'],
  TRY: ['TR'],
  JPY: ['JP'],
  USD: ['US', 'PR'],
  CNY: ['CN'],
  INR: ['IN'],
  CAD: ['CA'],
  AUD: ['AU'],
}

/** Inverts a currency → keys table into a lookup by lower-cased key. */
function byKey(table: Readonly<Record<string, readonly string[]>>): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>()
  for (const [currency, keys] of Object.entries(table)) {
    for (const key of keys) lookup.set(key.toLowerCase(), currency)
  }
  return lookup
}

const CURRENCY_BY_TIME_ZONE = byKey(CURRENCY_ZONES)
const CURRENCY_BY_REGION = byKey(CURRENCY_REGIONS)

/** The region subtag of a BCP 47 tag ('de-DE' → 'DE', 'zh-Hans-CN' → 'CN'), or null. */
function regionOf(locale: string): string | null {
  try {
    return new Intl.Locale(locale.trim().replaceAll('_', '-')).region ?? null
  } catch {
    // Not a well-formed language tag (Intl.Locale throws a RangeError, '' included).
    return null
  }
}

/**
 * Default currency: from the time zone first (Europe/Berlin → EUR, Europe/Zurich → CHF,
 * Europe/London → GBP, Europe/Tirane → ALL, …), then the locale's region ('en-GB' → GBP),
 * then EUR. The time zone wins because it says where the phone is, while many people run their
 * phone in a language from elsewhere. Callers pass the device's zone, read with
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`; this function never reads it itself.
 */
export function defaultCurrencyFor(locale: string, timeZone?: string): string {
  const fromZone = timeZone === undefined ? undefined : CURRENCY_BY_TIME_ZONE.get(timeZone.trim().toLowerCase())
  if (fromZone !== undefined) return fromZone
  const region = regionOf(locale)
  const fromRegion = region === null ? undefined : CURRENCY_BY_REGION.get(region.toLowerCase())
  return fromRegion ?? FALLBACK_CURRENCY
}

/**
 * The navigator language when it is in NUMBER_LOCALES (matched without regard to case, so the
 * lower-case 'en-us' of older Safari versions counts), else 'de-DE'.
 */
export function defaultNumberLocale(navigatorLanguage: string | undefined): string {
  const wanted = navigatorLanguage?.trim().replaceAll('_', '-').toLowerCase()
  const match = NUMBER_LOCALES.find(({ locale }) => locale.toLowerCase() === wanted)
  return match?.locale ?? FALLBACK_NUMBER_LOCALE
}

/** NUMBER_LOCALES tags by their lower-cased form: language tags do not depend on case. */
const OFFERED_NUMBER_LOCALES: ReadonlyMap<string, string> = new Map(
  NUMBER_LOCALES.map(({ locale }) => [locale.toLowerCase(), locale]),
)

/**
 * `value` as a number format locale in canonical form, or null when it is none (§4.7): a
 * NUMBER_LOCALES tag in any case gives the tag as listed ('sq-al' → 'sq-AL'), and any other tag
 * counts when Intl supports it ('en-us' → 'en-US', 'ja-JP'). Offered formats count even where the
 * engine lacks their data: Chromium has no sq-AL, so Intl formats it in its default locale there,
 * but a saved choice is never rewritten and still applies on engines that have it (Safari). Use
 * it wherever a locale is accepted, so that a choice the app takes survives normalisation.
 */
export function canonicalNumberLocale(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const offered = OFFERED_NUMBER_LOCALES.get(value.toLowerCase())
  if (offered !== undefined) return offered
  try {
    const supported = Intl.NumberFormat.supportedLocalesOf([value])
    return supported.length === 1 ? (supported[0] ?? null) : null
  } catch {
    // A malformed language tag throws a RangeError.
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Look

/** Navy (the default), royal blue, teal, bottle green, burgundy, plum, cognac, graphite (docs/DESIGN.md §4.3). */
export const ACCENTS: AccentOption[] = [
  { key: 'navy', name: 'Navy' },
  { key: 'royal', name: 'Royal blue' },
  { key: 'teal', name: 'Teal' },
  { key: 'bottle', name: 'Bottle green' },
  { key: 'burgundy', name: 'Burgundy' },
  { key: 'plum', name: 'Plum' },
  { key: 'cognac', name: 'Cognac' },
  { key: 'graphite', name: 'Graphite' },
]

/**
 * The ten category colour slots in picker order, the order of the `--cat-*` tokens. A new
 * category takes the first one no active category uses (nextFreeCategoryColor).
 */
export const CATEGORY_COLORS: CategoryColorOption[] = [
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
]

// ---------------------------------------------------------------------------------------------
// Category icons

/** Sections of the icon picker, in display order. */
export const CATEGORY_ICON_GROUPS = [
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
] as const

export type CategoryIconGroup = (typeof CATEGORY_ICON_GROUPS)[number]

/** One icon as [Phosphor key, accessible name, search keywords]. */
type IconEntry = readonly [key: string, name: string, keywords: readonly string[]]

/**
 * The curated icons by picker section, chosen for a student's month in Germany: rent and the
 * Mensa, the Deutschlandticket, the semester fee, laundry, the drugstore. Names describe the
 * picture and serve as each icon's accessible name, so they are nouns ("Repeat symbol", never a
 * verb that reads like a button). Keywords say what people use the icon for, in lower case, so a
 * search for "rent" finds the house; they include the German word where people living in Germany
 * are likely to type it (miete, strom, apotheke). Every key is a file in
 * @phosphor-icons/core/assets/regular and /light; scripts/build-icons.mjs extracts their paths.
 */
const ICON_SECTIONS: Readonly<Record<CategoryIconGroup, readonly IconEntry[]>> = {
  'Food & drink': [
    ['fork-knife', 'Fork and knife', ['eating', 'eating out', 'restaurant', 'lunch', 'dinner', 'meal', 'food']],
    ['bowl-food', 'Bowl', ['mensa', 'canteen', 'cafeteria', 'lunch', 'noodles', 'ramen', 'food']],
    ['shopping-cart', 'Shopping trolley', ['groceries', 'supermarket', 'lebensmittel', 'food shopping', 'market']],
    ['bread', 'Bread', ['bakery', 'bäckerei', 'breakfast', 'pastry', 'snacks']],
    ['coffee', 'Coffee cup', ['coffee', 'café', 'cafe', 'tea', 'snacks', 'drinks']],
    ['pizza', 'Pizza', ['takeaway', 'delivery', 'fast food', 'food']],
    ['beer-stein', 'Beer mug', ['beer', 'bar', 'pub', 'kneipe', 'beer garden', 'drinks', 'going out']],
    ['martini', 'Cocktail glass', ['going out', 'cocktails', 'bar', 'club', 'party', 'nightlife', 'drinks']],
  ],
  'Home & bills': [
    ['house', 'House', ['rent', 'miete', 'home', 'flat', 'apartment', 'dorm', 'housing']],
    ['repeat', 'Repeat symbol', ['subscriptions', 'abo', 'recurring', 'monthly', 'membership', 'streaming']],
    ['lightning', 'Lightning bolt', ['electricity', 'strom', 'power', 'energy', 'utilities']],
    ['flame', 'Flame', ['heating', 'heizung', 'gas', 'energy', 'utilities']],
    ['wifi-high', 'Wi-Fi signal', ['internet', 'wlan', 'broadband', 'router', 'online']],
    ['washing-machine', 'Washing machine', ['laundry', 'washing', 'launderette', 'dry cleaning']],
    ['couch', 'Sofa', ['furniture', 'möbel', 'household', 'home', 'decor']],
  ],
  Transport: [
    [
      'train',
      'Train',
      ['transport', 'public transport', 'deutschlandticket', 'bahn', 'commute', 'ticket', 'u-bahn', 's-bahn'],
    ],
    ['bus', 'Bus', ['public transport', 'commute', 'coach', 'tram']],
    ['bicycle', 'Bicycle', ['bike', 'fahrrad', 'cycling', 'bike sharing', 'bike repairs']],
    ['scooter', 'Scooter', ['e-scooter', 'kick scooter', 'ride', 'sharing']],
    ['car', 'Car', ['driving', 'parking', 'car sharing', 'lease', 'car repairs']],
    ['gas-pump', 'Fuel pump', ['fuel', 'petrol', 'tanken', 'gas', 'diesel', 'charging']],
    ['taxi', 'Taxi', ['cab', 'ride', 'ride hailing', 'night ride']],
  ],
  Shopping: [
    ['shopping-bag', 'Shopping bag', ['shopping', 'online shopping', 'store', 'things']],
    ['t-shirt', 'T-shirt', ['clothes', 'kleidung', 'clothing', 'fashion']],
    ['sneaker', 'Trainer', ['shoes', 'schuhe', 'sneakers', 'footwear', 'fashion']],
    ['gift', 'Gift', ['presents', 'geschenk', 'gifts', 'birthday', 'christmas']],
  ],
  'Health & care': [
    ['pill', 'Pill', ['health', 'pharmacy', 'apotheke', 'medicine']],
    ['first-aid-kit', 'First aid kit', ['doctor', 'arzt', 'medical', 'hospital', 'health']],
    ['tooth', 'Tooth', ['dentist', 'zahnarzt', 'dental']],
    ['hand-soap', 'Soap dispenser', ['drugstore', 'drogerie', 'toiletries', 'hygiene', 'personal care', 'cosmetics']],
    ['scissors', 'Scissors', ['haircut', 'hairdresser', 'friseur', 'barber', 'beauty']],
    ['barbell', 'Barbell', ['gym', 'fitness', 'sport', 'workout']],
  ],
  Fun: [
    ['film-slate', 'Clapperboard', ['cinema', 'kino', 'films', 'movies', 'streaming']],
    ['music-notes', 'Music notes', ['music', 'concerts', 'streaming', 'lessons']],
    ['game-controller', 'Game controller', ['games', 'gaming', 'video games', 'console']],
    ['ticket', 'Ticket', ['events', 'tickets', 'concerts', 'theatre', 'festival', 'museum']],
    ['confetti', 'Confetti', ['party', 'celebration', 'birthday', 'events']],
    ['soccer-ball', 'Football', ['sport', 'football', 'soccer', 'club', 'match']],
  ],
  Money: [
    ['piggy-bank', 'Piggy bank', ['savings', 'sparen', 'saving', 'emergency fund']],
    ['bank', 'Bank', ['bank fees', 'account', 'loan', 'transfer', 'interest']],
    ['credit-card', 'Credit card', ['card', 'card fees', 'payments', 'credit']],
    ['coins', 'Coins', ['cash', 'bargeld', 'money', 'cash machine', 'tips']],
    ['chart-line-up', 'Rising chart', ['investing', 'investments', 'stocks', 'etf', 'crypto']],
    ['shield-check', 'Shield', ['insurance', 'versicherung', 'liability', 'protection']],
  ],
  Tech: [
    ['device-mobile', 'Mobile phone', ['phone', 'handy', 'mobile', 'phone contract', 'internet', 'smartphone', 'sim']],
    ['laptop', 'Laptop', ['computer', 'software', 'electronics', 'apps']],
    ['television', 'Television', ['tv', 'streaming', 'licence fee', 'rundfunkbeitrag']],
    ['headphones', 'Headphones', ['audio', 'music', 'podcasts', 'audiobooks']],
  ],
  Travel: [
    ['airplane', 'Aeroplane', ['flights', 'travel', 'holiday', 'urlaub', 'vacation', 'trip', 'visiting home']],
    ['suitcase-rolling', 'Suitcase', ['travel', 'luggage', 'holiday', 'vacation', 'trip']],
    ['bed', 'Bed', ['hotel', 'accommodation', 'hostel', 'holiday flat']],
    ['map-trifold', 'Map', ['trips', 'sightseeing', 'excursions', 'travel']],
  ],
  Education: [
    [
      'graduation-cap',
      'Graduation cap',
      ['university', 'uni', 'studies', 'studium', 'semester fee', 'semesterbeitrag', 'tuition', 'school'],
    ],
    ['book-open', 'Open book', ['books', 'reading', 'textbooks', 'library', 'stationery']],
    ['chalkboard-teacher', 'Teacher at a board', ['courses', 'lessons', 'tutoring', 'language course', 'sprachkurs']],
  ],
  'Family & pets': [
    ['baby', 'Baby', ['children', 'kids', 'childcare', 'kita', 'family']],
    ['users-three', 'Group of people', ['family', 'friends', 'flatmates', 'wg', 'shared costs', 'group']],
    ['heart', 'Heart', ['partner', 'dating', 'love', 'relationship']],
    ['paw-print', 'Paw print', ['pets', 'dog', 'cat', 'vet', 'pet food']],
  ],
  Other: [
    ['package', 'Parcel', ['other', 'miscellaneous', 'parcels', 'post', 'delivery']],
    ['briefcase', 'Briefcase', ['work', 'job', 'business', 'office']],
    ['hand-heart', 'Hand with heart', ['donations', 'spende', 'charity', 'giving']],
    ['question', 'Question mark', ['uncategorized', 'unknown']],
    ['circle', 'Circle', ['general', 'plain', 'default']],
  ],
}

/**
 * The 64 Phosphor keys offered for categories and quick adds, grouped for the icon picker in
 * CATEGORY_ICON_GROUPS order. Includes every default category and quick-add icon (§5.11),
 * 'question' (Uncategorized) and 'circle' (what an invalid icon is repaired to, §4.7).
 */
export const CATEGORY_ICONS: CategoryIconOption[] = CATEGORY_ICON_GROUPS.flatMap((group) =>
  ICON_SECTIONS[group].map(([key, name, keywords]) => ({ key, name, keywords: [...keywords], group })),
)

/**
 * Emoji offered in the icon picker's Emoji tab and as avatars: faces and animals first (they
 * suit a profile picture), then things that suit a category, in the icon picker's group order.
 * Each is a single code point with emoji presentation, so it renders as an emoji everywhere
 * without a variation selector.
 */
export const EMOJI_CHOICES: string[] = [
  // Faces and animals
  '😀', '😊', '😎', '🤓', '🥳', '😇', '😴',
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🐸', '🦁', '🐧', '🦄',
  // Nature
  '🌸', '🌻', '🌿', '🍀', '⭐', '🔥',
  // Food and drink
  '☕', '🍕', '🍔', '🍜', '🍣', '🥗', '🥐', '🍰', '🍎', '🍺', '🍷', '🍸',
  // Home and bills
  '🏠', '💡', '🧾', '🧺', '🪴', '🔧', '📦',
  // Transport
  '🚆', '🚌', '🚗', '🚲', '⛽', '🚕',
  // Shopping
  '🛒', '👕', '👟', '💄', '🎁',
  // Health and care
  '💊', '🩺', '🦷', '🧴', '💪',
  // Fun
  '🎬', '🎵', '🎮', '🎫', '🎉', '⚽', '🎨',
  // Money
  '💰', '💳', '🏦', '🐷', '💸',
  // Tech
  '📱', '💻', '📺',
  // Travel
  '🧳', '🛫', '🌴', '⛺',
  // Education
  '🎓', '📚',
  // Family and pets
  '👶', '🐾', '💍',
]

// ---------------------------------------------------------------------------------------------
// Home, recurring items and the lock

/**
 * Every Home card in default order, with the names shown in You → Home layout. 'equation' is no
 * card of its own: it shows the sums inside the hero, so its entry reads as a setting.
 */
export const HOME_CARDS: HomeCardOption[] = [
  {
    key: 'equation',
    name: 'Show the sums above the total',
    description: 'Income, fixed costs, savings and daily spending',
  },
  { key: 'wallet', name: 'Wallet', description: 'Money you keep from month to month' },
  { key: 'owed', name: 'Owed to you', description: 'Money people owe you from shared bills' },
  { key: 'whereItWent', name: 'Where it went', description: 'Daily spending by category' },
  { key: 'budgets', name: 'Limits', description: 'Spending against your monthly limits' },
  { key: 'comingUp', name: 'Coming up', description: 'Fixed costs still due this month' },
  { key: 'trend', name: 'Last 6 months', description: 'Fixed costs and daily spending month by month' },
  { key: 'recent', name: 'Recent', description: 'Your latest expenses' },
]

/** Monthly, Every 2 months, Every 3 months, Every 6 months, Yearly. */
export const EVERY_MONTHS_OPTIONS: EveryMonthsOption[] = [
  { value: 1, label: 'Monthly' },
  { value: 2, label: 'Every 2 months' },
  { value: 3, label: 'Every 3 months' },
  { value: 6, label: 'Every 6 months' },
  { value: 12, label: 'Yearly' },
]

/**
 * Netflix (subscriptions, 1), Spotify (subscriptions, 1), Deutschlandticket (transport, 1),
 * Phone (phone, 1), Internet (phone, 1), Gym (subscriptions, 1), Insurance (insurance, 12),
 * Rundfunkbeitrag (other, 3). Category ids are the default ones of defaults.ts
 * (DEFAULT_CATEGORY_IDS), written out because defaults.ts imports this module.
 */
export const RECURRING_SUGGESTIONS: RecurringSuggestion[] = [
  { name: 'Netflix', categoryId: 'cat-subscriptions', everyMonths: 1 },
  { name: 'Spotify', categoryId: 'cat-subscriptions', everyMonths: 1 },
  { name: 'Deutschlandticket', categoryId: 'cat-transport', everyMonths: 1 },
  { name: 'Phone', categoryId: 'cat-phone', everyMonths: 1 },
  { name: 'Internet', categoryId: 'cat-phone', everyMonths: 1 },
  { name: 'Gym', categoryId: 'cat-subscriptions', everyMonths: 1 },
  { name: 'Insurance', categoryId: 'cat-insurance', everyMonths: 12 },
  { name: 'Rundfunkbeitrag', categoryId: 'cat-other', everyMonths: 3 },
]

/** Immediately (0), 1 minute (the default), 5 minutes, 15 minutes, 1 hour. */
export const AUTO_LOCK_OPTIONS: AutoLockOption[] = [
  { minutes: 0, label: 'Immediately' },
  { minutes: 1, label: '1 minute' },
  { minutes: 5, label: '5 minutes' },
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
]
