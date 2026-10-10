/**
 * Net worth across asset classes, kept free of the database so the conversion
 * rules can be tested on their own. A USD balance with no USD/KRW rate is listed
 * as unpriced and left out of the total — never counted as zero, never at 1:1.
 */
export type CashAccountBalance = { institution: string; account: string; kind: string; currency: 'KRW' | 'USD'; asOfDate: string; balance: number; derived: boolean }
/** A value taken from a dated snapshot or held at cost, not from today's price: shown with its date. */
export type AsOfNote = { label: string; asOf: string }
export type NetWorth = {
  totalKrw: number
  byClass: { stocks: number; crypto: number; cash: number; pensions: number; gold: number }
  asOfNotes: AsOfNote[]
  cash: (CashAccountBalance & { krw: number | null })[]
  unpricedCash: string[]
  history: { month: string; stocks: number | null; cash: number }[]
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
}): Omit<NetWorth, 'history'> {
  const cash = input.cash.map((row) => ({ ...row, krw: toKrw(row.currency, row.balance, input.usdKrw) }))
  const cashKrw = cash.reduce((sum, row) => sum + (row.krw ?? 0), 0)
  const byClass = { stocks: input.stocksKrw, crypto: input.cryptoKrw, cash: cashKrw, pensions: input.pensionsKrw ?? 0, gold: input.goldKrw ?? 0 }
  return {
    totalKrw: byClass.stocks + byClass.crypto + byClass.cash + byClass.pensions + byClass.gold,
    byClass,
    asOfNotes: input.asOfNotes ?? [],
    cash,
    unpricedCash: cash.filter((row) => row.krw == null).map((row) => row.account),
  }
}

export function monthEndCash(
  series: { institution: string; account: string; currency: 'KRW' | 'USD'; date: string; balance: number }[],
  rateAt: (date: string) => number | null
): { month: string; cash: number }[] {
  const months = [...new Set(series.map((row) => row.date.slice(0, 7)))].sort()
  const key = (row: { institution: string; account: string }) => `${row.institution}|${row.account}`
  const accounts = [...new Set(series.map(key))]
  return months.map((month) => {
    let cash = 0
    for (const account of accounts) {
      const last = series.filter((row) => key(row) === account && row.date.slice(0, 7) <= month).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
      if (!last) continue
      const krw = toKrw(last.currency, last.balance, rateAt(last.date))
      if (krw != null) cash += krw
    }
    return { month, cash }
  })
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
