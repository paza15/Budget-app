import { useId, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SheetProps } from '@/app/nav'
import { periodOf, periodTiming, formatPeriodName } from '@/domain/period'
import type { Cents, MonthKey } from '@/domain/types'
import { blurOnEnter } from '@/features/you/settings/keyboard'
import { actions } from '@/store/actions'
import { useData, useMoneyFormat } from '@/store/hooks'
import { getToday, useToday } from '@/store/today'
import { AmountField, ListRow, Section, SheetHeader } from '@/ui'

/**
 * Monthly savings (docs/SPEC.md §3.7, §4.5): what is set aside before daily spending, for every
 * month (setSavingsGoal, which keeps past months as they were) and, if wanted, a different amount
 * for one month (setMonthSavings), like a fixed cost's "Different amount this month". Opened from
 * You (this month) or from Home's Savings row (the month shown there).
 */
export function SavingsGoalSheet({ route, onClose, setDirty }: SheetProps<'savingsGoal'>) {
  const today = useToday()
  const settings = useData((d) => d.settings)
  const [month] = useState<MonthKey>(() => route.month ?? periodOf(today, settings.monthStartDay))
  const stored = useData((d) => (Object.hasOwn(d.months, month) ? d.months[month]?.savingsGoal : undefined))
  const money = useMoneyFormat()
  // The month's amount field, focused when "Different amount" opens it.
  const monthFieldId = useId()

  const [initialEvery] = useState<Cents>(settings.savingsGoal)
  const [initialMonth] = useState<Cents | null>(stored ?? null)
  const [every, setEvery] = useState<Cents | null>(initialEvery)
  const [own, setOwn] = useState<Cents | null>(initialMonth)
  // The month's field shows once asked for, or when the month already has its own amount.
  const [monthOpen, setMonthOpen] = useState(initialMonth !== null)

  const timing = periodTiming(month, today, settings.monthStartDay)
  const current = timing === 'current'
  const monthName = formatPeriodName(month, settings.monthStartDay, settings.locale, { withYear: !current })
  const groupTitle = current ? 'This month' : monthName
  const fieldLabel = current ? 'Different amount this month' : `Different amount in ${formatPeriodName(month, settings.monthStartDay, settings.locale)}`
  const usual = every ?? 0

  const changed = (nextEvery: Cents | null, nextOwn: Cents | null) => {
    setDirty((nextEvery ?? 0) !== initialEvery || nextOwn !== initialMonth)
  }

  const openMonth = () => {
    flushSync(() => setMonthOpen(true))
    document.getElementById(monthFieldId)?.focus()
  }

  const backToUsual = () => {
    setOwn(null)
    setMonthOpen(false)
    changed(every, null)
  }

  const save = () => {
    const goal = every ?? 0
    if (goal !== initialEvery) actions.setSavingsGoal(goal, getToday())
    if (own !== initialMonth) actions.setMonthSavings(month, own)
    onClose()
  }

  return (
    // The body puts the keyboard away on its "done" key.
    <div ref={blurOnEnter} style={{ display: 'contents' }}>
      <SheetHeader title="Monthly savings" onCancel={onClose} action={{ label: 'Save', onClick: save, 'data-testid': 'sheet-save' }} />
      <Section
        variant="form"
        context="sheet"
        title="Every month"
        footer={
          timing === 'past'
            ? "Set aside before daily spending. It lowers what's left to spend. Months that have ended keep what they had."
            : "Set aside before daily spending. It lowers what's left to spend."
        }
      >
        <AmountField
          label="Amount"
          value={every}
          onChange={(value) => {
            setEvery(value)
            changed(value, own)
          }}
        />
      </Section>
      <Section
        variant="form"
        context="sheet"
        title={groupTitle}
        footer={
          monthOpen
            ? `Changes ${current ? 'this month' : monthName} only. Leave it empty to use the usual amount.`
            : undefined
        }
      >
        {monthOpen ? (
          <>
            <AmountField
              id={monthFieldId}
              label={fieldLabel}
              value={own}
              placeholder={money.format(usual, { unmasked: true })}
              onChange={(value) => {
                setOwn(value)
                changed(every, value)
              }}
            />
            <ListRow title="Use the usual amount" tinted onClick={backToUsual} />
          </>
        ) : (
          <ListRow title={fieldLabel} detail="Off" chevron onClick={openMonth} />
        )}
      </Section>
    </div>
  )
}
