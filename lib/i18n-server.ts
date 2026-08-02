import { cookies } from 'next/headers'
import { LANGUAGE_COOKIE, normalizeLanguage, type Language } from '@/lib/i18n'

export async function getLanguage(): Promise<Language> {
  const cookieStore = await cookies()
  return normalizeLanguage(cookieStore.get(LANGUAGE_COOKIE)?.value)
}
