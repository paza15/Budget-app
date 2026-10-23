import { useState } from 'react'
import { MonthStepper, MonthTitle } from '@/app/MonthSwitcher'
import { useNav, useSelectedMonth, type FixedSegment } from '@/app/nav'
import { formatPeriodTitle, periodOf } from '@/domain/period'
import { addFixedCost, CostsView, useFixedChips } from '@/features/fixed/CostsView'
import { paidCount, periodPhrase } from '@/features/fixed/fixedModel'
import styles from '@/features/fixed/FixedScreen.module.css'
import { IncomeView } from '@/features/fixed/IncomeView'
import { useMonthSummary, useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import { useUiStore } from '@/store/uiStore'
import { IconButton, Money, Screen, SegmentedControl } from '@/ui'

const SEGMENTS: { value: FixedSegment; label: string }[] = [
  { value: 'costs', label: 'Costs' },
  { value: 'income', label: 'Income' },
]

const EYEBROW = 'Fixed costs and income'

function setSegment(segment: FixedSegment): void {
  useNav.getState().setFixedSegment(segment)
}

/** A new fixed cost (in the selected chip's category) or a new recurring income. */
function addItem(segment: FixedSegment, chip: string | null): void {
  if (segment === 'costs') addFixedCost(chip)
  else useNav.getState().openSheet({ name: 'recurring', kind: 'income' })
}

/** The eye button while Hide amounts is on (docs/SPEC.md §3.1): shows the amounts until the app is hidden. */
function EyeButton() {
  const revealed = useUiStore((s) => s.amountsRevealed)
  return (
    <IconButton
      variant="glass"
      icon={revealed ? 'eye-off' : 'eye'}
      label={revealed ? 'Hide amounts' : 'Show amounts'}
      onClick={() => useUiStore.getState().setAmountsRevealed(!revealed)}
    />
  )
}

/**
 * Fixed tab (docs/SPEC.md §3.5, DESIGN.md §9.2): fixed costs and income that repeat, for the month
 * Home, Daily and Fixed share. The nav row carries the eyebrow, the add button and the month
 * stepper; the large title is the month; Costs | Income switches the list (nav's fixedSegment).
 */
export function FixedScreen() {
  const month = useSelectedMonth()
  const segment = useNav((s) => s.fixedSegment)
  const settings = useSettings()
  const today = useToday()
  const summary = useMonthSummary(month)
  // The category chip, kept while switching segments; it falls back to All when its category goes.
  const [chip, setChip] = useState<string | null>(null)
  const { selected } = useFixedChips(chip)

  const current = periodOf(today, settings.monthStartDay)
  const { paid, count } = paidCount(summary.fixedLines)
  const compactSubtitle =
    segment === 'costs' ? (
      count > 0 ? (
        `${paid} of ${count} paid`
      ) : undefined
    ) : (
      <>
        <Money cents={summary.income} /> {periodPhrase(month, current, settings.monthStartDay, settings.locale)}
      </>
    )

  return (
    <Screen
      title={EYEBROW}
      // The hidden heading already says it; VoiceOver reads it once. The nav row truncates it.
      eyebrow={<span aria-hidden="true">{EYEBROW}</span>}
      largeTitle
      titleContent={<MonthTitle />}
      compactTitle={formatPeriodTitle(month, current, settings.monthStartDay, settings.locale)}
      compactTitleVariant="month"
      compactSubtitle={compactSubtitle}
      headerRight={
        <>
          {settings.hideAmounts && <EyeButton />}
          <IconButton
            variant="glass"
            icon="plus"
            label={segment === 'costs' ? 'Add fixed cost' : 'Add income'}
            onClick={() => addItem(segment, selected)}
          />
          <MonthStepper />
        </>
      }
    >
      <div className={styles.segment}>
        <SegmentedControl
          options={SEGMENTS}
          value={segment}
          onChange={setSegment}
          label="Costs or income"
          data-testid="fixed-segment"
        />
      </div>
      {segment === 'costs' ? (
        <CostsView month={month} current={current} chip={chip} onChip={setChip} />
      ) : (
        <IncomeView month={month} current={current} />
      )}
    </Screen>
  )
}
