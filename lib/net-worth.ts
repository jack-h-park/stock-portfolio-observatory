/**
 * Net worth across asset classes, kept free of the database so the conversion
 * rules can be tested on their own. A USD balance with no USD/KRW rate is listed
 * as unpriced and left out of the total — never counted as zero, never at 1:1.
 */
export type CashAccountBalance = { institution: string; account: string; kind: string; currency: 'KRW' | 'USD'; asOfDate: string; balance: number; derived: boolean }
export type NetWorth = {
  totalKrw: number
  byClass: { stocks: number; crypto: number; cash: number; pension: number; gold: number }
  cash: (CashAccountBalance & { krw: number | null })[]
  unpricedCash: string[]
  history: { month: string; stocks: number | null; cash: number }[]
}

// Only KRW and USD are priced. Any other currency is unpriced rather than guessed at.
const toKrw = (currency: string, amount: number, usdKrw: number | null) =>
  currency === 'KRW' ? amount : currency === 'USD' && usdKrw && usdKrw > 0 ? amount * usdKrw : null

export function summarizeNetWorth(input: { stocksKrw: number; cryptoKrw: number; cash: CashAccountBalance[]; usdKrw: number | null }): Omit<NetWorth, 'history'> {
  const cash = input.cash.map((row) => ({ ...row, krw: toKrw(row.currency, row.balance, input.usdKrw) }))
  const cashKrw = cash.reduce((sum, row) => sum + (row.krw ?? 0), 0)
  const byClass = { stocks: input.stocksKrw, crypto: input.cryptoKrw, cash: cashKrw, pension: 0, gold: 0 }
  return {
    totalKrw: byClass.stocks + byClass.crypto + byClass.cash + byClass.pension + byClass.gold,
    byClass,
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
