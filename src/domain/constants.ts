/**
 * App-wide constants (docs/SPEC.md §3.7, §4.1, §4.7, §5.3). Plain values, safe to import from any
 * layer.
 */

/** Display name of the app. */
export const APP_NAME = 'On a Budget'

/** Machine name: the `app` field of backup files and the prefix of exported file names. */
export const APP_ID = 'on-a-budget'

/** Largest amount the app accepts, in cents: 8 integer digits (99.999.999,99 €). */
export const MAX_CENTS = 9_999_999_999

/** Maximum lengths of user-entered text, applied on input and when loading data (§4.7). */
export const MAX_LENGTHS = { name: 24, category: 24, quickAdd: 16, recurring: 40, note: 80 } as const

/** Most quick add buttons there can be (§3.7): actions.addQuickAdd refuses another one. */
export const MAX_QUICK_ADDS = 8

/** Note of the onboarding expense that stands for spending before the app was set up (§3.9). */
export const BEFORE_APP_NOTE = 'Before On a Budget'

/**
 * Latest day a budget period can start on: `settings.monthStartDay` is 1..28 (§4.3). Every month
 * has a 28th, so each period starts on a real day and is exactly as long as its starting month.
 */
export const MAX_MONTH_START_DAY = 28

/** Prefix of every localStorage key the app owns. Erasing all data removes every key with it. */
export const LS_PREFIX = 'onabudget:'

/** localStorage keys (all start with LS_PREFIX). Everything else lives in IndexedDB. */
export const LS_KEYS = {
  /** Mirror of settings.theme, read by public/theme-init.js before the app loads. */
  theme: 'onabudget:theme',
  /** Mirror of settings.accent, read by public/theme-init.js before the app loads. */
  accent: 'onabudget:accent',
  /** `{ basedOnRev, data }`, written when saving to IndexedDB fails (§5.4, persistence rule 4). */
  rescue: 'onabudget:rescue',
  /** The unsaved new-item sheet: `{ route, fields, savedAt }` (§5.10). */
  draft: 'onabudget:draft',
  /** Last onboarding step reached, so a relaunch resumes there (§3.9). */
  onboardingStep: 'onabudget:onboardingStep',
  /** Set when the Safari install hint is dismissed (§3.10). */
  installHintDismissed: 'onabudget:installHintDismissed',
  /** Epoch ms until which the backup nudge stays hidden (§3.10). */
  backupNudgeUntil: 'onabudget:backupNudgeUntil',
} as const
