// account-map.mjs — which wrapper and owner each account belongs to.
//
// Account numbers and institution aliases are private, and this repository is
// public, so the mapping lives in a gitignored file (STOCK_ACCOUNT_MAP_PATH,
// default data/accounts.local.json). Its absence is normal: CI, sample mode and a
// fresh checkout have none, and every account then falls back to the label rule.
import fs from 'node:fs'

/**
 * The wrappers the default (Stocks) view shows. Everything else needs the All-assets view.
 * Keep in step with STOCK_WRAPPER_SQL in lib/adapters/portfolio-db.ts.
 */
export const STOCK_WRAPPERS = Object.freeze(['taxable', 'isa'])

export function loadAccountMap(file) {
  if (!file || !fs.existsSync(file)) return { accounts: {}, bankAccounts: [], anchors: [], pensionAccounts: [] }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    // Fail closed: an empty map would silently re-tag every account as taxable.
    throw new Error(`account map ${file} is not valid JSON: ${e.message}`)
  }
  return {
    accounts: raw.accounts ?? {},
    bankAccounts: raw.bankAccounts ?? [],
    anchors: raw.anchors ?? [],
    pensionAccounts: raw.pensionAccounts ?? [],
  }
}

export function wrapperFor(row, map) {
  const override = map.accounts?.[row.account]?.wrapper
  if (override) return override
  // A pension account the map lists by name carries its wrapper there, so a
  // label that names neither IRP nor 연금저축 still never reads as taxable.
  const pension = (map.pensionAccounts ?? []).find((entry) => entry?.account && entry.account === row.account)
  if (pension?.wrapper) return pension.wrapper
  const label = String(row.account ?? '')
  // A pension account the map does not know must still never read as taxable:
  // the label is the fallback, and both issuers put the account type in it.
  if (/IRP|퇴직연금/i.test(label)) return 'irp'
  if (/연금저축/.test(label)) return 'pension_savings'
  return /ISA/i.test(label) ? 'isa' : 'taxable'
}

/** 'security' unless the map says otherwise or the label names 금현물 (the 미래에셋 gold account). */
export function assetClassFor(row, map) {
  return map.accounts?.[row.account]?.assetClass ?? (/금현물/.test(String(row.account ?? '')) ? 'gold' : 'security')
}

export function ownerFor(row, map) {
  return map.accounts?.[row.account]?.owner ?? 'self'
}

export function tagRows(rows, map) {
  return rows.map((row) => ({
    ...row,
    account_wrapper: row.account_wrapper ?? wrapperFor(row, map),
    owner: row.owner ?? ownerFor(row, map),
    asset_class: row.asset_class ?? assetClassFor(row, map),
  }))
}
