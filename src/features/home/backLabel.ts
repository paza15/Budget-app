import type { Route, RouteName, TabId } from '@/app/nav'
import { categoryDisplay } from '@/domain/queries'
import type { Category } from '@/domain/types'

/** Where a pushed screen was opened from: its tab, and the screen under it (null: the tab's root). */
export interface ScreenOrigin {
  tab: TabId
  below: Route | null
}

/** Tab roots by the name their tab carries. */
const TAB_TITLES: Readonly<Record<TabId, string>> = { home: 'Home', daily: 'Daily', fixed: 'Fixed', wallet: 'Wallet' }

/** Titles of the pushed screens, as SPEC §3.7, §3.8 and §3.16 name them. */
const ROUTE_TITLES: Readonly<Partial<Record<RouteName, string>>> = {
  you: 'You',
  owed: 'Owed to you',
  'you.homeLayout': 'Home layout',
  'you.currency': 'Currency',
  'you.numberFormat': 'Number format',
  'you.monthStart': 'Month starts on',
  'you.categories': 'Categories',
  'you.quickAdds': 'Quick add buttons',
  'you.backup': 'Backup',
  'you.about': 'About',
  'you.diagnostics': 'Diagnostics',
  'you.privacy': 'App lock',
}

/**
 * The back capsule's label on a pushed screen (DESIGN.md §9.2): "‹ {previous title}", the screen
 * under it ("Daily", "Coffee & snacks", "Categories"), or "Back" for a screen without a known title.
 */
export function backLabelFor(origin: ScreenOrigin, categories: Readonly<Record<string, Category>>): string {
  const { below } = origin
  if (below === null) return TAB_TITLES[origin.tab]
  if (below.name === 'category') return categoryDisplay(below.categoryId, categories).name
  return ROUTE_TITLES[below.name] ?? 'Back'
}
