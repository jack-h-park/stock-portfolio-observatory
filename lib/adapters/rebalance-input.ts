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
  const wrapper = columnsOf(conn, table).has('account_wrapper') ? " and coalesce(account_wrapper, 'taxable') = 'taxable'" : ''
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
    const rows = conn
      .prepare(
        `select institution as brokerage, account, currency, balance, as_of_date as asOf
           from brokerage_cash c
          where account_wrapper = 'taxable'
            and id = (select id from brokerage_cash l
                       where l.institution = c.institution and l.account = c.account and l.pool = c.pool
                         and l.currency = c.currency and l.account_wrapper = 'taxable'
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

function readAccountDataAsOf(conn: Database.Database): Record<string, string | null> {
  const table = allAssetsTable(conn, 'transactions')
  const rows = conn
    .prepare(
      `select brokerage, account, max(date) as latest from ${table}
        where 1 = 1${scope(conn, table)} group by brokerage, account`
    )
    .all() as { brokerage: string | null; account: string; latest: string | null }[]
  return Object.fromEntries(rows.map((row) => [accountKey(row.brokerage, row.account), row.latest]))
}

function readRealizedLots(conn: Database.Database): RealizedLotRow[] {
  const table = allAssetsTable(conn, 'realized_lots')
  const columns = columnsOf(conn, table)
  const superseded = columns.has('superseded_by') ? 'superseded_by' : 'null as superseded_by'
  const wrapper = columns.has('account_wrapper') ? 'account_wrapper' : "'taxable' as account_wrapper"
  return conn
    .prepare(
      `select market, sold_date, tax_term, realized_gl_krw, native_realized_gl, currency,
              ${wrapper}, ${superseded}
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
