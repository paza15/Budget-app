import { useMemo, useState } from 'react'
import { useNav } from '@/app/nav'
import { CURRENCIES, type CurrencyOption } from '@/domain/catalog'
import { currencyDigits, formatMoney } from '@/domain/money'
import { ChoiceList } from '@/features/you/settings/ChoiceList'
import { ScreenSearch } from '@/features/you/settings/ScreenSearch'
import { searchKey } from '@/features/you/settings/text'
import { actions } from '@/store/actions'
import { useData } from '@/store/hooks'
import { EmptyState, Screen, Section } from '@/ui'

/** The sample each currency shows: 1.234,56 € in de-DE (1.235 ¥ with no minor unit). */
const SAMPLE = 123456

function back(): void {
  useNav.getState().pop()
}

/** The listed currencies, with one chosen elsewhere (a restored backup) kept at the top. */
function currenciesWith(code: string): CurrencyOption[] {
  if (CURRENCIES.some((currency) => currency.code === code)) return CURRENCIES
  return [{ code, name: code, digits: currencyDigits(code) }, ...CURRENCIES]
}

/**
 * You › Currency (docs/SPEC.md §3.7, §4.1): a searchable list of CURRENCIES (by name or code),
 * each with a sample amount in the user's number format, and the chosen one checked. Changing it
 * changes the symbol and digits only; amounts are never converted.
 */
export function CurrencyScreen() {
  const currency = useData((d) => d.settings.currency)
  const locale = useData((d) => d.settings.locale)
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const key = searchKey(query)
    return currenciesWith(currency).filter(
      ({ code, name }) => key === '' || searchKey(name).includes(key) || searchKey(code).includes(key),
    )
  }, [currency, query])

  return (
    <Screen title="Currency" largeTitle onBack={back} backLabel="You">
      <ScreenSearch label="Search currencies" value={query} onChange={setQuery} />
      {matches.length > 0 ? (
        <Section footer="Changing the currency changes the symbol only. Amounts are not converted.">
          <ChoiceList
            label="Currency"
            value={currency}
            onChange={(code) => actions.updateSettings({ currency: code })}
            options={matches.map(({ code, name }) => ({
              value: code,
              title: name,
              detail: formatMoney(SAMPLE, { currency: code, locale }),
            }))}
          />
        </Section>
      ) : (
        <EmptyState
          icon="search"
          title="No currency found"
          message={`Nothing matches “${query.trim()}”. Try a name or a code, like Swiss franc or CHF.`}
        />
      )}
    </Screen>
  )
}
