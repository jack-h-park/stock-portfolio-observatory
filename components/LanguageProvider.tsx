'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { createMoneyFormatter, type CurrencyPreferences } from '@/lib/currency'
import type { Language } from '@/lib/i18n'
import { getUiCopy } from '@/lib/ui-copy'

const LanguageContext = createContext<Language>('en')
const CurrencyContext = createContext<CurrencyPreferences>({ displayCurrency: 'KRW', usdKrwRate: null })

export function LanguageProvider({
  children,
  language,
  currencyPreferences = { displayCurrency: 'KRW', usdKrwRate: null },
}: {
  children: ReactNode
  language: Language
  currencyPreferences?: CurrencyPreferences
}) {
  return (
    <LanguageContext.Provider value={language}>
      <CurrencyContext.Provider value={currencyPreferences}>{children}</CurrencyContext.Provider>
    </LanguageContext.Provider>
  )
}

export function usePageLanguage() {
  return useContext(LanguageContext)
}

export function useCurrencyPreferences() {
  return useContext(CurrencyContext)
}

export function useMoneyFormatter() {
  return createMoneyFormatter(useCurrencyPreferences())
}

/**
 * A shared-copy string rendered from the language context.
 *
 * Server components can read the language cookie directly, but a shared
 * component like DataTable is instantiated from 35 call sites and cannot ask
 * every one of them to thread the language through. Reading it from context
 * here keeps those call sites unchanged and still answers in Korean — which
 * the previous English-pinned constant could not do.
 */
export function CommonLabel({ label }: { label: keyof ReturnType<typeof getUiCopy>['common'] }) {
  const value = getUiCopy(usePageLanguage()).common[label]
  return <>{typeof value === 'string' ? value : ''}</>
}
