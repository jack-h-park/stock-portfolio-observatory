/**
 * Pins both languages of a page's copy to the same shape.
 *
 * The type is inferred from `en`, so `ko` cannot omit a key, add one, or change
 * a formatter's arity — a missing translation is a compile error rather than a
 * sentence that silently stays English. Seven pages had drifted to English-only
 * before this existed.
 */
export function defineCopy<T>(copy: { en: T; ko: T }) {
  return copy
}
