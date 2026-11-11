/**
 * Account labels as pages show them. Some stored account names carry the full account identifier (a brokerage
 * label followed by something like `AB-12345678`); pages show only its last four characters. This is display
 * only: form values, keys, stored data, owner exports and identity comparisons keep the raw value, because two
 * accounts are the same only when their full values are equal.
 */

/** A run of letters and digits, optionally joined by single interior dashes. */
const TOKEN = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/
const YEAR = /^(19|20)\d{2}$/

/** Whether one token is shaped like an account identifier rather than a word, a short suffix, a year or a date. */
export function looksLikeAccountId(token: string): boolean {
  if (ISO_DATE.test(token)) return false
  const digitRuns = token.match(/\d+/g) ?? []
  // A label such as `Pension2025` or `2024-2025`: its only digits are years.
  if (digitRuns.length > 0 && digitRuns.every((run) => YEAR.test(run))) return false
  const digits = digitRuns.join('').length
  const alnum = token.replace(/-/g, '').length
  return digits >= 6 || (alnum >= 8 && digits >= 3)
}

/** `…` and the token's last four letters or digits. */
const maskToken = (token: string) => `…${token.replace(/-/g, '').slice(-4)}`

/**
 * The label with every account-identifier-shaped token cut to `…` and its last four characters. Plain names,
 * short suffixes (`... 1234`, `...1234`, `Robinhood 1234`), years, dates and non-ASCII text are left as they are.
 * Idempotent: a masked label comes back unchanged.
 */
export function maskAccountLabel(label: string | null | undefined): string {
  if (!label) return ''
  return label.replace(TOKEN, (token) => (looksLikeAccountId(token) ? maskToken(token) : token))
}

/** `brokerage · account` (or the account alone), masked for display. */
export function displayAccount(brokerage: string | null | undefined, account: string | null | undefined): string {
  if (!account) return ''
  return brokerage ? `${maskAccountLabel(brokerage)} · ${maskAccountLabel(account)}` : maskAccountLabel(account)
}

/** An accountKey (`brokerage::account`) as a display label. A string without the separator is masked as is. */
export function displayAccountKey(key: string): string {
  const at = key.indexOf('::')
  return at === -1 ? maskAccountLabel(key) : displayAccount(key.slice(0, at) || null, key.slice(at + 2))
}

/**
 * Free text (an engine warning, say) with each of the given raw account values replaced by its masked form.
 * Only those exact values are touched, so tickers and figures elsewhere in the text are left alone.
 */
export function maskAccountsIn(text: string, accounts: Iterable<string | null | undefined>): string {
  let out = text
  const list = [...new Set([...accounts].filter((a): a is string => typeof a === 'string' && a.length > 0))].sort((a, b) => b.length - a.length)
  for (const raw of list) {
    const masked = maskAccountLabel(raw)
    if (masked !== raw) out = out.split(raw).join(masked)
  }
  return out
}
