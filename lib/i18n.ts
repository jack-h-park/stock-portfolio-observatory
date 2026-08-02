export const LANGUAGES = ['en', 'ko'] as const
export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'en'
export const LANGUAGE_COOKIE = 'stock-observatory-language'

export function normalizeLanguage(value: unknown): Language {
  return value === 'ko' ? 'ko' : DEFAULT_LANGUAGE
}

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ko: '한국어',
}
