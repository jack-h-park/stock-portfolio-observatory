import type { Language } from '@/lib/i18n'
import { UI_COPY_BY_LANG } from '@/lib/ui-copy/common'
import { PAGE_COPY } from '@/lib/ui-copy/pages'

export { UI_COPY_BY_LANG } from '@/lib/ui-copy/common'

/** The vocabulary shared by every screen: All, Search, Sort, freshness, priority. */
export function getUiCopy(language: Language = 'en') {
  return UI_COPY_BY_LANG[language]
}

/**
 * One page's wording.
 *
 * Copy used to live wherever the page that needed it happened to be: nine
 * `const COPY = { en, ko }` blocks inside page files, two per-page copy.ts
 * modules totalling 1,074 lines, a partly-used shared module, and seven pages
 * with no Korean at all. The registry is one place to look, and — because
 * `defineCopy` pins both languages to the same shape — one place where a
 * missing translation is a type error rather than a sentence that silently
 * stays English.
 */
export function getPageCopy<K extends keyof typeof PAGE_COPY>(
  page: K,
  language: Language = 'en'
): (typeof PAGE_COPY)[K]['en'] {
  // `en` and `ko` are pinned to the same shape by defineCopy, so naming one of
  // them as the return type narrows to that page instead of the union of all.
  return PAGE_COPY[page][language]
}
