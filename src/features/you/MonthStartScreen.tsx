import { useState } from 'react'
import { useNav } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { formatDate, ordinalDay } from '@/domain/dates'
import { periodOf, periodRange } from '@/domain/period'
import { ActionBar } from '@/features/you/settings/ActionBar'
import { DayGrid } from '@/features/you/settings/DayGrid'
import { hasPeriodData } from '@/features/you/settings/rules'
import { SentenceRow } from '@/features/you/settings/SentenceRow'
import { actions } from '@/store/actions'
import { useData } from '@/store/hooks'
import { useToday } from '@/store/today'
import { Button, confirmDialog, Screen, Section, toast } from '@/ui'

function back(): void {
  useNav.getState().pop()
}

/**
 * You › Month starts on (docs/SPEC.md §3.7, §4.3): day 1 to 28, the footer about paydays, a live
 * line "This month will run from {start} to {end}.", and the change itself behind a button that
 * asks first when there is data (setMonthStartDay remaps the period keys) and offers Undo.
 */
export function MonthStartScreen() {
  const startDay = useData((d) => d.settings.monthStartDay)
  const locale = useData((d) => d.settings.locale)
  const hasData = useData(hasPeriodData)
  const today = useToday()
  // The day picked on this page: it starts at the day in use and is applied with the button.
  const [day, setDay] = useState(startDay)
  const changed = day !== startDay
  const range = periodRange(periodOf(today, day), day)
  // A date never breaks between its day and month ("24 Oct" on one line).
  const start = formatDate(range.start, locale, 'short').replaceAll(' ', ' ')
  const end = formatDate(range.end, locale, 'short').replaceAll(' ', ' ')

  const apply = async () => {
    const target = day
    if (target === startDay) return
    const ordinal = ordinalDay(target)
    if (hasData) {
      const confirmed = await confirmDialog({
        title: `Start each month on the ${ordinal}?`,
        message: 'Entries keep their dates and fixed costs their due days. Totals, limits and savings follow the new months.',
        confirmLabel: 'Change',
      })
      if (!confirmed) return
    }
    try {
      await withUndo(`Months now start on the ${ordinal}`, () => actions.setMonthStartDay(target))
    } catch {
      toast({ message: "Couldn't change the start day. Try again.", tone: 'critical' })
    }
  }

  return (
    <Screen title="Month starts on" largeTitle onBack={back} backLabel="You">
      <Section footer="Pick your payday to make each month run from one payday to the next.">
        <DayGrid value={day} current={startDay} onChange={setDay} />
        <SentenceRow>
          {changed ? `This month will run from ${start} to ${end}.` : `This month runs from ${start} to ${end}.`}
        </SentenceRow>
      </Section>
      <ActionBar>
        <Button size="lg" block disabled={!changed} onClick={() => void apply()}>
          {`Start months on the ${ordinalDay(day)}`}
        </Button>
      </ActionBar>
    </Screen>
  )
}
