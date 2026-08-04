'use client'

import { useRouter } from 'next/navigation'
import {
  DISPLAY_CURRENCIES,
  DISPLAY_CURRENCY_COOKIE,
  DISPLAY_CURRENCY_LABELS,
  type DisplayCurrency,
} from '@/lib/currency'
import { LANGUAGE_COOKIE, LANGUAGE_LABELS, type Language } from '@/lib/i18n'

const SEGMENT_CLASS =
  'grid rounded-md border border-line-subtle bg-surface p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]'
const SEGMENT_BUTTON_CLASS =
  'min-h-8 rounded-[4px] px-2 text-center text-[12px] font-medium leading-none transition-colors'

export function LanguageSwitcher({ language }: { language: Language }) {
  const router = useRouter()

  const setLanguage = (nextLanguage: Language) => {
    document.cookie = `${LANGUAGE_COOKIE}=${nextLanguage}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.lang = nextLanguage
    router.refresh()
  }

  return (
    <div className={`${SEGMENT_CLASS} grid-cols-2`} role="group" aria-label="Language">
      {(['en', 'ko'] as Language[]).map((option) => {
        const active = option === language
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLanguage(option)}
            aria-pressed={active}
            className={`${SEGMENT_BUTTON_CLASS} ${
              active ? 'bg-card text-ink shadow-card' : 'text-ink-3 hover:bg-card hover:text-ink'
            }`}
          >
            {LANGUAGE_LABELS[option]}
          </button>
        )
      })}
    </div>
  )
}

export function CurrencySwitcher({ displayCurrency }: { displayCurrency: DisplayCurrency }) {
  const router = useRouter()

  const setDisplayCurrency = (nextCurrency: DisplayCurrency) => {
    document.cookie = `${DISPLAY_CURRENCY_COOKIE}=${nextCurrency}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }

  return (
    <div className={`${SEGMENT_CLASS} grid-cols-2`} role="group" aria-label="Currency">
      {DISPLAY_CURRENCIES.map((option) => {
        const active = option === displayCurrency
        return (
          <button
            key={option}
            type="button"
            onClick={() => setDisplayCurrency(option)}
            aria-pressed={active}
            className={`${SEGMENT_BUTTON_CLASS} ${
              active ? 'bg-card text-ink shadow-card' : 'text-ink-3 hover:bg-card hover:text-ink'
            }`}
          >
            {DISPLAY_CURRENCY_LABELS[option]}
          </button>
        )
      })}
    </div>
  )
}
