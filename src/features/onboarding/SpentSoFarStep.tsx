import { useState } from 'react'
import { formatDate } from '@/domain/dates'
import { periodOf, periodRange } from '@/domain/period'
import type { Cents } from '@/domain/types'
import { beforeAppEntry, saveSpentSoFar } from '@/features/onboarding/entries'
import { StepFrame } from '@/features/onboarding/StepFrame'
import type { StepNav } from '@/features/onboarding/types'
import { getData } from '@/store/appStore'
import { useData, useSettings } from '@/store/hooks'
import { getToday, useToday } from '@/store/today'
import { AmountField, Section } from '@/ui'

/** The current period and its start day at the time of the tap. */
function current() {
  const startDay = getData().settings.monthStartDay
  return { month: periodOf(getToday(), startDay), startDay }
}

/**
 * Step 5, Spent so far (docs/SPEC.md §3.9), shown after the first day of the period: one rough
 * total of the daily spending before the app, saved as an expense in Other on the first day of the
 * period with the note "Before On a Budget". Continue and Back save it (an empty amount removes
 * it); Skip leaves it as it was.
 */
export function SpentSoFarStep({ progress, direction, onNext, onBack }: StepNav) {
  const { monthStartDay, locale } = useSettings()
  const transactions = useData((d) => d.transactions)
  const today = useToday()
  const month = periodOf(today, monthStartDay)
  // Starts from the entry an earlier visit saved, if any; leaving the step saves it.
  const [amount, setAmount] = useState<Cents | null>(
    () => beforeAppEntry(transactions, month, monthStartDay)?.amount ?? null,
  )
  const start = periodRange(month, monthStartDay).start

  const save = () => {
    const now = current()
    saveSpentSoFar(amount, now.month, now.startDay, getData().transactions)
  }

  return (
    <StepFrame
      title={`Spent anything since ${formatDate(start, locale, 'short')}?`}
      compactTitle="Spent so far"
      lead="Food, shopping, going out and the like. Leave out fixed costs: they're counted already."
      progress={progress}
      direction={direction}
      onBack={() => {
        save()
        onBack()
      }}
      primary={{
        label: 'Continue',
        onClick: () => {
          save()
          onNext()
        },
      }}
      secondary={{ label: 'Skip', onClick: onNext }}
    >
      <Section variant="form" footer="A rough total is fine. It keeps this month's numbers honest.">
        <AmountField
          label="Daily spending so far this month"
          value={amount}
          onChange={setAmount}
        />
      </Section>
    </StepFrame>
  )
}
