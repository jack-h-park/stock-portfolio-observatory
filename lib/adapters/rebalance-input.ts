import Database from 'better-sqlite3'
import { config } from '@/config'
import { accountKey } from '@/lib/rebalance/allocation-policy'
import type { RebalanceCash, RebalancePosition } from '@/lib/rebalance/allocation'
import { deriveYtdRealized, type RealizedLotRow, type YtdRealized } from '@/lib/rebalance/ytd-realized'
import { allAssetsTable, getTaxPlanningLots, getWashSaleReview, selfOnlyAnd } from '@/lib/adapters/portfolio-db'
import { getTaxPolicyState } from '@/lib/tax-policy'
import type { TaxPlanningLot } from '@/lib/tax-planning'

export type RecentBuy = { market: string; ticker: string; brokerage: string | null; account: string; date: string }
export type RebalanceInput = {
  asOf: string
  usdKrwRate: number
  positions: RebalancePosition[]
  cash: RebalanceCash[]
  lots: TaxPlanningLot[]
  recentBuys: RecentBuy[]
  washSaleBlockedBuys: { ticker: string; blockedThrough: string }[]
  accountDataAsOf: Record<string, string | null>
  ytd: YtdRealized
  healthErrors: string[]
}

const FALLBACK_USD_KRW = 1350
const DAY_MS = 86_400_000

function hasTable(conn: Database.Database, name: string) {
  return Boolean(conn.prepare("select 1 from sqlite_master where type in ('table', 'view') and name = ?").get(name))
}

function columnsOf(conn: Database.Database, table: string) {
  return new Set((conn.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name))
}

/** Taxable wrapper and the maintainer's own rows; the scope boundary of every rebalance read. */
function scope(conn: Database.Database, table: string) {
  const wrapper = columnsOf(conn, table).has('account_wrapper') ? " and account_wrapper = 'taxable'" : ''
  return `${wrapper}${selfOnlyAnd(conn, table)}`
}

function latestUsdKrw(conn: Database.Database): number {
  if (!hasTable(conn, 'fx_rates')) return FALLBACK_USD_KRW
  const row = conn
    .prepare(
      "select rate from fx_rates where from_currency = 'USD' and to_currency = 'KRW' order by as_of_date desc, id desc limit 1"
    )
    .get() as { rate: number } | undefined
  return row && Number(row.rate) > 0 ? Number(row.rate) : FALLBACK_USD_KRW
}

function readPositions(conn: Database.Database): RebalancePosition[] {
  const table = allAssetsTable(conn, 'holdings')
  return conn
    .prepare(
      `select brokerage, account, market, max(currency) as currency, ticker, max(name) as name,
              max(asset_class) as asset_class, sum(quantity) as quantity,
              case when count(base_market_value) = 0 then null else sum(base_market_value) end as valueKrw,
              sum(coalesce(base_cost, total_cost_krw)) as costKrw, max(as_of_date) as dataAsOf
         from ${table}
        where 1 = 1${scope(conn, table)}
        group by brokerage, account, market, ticker
        order by brokerage, account, market, ticker`
    )
    .all() as RebalancePosition[]
}

function readCash(conn: Database.Database, usdKrw: number): RebalanceCash[] {
  const toKrw = (currency: string, balance: number) =>
    currency === 'KRW' ? balance : currency === 'USD' ? balance * usdKrw : null
  const cash: RebalanceCash[] = []
  if (hasTable(conn, 'cash_balances')) {
    const rows = conn
      .prepare(
        `select institution as brokerage, account, currency, balance, as_of_date as asOf
           from cash_balances c
          where 1 = 1${selfOnlyAnd(conn, 'cash_balances')}
            and id = (select id from cash_balances l
                       where l.institution = c.institution and l.account = c.account and l.currency = c.currency
                       order by l.as_of_date desc, l.id desc limit 1)
          order by institution, account, currency`
      )
      .all() as Omit<RebalanceCash, 'krw'>[]
    for (const row of rows) cash.push({ ...row, krw: toKrw(row.currency, row.balance) })
  }
  if (hasTable(conn, 'brokerage_cash')) {
    // brokerage_cash has no owner column: a child's account is any (institution, account) the
    // holdings or transactions list under another owner.
    const childPairs = ['holdings_all', 'transactions_all']
      .filter((table) => hasTable(conn, table) && columnsOf(conn, table).has('owner'))
      .map((table) => `select brokerage, account from ${table} where coalesce(owner, 'self') <> 'self'`)
    const notChild = childPairs.length
      ? ` and not exists (select 1 from (${childPairs.join(' union ')}) k where k.brokerage = c.institution and k.account = c.account)`
      : ''
    const rows = conn
      .prepare(
        `select institution as brokerage, account, currency, balance, as_of_date as asOf
           from brokerage_cash c
          where account_wrapper = 'taxable' and asset_class = 'security'${notChild}
            and id = (select id from brokerage_cash l
                       where l.institution = c.institution and l.account = c.account and l.pool = c.pool
                         and l.currency = c.currency and l.account_wrapper = 'taxable' and l.asset_class = 'security'
                       order by l.as_of_date desc, l.id desc limit 1)
          order by institution, account, pool, currency`
      )
      .all() as Omit<RebalanceCash, 'krw'>[]
    for (const row of rows) cash.push({ ...row, krw: toKrw(row.currency, row.balance) })
  }
  return cash
}

function readRecentBuys(conn: Database.Database, today: string): RecentBuy[] {
  const table = allAssetsTable(conn, 'transactions')
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * DAY_MS).toISOString().slice(0, 10)
  // Every wrapper of the maintainer's own accounts: a buy anywhere re-enters a position.
  return conn
    .prepare(
      `select market, ticker, brokerage, account, date from ${table}
        where type in ('BUY', 'REINVEST') and coalesce(quantity, 0) > 0 and market in ('US', 'KR')
          and ticker is not null and date >= ? and date <= ?${selfOnlyAnd(conn, table)}
        order by date, account, ticker`
    )
    .all(since, today) as RecentBuy[]
}

/**
 * Per account, the later of its latest holdings date (holdings_all, scoped as positions are) and
 * its latest transaction date. An account held with no transactions still has a date; an account
 * with neither has none (counted as stale by the engine).
 */
function readAccountDataAsOf(conn: Database.Database): Record<string, string | null> {
  const latest: Record<string, string | null> = {}
  const merge = (rows: { brokerage: string | null; account: string; latest: string | null }[]) => {
    for (const row of rows) {
      const key = accountKey(row.brokerage, row.account)
      const current = latest[key] ?? null
      latest[key] = row.latest != null && (current == null || row.latest > current) ? row.latest : current
    }
  }
  const holdings = allAssetsTable(conn, 'holdings')
  merge(
    conn
      .prepare(
        `select brokerage, account, max(as_of_date) as latest from ${holdings}
          where 1 = 1${scope(conn, holdings)} group by brokerage, account`
      )
      .all() as { brokerage: string | null; account: string; latest: string | null }[]
  )
  const transactions = allAssetsTable(conn, 'transactions')
  merge(
    conn
      .prepare(
        `select brokerage, account, max(date) as latest from ${transactions}
          where 1 = 1${scope(conn, transactions)} group by brokerage, account`
      )
      .all() as { brokerage: string | null; account: string; latest: string | null }[]
  )
  return Object.fromEntries(Object.keys(latest).sort().map((key) => [key, latest[key]]))
}

function readRealizedLots(conn: Database.Database): RealizedLotRow[] {
  const table = allAssetsTable(conn, 'realized_lots')
  const columns = columnsOf(conn, table)
  const superseded = columns.has('superseded_by') ? 'superseded_by' : 'null as superseded_by'
  const wrapper = columns.has('account_wrapper') ? 'account_wrapper' : "'taxable' as account_wrapper"
  const proceeds = columns.has('proceeds_krw') ? 'proceeds_krw' : 'null as proceeds_krw'
  const costUsd = columns.has('acquisition_cost_usd') ? 'acquisition_cost_usd' : 'null as acquisition_cost_usd'
  return conn
    .prepare(
      `select market, sold_date, tax_term, realized_gl_krw, native_realized_gl, currency,
              ${wrapper}, ${superseded}, ${proceeds}, ${costUsd}
         from ${table} where sold_date is not null${selfOnlyAnd(conn, table)}`
    )
    .all() as RealizedLotRow[]
}

function readHealthErrors(conn: Database.Database): string[] {
  if (!hasTable(conn, 'validation_checks')) return []
  return (
    conn
      .prepare("select name from validation_checks where severity = 'error' and status != 'pass' order by name")
      .all() as { name: string }[]
  ).map((row) => row.name)
}

export function getRebalanceInput(today: string, dbPath: string = config.stockDbPath): RebalanceInput {
  const conn = new Database(dbPath, { readonly: true, fileMustExist: true })
  let snapshot: Omit<RebalanceInput, 'lots' | 'washSaleBlockedBuys'> & { realized: RealizedLotRow[] }
  try {
    const usdKrwRate = latestUsdKrw(conn)
    snapshot = {
      asOf: today,
      usdKrwRate,
      positions: readPositions(conn),
      cash: readCash(conn, usdKrwRate),
      recentBuys: readRecentBuys(conn, today),
      accountDataAsOf: readAccountDataAsOf(conn),
      realized: readRealizedLots(conn),
      ytd: undefined as unknown as YtdRealized,
      healthErrors: readHealthErrors(conn),
    }
  } finally {
    conn.close()
  }
  const { realized, ...rest } = snapshot
  const lots = getTaxPlanningLots(5000, getTaxPolicyState().policy, { dbPath, selfOnly: true }).filter(
    (lot) => lot.account_wrapper === 'taxable'
  )
  const washSaleBlockedBuys = getWashSaleReview(today, dbPath).windows.map((w) => ({
    ticker: w.ticker,
    blockedThrough: w.blockedThrough,
  }))
  return {
    ...rest,
    lots,
    washSaleBlockedBuys,
    ytd: deriveYtdRealized(realized, Number(today.slice(0, 4)), rest.usdKrwRate),
  }
}
