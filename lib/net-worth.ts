import { matchGoldLots } from '@/scripts/gold-lots.mjs'

/**
 * Net worth across asset classes, kept free of the database so the conversion
 * rules can be tested on their own. A USD balance with no USD/KRW rate is listed
 * as unpriced and left out of the total — never counted as zero, never at 1:1.
 */
export type CashAccountBalance = { institution: string; account: string; kind: string; currency: 'KRW' | 'USD'; asOfDate: string; balance: number; derived: boolean }
export type AssetClassKey = 'stocks' | 'crypto' | 'cash' | 'pensions' | 'gold'
export const ASSET_CLASSES: readonly AssetClassKey[] = ['stocks', 'crypto', 'cash', 'pensions', 'gold']
/**
 * A value taken from a dated snapshot, held at cost, or (cash) read from a
 * balance that is not today's: shown with its date next to its class.
 */
export type AsOfNote = { assetClass: AssetClassKey; label: string; asOf: string }
export type NetWorth = {
  coverage?: { omittedAssetCount: number; sourceCoverageConfirmed: boolean; liabilitiesSupported: false }
  valuationDates?: Partial<Record<'market' | 'snapshot' | 'cost', { oldest: string | null; newest: string | null; undated: number }>>
  fxAsOf?: string | null
  totalKrw: number
  byClass: Record<AssetClassKey, number>
  asOfNotes: AsOfNote[]
  cash: (CashAccountBalance & { krw: number | null })[]
  unpricedCash: string[]
}

// Only KRW and USD are priced. Any other currency is unpriced rather than guessed at.
const toKrw = (currency: string, amount: number, usdKrw: number | null) =>
  currency === 'KRW' ? amount : currency === 'USD' && usdKrw && usdKrw > 0 ? amount * usdKrw : null

export function summarizeNetWorth(input: {
  stocksKrw: number
  cryptoKrw: number
  cash: CashAccountBalance[]
  usdKrw: number | null
  pensionsKrw?: number
  goldKrw?: number
  asOfNotes?: AsOfNote[]
}): NetWorth {
  const cash = input.cash.map((row) => ({ ...row, krw: toKrw(row.currency, row.balance, input.usdKrw) }))
  const cashKrw = cash.reduce((sum, row) => sum + (row.krw ?? 0), 0)
  const byClass = { stocks: input.stocksKrw, crypto: input.cryptoKrw, cash: cashKrw, pensions: input.pensionsKrw ?? 0, gold: input.goldKrw ?? 0 }
  // Nonzero cash is as old as its stalest priced balance: the account whose latest
  // balance is the oldest names the date.
  const stalest = cash.filter((row) => row.krw != null && row.balance !== 0).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))[0]
  const cashNote: AsOfNote[] = stalest ? [{ assetClass: 'cash', label: stalest.account, asOf: stalest.asOfDate }] : []
  return {
    totalKrw: byClass.stocks + byClass.crypto + byClass.cash + byClass.pensions + byClass.gold,
    byClass,
    asOfNotes: [...(input.asOfNotes ?? []), ...cashNote],
    cash,
    unpricedCash: cash.filter((row) => row.krw == null).map((row) => row.account),
  }
}

export type CashBalanceRow = { institution: string; account: string; currency: 'KRW' | 'USD'; date: string; balance: number }

/**
 * Deposits in KRW on each of the given dates: every account's latest balance on
 * or before the date, converted at that date's rate, summed. An account adds
 * nothing before its first balance, and a USD account adds nothing on a date
 * with no rate. A date no account reaches is null, so a chart draws a gap rather
 * than a fall to zero. `since` is the earliest first balance among the accounts
 * that reached at least one date. Rows of one account that share a date keep
 * their input order, so the last one wins (the reader orders by date, then id).
 */
export function depositsSeries(
  dates: string[],
  rows: CashBalanceRow[],
  rateAt: (date: string) => number | null
): { series: { date: string; krw: number | null }[]; since: string | null } {
  const byAccount = new Map<string, CashBalanceRow[]>()
  for (const row of rows) {
    const key = `${row.institution}|${row.account}`
    byAccount.set(key, [...(byAccount.get(key) ?? []), row])
  }
  const accounts = [...byAccount.values()].map((list) => [...list].sort((a, b) => a.date.localeCompare(b.date)))
  const counted = new Set<CashBalanceRow[]>()
  const series = dates.map((date) => {
    let krw: number | null = null
    for (const list of accounts) {
      const last = list.filter((row) => row.date <= date).at(-1)
      if (!last) continue
      const value = toKrw(last.currency, last.balance, last.currency === 'KRW' ? null : rateAt(date))
      if (value == null) continue
      krw = (krw ?? 0) + value
      counted.add(list)
    }
    return { date, krw }
  })
  const starts = [...counted].map((list) => list[0].date).sort()
  return { series, since: starts[0] ?? null }
}

export type TotalAssetsPoint = {
  date: string
  stocks: number | null
  crypto: number | null
  cash: number | null
  pensions: number | null
  gold: number | null
  total: number
}
export type TotalAssetsSeries = { points: TotalAssetsPoint[]; startsOn: Partial<Record<AssetClassKey, string>> }

export type HistoricalGoldTrade = {
  accountId: string
  date: string
  type: 'BUY' | 'SELL'
  grams: number | null
  costKrw: number | null
  feeKrw?: number
}

/** Same account-scoped FIFO basis as ingestion; a quote does not repair missing quantities. */
function historicalGoldValue(trades: HistoricalGoldTrade[], prices: { date: string; price: number }[], date: string): number | null {
  if (trades.some(trade => !/^\d{4}-\d{2}-\d{2}$/.test(trade.date))) return null
  const reached = trades.filter(trade => trade.date <= date)
  if (!reached.length) return null
  const accounts = new Map<string, HistoricalGoldTrade[]>()
  for (const trade of reached) accounts.set(trade.accountId, [...(accounts.get(trade.accountId) ?? []), trade])
  const price = prices.filter(row => row.date <= date && Number.isFinite(row.price) && row.price > 0).at(-1)
  let value = 0
  for (const rows of accounts.values()) {
    if (rows.some(row => row.grams == null || !Number.isFinite(row.grams) || row.grams === 0 || !['BUY', 'SELL'].includes(row.type))) return null
    const knownCost = (row: HistoricalGoldTrade) => row.costKrw != null && Number.isFinite(row.costKrw) && Number.isFinite(row.feeKrw ?? 0)
    const normalized = rows.map(row => ({ date: row.date, type: row.type, grams: Math.abs(row.grams!),
      amountKrw: row.costKrw != null && Number.isFinite(row.costKrw) ? Math.abs(row.costKrw) : 0,
      feeKrw: Number.isFinite(row.feeKrw ?? 0) ? Math.abs(row.feeKrw ?? 0) : 0 }))
    const matched = matchGoldLots(normalized)
    if (matched.oversold > 1e-9) return null
    const grams = matched.open.reduce((sum, lot) => sum + lot.grams, 0)
    if (!grams) continue // A supported closed account is zero, even without a price or basis.
    if (price) value += grams * price.price
    else {
      // Replay a unit-cost marker through the same FIFO matcher. Only unknown
      // purchase basis still in an open lot prevents remaining-cost fallback.
      const unknown = matchGoldLots(normalized.map((row, i) => ({ ...row, feeKrw: 0,
        amountKrw: row.type === 'BUY' && !knownCost(rows[i]) ? row.grams : 0 })))
      if (unknown.open.some(lot => lot.costKrw > 0)) return null
      value += matched.open.reduce((sum, lot) => sum + lot.costKrw, 0)
    }
  }
  return value
}

/**
 * Every asset class on each date, in KRW, for the stacked total-assets chart.
 *
 * - Stocks, crypto and cash arrive per date; a missing date is null.
 * - Pensions step: each account holds its latest point on or before the date
 *   (a year-end certificate or a snapshot total) and adds nothing before its
 *   first. The class is null until some account has started.
 * - Gold: remaining grams after account-scoped FIFO sales, at the latest price
 *   on or before the date, or their remaining purchase cost including fees.
 *   Null before history begins or where quantity/basis cannot be supported.
 *
 * A class that has not started is null, never 0 and never interpolated, so the
 * chart draws nothing for it. The total is the sum of the non-null classes, and
 * `startsOn` is each class's first non-null date.
 */
export function totalAssetsSeries(input: {
  dates: string[]
  stocks: Record<string, number | null>
  crypto: Record<string, number | null>
  cash: Record<string, number | null>
  pensionPoints: { date: string; account: string; valueKrw: number }[]
  gold: { trades: HistoricalGoldTrade[]; prices: { date: string; price: number }[] }
}): TotalAssetsSeries {
  const byAccount = new Map<string, { date: string; valueKrw: number }[]>()
  for (const point of input.pensionPoints) byAccount.set(point.account, [...(byAccount.get(point.account) ?? []), point])
  // Stable sort: points of one account that share a date keep their input order, so the last wins.
  const accounts = [...byAccount.values()].map((list) => [...list].sort((a, b) => a.date.localeCompare(b.date)))
  const prices = [...input.gold.prices].sort((a, b) => a.date.localeCompare(b.date))
  const value = (record: Record<string, number | null>, date: string) => {
    const v = record[date]
    return v == null || !Number.isFinite(v) ? null : v
  }

  const points = input.dates.map((date): TotalAssetsPoint => {
    let pensions: number | null = null
    for (const list of accounts) {
      const last = list.filter((point) => point.date <= date).at(-1)
      if (last) pensions = (pensions ?? 0) + last.valueKrw
    }
    const gold = historicalGoldValue(input.gold.trades, prices, date)
    const classes = { stocks: value(input.stocks, date), crypto: value(input.crypto, date), cash: value(input.cash, date), pensions, gold }
    const total = ASSET_CLASSES.reduce((sum, key) => sum + (classes[key] ?? 0), 0)
    return { date, ...classes, total }
  })

  const startsOn: TotalAssetsSeries['startsOn'] = {}
  for (const key of ASSET_CLASSES) {
    const first = points.find((point) => point[key] != null)
    if (first) startsOn[key] = first.date
  }
  return { points, startsOn }
}
