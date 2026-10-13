// A pension account's value before its first snapshot, rebuilt from its
// 거래내역증명서: the units each trade leaves held, valued at that day's close,
// plus the cash the statement prints (or, where it prints none, the cash the rows
// add up to). Used where the certificate covers the account from its first
// deposit and every row is one this replay understands; the result is DERIVED
// and is stored flagged as such.
//
// When the rows are understood but a traded ETF has no price history, the value
// cannot be rebuilt, and the fallback is the cumulative net contributions (money
// in less money out), also flagged. Anything else — an IRP's trust products
// (TRUST_OUT), a fund bought with no ticker — is left alone: no derived point,
// exactly as before.

const CASH_IN = new Set(['DEPOSIT', 'EMPLOYER_CONTRIBUTION', 'TRANSFER_IN', 'DIVIDEND', 'INTEREST', 'OTHER_INCOME'])
const CASH_OUT = new Set(['WITHDRAWAL', 'TRANSFER_OUT', 'FEE'])
const TRADES = new Set(['BUY', 'SELL'])
const CONTRIBUTION_IN = new Set(['DEPOSIT', 'EMPLOYER_CONTRIBUTION', 'TRANSFER_IN'])
const CONTRIBUTION_OUT = new Set(['WITHDRAWAL', 'TRANSFER_OUT'])
export const REPLAY_TYPES = new Set([...CASH_IN, ...CASH_OUT, ...TRADES])

const num = (value) => {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
const amountOf = (row) => Math.abs(num(row.amount_krw) || num(row.settlement_krw) || num(row.native_amount))
const day = (value) => String(value ?? '').slice(0, 10)

/** The latest `value` on or before `date` in a date-sorted list, or null. */
function latestOn(points, date) {
  let found = null
  for (const point of points) {
    if (point.date > date) break
    found = point
  }
  return found
}

/**
 * @param {object} input
 * @param {object[]} input.rows the account's transaction rows (type, date, ticker, quantity, amount_krw, fee, tax, unit_price)
 * @param {string} input.firstPointDate the date of the account's first stored point (its snapshot)
 * @param {Map<string, {date: string, close: number}[]>} input.prices date-sorted closes by ticker
 * @param {{date: string, balance: number}[]} [input.cash] the won balance the statement prints, date-sorted
 * @returns {{ method: 'replay' | 'contributions' | null, reason: string | null, points: {date: string, value: number}[],
 *   atFirstPoint: { quantities: Map<string, number>, value: number, cash: number } | null, unpriced: string[] }}
 */
export function replayPensionHistory({ rows, firstPointDate, prices, cash = [] }) {
  const sorted = [...rows].map((row) => ({ ...row, date: day(row.date) })).filter((row) => row.date).sort((a, b) => a.date.localeCompare(b.date))
  const none = (reason) => ({ method: null, reason, points: [], atFirstPoint: null, unpriced: [] })
  if (!firstPointDate) return none('no stored point to meet')
  if (!sorted.length || sorted[0].date >= firstPointDate) return none('no certificate row before the first point')
  const foreign = [...new Set(sorted.filter((row) => !REPLAY_TYPES.has(row.type)).map((row) => row.type))]
  if (foreign.length) return none(`rows the replay does not value: ${foreign.join(', ')}`)
  if (sorted.some((row) => TRADES.has(row.type) && !String(row.ticker ?? '').trim())) return none('a trade with no ticker')

  const tickers = [...new Set(sorted.filter((row) => TRADES.has(row.type)).map((row) => String(row.ticker).trim()))]
  const unpriced = tickers.filter((ticker) => !(prices.get(ticker) ?? []).length)
  const before = sorted.filter((row) => row.date < firstPointDate)

  if (unpriced.length) {
    let total = 0
    const byDate = new Map()
    for (const row of before) {
      if (CONTRIBUTION_IN.has(row.type)) total += amountOf(row)
      else if (CONTRIBUTION_OUT.has(row.type)) total -= amountOf(row)
      else continue
      byDate.set(row.date, total)
    }
    return {
      method: 'contributions',
      reason: `no price history for ${unpriced.join(', ')}`,
      points: [...byDate].map(([date, value]) => ({ date, value })),
      atFirstPoint: null,
      unpriced,
    }
  }

  const dates = new Set(before.map((row) => row.date))
  for (const ticker of tickers) {
    for (const point of prices.get(ticker) ?? []) {
      if (point.date >= sorted[0].date && point.date < firstPointDate) dates.add(point.date)
    }
  }
  const quantities = new Map()
  const lastCost = new Map()
  let runningCash = 0
  let next = 0
  const state = (date) => {
    while (next < sorted.length && sorted[next].date <= date) {
      const row = sorted[next]
      const amount = amountOf(row)
      if (CASH_IN.has(row.type)) runningCash += amount
      else if (CASH_OUT.has(row.type)) runningCash -= amount
      else {
        const ticker = String(row.ticker).trim()
        const units = Math.abs(num(row.quantity))
        if (row.type === 'BUY') {
          quantities.set(ticker, (quantities.get(ticker) ?? 0) + units)
          runningCash -= amount + Math.abs(num(row.fee))
          if (units > 0) lastCost.set(ticker, amount / units)
        } else {
          quantities.set(ticker, (quantities.get(ticker) ?? 0) - units)
          runningCash += amount - Math.abs(num(row.fee)) - Math.abs(num(row.tax))
        }
      }
      next += 1
    }
    let securities = 0
    for (const [ticker, units] of quantities) {
      if (!units) continue
      const close = latestOn(prices.get(ticker) ?? [], date)?.close ?? lastCost.get(ticker) ?? 0
      securities += units * close
    }
    const printed = latestOn(cash, date)
    const cashNow = printed ? printed.balance : runningCash
    return { value: securities + cashNow, cash: cashNow }
  }
  const points = [...dates].sort().map((date) => ({ date, value: Math.round(state(date).value) }))
  const end = state(firstPointDate)
  return {
    method: 'replay',
    reason: null,
    points,
    atFirstPoint: { quantities: new Map([...quantities].filter(([, units]) => units)), value: Math.round(end.value), cash: Math.round(end.cash) },
    unpriced,
  }
}
