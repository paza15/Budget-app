import { defaultCurrencyFor, defaultNumberLocale, HOME_CARDS } from '@/domain/catalog'
import type {
  AppData,
  Category,
  CategoryColor,
  CategoryKind,
  IconRef,
  QuickAdd,
  SecurityConfig,
  Settings,
  Wallet,
} from '@/domain/types'

/** First-run data and defaults (docs/SPEC.md §5.11). */

/** Schema version written by this build. Bump it together with a new entry in MIGRATIONS. */
export const CURRENT_SCHEMA_VERSION = 1

/** Stable ids of the default categories, in default order. */
export const DEFAULT_CATEGORY_IDS = {
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
} as const

/** PBKDF2-SHA256 iterations for new PIN hashes (§8). */
export const DEFAULT_PIN_ITERATIONS = 210_000

/** Lock after the app has been in the background this long (§3.8: "1 minute" is the default). */
export const DEFAULT_AUTO_LOCK_MINUTES = 1

/** A default category as [id, icon, name, colour, kind], in §5.11 order. */
type CategorySeed = readonly [id: string, icon: IconRef, name: string, color: CategoryColor, kind: CategoryKind]

const CATEGORY_SEEDS: readonly CategorySeed[] = [
  [DEFAULT_CATEGORY_IDS.rent, 'house', 'Rent', 'blue', 'fixed'],
  [DEFAULT_CATEGORY_IDS.subscriptions, 'repeat', 'Subscriptions', 'violet', 'fixed'],
  [DEFAULT_CATEGORY_IDS.transport, 'train', 'Transport', 'aqua', 'both'],
  [DEFAULT_CATEGORY_IDS.phone, 'device-mobile', 'Phone & internet', 'slate', 'fixed'],
  [DEFAULT_CATEGORY_IDS.insurance, 'shield-check', 'Insurance', 'brown', 'fixed'],
  [DEFAULT_CATEGORY_IDS.eating, 'fork-knife', 'Eating', 'orange', 'daily'],
  [DEFAULT_CATEGORY_IDS.groceries, 'shopping-cart', 'Groceries', 'green', 'daily'],
  [DEFAULT_CATEGORY_IDS.coffee, 'coffee', 'Coffee & snacks', 'yellow', 'daily'],
  [DEFAULT_CATEGORY_IDS.shopping, 'shopping-bag', 'Shopping', 'magenta', 'daily'],
  [DEFAULT_CATEGORY_IDS.goingOut, 'martini', 'Going out', 'red', 'daily'],
  [DEFAULT_CATEGORY_IDS.health, 'pill', 'Health', 'blue', 'daily'],
  [DEFAULT_CATEGORY_IDS.other, 'package', 'Other', 'slate', 'both'],
]

/**
 * Default settings; currency and number format follow the device. Pass `navigator.language` and
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`; without them the currency is EUR and the
 * number format de-DE. Every Home card is shown, in HOME_CARDS order (equation, wallet, owed,
 * whereItWent, budgets, comingUp, trend, recent: §5.9), and no month has been reviewed yet.
 */
export function createDefaultSettings(now: number, navigatorLanguage?: string, timeZone?: string): Settings {
  return {
    name: '',
    avatar: '',
    currency: defaultCurrencyFor(navigatorLanguage ?? '', timeZone),
    locale: defaultNumberLocale(navigatorLanguage),
    monthStartDay: 1,
    savingsGoal: 0,
    theme: 'system',
    accent: 'navy',
    showCents: true,
    hideAmounts: false,
    homeCards: HOME_CARDS.map(({ key }) => key),
    onboarded: false,
    lastBackupAt: null,
    lastReviewedMonth: null,
    createdAt: now,
  }
}

/** The twelve default categories of §5.11, in order: no limits, none archived. */
export function createDefaultCategories(): Category[] {
  return CATEGORY_SEEDS.map(([id, icon, name, color, kind], order) => ({
    id,
    name,
    icon,
    color,
    kind,
    budget: null,
    order,
    archived: false,
  }))
}

/**
 * Coffee 3,50 and Bakery 2,50 (Coffee & snacks) and Mensa 4,50 (Eating). Stable ids, like the
 * categories', keep a fresh install's data the same every time.
 */
export function createDefaultQuickAdds(): QuickAdd[] {
  return [
    { id: 'qa-coffee', label: 'Coffee', icon: 'coffee', amount: 350, categoryId: DEFAULT_CATEGORY_IDS.coffee, order: 0 },
    { id: 'qa-bakery', label: 'Bakery', icon: 'bread', amount: 250, categoryId: DEFAULT_CATEGORY_IDS.coffee, order: 1 },
    { id: 'qa-mensa', label: 'Mensa', icon: 'bowl-food', amount: 450, categoryId: DEFAULT_CATEGORY_IDS.eating, order: 2 },
  ]
}

/** Everything a new install starts with: default settings, categories and quick adds, no entries. */
export function createInitialData(now: number, navigatorLanguage?: string, timeZone?: string): AppData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: createDefaultSettings(now, navigatorLanguage, timeZone),
    categories: createDefaultCategories(),
    recurring: [],
    transactions: [],
    quickAdds: createDefaultQuickAdds(),
    months: {},
    wallet: createDefaultWallet(),
  }
}

/**
 * An empty wallet that starts with the period the app is set up in (docs/SPEC.md §4.8): no
 * opening balance, no entries and no savings goals (§3.14).
 */
export function createDefaultWallet(): Wallet {
  return { opening: 0, startMonth: null, entries: [], goals: [] }
}

/** No PIN, no Face ID, lock after 1 minute, 210,000 PBKDF2 iterations, no failed attempts. */
export function createDefaultSecurity(): SecurityConfig {
  return {
    pinHash: null,
    pinSalt: null,
    pinIterations: DEFAULT_PIN_ITERATIONS,
    pinLength: 4,
    biometricCredentialId: null,
    autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
    failedAttempts: 0,
    lockoutUntil: null,
  }
}
