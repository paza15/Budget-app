import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { RecurringSuggestion } from '@/domain/catalog'
import { periodOf } from '@/domain/period'
import {
  fixedRows,
  openSuggestions,
  saveFixedRows,
  suggestionRow,
  type FixedRow,
} from '@/features/onboarding/entries'
import { StepFrame } from '@/features/onboarding/StepFrame'
import styles from '@/features/onboarding/Steps.module.css'
import type { StepNav } from '@/features/onboarding/types'
import { getData } from '@/store/appStore'
import { useData, useSettings } from '@/store/hooks'
import { getToday, useToday } from '@/store/today'
import { AmountField, Chip, Icon, Section } from '@/ui'

/** The current period at the time of the tap. */
function currentMonth() {
  return periodOf(getToday(), getData().settings.monthStartDay)
}

const LEFT_OUT = 'Costs without an amount are left out.'

const EVERY: Readonly<Partial<Record<FixedRow['everyMonths'], string>>> = {
  2: 'every two months',
  3: 'every three months',
  6: 'every six months',
  12: 'once a year',
}

/**
 * What the footer says about added costs that do not come every month: the amount is the whole
 * charge, set aside a share at a time (entries.ts saves them spread). "Insurance comes once a year
 * and Rundfunkbeitrag every three months: …"
 */
function rhythmNote(rows: readonly FixedRow[]): string | null {
  const added = rows.filter((row) => row.id === null && row.everyMonths > 1)
  if (added.length === 0) return null
  const parts = added.map((row, i) => {
    const every = EVERY[row.everyMonths] ?? `every ${row.everyMonths} months`
    return i === 0 ? `${row.name} comes ${every}` : `${row.name} ${every}`
  })
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return `${list}: enter what you pay each time, and a share is set aside every month.`
}

/**
 * Step 4, Fixed costs (docs/SPEC.md §3.9): Rent first (the first fixed cost in Rent, or a new
 * row), then the fixed costs this month already has, each an amount field named after the cost.
 * Suggestion chips add a named row without a price and put the cursor in its amount. Continue
 * and Back save; "Skip for now" leaves everything as it was.
 */
export function FixedCostsStep({ progress, direction, onNext, onBack }: StepNav) {
  const recurring = useData((d) => d.recurring)
  const { monthStartDay } = useSettings()
  const today = useToday()
  // The rows start from what the data holds when the step opens; leaving the step saves them.
  const [rows, setRows] = useState<FixedRow[]>(() => fixedRows(recurring, periodOf(today, monthStartDay)))
  const listRef = useRef<HTMLDivElement>(null)
  const suggestions = openSuggestions(rows)
  const note = rhythmNote(rows)

  const setAmount = (key: string, amount: FixedRow['amount']) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, amount } : row)))

  const save = () => saveFixedRows(rows, currentMonth(), getData().recurring)

  const add = (suggestion: RecurringSuggestion) => {
    const row = suggestionRow(suggestion)
    // Rendered at once, so the amount takes focus inside the tap and iOS raises the keyboard. The
    // chip goes away with it, so focus must move anyway.
    flushSync(() => setRows((current) => [...current, row]))
    listRef.current?.querySelector<HTMLInputElement>(`input[data-id="${row.key}"]`)?.focus()
  }

  return (
    <StepFrame
      title="What goes out each month?"
      compactTitle="Fixed costs"
      lead="Rent, subscriptions, your phone: the app counts fixed costs for you every month."
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
      secondary={{ label: 'Skip for now', onClick: onNext }}
    >
      <div ref={listRef}>
        <Section variant="form" footer={note === null ? LEFT_OUT : `${note} ${LEFT_OUT}`}>
          {rows.map((row) => (
            <AmountField
              key={row.key}
              label={row.name}
              value={row.amount}
              onChange={(amount) => setAmount(row.key, amount)}
              data-id={row.key}
            />
          ))}
        </Section>
      </div>
      {suggestions.length > 0 && (
        <Section variant="form" title="Add more" footer="Anything else can go on the Fixed tab later." bare>
          <div className={styles.chips}>
            {suggestions.map((suggestion) => (
              <Chip
                key={suggestion.name}
                leading={<Icon name="plus" size={13} className={styles.chipPlus} />}
                onClick={() => add(suggestion)}
              >
                {suggestion.name}
              </Chip>
            ))}
          </div>
        </Section>
      )}
    </StepFrame>
  )
}
