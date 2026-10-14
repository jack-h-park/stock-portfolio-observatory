/**
 * Wash-sale windows: which US tickers must not be bought, in any account, until when.
 *
 * IRC §1091 disallows a loss on a stock sale when substantially identical stock
 * is acquired within 30 days before or after it. The rule is per TAXPAYER, not per
 * account: a buy in another brokerage, an IRA, or a spouse's account triggers it
 * just the same, and an IRA buy makes the loss permanent rather than deferred. This
 * app sees only the accounts it ingests, so everything here is a lower bound on
 * the risk, and the copy says so.
 *
 * Pure on purpose: the date math and the before-sale matching are what can quietly
 * be wrong, so they are tested apart from the database (tests/wash-sale.test.ts).
 * The adapter feeds rows in; the pages, the briefing summary and the tests all read
 * the same result.
 *
 * Out of scope, deliberately: crypto (no wash-sale rule applies to it today), Korean
 * stocks (no such rule in Korea), options and other "substantially identical"
 * securities (matched by ticker only — a different share class or an option on the
 * same name is not caught).
 */

/** Calendar days on each side of a loss sale. */
export const WASH_SALE_WINDOW_DAYS = 30

/** One realized lot of a US sale. A loss lot has `realizedGl < 0`. */
export type WashSaleLot = {
  ticker: string
  soldDate: string
  acquiredDate: string | null
  quantity: number
  /** In the lot's own currency (USD). */
  realizedGl: number
  account: string
}

/** One acquisition of a US ticker: a buy, including a dividend reinvestment. */
export type WashSaleBuy = {
  ticker: string
  date: string
  quantity: number
  account: string
  /** True for a dividend reinvestment — it counts, and is the one people forget. */
  reinvested?: boolean
}

export type WashSaleMatchedBuy = WashSaleBuy & {
  /** 'before' = within 30 days before the loss sale (or the same day); 'after' = since it. */
  side: 'before' | 'after'
}

/** One sale date of one ticker, with what it lost and what may undo that. */
export type WashSaleSale = {
  soldDate: string
  /** Last day of the window: soldDate + 30 calendar days, inclusive. */
  windowEnd: string
  accounts: string[]
  /** Shares sold at a loss on this date. */
  lossQuantity: number
  /** Sum of the loss lots, negative. Gain lots in the same sale are not netted in. */
  loss: number
  matchedBuys: WashSaleMatchedBuy[]
  /** Shares bought in the window that can stand as replacement shares. */
  replacementQuantity: number
  /** Part of `loss` that may be disallowed, negative or 0. An estimate — see below. */
  possiblyDisallowed: number
}

export type WashSaleWindow = {
  ticker: string
  /** Last day a buy would still fall inside a window: the latest sale's windowEnd. */
  blockedThrough: string
  /** First day a buy is outside every window. */
  clearFrom: string
  /** Days from today to `blockedThrough`; 0 on the last blocked day. */
  daysLeft: number
  /** Sum of the loss lots in the open windows, negative. */
  loss: number
  possiblyDisallowed: number
  sales: WashSaleSale[]
  /** True when a buy has already landed after a sale, inside its window. */
  boughtSinceSale: boolean
}

const DAY_MS = 86_400_000

function utcDay(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** `iso` (YYYY-MM-DD) moved by `days` calendar days. UTC throughout, so no DST drift. */
export function addCalendarDays(iso: string, days: number) {
  return new Date(utcDay(iso) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function calendarDaysBetween(from: string, to: string) {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS)
}

/** The last day of the window a sale on `soldDate` opens. 2026-10-09 → 2026-11-08. */
export function washSaleWindowEnd(soldDate: string) {
  return addCalendarDays(soldDate, WASH_SALE_WINDOW_DAYS)
}

/**
 * Loss sales whose window is still open on `today`, one entry per ticker.
 *
 * Replacement shares are estimated, not computed the way a 1099-B will:
 *
 *  - A buy counts when it lands in [soldDate - 30, soldDate + 30] and on or before
 *    `today` (a future buy is what the warning is for, not something to count).
 *    A same-day buy is put on the 'before' side: the order of the two trades is
 *    not in the data, and either way it is inside the window.
 *  - Shares bought in the 30 days before and then sold IN THIS SAME SALE are not
 *    replacement shares — they are part of what was sold. Those are subtracted,
 *    using the realized lots of that day whose acquisition date falls in the
 *    window (gain lots included: they are shares sold too).
 *  - The disallowed part is the loss pro-rated by min(replacement, loss shares) /
 *    loss shares. The real rule matches share by share in acquisition order, so
 *    this is the size of the exposure, not a filing figure.
 */
export function buildWashSaleWindows({
  lots,
  buys,
  today,
}: {
  lots: WashSaleLot[]
  buys: WashSaleBuy[]
  today: string
}): WashSaleWindow[] {
  const byTickerDate = new Map<string, WashSaleLot[]>()
  for (const lot of lots) {
    if (!lot.soldDate || !lot.ticker) continue
    const key = `${lot.ticker}\u0000${lot.soldDate.slice(0, 10)}`
    const group = byTickerDate.get(key)
    if (group) group.push(lot)
    else byTickerDate.set(key, [lot])
  }

  const salesByTicker = new Map<string, WashSaleSale[]>()
  for (const group of byTickerDate.values()) {
    const { ticker } = group[0]
    const soldDate = group[0].soldDate.slice(0, 10)
    const windowEnd = washSaleWindowEnd(soldDate)
    if (windowEnd < today) continue
    const lossLots = group.filter((lot) => lot.realizedGl < 0)
    if (!lossLots.length) continue

    const windowStart = addCalendarDays(soldDate, -WASH_SALE_WINDOW_DAYS)
    const lossQuantity = lossLots.reduce((sum, lot) => sum + Math.abs(lot.quantity), 0)
    const loss = lossLots.reduce((sum, lot) => sum + lot.realizedGl, 0)

    const matchedBuys: WashSaleMatchedBuy[] = buys
      .filter((buy) => buy.ticker === ticker && buy.date >= windowStart && buy.date <= windowEnd && buy.date <= today)
      .map((buy) => ({ ...buy, side: buy.date <= soldDate ? ('before' as const) : ('after' as const) }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const boughtBefore = matchedBuys.filter((b) => b.side === 'before').reduce((sum, b) => sum + Math.abs(b.quantity), 0)
    const boughtAfter = matchedBuys.filter((b) => b.side === 'after').reduce((sum, b) => sum + Math.abs(b.quantity), 0)
    const soldFromWindow = group
      .filter((lot) => lot.acquiredDate != null && lot.acquiredDate.slice(0, 10) >= windowStart && lot.acquiredDate.slice(0, 10) <= soldDate)
      .reduce((sum, lot) => sum + Math.abs(lot.quantity), 0)
    const replacementQuantity = Math.max(0, boughtBefore - soldFromWindow) + boughtAfter
    const share = lossQuantity > 0 ? Math.min(1, replacementQuantity / lossQuantity) : 0

    const sale: WashSaleSale = {
      soldDate,
      windowEnd,
      accounts: [...new Set(group.map((lot) => lot.account))].sort(),
      lossQuantity,
      loss,
      matchedBuys,
      replacementQuantity,
      possiblyDisallowed: share > 0 ? loss * share : 0,
    }
    const list = salesByTicker.get(ticker)
    if (list) list.push(sale)
    else salesByTicker.set(ticker, [sale])
  }

  const windows: WashSaleWindow[] = []
  for (const [ticker, sales] of salesByTicker) {
    sales.sort((a, b) => a.soldDate.localeCompare(b.soldDate))
    const blockedThrough = sales.reduce((latest, sale) => (sale.windowEnd > latest ? sale.windowEnd : latest), sales[0].windowEnd)
    windows.push({
      ticker,
      blockedThrough,
      clearFrom: addCalendarDays(blockedThrough, 1),
      daysLeft: calendarDaysBetween(today, blockedThrough),
      loss: sales.reduce((sum, sale) => sum + sale.loss, 0),
      possiblyDisallowed: sales.reduce((sum, sale) => sum + sale.possiblyDisallowed, 0),
      sales,
      boughtSinceSale: sales.some((sale) => sale.matchedBuys.some((buy) => buy.side === 'after')),
    })
  }
  // Soonest to clear last: the longest-running block reads first, ties by size of the loss.
  return windows.sort((a, b) => b.blockedThrough.localeCompare(a.blockedThrough) || a.loss - b.loss || a.ticker.localeCompare(b.ticker))
}

/**
 * One sentence for the briefing summary and the Telegram line, or null when no
 * window is open. Tickers that clear on the same day share one date. Stated as
 * the fact it is — what a buy would do — rather than as an order.
 */
export function washSaleLine(windows: Pick<WashSaleWindow, 'ticker' | 'blockedThrough' | 'daysLeft' | 'boughtSinceSale'>[]): string | null {
  if (!windows.length) return null
  const byDate = new Map<string, { tickers: string[]; daysLeft: number }>()
  for (const w of windows) {
    const group = byDate.get(w.blockedThrough)
    if (group) group.tickers.push(w.ticker)
    else byDate.set(w.blockedThrough, { tickers: [w.ticker], daysLeft: w.daysLeft })
  }
  const groups = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, g]) => `${g.tickers.join(', ')} through ${date} (${g.daysLeft === 0 ? 'last day' : `${g.daysLeft}d left`})`)
  const bought = windows.filter((w) => w.boughtSinceSale).map((w) => w.ticker)
  const tail = bought.length ? ` Already bought since the sale: ${bought.join(', ')}.` : ''
  return `Wash-sale window: ${groups.join('; ')}. A buy in any account, IRA or spouse's included, disallows the loss.${tail}`
}
