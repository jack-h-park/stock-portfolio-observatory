/**
 * Positions and their market value on a past date, rebuilt from tax lots and
 * historical prices. The month-end backfill (backfill-portfolio-history.mjs)
 * and the FBAR maximum-balance table (lib/adapters/portfolio-db.ts) both value
 * history this way, so the two cannot drift apart.
 *
 * A position on a date is every open lot acquired on or before it, plus every
 * realized lot acquired on or before it and not yet sold. Its value is the
 * quantity times the latest close on or before the date, converted at the
 * latest USD/KRW rate on or before it unless the quote is in won.
 */

export function dateOnly(value) {
  return String(value ?? '').slice(0, 10)
}

/**
 * @param {{
 *   openLots: { market: string, account: string, ticker: string, acquired_date: string, open_quantity: number, cost_basis_krw: number }[],
 *   realizedLots: { market: string, account: string, ticker: string, acquired_date: string | null, sold_date: string | null, quantity_sold: number | null, cost_basis_krw: number | null }[],
 *   historicalPrices: { market: string, ticker: string, currency: string | null, price_date: string, close: number }[],
 *   historicalFxRates: { price_date: string, rate: number }[],
 * }} input historicalPrices and historicalFxRates ordered by date.
 */
export function createLotValuer({ openLots, realizedLots, historicalPrices, historicalFxRates }) {
  const pricesByTicker = new Map()
  for (const row of historicalPrices) {
    const key = `${row.market}:${row.ticker}`
    if (!pricesByTicker.has(key)) pricesByTicker.set(key, [])
    pricesByTicker.get(key).push(row)
  }
  const fxByDate = new Map(historicalFxRates.map((row) => [row.price_date, Number(row.rate)]))
  const latestFx = historicalFxRates.length ? Number(historicalFxRates[historicalFxRates.length - 1].rate) : null

  function latestPrice(market, ticker, date) {
    const rows = pricesByTicker.get(`${market}:${ticker}`) ?? []
    let result = null
    for (const row of rows) {
      if (row.price_date > date) break
      result = row
    }
    return result
  }

  function fxRate(date) {
    if (fxByDate.has(date)) return fxByDate.get(date)
    let result = null
    for (const row of historicalFxRates) {
      if (row.price_date > date) break
      result = Number(row.rate)
    }
    return result ?? latestFx
  }

  /** Raw positions keyed `market\taccount\tticker`; the quantity may be negative on bad data. */
  function positionsAt(date) {
    const positions = new Map()
    for (const lot of openLots) {
      const acquiredDate = dateOnly(lot.acquired_date)
      if (!acquiredDate || acquiredDate > date) continue
      const key = `${lot.market}\t${lot.account}\t${lot.ticker}`
      const position = positions.get(key) ?? { quantity: 0, cost: 0 }
      position.quantity += Number(lot.open_quantity || 0)
      position.cost += Number(lot.cost_basis_krw || 0)
      positions.set(key, position)
    }
    for (const lot of realizedLots) {
      const acquiredDate = dateOnly(lot.acquired_date)
      if (!acquiredDate || acquiredDate > date || (lot.sold_date && dateOnly(lot.sold_date) <= date)) continue
      const key = `${lot.market}\t${lot.account}\t${lot.ticker}`
      const position = positions.get(key) ?? { quantity: 0, cost: 0 }
      position.quantity += Number(lot.quantity_sold || 0)
      position.cost += Number(lot.cost_basis_krw || 0)
      positions.set(key, position)
    }
    return positions
  }

  /**
   * Every position held on the date with its KRW market value, or null when no
   * price or rate reaches it.
   * @returns {{ market: string, account: string, ticker: string, quantity: number, cost: number, marketValue: number | null }[]}
   */
  function valuedPositionsAt(date) {
    const valued = []
    for (const [key, rawPosition] of positionsAt(date)) {
      const [market, account, ticker] = key.split('\t')
      const quantity = Math.max(0, rawPosition.quantity)
      if (!quantity) continue
      const price = latestPrice(market, ticker, date)
      // Quote currency, not the account's market, decides whether FX applies.
      // A US security held in a Korean account is stored under market=KR so its
      // lots stay with that account, while its historical quote is still USD.
      const rate = price?.currency === 'KRW' ? 1 : fxRate(date)
      valued.push({
        market,
        account,
        ticker,
        quantity,
        cost: rawPosition.cost,
        marketValue: price != null && rate != null ? quantity * Number(price.close) * rate : null,
      })
    }
    return valued
  }

  return { latestPrice, fxRate, positionsAt, valuedPositionsAt }
}
