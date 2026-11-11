import Database from 'better-sqlite3'
import { config } from '@/config'
import { summarizeFinanceAssets, type AssetObservation } from '@/lib/domain/assets/overview'

type Raw = Record<string, unknown>
// These core sweep identifiers are already explicitly recognized by ingestion.
const SWEEPS = new Set(['SPAXX', 'QACDS', 'FDRXX', 'SPRXX', 'FZFXX', 'FGXXX'])
export function getFinanceOverview(filePath = config.stockDbPath) {
  const db = new Database(filePath, { readonly: true })
  try {
    const has = (name: string) =>
      Boolean(db.prepare("select 1 from sqlite_master where name=? and type in ('table','view')").get(name))
    const rows = (name: string) => (has(name) ? (db.prepare(`select * from ${name}`).all() as Raw[]) : [])
    const owners = new Map(rows('account_owners').map((row) => [String(row.account), String(row.owner)]))
    const owner = (row: Raw) => String(row.owner ?? owners.get(String(row.account)) ?? 'self')
    const rates = rows('fx_rates')
      .filter((row) => row.from_currency === 'USD' && row.to_currency === 'KRW' && Number(row.rate) > 0)
      .sort((a, b) => String(b.as_of_date).localeCompare(String(a.as_of_date)))
    const rate = rates[0] ? Number(rates[0].rate) : null
    const convert = (value: number, currency: string) =>
      !Number.isFinite(value)
        ? null
        : currency === 'KRW'
          ? value
          : currency === 'USD' && rate != null
            ? value * rate
            : null
    const observations: AssetObservation[] = []
    const cashProducts: AssetObservation[] = []
    const holdings = rows(has('holdings_all') ? 'holdings_all' : 'holdings')
    for (const row of holdings) {
      const institution = String(row.brokerage ?? ''),
        account = String(row.account),
        wrapper = String(row.account_wrapper ?? 'taxable')
      const pension = ['irp', 'pension_savings'].includes(wrapper),
        sweep = row.market === 'US' && SWEEPS.has(String(row.ticker).replace(/\*/g, '').toUpperCase())
      const cashProduct = sweep || (pension && /^PENSION:[^:]+:cash:/.test(String(row.ticker)))
      const assetClass = pension
        ? 'pensions'
        : row.asset_class === 'gold'
          ? 'gold'
          : sweep
            ? 'cash'
            : row.market === 'CRYPTO'
              ? 'crypto'
              : 'stocks'
      // Pension snapshot funds/cash can have no share quantity while still
      // carrying an issuer-reported balance. Quantity is not their value.
      if (Number(row.quantity) === 0 && !pension && assetClass !== 'gold') continue
      const value =
        row.base_market_value != null
          ? Number(row.base_market_value)
          : (pension || assetClass === 'gold') && row.base_cost != null
            ? Number(row.base_cost)
            : null
      const currency = String(row.currency ?? (row.market === 'US' ? 'USD' : 'KRW'))
      const observation: AssetObservation = {
        owner: owner(row),
        accountId: JSON.stringify([institution, account]),
        assetKey: JSON.stringify([row.market, row.ticker]),
        assetClass,
        asOf: row.as_of_date ? String(row.as_of_date) : null,
        valueKrw: Number(row.quantity) < 0 ? null : value,
        method:
          value == null
            ? 'unpriced'
            : row.base_market_value == null || row.valuation_source === 'cost'
              ? 'cost'
              : row.valuation_source === 'snapshot'
                ? 'snapshot'
                : 'market',
        institution,
        account,
        currency,
        nativeAmount:
          row.native_market_value == null
            ? currency === 'KRW' && value != null
              ? value
              : undefined
            : Number(row.native_market_value),
        wrapper,
        market: String(row.market ?? ''),
        ticker: String(row.ticker ?? ''),
        name: String(row.name ?? row.ticker ?? ''),
        asset_class: cashProduct ? 'cash' : String(row.asset_class ?? 'security'),
      }
      ;(cashProduct ? cashProducts : observations).push(observation)
    }
    // Cash product rows are components, whereas brokerage/bank balances are
    // account/currency aggregates. Sum distinct products before reconciliation.
    const productAccounts = new Map<string, AssetObservation[]>()
    for (const row of cashProducts) {
      const key = JSON.stringify([row.owner, row.accountId, row.currency])
      productAccounts.set(key, [...(productAccounts.get(key) ?? []), row])
    }
    for (const products of productAccounts.values()) {
      const byProduct = new Map<string, AssetObservation>()
      for (const row of products.sort((a, b) => (a.asOf ?? '').localeCompare(b.asOf ?? ''))) {
        const old = byProduct.get(row.assetKey)
        byProduct.set(
          row.assetKey,
          old && old.asOf === row.asOf && old.valueKrw !== row.valueKrw ? { ...row, valueKrw: null } : row,
        )
      }
      const components = [...byProduct.values()],
        first = components[0]
      observations.push({
        ...first,
        assetKey: `cash:${first.currency}`,
        ticker: `CASH:${first.currency}`,
        market: '',
        asset_class: 'cash',
        asOf: components.some((row) => row.asOf == null) ? null : components.map((row) => row.asOf!).sort()[0],
        valueKrw: components.some((row) => row.valueKrw == null)
          ? null
          : components.reduce((n, row) => n + row.valueKrw!, 0),
        nativeAmount: components.some((row) => row.nativeAmount == null)
          ? undefined
          : components.reduce((n, row) => n + row.nativeAmount!, 0),
      })
    }
    const cash = (row: Raw, balance: number, currency: string, assetClass: 'cash' | 'pensions' = 'cash') =>
      observations.push({
        owner: owner(row),
        accountId: JSON.stringify([String(row.institution), String(row.account)]),
        assetKey: `cash:${currency}`,
        assetClass,
        asOf: row.as_of_date ? String(row.as_of_date) : null,
        valueKrw: convert(balance, currency),
        method: convert(balance, currency) == null ? 'unpriced' : 'snapshot',
        institution: String(row.institution),
        account: String(row.account),
        currency,
        nativeAmount: balance,
        cashKind: String(row.kind ?? 'cash'),
        derived: Boolean(row.derived),
        wrapper: String(row.account_wrapper ?? 'taxable'),
        market: '',
        ticker: `CASH:${currency}`,
        name: String(row.account),
        asset_class: 'cash',
      })
    // Reduce each source independently first. Bank snapshots and the broker's
    // sweep representation then share one account/currency inclusion key.
    const latest = (input: Raw[], key: (row: Raw) => string) => {
      const map = new Map<string, Raw>()
      for (const row of input.sort(
        (a, b) => String(a.as_of_date).localeCompare(String(b.as_of_date)) || Number(a.id ?? 0) - Number(b.id ?? 0),
      ))
        map.set(key(row), row)
      return [...map.values()]
    }
    for (const row of latest(rows('cash_balances'), (row) =>
      JSON.stringify([row.institution, row.account, row.currency]),
    ))
      cash(row, Number(row.balance), String(row.currency))
    const pools = latest(rows('brokerage_cash'), (row) =>
      JSON.stringify([row.institution, row.account, row.currency, row.pool]),
    )
    const accounts = new Map<string, Raw[]>()
    for (const row of pools) {
      const key = JSON.stringify([row.institution, row.account, row.currency])
      accounts.set(key, [...(accounts.get(key) ?? []), row])
    }
    for (const group of accounts.values()) {
      const row: Raw = { ...group[0], as_of_date: group.map((item) => String(item.as_of_date)).sort()[0] }
      cash(
        row,
        group.reduce((n, item) => n + Number(item.balance), 0),
        String(row.currency),
        ['irp', 'pension_savings'].includes(String(row.account_wrapper)) ? 'pensions' : 'cash',
      )
    }
    for (const row of latest(rows('fx_account_balances'), (row) => JSON.stringify([row.institution, row.account])))
      cash(row, Number(row.balance_usd), 'USD')
    const summary = summarizeFinanceAssets(observations)
    return {
      ...summary,
      complete: false,
      sourceCoverageConfirmed: false,
      fxAsOf: rates[0]?.as_of_date ? String(rates[0].as_of_date) : null,
    }
  } finally {
    db.close()
  }
}
