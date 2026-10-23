import type { ComponentType } from 'react'
import { MonthPickerSheet } from '@/app/MonthPickerSheet'
import type { RouteName, RouteProps, SheetName, SheetProps, SheetRoute, TabId } from '@/app/nav'
import { formatPeriodName } from '@/domain/period'
import { DailyScreen } from '@/features/daily/DailyScreen'
import { TransactionSheet } from '@/features/daily/TransactionSheet'
import { FixedScreen } from '@/features/fixed/FixedScreen'
import { RecurringSheet } from '@/features/fixed/RecurringSheet'
import { CategoryDetailScreen } from '@/features/home/CategoryDetailScreen'
import { HomeScreen } from '@/features/home/HomeScreen'
import { PinSetupSheet } from '@/features/lock/PinSetupSheet'
import { PrivacyScreen } from '@/features/lock/PrivacyScreen'
import { VerifyOwnerSheet } from '@/features/lock/VerifyOwnerSheet'
import { OwedScreen } from '@/features/owed/OwedScreen'
import { MonthReviewSheet } from '@/features/review/MonthReviewSheet'
import { GoalSheet } from '@/features/wallet/GoalSheet'
import { WalletEntrySheet } from '@/features/wallet/WalletEntrySheet'
import { WalletScreen } from '@/features/wallet/WalletScreen'
import { WalletSettingsSheet } from '@/features/wallet/WalletSettingsSheet'
import { AboutScreen } from '@/features/you/AboutScreen'
import { BackupScreen } from '@/features/you/BackupScreen'
import { CategoriesScreen } from '@/features/you/CategoriesScreen'
import { CategorySheet } from '@/features/you/CategorySheet'
import { CurrencyScreen } from '@/features/you/CurrencyScreen'
import { DiagnosticsScreen } from '@/features/you/DiagnosticsScreen'
import { EraseSheet } from '@/features/you/EraseSheet'
import { HomeLayoutScreen } from '@/features/you/HomeLayoutScreen'
import { MonthStartScreen } from '@/features/you/MonthStartScreen'
import { NumberFormatScreen } from '@/features/you/NumberFormatScreen'
import { QuickAddSheet } from '@/features/you/QuickAddSheet'
import { QuickAddsScreen } from '@/features/you/QuickAddsScreen'
import { SavingsGoalSheet } from '@/features/you/SavingsGoalSheet'
import { YouScreen } from '@/features/you/YouScreen'

/**
 * What renders for each tab, route and sheet (docs/SPEC.md §5.5, §5.9). Only Shell, ScreenStack
 * and SheetHost import this module, so features never depend on each other through it.
 */

export const TAB_ROOTS: Record<TabId, ComponentType> = {
  home: HomeScreen,
  daily: DailyScreen,
  fixed: FixedScreen,
  wallet: WalletScreen,
}

export const SCREENS: { [N in RouteName]: ComponentType<RouteProps<N>> } = {
  category: CategoryDetailScreen,
  you: YouScreen,
  owed: OwedScreen,
  'you.homeLayout': HomeLayoutScreen,
  'you.currency': CurrencyScreen,
  'you.numberFormat': NumberFormatScreen,
  'you.monthStart': MonthStartScreen,
  'you.categories': CategoriesScreen,
  'you.quickAdds': QuickAddsScreen,
  'you.backup': BackupScreen,
  'you.about': AboutScreen,
  'you.diagnostics': DiagnosticsScreen,
  'you.privacy': PrivacyScreen,
}

export interface SheetDefinition<N extends SheetName> {
  Component: ComponentType<SheetProps<N>>
  /** Accessible name of the sheet's dialog. */
  label: string
  /**
   * auto: as tall as its content, up to the 10px top inset (DESIGN.md §9.16); large: always starts
   * at that inset, for long forms that scroll (recurring, category, the month review).
   */
  size: 'auto' | 'large'
  /**
   * What the sheet is printed on. Default 'sheet' (--surface-sheet); 'paper' is statement paper
   * (--surface), for the month-end review (docs/design/EXTRAS.md §1.1).
   */
  material?: 'sheet' | 'paper'
}

export const SHEETS: { [N in SheetName]: SheetDefinition<N> } = {
  // Content-sized even with its keypad: the screen stays visible above it, and on 375×667 it then
  // fills the height exactly (DESIGN.md §9.16). The wallet entry and goal sheets likewise (§9.26).
  transaction: { Component: TransactionSheet, label: 'New expense', size: 'auto' },
  recurring: { Component: RecurringSheet, label: 'Fixed cost or income', size: 'large' },
  categoryEdit: { Component: CategorySheet, label: 'Category', size: 'large' },
  quickAdd: { Component: QuickAddSheet, label: 'Quick add button', size: 'auto' },
  savingsGoal: { Component: SavingsGoalSheet, label: 'Monthly savings', size: 'auto' },
  monthPicker: { Component: MonthPickerSheet, label: 'Choose a month', size: 'auto' },
  pinSetup: { Component: PinSetupSheet, label: 'Choose a PIN', size: 'auto' },
  verifyOwner: { Component: VerifyOwnerSheet, label: "Confirm it's you", size: 'auto' },
  erase: { Component: EraseSheet, label: 'Erase all data', size: 'auto' },
  walletEntry: { Component: WalletEntrySheet, label: 'Add money', size: 'auto' },
  walletSettings: { Component: WalletSettingsSheet, label: 'Wallet settings', size: 'auto' },
  goal: { Component: GoalSheet, label: 'Goal', size: 'auto' },
  // A statement printed on paper; sheetLabel names it after its period ("October statement").
  monthReview: { Component: MonthReviewSheet, label: 'Month review', size: 'large', material: 'paper' },
}

/**
 * The accessible name of a sheet's dialog: the registry label, made specific where the route
 * says more (editing rather than adding, income rather than an expense).
 */
export function sheetLabel(route: SheetRoute): string {
  const editing = 'id' in route && route.id !== undefined
  switch (route.name) {
    case 'transaction':
      if (editing) return route.kind === 'income' ? 'Edit income' : route.kind === 'expense' ? 'Edit expense' : 'Edit entry'
      return route.kind === 'income' ? 'One-off income' : 'New expense'
    case 'recurring':
      if (editing) return route.kind === 'income' ? 'Edit income' : 'Edit fixed cost'
      return route.kind === 'income' ? 'New income' : 'New fixed cost'
    case 'categoryEdit':
      return editing ? 'Edit category' : 'New category'
    case 'quickAdd':
      return editing ? 'Edit quick add button' : 'New quick add button'
    case 'walletEntry':
      if (editing) return 'Edit wallet entry'
      return route.kind === 'withdrawal' ? 'Take money out' : 'Add money'
    case 'goal':
      return editing ? 'Edit goal' : 'New goal'
    case 'monthReview':
      // The dialog is named by its title, "October statement" (EXTRAS.md §1.8). A period's name is
      // the month it starts in, whatever the start day and number format, so the defaults serve.
      return `${formatPeriodName(route.month, 1, 'de-DE')} statement`
    default:
      return SHEETS[route.name].label
  }
}
