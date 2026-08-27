'use client'

import { useRouter } from 'next/navigation'
import { SegmentedControl } from '@/components/ui'
import {
  DISPLAY_CURRENCIES,
  DISPLAY_CURRENCY_COOKIE,
  DISPLAY_CURRENCY_LABELS,
  type DisplayCurrency,
} from '@/lib/currency'
import { LANGUAGE_COOKIE, LANGUAGE_LABELS, type Language } from '@/lib/i18n'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function persist(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
}

export function LanguageSwitcher({ language }: { language: Language }) {
  const router = useRouter()

  return (
    <SegmentedControl
      label="Language"
      value={language}
      options={(['en', 'ko'] as Language[]).map((option) => ({ value: option, label: LANGUAGE_LABELS[option] }))}
      onChange={(next) => {
        persist(LANGUAGE_COOKIE, next)
        // AutoRefresh and HelpPopover read the language off the document, so it
        // has to change here as well as in the cookie the server reads.
        document.documentElement.lang = next
        router.refresh()
      }}
    />
  )
}

export function CurrencySwitcher({ displayCurrency }: { displayCurrency: DisplayCurrency }) {
  const router = useRouter()

  return (
    <SegmentedControl
      label="Currency"
      value={displayCurrency}
      options={DISPLAY_CURRENCIES.map((option) => ({ value: option, label: DISPLAY_CURRENCY_LABELS[option] }))}
      onChange={(next) => {
        persist(DISPLAY_CURRENCY_COOKIE, next)
        router.refresh()
      }}
    />
  )
}
