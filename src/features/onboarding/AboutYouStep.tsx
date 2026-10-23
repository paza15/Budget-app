import { useState } from 'react'
import { CURRENCIES, NUMBER_LOCALES } from '@/domain/catalog'
import { MAX_LENGTHS, MAX_MONTH_START_DAY } from '@/domain/constants'
import { formatDate, ordinalDay } from '@/domain/dates'
import { formatMoney } from '@/domain/money'
import { periodOf, periodRange } from '@/domain/period'
import type { ISODate } from '@/domain/types'
import { StepFrame } from '@/features/onboarding/StepFrame'
import type { StepNav } from '@/features/onboarding/types'
import { actions } from '@/store/actions'
import { getData } from '@/store/appStore'
import { useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import { Section, SelectField, TextField, type SelectOption } from '@/ui'

interface AboutYouForm {
  name: string
  currency: string
  locale: string
  startDay: number
}

/** The sample each number format shows, in the chosen currency ("1.234,56 €"). */
const SAMPLE = 123456

const DAY_OPTIONS: SelectOption<number>[] = Array.from({ length: MAX_MONTH_START_DAY }, (_, i) => ({
  value: i + 1,
  label: ordinalDay(i + 1),
}))

function currencyOptions(current: string): SelectOption<string>[] {
  const options = CURRENCIES.map(({ code, name }) => ({ value: code, label: `${name} (${code})` }))
  // A restored backup may use a currency the list does not offer; it stays choosable.
  return options.some((option) => option.value === current) ? options : [{ value: current, label: current }, ...options]
}

function numberFormatOptions(currency: string, current: string): SelectOption<string>[] {
  const option = (locale: string, label: string) => ({
    value: locale,
    label: `${formatMoney(SAMPLE, { currency, locale })} (${label})`,
  })
  const options = NUMBER_LOCALES.map(({ locale, label }) => option(locale, label))
  return options.some((o) => o.value === current) ? options : [option(current, current), ...options]
}

/** "This month will run from 25 Sep to 24 Oct." for the start day being chosen. */
function periodLine(today: ISODate, startDay: number, locale: string): string {
  const { start, end } = periodRange(periodOf(today, startDay), startDay)
  return `This month will run from ${formatDate(start, locale, 'short')} to ${formatDate(end, locale, 'short')}.`
}

/**
 * Step 2, About you (docs/SPEC.md §3.9): the name for the greeting (optional), the currency (the
 * device's by default, set at first launch), the number format and the day the month starts.
 * Continue and Back save; settings.onboarded stays false until Done.
 */
export function AboutYouStep({ progress, direction, onNext, onBack }: StepNav) {
  const settings = useSettings()
  const today = useToday()
  const [form, setForm] = useState<AboutYouForm>(() => ({
    name: settings.name,
    currency: settings.currency,
    locale: settings.locale,
    startDay: settings.monthStartDay,
  }))
  const change = (patch: Partial<AboutYouForm>) => setForm((current) => ({ ...current, ...patch }))

  const save = () => {
    actions.updateSettings({ name: form.name, currency: form.currency, locale: form.locale })
    if (form.startDay !== getData().settings.monthStartDay) actions.setMonthStartDay(form.startDay)
  }

  return (
    <StepFrame
      title="About you"
      compactTitle="About you"
      lead="You can change all of this later in Settings."
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
    >
      <Section variant="form" footer="For the greeting on Home.">
        <TextField
          variant="form"
          label="Name"
          value={form.name}
          onChange={(name) => change({ name })}
          placeholder="Optional"
          maxLength={MAX_LENGTHS.name}
          autoComplete="given-name"
          enterKeyHint="done"
        />
      </Section>
      <Section
        variant="form"
        title="Money"
        footer={`Pick your payday to make each month run from one payday to the next. ${periodLine(today, form.startDay, form.locale)}`}
      >
        <SelectField
          label="Currency"
          value={form.currency}
          options={currencyOptions(form.currency)}
          onChange={(currency) => change({ currency })}
        />
        <SelectField
          label="Number format"
          value={form.locale}
          options={numberFormatOptions(form.currency, form.locale)}
          onChange={(locale) => change({ locale })}
        />
        <SelectField
          label="Month starts on"
          value={form.startDay}
          options={DAY_OPTIONS}
          onChange={(startDay) => change({ startDay })}
        />
      </Section>
    </StepFrame>
  )
}
