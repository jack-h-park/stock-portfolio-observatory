/**
 * The Overview's gold scope: physical gold (KRX 금현물) and gold-backed ETFs
 * on one line. It is a cross-cut view, not an additive asset class.
 *
 * - The gold ETFs live in the stock tables, so Global, Korea and United States
 *   already count them. Physical gold lives in the `*_all` tables only, so no
 *   stock figure counts it. The two sets are disjoint by construction, and this
 *   scope is their union.
 * - Nothing here is added back into a stock figure: the gold scope reads the
 *   same rows and sums them again for its own chart.
 */

/** Gold-backed ETFs, matched by ticker in the stock book. Add a ticker here to include it. */
export const GOLD_ETF_TICKERS = ['IAU', 'IAUM', 'SGOL'] as const

export type GoldTrade = { date: string; type: 'BUY' | 'SELL'; grams: number; costKrw: number }
export type GoldPricePoint = { date: string; price: number }

/**
 * A group of positions on one date. `pricedCost` is the cost of the positions
 * that have a market value, so `marketValue - pricedCost` is a like-for-like gain.
 */
export type GoldBook = { cost: number; pricedCost: number; marketValue: number; positions: number }

export const emptyGoldBook = (): GoldBook => ({ cost: 0, pricedCost: 0, marketValue: 0, positions: 0 })

/**
 * Physical gold held on a date, rebuilt from its trades the way the ingest builds
 * the holding: a purchase adds grams and cost, a sale takes grams out at the
 * average cost. Valued at the latest KRX price on or before the date; with none,
 * the grams are carried at cost and counted as unpriced.
 */
export function physicalGoldBookAt(trades: GoldTrade[], prices: GoldPricePoint[], date: string): GoldBook {
  let grams = 0
  let cost = 0
  for (const trade of trades) {
    if (trade.date > date) continue
    if (trade.type === 'BUY') {
      grams += trade.grams
      cost += trade.costKrw
    } else if (grams > 0) {
      const sold = Math.min(trade.grams, grams)
      cost -= (cost / grams) * sold
      grams -= sold
    }
  }
  if (!(grams > 0)) return emptyGoldBook()
  const price = prices.filter((row) => row.date <= date).at(-1)
  return price
    ? { cost, pricedCost: cost, marketValue: grams * price.price, positions: 1 }
    : { cost, pricedCost: 0, marketValue: 0, positions: 1 }
}

export function addGoldBooks(...books: GoldBook[]): GoldBook {
  return books.reduce(
    (sum, book) => ({
      cost: sum.cost + book.cost,
      pricedCost: sum.pricedCost + book.pricedCost,
      marketValue: sum.marketValue + book.marketValue,
      positions: sum.positions + book.positions,
    }),
    emptyGoldBook()
  )
}

export type GoldScopeFields = {
  gold_market_value: number | null
  gold_cost_basis: number | null
  gold_unrealized_gl: number | null
  gold_return_pct: number | null
  gold_market_value_coverage: number | null
  gold_realized_gl: number | null
}

const NO_GOLD: GoldScopeFields = {
  gold_market_value: null,
  gold_cost_basis: null,
  gold_unrealized_gl: null,
  gold_return_pct: null,
  gold_market_value_coverage: null,
  gold_realized_gl: null,
}

/**
 * The scope's snapshot fields for one date. Every field is null before the
 * first gold position (and before any realized gold gain), so the chart draws
 * nothing there instead of a line at zero.
 */
export function goldScopeFields(book: GoldBook, realizedGl: number): GoldScopeFields {
  if (book.positions === 0 && realizedGl === 0) return NO_GOLD
  const unrealized = book.marketValue - book.pricedCost
  return {
    gold_market_value: book.marketValue,
    gold_cost_basis: book.cost,
    gold_unrealized_gl: unrealized,
    gold_return_pct: book.pricedCost > 0 ? (unrealized / book.pricedCost) * 100 : null,
    gold_market_value_coverage: book.cost > 0 ? book.pricedCost / book.cost : 1,
    gold_realized_gl: realizedGl,
  }
}
