/**
 * `pnpm tax:calendar` — the dated constraints on US sales and buys, from the database.
 *
 *  - Wash-sale windows: getWashSaleReview, the same windows the pages and the
 *    briefing show (lib/wash-sale.ts has the rule). DRIP buys count.
 *  - DRIP: per ticker, the last dividend reinvestment in the past DRIP_ACTIVE_DAYS.
 *    An automatic buy inside a planned loss window is the one nobody sees coming.
 *  - Settlement (good-faith violations): only for accounts the account map marks
 *    `"cashAccount": true`. US equities settle T+1, so a security bought with the
 *    proceeds of a sale that has not settled yet may not be sold before that sale
 *    settles. Without a marked account the block says "unavailable" rather than
 *    guessing which accounts are cash accounts.
 *
 * Covers the brokerages whose US transactions are ingested. Korean stocks (no
 * wash-sale rule), crypto (none applies) and options (not matched) are outside it.
 */
import type Database from 'better-sqlite3'
import { config } from '@/config'
import { getWashSaleReview } from '@/lib/adapters/portfolio-db'
import { addCalendarDays } from '@/lib/wash-sale'
import { cashAccountLabels, loadAccountMap } from '@/scripts/account-map.mjs'
import {
  buildProvenance,
  columnsOf,
  dateFlag,
  hasTable,
  provenanceLines,
  table,
  todayLosAngeles,
  usd,
  type CliContext,
  type Command,
  type ParsedFlags,
} from '@/lib/cli/common'

/** A reinvestment within this many days marks the ticker's DRIP as active. Covers quarterly and semiannual payers. */
export const DRIP_ACTIVE_DAYS = 183

/** How far back a buy is checked for unsettled funding. T+1 plus a long weekend fits well inside. */
const SETTLEMENT_LOOKBACK_DAYS = 10

/** The next business day after `date` (weekends skipped; exchange holidays are not known here). */
export function nextBusinessDay(date: string) {
  let next = addCalendarDays(date, 1)
  for (;;) {
    const day = new Date(`${next}T00:00:00Z`).getUTCDay()
    if (day !== 0 && day !== 6) return next
    next = addCalendarDays(next, 1)
  }
}

/** T+1: the day a US equity sale on `tradeDate` settles. */
export function usSettlementDate(tradeDate: string) {
  return nextBusinessDay(tradeDate)
}

export type SettlementTrade = { account: string; ticker: string; date: string; type: 'BUY' | 'SELL' }

export type SettlementItem = {
  account: string
  ticker: string
  buyDate: string
  fundedBySaleDate: string
  settlesOn: string
  earliestSaleDate: string
}

/**
 * Buys in cash accounts that may have been paid for with unsettled proceeds.
 *
 * Cash balances are not in the data, so which money paid for a buy is unknown.
 * The rule here is the conservative one: a buy on a day when a sale in the same
 * account had not settled yet is listed, with that sale's settlement date as the
 * first day the bought security may be sold. Only buys whose earliest sale date
 * is on or after `asOf` are returned; older ones no longer constrain anything.
 */
export function settlementConstraints(trades: SettlementTrade[], cashAccounts: string[], asOf: string): SettlementItem[] {
  const cash = new Set(cashAccounts)
  const items: SettlementItem[] = []
  for (const buy of trades) {
    if (buy.type !== 'BUY' || !cash.has(buy.account)) continue
    // The latest-settling sale that was still unsettled on the buy date.
    const funding = trades
      .filter((sale) => sale.type === 'SELL' && sale.account === buy.account && sale.date <= buy.date)
      .map((sale) => ({ sale, settles: usSettlementDate(sale.date) }))
      .filter(({ settles }) => settles > buy.date)
      .sort((a, b) => b.settles.localeCompare(a.settles) || b.sale.date.localeCompare(a.sale.date))[0]
    if (!funding || funding.settles < asOf) continue
    items.push({
      account: buy.account,
      ticker: buy.ticker,
      buyDate: buy.date,
      fundedBySaleDate: funding.sale.date,
      settlesOn: funding.settles,
      earliestSaleDate: funding.settles,
    })
  }
  return items.sort((a, b) => a.earliestSaleDate.localeCompare(b.earliestSaleDate) || a.account.localeCompare(b.account) || a.ticker.localeCompare(b.ticker))
}

function transactionsTable(conn: Database.Database) {
  return hasTable(conn, 'transactions_all') ? 'transactions_all' : 'transactions'
}

/** `and <self only> and <securities only>` for the columns this database has. */
function rowScope(conn: Database.Database, table: string) {
  const columns = columnsOf(conn, table)
  return [columns.has('owner') ? " and coalesce(owner, 'self') = 'self'" : '', columns.has('asset_class') ? " and asset_class = 'security'" : ''].join('')
}

type DripRow = { ticker: string; lastReinvestDate: string; accounts: string[] }

function dripRows(conn: Database.Database, asOf: string): DripRow[] {
  if (!hasTable(conn, 'transactions')) return []
  const tx = transactionsTable(conn)
  const drip = columnsOf(conn, tx).has('placed_agent') ? "(type = 'REINVEST' or placed_agent = 'drip')" : "type = 'REINVEST'"
  const since = addCalendarDays(asOf, -DRIP_ACTIVE_DAYS)
  const rows = conn
    .prepare(
      `select ticker, account, max(date) as last
         from ${tx}
        where market = 'US' and ticker is not null and ${drip} and date >= ? and date <= ?${rowScope(conn, tx)}
        group by ticker, account`
    )
    .all(since, asOf) as { ticker: string; account: string; last: string }[]
  const byTicker = new Map<string, DripRow>()
  for (const row of rows) {
    const entry = byTicker.get(row.ticker)
    if (entry) {
      entry.accounts.push(row.account)
      if (row.last > entry.lastReinvestDate) entry.lastReinvestDate = row.last
    } else byTicker.set(row.ticker, { ticker: row.ticker, lastReinvestDate: row.last, accounts: [row.account] })
  }
  return [...byTicker.values()]
    .map((row) => ({ ...row, lastReinvestDate: row.lastReinvestDate.slice(0, 10), accounts: [...new Set(row.accounts)].sort() }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
}

function settlementTrades(conn: Database.Database, asOf: string, accounts: string[]): SettlementTrade[] {
  if (!accounts.length || !hasTable(conn, 'transactions')) return []
  const tx = transactionsTable(conn)
  const marks = accounts.map(() => '?').join(', ')
  return conn
    .prepare(
      `select account, ticker, substr(date, 1, 10) as date, type
         from ${tx}
        where market = 'US' and type in ('BUY', 'SELL') and ticker is not null
          and date >= ? and account in (${marks})${rowScope(conn, tx)}
        order by date`
    )
    .all(addCalendarDays(asOf, -SETTLEMENT_LOOKBACK_DAYS), ...accounts) as SettlementTrade[]
}

function brokerages(conn: Database.Database): string[] {
  if (!hasTable(conn, 'transactions')) return []
  const tx = transactionsTable(conn)
  return (
    conn
      .prepare(`select distinct brokerage from ${tx} where market = 'US' and brokerage is not null${rowScope(conn, tx)} order by brokerage`)
      .all() as { brokerage: string }[]
  ).map((row) => row.brokerage)
}

export function runTaxCalendar(flags: ParsedFlags, ctx: CliContext) {
  const asOf = dateFlag(flags, 'as-of') ?? todayLosAngeles()
  const drip = dripRows(ctx.conn, asOf)
  const dripTickers = new Set(drip.map((row) => row.ticker))
  const review = getWashSaleReview(asOf)

  const washSaleWindows = review.windows.map((window) => {
    const latest = window.sales[window.sales.length - 1]
    return {
      ticker: window.ticker,
      soldDate: latest?.soldDate ?? null,
      blockedThrough: window.blockedThrough,
      daysLeft: window.daysLeft,
      realizedLossUsd: usd(window.loss),
      accounts: [...new Set([...window.sales.flatMap((sale) => sale.accounts), ...window.stillHeldIn])].sort(),
      boughtSinceSale: window.boughtSinceSale,
      dripActive: dripTickers.has(window.ticker),
    }
  })

  const cashAccounts = cashAccountLabels(loadAccountMap(config.stockAccountMapPath))
  const settlement = cashAccounts.length
    ? {
        status: 'ok' as const,
        reason: null,
        items: settlementConstraints(settlementTrades(ctx.conn, asOf, cashAccounts), cashAccounts, asOf),
      }
    : {
        status: 'unavailable' as const,
        reason: 'No account is marked "cashAccount": true in the account map, so settlement timing is not computed.',
        items: [],
      }

  return {
    provenance: buildProvenance({ conn: ctx.conn, policyState: ctx.policyState, dbPath: ctx.dbPath }),
    asOf,
    transactionsThrough: review.transactionsThrough,
    washSaleWindows,
    drip,
    settlement,
    coverage: { brokerages: brokerages(ctx.conn), excludes: ['KR', 'crypto', 'options'] },
  }
}

function textTaxCalendar(r: Record<string, any>) {
  const parts = [`tax:calendar — as of ${r.asOf}; US transactions through ${r.transactionsThrough ?? 'none'}`, '']
  parts.push(
    r.washSaleWindows.length
      ? table(
          ['wash-sale', 'sold', 'blocked through', 'days left', 'loss USD', 'bought since', 'DRIP', 'accounts'],
          r.washSaleWindows.map((w: any) => [w.ticker, w.soldDate, w.blockedThrough, w.daysLeft, w.realizedLossUsd, w.boughtSinceSale ? 'yes' : 'no', w.dripActive ? 'yes' : 'no', w.accounts.join(', ')])
        )
      : 'wash-sale: no open window'
  )
  parts.push('', r.drip.length ? table(['DRIP', 'last reinvest', 'accounts'], r.drip.map((d: any) => [d.ticker, d.lastReinvestDate, d.accounts.join(', ')])) : `DRIP: no reinvestment in the last ${DRIP_ACTIVE_DAYS} days`)
  if (r.settlement.status === 'unavailable') parts.push('', `settlement: unavailable — ${r.settlement.reason}`)
  else if (!r.settlement.items.length) parts.push('', 'settlement: no buy is waiting on unsettled proceeds')
  else
    parts.push(
      '',
      table(
        ['settlement', 'ticker', 'bought', 'funded by sale', 'settles', 'earliest sale'],
        r.settlement.items.map((i: any) => [i.account, i.ticker, i.buyDate, i.fundedBySaleDate, i.settlesOn, i.earliestSaleDate])
      )
    )
  parts.push('', `coverage: ${r.coverage.brokerages.join(', ') || 'none'}; excludes ${r.coverage.excludes.join(', ')}`, '', provenanceLines(r.provenance))
  return parts.join('\n')
}

export const taxCalendarCommand: Command = {
  name: 'tax:calendar',
  usage: 'pnpm tax:calendar [--as-of YYYY-MM-DD] [--json]',
  flags: { 'as-of': 'string' },
  run: runTaxCalendar as Command['run'],
  text: textTaxCalendar,
}
