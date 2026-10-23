/**
 * On a Budget data model. This file is the contract every layer builds on.
 *
 * Conventions (see docs/SPEC.md §4):
 * - Money is an integer number of hundredths of the major unit, whatever the currency
 *   (3,50 € is 350, ¥350 is 35000). Never a float. The currency only changes display and input.
 * - Calendar dates are local 'YYYY-MM-DD' strings. Never parse them with `new Date(str)`,
 *   which treats them as UTC; use the helpers in `dates.ts`, the only module that builds them.
 * - A budget period ("month") is identified by the 'YYYY-MM' of the calendar month in which it
 *   STARTS. With `monthStartDay` 1 it is the calendar month; with 25 the period '2026-10'
 *   runs from 25 Oct to 24 Nov (inclusive).
 */

/** Integer amount in hundredths of the major currency unit. */
export type Cents = number;

/** Local calendar date, 'YYYY-MM-DD'. Build with dates.ts; narrow unknown input with isValidISODate. */
export type ISODate = `${number}-${number}-${number}`;

/**
 * Budget period key, 'YYYY-MM': the calendar month in which the period starts. Build with
 * dates.ts; narrow unknown input with isValidMonthKey.
 */
export type MonthKey = `${number}-${number}`;

export type ThemeMode = 'system' | 'light' | 'dark';

/** User-selectable accent colours. Hex values live in src/styles/tokens.css. */
export type AccentKey =
  | 'navy'
  | 'royal'
  | 'teal'
  | 'bottle'
  | 'burgundy'
  | 'plum'
  | 'cognac'
  | 'graphite';

/** Category colour slots. Hex values (light and dark) live in src/styles/tokens.css. */
export type CategoryColor =
  | 'blue'
  | 'orange'
  | 'aqua'
  | 'yellow'
  | 'magenta'
  | 'green'
  | 'violet'
  | 'red'
  | 'slate'
  | 'brown';

/**
 * Where a category is offered by default.
 * 'fixed': only for recurring costs (rent). 'daily': only for manual entries (coffee).
 * 'both': offered in both places (transport: monthly pass + occasional taxi).
 */
export type CategoryKind = 'fixed' | 'daily' | 'both';

export type TxKind = 'expense' | 'income';

/** Recurrence interval in months. 1 = monthly, 12 = yearly. */
export type EveryMonths = 1 | 2 | 3 | 6 | 12;

/** Cards on the Home screen that the user can show, hide and reorder. */
export type HomeCardKey =
  | 'equation'
  | 'wallet'
  | 'owed'
  | 'whereItWent'
  | 'budgets'
  | 'comingUp'
  | 'trend'
  | 'recent';

export interface Settings {
  /** Shown in the greeting. May be empty. */
  name: string;
  /** Profile picture: '' shows the initial of `name` as a monogram; otherwise a single emoji. */
  avatar: string;
  /** ISO 4217 code, e.g. 'EUR'. */
  currency: string;
  /** BCP 47 locale used for number and currency formatting only, e.g. 'de-DE'. UI text is English. */
  locale: string;
  /** First day of each budget period, 1..28. */
  monthStartDay: number;
  /** Amount set aside every period before daily spending (0 = no savings goal). */
  savingsGoal: Cents;
  theme: ThemeMode;
  accent: AccentKey;
  /** Show cents in large figures (lists always show cents). */
  showCents: boolean;
  /** Privacy mode: amounts are masked until revealed. */
  hideAmounts: boolean;
  /** Visible Home cards, in display order. The hero (left to spend) is always shown. */
  homeCards: HomeCardKey[];
  onboarded: boolean;
  /** Epoch ms of the last successful backup export, or null. */
  lastBackupAt: number | null;
  /** The latest closed period whose month-end review was opened or dismissed (§3.15), or null. */
  lastReviewedMonth: MonthKey | null;
  /** Epoch ms. */
  createdAt: number;
}

/**
 * A category or quick-add symbol: either a key from CATEGORY_ICONS in catalog.ts (a Phosphor icon
 * name such as 'coffee') or, when the user picks one, a single emoji.
 */
export type IconRef = string;

export interface Category {
  id: string;
  name: string;
  icon: IconRef;
  color: CategoryColor;
  kind: CategoryKind;
  /** Optional monthly limit. It covers everything in this category: fixed costs plus daily spending. */
  budget: Cents | null;
  order: number;
  /** Archived categories are hidden from pickers but keep their history. */
  archived: boolean;
}

/** One step in a recurring item's amount history: `amount` applies from period `from` onward. */
export interface AmountChange {
  from: MonthKey;
  amount: Cents;
}

/**
 * A recurring item. kind 'expense' is a fixed cost (rent, Netflix); kind 'income' is recurring
 * income (salary, parents, BAföG).
 */
export interface Recurring {
  id: string;
  kind: TxKind;
  name: string;
  /** Required for expenses; always null for income. */
  categoryId: string | null;
  /**
   * Amount history, sorted ascending by `from`, unique `from` values, and
   * `amounts[0].from === startMonth`. Never empty.
   */
  amounts: AmountChange[];
  /** Charged every N periods, counted from `startMonth`. */
  everyMonths: EveryMonths;
  /**
   * Only meaningful when everyMonths > 1: count amount / everyMonths in every period instead of
   * the full amount in the charge period (e.g. yearly insurance set aside monthly).
   */
  spread: boolean;
  /** First period this item applies to (also the anchor for everyMonths). */
  startMonth: MonthKey;
  /** Last period this item applies to (inclusive), or null if ongoing. */
  endMonth: MonthKey | null;
  /** Day of month the payment usually happens, 1..31. Display and ordering only. */
  dueDay: number | null;
  note: string;
  order: number;
  /** Epoch ms. */
  createdAt: number;
}

/** Per-period adjustment of one recurring item. */
export interface RecurringOverride {
  /** A different amount for this period only. */
  amount?: Cents;
  /** Not charged in this period. */
  skipped?: boolean;
  /** Ticked off as paid / received in this period. */
  paid?: boolean;
}

export interface MonthData {
  /** Keyed by Recurring.id. */
  overrides?: Record<string, RecurringOverride>;
  /** Savings goal for this period only (overrides Settings.savingsGoal). */
  savingsGoal?: Cents;
}

/** A one-off entry the user types in: daily spending (coffee) or one-off income (a gift). */
export interface Transaction {
  id: string;
  kind: TxKind;
  /** Always > 0. The kind gives the direction. */
  amount: Cents;
  /** Required for expenses; always null for income. */
  categoryId: string | null;
  date: ISODate;
  note: string;
  /**
   * Paid from the wallet (§3.13): the expense leaves the month's budget alone and comes out of the
   * wallet instead. Always false for income.
   */
  fromWallet: boolean;
  /** What other people owe you for this expense (§3.16). Always empty for income. */
  splits: Split[];
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. */
  updatedAt: number;
}

export type SplitStatus = 'open' | 'paid' | 'forgiven';

/** One person's part of a shared expense (§3.16). */
export interface Split {
  id: string;
  /** 1..24 characters. */
  person: string;
  /** 1..MAX_CENTS; all splits of an expense together never exceed its amount. */
  amount: Cents;
  /** 'forgiven' counts as your own spending again. */
  status: SplitStatus;
  /** Epoch ms when it was paid back or forgiven; null while open. */
  settledAt: number | null;
}

/**
 * A savings goal (§3.14): a target added to the wallet. The wallet's balance fills active goals in
 * `order`, top first, so goals hold no money of their own.
 */
export interface SavingsGoal {
  id: string;
  name: string;
  icon: IconRef;
  /** 1..MAX_CENTS. */
  target: Cents;
  order: number;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms when marked done (it then leaves the fill order), or null. */
  doneAt: number | null;
}

/** A one-tap button that adds a fixed-amount expense dated today (e.g. Coffee 3.50). */
export interface QuickAdd {
  id: string;
  label: string;
  icon: IconRef;
  /** > 0 */
  amount: Cents;
  categoryId: string;
  order: number;
}

/** Money moved into or out of the wallet by hand (docs/SPEC.md §4.8). */
export interface WalletEntry {
  id: string;
  kind: 'deposit' | 'withdrawal';
  /** Always > 0. The kind gives the direction. */
  amount: Cents;
  date: ISODate;
  note: string;
  /** Epoch ms. */
  createdAt: number;
}

/**
 * The wallet: money kept from month to month (docs/SPEC.md §4.8). Its balance is never stored. It
 * is the opening balance, plus every closed month's result (income − fixed − daily, so savings
 * plus what was left over, or minus an overspend), plus deposits, minus withdrawals.
 */
export interface Wallet {
  /** Money already saved when the wallet started. 0..MAX_CENTS. */
  opening: Cents;
  /** First period whose result flows in, or null for the period the app was set up in. */
  startMonth: MonthKey | null;
  entries: WalletEntry[];
  /** Savings goals, active and done (§3.14). */
  goals: SavingsGoal[];
}

/** Everything the user owns. Persisted as one IndexedDB value and exported as a backup. */
export interface AppData {
  schemaVersion: number;
  settings: Settings;
  categories: Category[];
  recurring: Recurring[];
  transactions: Transaction[];
  quickAdds: QuickAdd[];
  /** Keyed by MonthKey. Missing entries mean "no adjustments". */
  months: Record<MonthKey, MonthData>;
  wallet: Wallet;
}

/**
 * App-lock configuration. Stored under its own IndexedDB key and never included in backups,
 * because a passkey only works on the device (and site) that created it.
 */
export interface SecurityConfig {
  /** base64 PBKDF2-SHA256 hash of the PIN, or null when no PIN is set. */
  pinHash: string | null;
  /** base64 random salt. */
  pinSalt: string | null;
  pinIterations: number;
  pinLength: 4 | 6;
  /** base64url WebAuthn credential id used for Face ID / Touch ID unlock, or null. */
  biometricCredentialId: string | null;
  /** Lock after the app has been in the background this long. 0 = immediately. */
  autoLockMinutes: number;
  failedAttempts: number;
  /** Epoch ms until which PIN entry is blocked after too many failures, or null. */
  lockoutUntil: number | null;
}
