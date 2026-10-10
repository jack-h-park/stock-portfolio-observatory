// account-map.mjs — which wrapper and owner each account belongs to.
//
// Account numbers and institution aliases are private, and this repository is
// public, so the mapping lives in a gitignored file (STOCK_ACCOUNT_MAP_PATH,
// default data/accounts.local.json). Its absence is normal: CI, sample mode and a
// fresh checkout have none, and every account then falls back to the label rule.
import fs from 'node:fs'

/** The wrappers the default (Stocks) view shows. Everything else needs the All-assets view. */
export const STOCK_WRAPPERS = Object.freeze(['taxable', 'isa'])

export function loadAccountMap(file) {
  if (!file || !fs.existsSync(file)) return { accounts: {}, bankAccounts: [], anchors: [] }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    accounts: raw.accounts ?? {},
    bankAccounts: raw.bankAccounts ?? [],
    anchors: raw.anchors ?? [],
  }
}

export function wrapperFor(row, map) {
  const override = map.accounts?.[row.account]?.wrapper
  if (override) return override
  // 미래에셋 labels its ISA account "미래에셋증권(ISA)"; that is the only ISA today.
  return /ISA/i.test(String(row.account ?? '')) ? 'isa' : 'taxable'
}

export function ownerFor(row, map) {
  return map.accounts?.[row.account]?.owner ?? 'self'
}

export function tagRows(rows, map) {
  return rows.map((row) => ({
    ...row,
    account_wrapper: row.account_wrapper ?? wrapperFor(row, map),
    owner: row.owner ?? ownerFor(row, map),
  }))
}
