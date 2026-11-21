/**
 * The label a copy table gives a code, or the code itself when the table has
 * none, so an unknown value still shows instead of a blank.
 *
 * For codes that are free text (a broker's type, a manual mapping's category):
 * the own-key check keeps a value that names an Object.prototype member
 * (`constructor`, `toString`) from rendering a function.
 */
export function labelFor<T extends string | null | undefined>(labels: Readonly<Record<string, string>>, code: T): string | T {
  if (code == null) return code
  return Object.hasOwn(labels, code) ? labels[code] : code
}
