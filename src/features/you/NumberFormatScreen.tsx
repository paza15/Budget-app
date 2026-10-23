import { useNav } from '@/app/nav'
import { NUMBER_LOCALES, type NumberLocaleOption } from '@/domain/catalog'
import { formatMoney } from '@/domain/money'
import { ChoiceList } from '@/features/you/settings/ChoiceList'
import { actions } from '@/store/actions'
import { useData } from '@/store/hooks'
import { Screen, Section } from '@/ui'

/** The live sample of each format: 1.234,56 € in de-DE, €1,234.56 in en-IE. */
const SAMPLE = 123456

function back(): void {
  useNav.getState().pop()
}

/** The listed formats, with one chosen elsewhere (the device's own, or a backup's) kept at the top. */
function localesWith(locale: string): NumberLocaleOption[] {
  if (NUMBER_LOCALES.some((option) => option.locale === locale)) return NUMBER_LOCALES
  return [{ locale, label: locale }, ...NUMBER_LOCALES]
}

/**
 * You › Number format (docs/SPEC.md §3.7, §4.1): NUMBER_LOCALES by country, each with a live sample
 * in the chosen currency (samples are never masked), the chosen one checked.
 */
export function NumberFormatScreen() {
  const currency = useData((d) => d.settings.currency)
  const locale = useData((d) => d.settings.locale)

  return (
    <Screen title="Number format" largeTitle onBack={back} backLabel="You">
      <Section footer="Sets the decimal mark, the thousands separator and where the currency symbol goes.">
        <ChoiceList
          label="Number format"
          value={locale}
          onChange={(next) => actions.updateSettings({ locale: next })}
          options={localesWith(locale).map((option) => ({
            value: option.locale,
            title: option.label,
            detail: formatMoney(SAMPLE, { currency, locale: option.locale }),
          }))}
        />
      </Section>
    </Screen>
  )
}
