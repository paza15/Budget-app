import { createContext, useContext } from 'react'
import { createMoneyFormat, type MoneyFormat } from '@/domain/money'

/**
 * Money settings for the UI kit (docs/SPEC.md §5.8). The UI kit never reads the store: App
 * provides the user's MoneyFormat (store/hooks useMoneyFormat), and components read it here.
 */

/** Used outside a provider (isolated component tests): euros, German number format, unmasked. */
const DEFAULT_MONEY_FORMAT: MoneyFormat = createMoneyFormat({
  currency: 'EUR',
  locale: 'de-DE',
  showCents: true,
  masked: false,
})

export const MoneyFormatContext = createContext<MoneyFormat>(DEFAULT_MONEY_FORMAT)

/** The MoneyFormat of the nearest provider. */
export function useMoneyFormatContext(): MoneyFormat {
  return useContext(MoneyFormatContext)
}
