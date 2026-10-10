/**
 * `bankAccounts` entries in the account map, matched to `cash_balances` rows.
 * The bank extractor (scripts/extract-bank-statements.py, `_alias`) names each
 * account it files; this names a map entry the same way, so an entry finds its
 * rows by institution and that name.
 */

export type BankAccountEntry = {
  institution?: unknown
  kind?: unknown
  last4?: unknown
  alias?: unknown
  retired?: unknown
  retiredOn?: unknown
}

/** Names the extractor gives when the map has none and `<institution> <kind>` would not read as the account's name. Keep in step with DEFAULT_ALIASES there. */
const DEFAULT_ALIASES: Record<string, string> = { 'mirae|cma': '미래에셋 CMA' }

/** The `cash_balances.account` the bank extractor files this entry's balances under. */
export function bankAccountName(entry: BankAccountEntry): string {
  const institution = String(entry.institution ?? '')
  const alias = String(entry.alias ?? '').trim()
  if (alias) return alias
  const last4 = String(entry.last4 ?? '').trim()
  if (last4) return `${institution} ${last4}`
  const kind = String(entry.kind ?? '')
  return DEFAULT_ALIASES[`${institution}|${kind}`] ?? `${institution} ${kind}`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Retired accounts, keyed `institution|account` as `cash_balances` names them.
 * The value is the retirement date, or null for `"retired": true` with no date.
 * An entry whose `retiredOn` is not a YYYY-MM-DD date is not treated as retired,
 * so a typo keeps the account visible rather than silently ending its history.
 */
export function retiredBankAccounts(entries: readonly BankAccountEntry[] | null | undefined): Map<string, string | null> {
  const retired = new Map<string, string | null>()
  for (const entry of entries ?? []) {
    if (!entry || !entry.institution) continue
    const retiredOn = typeof entry.retiredOn === 'string' && ISO_DATE.test(entry.retiredOn) ? entry.retiredOn : null
    if (!retiredOn && entry.retired !== true) continue
    retired.set(`${String(entry.institution)}|${bankAccountName(entry)}`, retiredOn)
  }
  return retired
}
