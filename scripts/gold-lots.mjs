/**
 * Physical gold (KRX 금현물) lots, matched first in, first out.
 *
 * The gold account's certificate lists purchases and sales in grams. A US
 * taxpayer needs each sale split by the purchase it consumed, because the
 * holding period (long or short term) runs from that purchase's date and gold
 * is a collectible: its long-term rate differs from a stock's. An average cost
 * would blur both, so a sale takes grams from the oldest purchase first.
 *
 * Costs are won, and include the purchase's commission and the VAT on it.
 * Proceeds are the sale amount less its commission and VAT, the selling
 * expenses the IRS nets from the amount realized. Dollar figures belong to the
 * caller: a lot's dollar cost uses the rate on its acquisition date, its
 * dollar proceeds the rate on the sale date.
 */

const DAY_MS = 86_400_000

function days(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/**
 * @param {{ date: string, type: 'BUY' | 'SELL', grams: number, amountKrw: number, feeKrw?: number }[]} trades
 *   `amountKrw` is the trade amount (grams x price) and `feeKrw` its commission
 *   plus the VAT on it. A purchase on the day of a sale is matched before it.
 * @returns {{
 *   realized: {
 *     acquiredDate: string, soldDate: string, grams: number, costKrw: number,
 *     proceedsKrw: number, gainKrw: number, holdingDays: number, term: 'Long-term' | 'Short-term',
 *   }[],
 *   open: { acquiredDate: string, grams: number, costKrw: number }[],
 *   oversold: number,
 * }} `oversold` is grams sold that no purchase on file covers (a certificate
 *   that starts after the purchase); those grams produce no realized row.
 */
export function matchGoldLots(trades) {
  const ordered = trades
    .map((trade, index) => ({ trade, index }))
    .sort(
      (a, b) =>
        a.trade.date.localeCompare(b.trade.date) ||
        (a.trade.type === b.trade.type ? 0 : a.trade.type === 'BUY' ? -1 : 1) ||
        a.index - b.index
    )
    .map(({ trade }) => trade)

  /** @type {{ acquiredDate: string, grams: number, originalGrams: number, costKrw: number }[]} */
  const lots = []
  const realized = []
  let oversold = 0

  for (const trade of ordered) {
    const grams = Math.abs(Number(trade.grams) || 0)
    if (!(grams > 0)) continue
    const fee = Math.abs(Number(trade.feeKrw) || 0)
    if (trade.type === 'BUY') {
      const cost = Math.abs(Number(trade.amountKrw) || 0) + fee
      lots.push({ acquiredDate: trade.date, grams, originalGrams: grams, costKrw: cost })
      continue
    }
    // The sale's net proceeds are spread over the grams, so a sale that spans
    // two purchases gives each slice its share.
    const netProceeds = Math.abs(Number(trade.amountKrw) || 0) - fee
    let remaining = grams
    for (const lot of lots) {
      if (remaining <= 1e-9) break
      if (lot.grams <= 1e-9) continue
      const slice = Math.min(lot.grams, remaining)
      const cost = lot.costKrw * (slice / lot.grams)
      const proceeds = netProceeds * (slice / grams)
      const holdingDays = days(lot.acquiredDate, trade.date)
      realized.push({
        acquiredDate: lot.acquiredDate,
        soldDate: trade.date,
        grams: slice,
        costKrw: cost,
        proceedsKrw: proceeds,
        gainKrw: proceeds - cost,
        holdingDays,
        term: holdingDays > 365 ? 'Long-term' : 'Short-term',
      })
      lot.costKrw -= cost
      lot.grams -= slice
      remaining -= slice
    }
    if (remaining > 1e-9) oversold += remaining
  }

  return {
    realized,
    open: lots
      .filter((lot) => lot.grams > 1e-9)
      .map((lot) => ({ acquiredDate: lot.acquiredDate, grams: lot.grams, costKrw: lot.costKrw })),
    oversold,
  }
}
