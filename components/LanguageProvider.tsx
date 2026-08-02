'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { Language } from '@/lib/i18n'

const LanguageContext = createContext<Language>('en')

export function LanguageProvider({ children, language }: { children: ReactNode; language: Language }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>
}

export function usePageLanguage() {
  return useContext(LanguageContext)
}
