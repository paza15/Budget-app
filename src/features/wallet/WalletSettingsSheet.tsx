import { useMemo, useState } from 'react'
import type { SheetProps } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { addMonths, localDateOf, maxMonth, minMonth, monthDiff } from '@/domain/dates'
import { formatPeriodLabel, periodOf } from '@/domain/period'
import { firstPeriod } from '@/domain/queries'
import type { Cents, MonthKey } from '@/domain/types'
import styles from '@/features/wallet/WalletSettingsSheet.module.css'
import { actions } from '@/store/actions'
import { useData, useWallet } from '@/store/hooks'
import { useToday } from '@/store/today'
import { AmountField, Section, SelectField, SheetHeader, toast, type SelectOption } from '@/ui'

/**
 * Wallet settings (docs/SPEC.md §3.12, DESIGN.md §9.26 "The Wallet settings sheet"): the opening
 * balance ("Money you had saved when you started.") and the month the wallet counts from ("Months
 * before this don't change your wallet."). Save writes what changed, through withUndo.
 */

interface SettingsForm {
  /** null while the field is empty, which saves as 0. */
  opening: Cents | null
  start: MonthKey
}

function isDirty(form: SettingsForm, initial: SettingsForm): boolean {
  return (form.opening ?? 0) !== (initial.opening ?? 0) || form.start !== initial.start
}

/**
 * The months "Counts from" offers, oldest first, `first` to `last`. Named like everywhere else:
 * "August 2026", or the range with its year when months start on another day than the 1st.
 */
function startOptions(first: MonthKey, last: MonthKey, startDay: number, locale: string): SelectOption<MonthKey>[] {
  const count = Math.max(1, monthDiff(first, last) + 1)
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(first, i)
    return { value: month, label: formatPeriodLabel(month, startDay, locale) }
  })
}

function showSaveError(): void {
  toast({ message: "Couldn't save the wallet settings. Check the opening balance, then try again.", tone: 'critical' })
}

export function WalletSettingsSheet({ onClose, setDirty }: SheetProps<'walletSettings'>) {
  const data = useData((d) => d)
  const wallet = useWallet()
  const today = useToday()
  // No opening balance shows the empty field with its "0,00 €" placeholder.
  const [initial] = useState<SettingsForm>(() => ({
    opening: data.wallet.opening === 0 ? null : data.wallet.opening,
    start: wallet.start,
  }))
  const [form, setForm] = useState(initial)

  const { monthStartDay: startDay, locale, createdAt } = data.settings
  const earliest = useMemo(() => firstPeriod(data, today), [data, today])
  // From the earliest month with data (or the chosen start, if earlier) to the current period (or
  // the chosen start, if later).
  const options = useMemo(() => {
    const current = periodOf(today, startDay)
    return startOptions(minMonth(earliest, form.start), maxMonth(current, form.start), startDay, locale)
  }, [earliest, form.start, today, startDay, locale])

  const update = (next: SettingsForm) => {
    setForm(next)
    setDirty(isDirty(next, initial))
  }

  const save = () => {
    const opening = form.opening ?? 0
    const openingChanged = opening !== data.wallet.opening
    const startChanged = form.start !== initial.start
    if (openingChanged || startChanged) {
      // The period the app was set up in is the default: stored as null, it follows start-day changes.
      const setup = periodOf(localDateOf(createdAt), startDay)
      withUndo('Saved', () => {
        if (openingChanged) actions.setWalletOpening(opening)
        if (startChanged) actions.setWalletStart(form.start === setup ? null : form.start)
      }).catch(showSaveError)
    }
    onClose()
  }

  return (
    <>
      <SheetHeader
        title="Wallet settings"
        onCancel={onClose}
        action={{ label: 'Save', onClick: save, 'data-testid': 'sheet-save' }}
      />
      <Section context="sheet" className={styles.first} footer="Money you had saved when you started.">
        <AmountField
          label="Opening balance"
          value={form.opening}
          onChange={(opening) => update({ ...form, opening })}
          data-testid="wallet-opening"
        />
      </Section>
      <Section context="sheet" className={styles.next} footer="Months before this don't change your wallet.">
        <SelectField
          label="Counts from"
          value={form.start}
          options={options}
          onChange={(start) => update({ ...form, start })}
          data-testid="wallet-start"
        />
      </Section>
    </>
  )
}
