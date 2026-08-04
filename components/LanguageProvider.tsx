'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { createMoneyFormatter, type CurrencyPreferences } from '@/lib/currency'
import type { Language } from '@/lib/i18n'

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
