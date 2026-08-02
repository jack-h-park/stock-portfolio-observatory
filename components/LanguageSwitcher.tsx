'use client'

import { useRouter } from 'next/navigation'
import { LANGUAGE_COOKIE, LANGUAGE_LABELS, type Language } from '@/lib/i18n'

export function LanguageSwitcher({ language }: { language: Language }) {
  const router = useRouter()

  const setLanguage = (nextLanguage: Language) => {
    document.cookie = `${LANGUAGE_COOKIE}=${nextLanguage}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.lang = nextLanguage
    router.refresh()
  }

  return (
    <div className="rounded-md border border-line-subtle bg-surface p-1" role="group" aria-label="Language">
      {(['en', 'ko'] as Language[]).map((option) => {
        const active = option === language
        return (
          <button
            key={option}
            type="button"
            onClick={() => setLanguage(option)}
            aria-pressed={active}
            className={`min-h-9 rounded-sm px-2.5 text-[11px] font-medium transition-colors ${
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
