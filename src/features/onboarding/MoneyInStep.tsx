import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { MAX_LENGTHS } from '@/domain/constants'
import { periodOf } from '@/domain/period'
import type { Cents } from '@/domain/types'
import {
  incomeRows,
  newIncomeRow,
  openingSavings,
  saveIncomeRows,
  saveOpeningSavings,
  type IncomeRow,
} from '@/features/onboarding/entries'
import { StepFrame } from '@/features/onboarding/StepFrame'
import styles from '@/features/onboarding/Steps.module.css'
import type { StepNav } from '@/features/onboarding/types'
import { getData } from '@/store/appStore'
import { useData, useSettings } from '@/store/hooks'
import { getToday, useToday } from '@/store/today'
import { AmountField, Icon, ListRow, Section, TextField } from '@/ui'

/** The current period at the time of the tap. */
function currentMonth() {
  return periodOf(getToday(), getData().settings.monthStartDay)
}

/**
 * Step 3, Money in (docs/SPEC.md §3.9): "What comes in each month?" The recurring income of this
 * month as rows (a name and an amount each), or one row named "Income"; "Add another" adds a row
 * and puts the cursor in its name. Under them, in a group of its own, the optional "Savings you
 * already have", the wallet's opening balance (§3.12). Continue and Back save the rows (an emptied
 * amount deletes its item) and the savings; "Skip for now" leaves everything as it was.
 */
export function MoneyInStep({ progress, direction, onNext, onBack }: StepNav) {
  const recurring = useData((d) => d.recurring)
  const opening = useData((d) => d.wallet.opening)
  const { monthStartDay } = useSettings()
  const today = useToday()
  // The fields start from what the data holds when the step opens; leaving the step saves them.
  const [rows, setRows] = useState<IncomeRow[]>(() => incomeRows(recurring, periodOf(today, monthStartDay)))
  const [savings, setSavings] = useState<Cents | null>(() => openingSavings(opening))
  const listRef = useRef<HTMLDivElement>(null)

  const update = (key: string, patch: Partial<IncomeRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const save = () => {
    const data = getData()
    saveIncomeRows(rows, currentMonth(), data.recurring)
    saveOpeningSavings(savings, data.wallet.opening)
  }

  const addAnother = () => {
    const row = newIncomeRow()
    // Rendered at once, so its name field takes focus inside the tap and iOS raises the keyboard.
    flushSync(() => setRows((current) => [...current, row]))
    listRef.current?.querySelector<HTMLInputElement>(`input[data-id="${row.key}"]`)?.focus()
  }

  return (
    <StepFrame
      title="What comes in each month?"
      compactTitle="Money in"
      lead="Add what arrives every month: your pay, money from your parents, BAföG."
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
        {rows.map((row) => (
          <Section key={row.key} variant="form">
            <TextField
              variant="form"
              label="Name"
              value={row.name}
              onChange={(name) => update(row.key, { name })}
              placeholder="Parents, BAföG, job"
              maxLength={MAX_LENGTHS.recurring}
              enterKeyHint="done"
              data-id={row.key}
            />
            <AmountField label="Amount" value={row.amount} onChange={(amount) => update(row.key, { amount })} />
          </Section>
        ))}
      </div>
      <Section variant="form" footer="Lines without an amount are left out.">
        <ListRow
          leading={<Icon name="plus-circle" size={22} className={styles.addIcon} />}
          title="Add another"
          tinted
          onClick={addAnother}
        />
      </Section>
      <Section variant="form" footer="Money you have saved already. It starts your wallet.">
        <AmountField label="Savings you already have" value={savings} onChange={setSavings} />
      </Section>
    </StepFrame>
  )
}
