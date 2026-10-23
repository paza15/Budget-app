import { useMemo, type ReactNode } from 'react'
import { useNav, type SheetRoute } from '@/app/nav'
import { RECURRING_SUGGESTIONS } from '@/domain/catalog'
import { sumCents } from '@/domain/money'
import { categoryDisplay } from '@/domain/queries'
import type { RecurringLine } from '@/domain/recurring'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import type { Category, MonthKey, Recurring } from '@/domain/types'
import {
  AddLine,
  GroupHeader,
  Lede,
  LedeStrong,
  RecurringRow,
  RowGroup,
  SubtitleText,
  TodayDivider,
  TotalRow,
} from '@/features/fixed/FixedList'
import {
  canTick,
  categoryKeyOfItem,
  fixedCategoryKeys,
  groupByCategory,
  itemsWithoutLine,
  knownCategoryIds,
  lineSubtitle,
  paidCount,
  periodPhrase,
  rowAmount,
  todayDividerIndex,
} from '@/features/fixed/fixedModel'
import styles from '@/features/fixed/FixedScreen.module.css'
import { NotThisMonth } from '@/features/fixed/NotThisMonth'
import { startingCategory } from '@/features/fixed/recurringForm'
import { actions } from '@/store/actions'
import { useCategories, useCategoryMap, useData, useMonthSummary, useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import { Button, CategoryBadge, Chip, ChipTabs, EmptyState, ListRow, Meter, Money } from '@/ui'

export interface CostsViewProps {
  /** The selected period. */
  month: MonthKey
  /** The current period. */
  current: MonthKey
  /** The selected category chip: a category id, UNCATEGORIZED_ID, or null for "All". */
  chip: string | null
  onChip(chip: string | null): void
}

const FOOTER =
  'Fixed costs count in full from the first day of the month, paid or not. Tick them off to keep track of what has gone out.'

function openSheet(route: SheetRoute): void {
  useNav.getState().openSheet(route)
}

/** A new fixed cost; with a category chip selected it starts in that category. */
export function addFixedCost(chip: string | null): void {
  openSheet({
    name: 'recurring',
    kind: 'expense',
    ...(chip === null || chip === UNCATEGORIZED_ID ? {} : { preset: { categoryId: chip } }),
  })
}

/**
 * The category chips of Costs (every category with fixed costs) and the chip in effect: one whose
 * category has gone (deleted, or its last fixed cost removed) falls back to All.
 */
export function useFixedChips(chip: string | null): {
  categories: Category[]
  known: ReadonlySet<string>
  keys: string[]
  selected: string | null
} {
  const recurring = useData((d) => d.recurring)
  const categories = useCategories({ includeArchived: true })
  const known = useMemo(() => knownCategoryIds(categories), [categories])
  const keys = useMemo(() => fixedCategoryKeys(recurring, categories, known), [recurring, categories, known])
  const selected = chip !== null && keys.includes(chip) ? chip : null
  return { categories, known, keys, selected }
}

function openItem(r: Recurring): void {
  openSheet({ name: 'recurring', id: r.id, kind: r.kind })
}

function togglePaid(line: RecurringLine): void {
  actions.setOverride(line.month, line.recurring.id, { paid: !line.paid })
}

/**
 * Fixed → Costs (docs/SPEC.md §3.5): the month's sentence, category chips, the rows grouped under
 * their categories (or one category by due date with the "Today" divider), the total that
 * reconciles with Home, the footer, the collapsed "Not this month" group and "Add fixed cost".
 */
export function CostsView({ month, current, chip, onChip }: CostsViewProps) {
  const summary = useMonthSummary(month)
  const recurring = useData((d) => d.recurring)
  const months = useData((d) => d.months)
  const categoryMap = useCategoryMap()
  const { monthStartDay: startDay, locale } = useSettings()
  const today = useToday()
  const { categories, known, keys: chipKeys, selected } = useFixedChips(chip)
  const lines = summary.fixedLines
  const withoutLine = useMemo(() => itemsWithoutLine(recurring, 'expense', lines, month), [recurring, lines, month])

  if (chipKeys.length === 0) return <EmptyCosts categories={categories} />

  const phrase = periodPhrase(month, current, startDay, locale)
  const { paid, count } = paidCount(lines)
  const display = (key: string) => categoryDisplay(key, categoryMap)
  const inChip = (r: Recurring) => selected === null || categoryKeyOfItem(r, known) === selected

  const row = (line: RecurringLine, divider: boolean) => (
    <RowFragment key={`${month}:${line.recurring.id}`} divider={divider}>
      <RecurringRow
        item={line.recurring}
        subtitle={<SubtitleText subtitle={lineSubtitle(line, current, startDay, locale)} />}
        amount={rowAmount(line, months)}
        tone={line.skipped ? 'struck' : line.paid || !line.isChargeMonth ? 'muted' : 'default'}
        check={canTick(line) ? { paid: line.paid, onToggle: () => togglePaid(line) } : null}
        onOpen={() => openItem(line.recurring)}
      />
    </RowFragment>
  )

  let list: ReactNode
  let total: number
  if (selected === null) {
    const groups = groupByCategory(lines, categories, known)
    total = summary.fixed
    list = groups.map((group) => (
      <div key={group.key}>
        <GroupHeader title={display(group.key).name} coin={display(group.key)} total={group.total} />
        <RowGroup>{group.lines.map((line) => row(line, false))}</RowGroup>
      </div>
    ))
  } else {
    const chipLines = lines.filter((line) => inChip(line.recurring))
    const dividerAt = month === current ? todayDividerIndex(chipLines, today) : null
    total = sumCents(chipLines.map((line) => line.amount))
    list = (
      <>
        <CategoryRow categoryKey={selected} month={month} phrase={phrase} />
        {chipLines.length > 0 && (
          <RowGroup className={styles.chipList}>
            {chipLines.map((line, index) => row(line, index === dividerAt))}
            {dividerAt === chipLines.length && <TodayDivider />}
          </RowGroup>
        )}
      </>
    )
  }

  return (
    <>
      <Lede>
        <LedeStrong>
          <Money cents={summary.fixed} /> {phrase}
        </LedeStrong>
        {count > 0 && `, ${paid} of ${count} paid`}
      </Lede>
      <ChipTabs
        className={styles.chips}
        label="Categories"
        value={selected}
        onChange={onChip}
        items={[
          { value: null, label: 'All' },
          ...chipKeys.map((key) => ({ value: key, label: display(key).name, icon: display(key).icon })),
        ]}
      />
      {list}
      <TotalRow total={total} />
      <p className={styles.footer}>{FOOTER}</p>
      <NotThisMonth
        items={withoutLine.filter(inChip)}
        month={month}
        startDay={startDay}
        locale={locale}
        coinFor={selected === null ? (r) => display(categoryKeyOfItem(r, known)) : undefined}
        onOpen={openItem}
      />
      <AddLine label="Add fixed cost" onClick={() => addFixedCost(selected)} />
    </>
  )
}

/** A row preceded by the "Today" divider when it is the first one still to come. */
function RowFragment({ divider, children }: { divider: boolean; children: ReactNode }) {
  return (
    <>
      {divider && <TodayDivider />}
      {children}
    </>
  )
}

interface CategoryRowProps {
  categoryKey: string
  month: MonthKey
  phrase: string
}

/**
 * The selected category as on Daily (§3.3, §3.5): badge, name, what it counts this month (fixed
 * plus daily) and its limit's meter, opening category detail.
 */
function CategoryRow({ categoryKey, month, phrase }: CategoryRowProps) {
  const summary = useMonthSummary(month)
  const categoryMap = useCategoryMap()
  const display = categoryDisplay(categoryKey, categoryMap)
  const spend = summary.byCategory.find((row) => row.categoryId === categoryKey)
  const total = spend?.total ?? 0
  return (
    <RowGroup className={styles.categoryRow}>
      <ListRow
        leading={<CategoryBadge icon={display.icon} color={display.color} />}
        title={display.name}
        subtitle={
          <>
            <Money cents={total} /> {phrase}
          </>
        }
        chevron
        onClick={() => useNav.getState().push({ name: 'category', categoryId: categoryKey })}
      />
      {spend !== undefined && spend.budget !== null && (
        <div className={styles.meter}>
          <Meter
            value={spend.total}
            max={spend.budget}
            status={spend.status}
            label={`${display.name} limit`}
            timeRatio={summary.pace.timeRatio}
          />
        </div>
      )}
    </RowGroup>
  )
}

/**
 * No fixed costs at all (§3.5): the invitation and the RECURRING_SUGGESTIONS chips, which open a
 * new fixed cost with the name, category and interval filled in (never a price). A missing or
 * archived category falls back to the first active fixed category, here for the glyph and in the
 * sheet for the form.
 */
function EmptyCosts({ categories }: { categories: readonly Category[] }) {
  const categoryMap = useCategoryMap()
  return (
    <div className={styles.empty}>
      <EmptyState
        icon="fixed"
        title="No fixed costs yet"
        message="Add rent, subscriptions and other costs that repeat every month."
      />
      <div className={styles.suggestions}>
        {RECURRING_SUGGESTIONS.map((suggestion) => {
          const categoryId = startingCategory(categories, suggestion.categoryId)
          return (
            <Chip
              key={suggestion.name}
              icon={categoryDisplay(categoryId, categoryMap).icon}
              onClick={() =>
                openSheet({
                  name: 'recurring',
                  kind: 'expense',
                  preset: {
                    name: suggestion.name,
                    categoryId: suggestion.categoryId,
                    everyMonths: suggestion.everyMonths,
                  },
                })
              }
            >
              {suggestion.name}
            </Chip>
          )
        })}
      </div>
      <div className={styles.emptyAction}>
        <Button variant="secondary" icon="plus" onClick={() => addFixedCost(null)}>
          Add fixed cost
        </Button>
      </div>
    </div>
  )
}

