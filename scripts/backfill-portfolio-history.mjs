import Database from 'better-sqlite3'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const dbPath = process.env.STOCK_DB_PATH || path.join(process.cwd(), 'outputs/stock-portfolio-observatory/stock-portfolio-observatory.db')
const db = new Database(dbPath)

function dateOnly(value) {
  return String(value ?? '').slice(0, 10)
}

function monthEnds(firstDate, lastDate) {
  const first = new Date(`${firstDate}T00:00:00Z`)
  const last = new Date(`${lastDate}T00:00:00Z`)
  const dates = []
  let cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1))
  while (cursor <= last) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0))
    if (monthEnd >= first && monthEnd < last) dates.push(monthEnd.toISOString().slice(0, 10))
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  }
  return dates
}

try {
  const current = db.prepare('select max(snapshot_date) as date from portfolio_snapshots').get()
  const first = db.prepare(`
    select min(date) as date from (
      select acquired_date as date from tax_lots
      union all
      select acquired_date as date from realized_lots
    ) where date is not null
  `).get()
  const firstDate = dateOnly(first?.date)
  const currentDate = dateOnly(current?.date)
  if (!firstDate || !currentDate) throw new Error('Cannot determine portfolio history date range.')

  const openLots = db.prepare('select market, ticker, acquired_date, currency, open_quantity, native_cost_basis, cost_basis_krw from tax_lots').all()
  const realizedLots = db.prepare('select market, ticker, acquired_date, sold_date, quantity_sold, cost_basis_krw from realized_lots').all()
  const dividends = db.prepare('select date, currency, native_amount from dividends').all()
  const historicalPrices = db.prepare('select market, ticker, price_date, close from historical_prices order by market, ticker, price_date').all()
  const historicalFxRates = db.prepare('select price_date, rate from historical_fx_rates order by price_date').all()
  const dates = monthEnds(firstDate, currentDate)

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
      result = Number(row.close)
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

  function positionsAt(date) {
    const positions = new Map()
    for (const lot of openLots) {
      if (dateOnly(lot.acquired_date) > date) continue
      const key = `${lot.market}:${lot.ticker}`
      positions.set(key, (positions.get(key) ?? 0) + Number(lot.open_quantity || 0))
    }
    for (const lot of realizedLots) {
      if (dateOnly(lot.acquired_date) > date || (lot.sold_date && dateOnly(lot.sold_date) <= date)) continue
      const key = `${lot.market}:${lot.ticker}`
      positions.set(key, (positions.get(key) ?? 0) + Number(lot.quantity_sold || 0))
    }
    return positions
  }

  // Columns as a list, with the placeholders counted from it. Hand-maintaining a
  // parallel run of `?` is a standing trap: adding the four crypto columns to the
  // SQL left the placeholder run one short, and the step died with "24 values for
  // 25 columns" — a failure that only surfaces at run time, after every earlier
  // step has already done its work.
  const snapshotColumns = [
    'snapshot_date', 'captured_at', 'global_base_cost', 'global_base_market_value',
    'global_base_unrealized_gl', 'global_base_return_pct', 'market_value_coverage',
    'kr_market_value', 'us_market_value_base', 'crypto_market_value_base',
    'kr_cost_basis', 'us_cost_basis_base', 'crypto_cost_basis_base',
    'kr_unrealized_gl', 'us_unrealized_gl_base', 'crypto_unrealized_gl_base',
    'kr_return_pct', 'us_return_pct', 'crypto_return_pct',
    'krw_cost', 'usd_cost', 'dividends_krw', 'dividends_usd', 'holding_count', 'share_count',
  ]
  const insert = db.prepare(`
    insert or replace into portfolio_snapshots (${snapshotColumns.join(', ')})
    values (${snapshotColumns.map(() => '?').join(', ')})
  `)

  const rebuild = db.transaction(() => {
    db.prepare('delete from portfolio_snapshots where snapshot_date < ?').run(currentDate)
    for (const date of dates) {
      const activeOpenLots = openLots.filter((lot) => dateOnly(lot.acquired_date) <= date)
      const activeRealizedLots = realizedLots.filter(
        (lot) => dateOnly(lot.acquired_date) <= date && (!lot.sold_date || dateOnly(lot.sold_date) > date)
      )
      const activeDividends = dividends.filter((dividend) => dateOnly(dividend.date) <= date)
      const globalCost = activeOpenLots.reduce((sum, lot) => sum + Number(lot.cost_basis_krw || 0), 0) + activeRealizedLots.reduce((sum, lot) => sum + Number(lot.cost_basis_krw || 0), 0)
      const lotsByMarket = (market) => [...activeOpenLots, ...activeRealizedLots].filter((lot) => lot.market === market)
      const krCost = lotsByMarket('KR').reduce((sum, lot) => sum + Number(lot.cost_basis_krw || 0), 0)
      const usCost = lotsByMarket('US').reduce((sum, lot) => sum + Number(lot.cost_basis_krw || 0), 0)
      const cryptoCost = lotsByMarket('CRYPTO').reduce((sum, lot) => sum + Number(lot.cost_basis_krw || 0), 0)
      const krwCost = activeOpenLots.filter((lot) => lot.currency === 'KRW').reduce((sum, lot) => sum + Number(lot.native_cost_basis || 0), 0)
      const usdCost = activeOpenLots.filter((lot) => lot.currency === 'USD').reduce((sum, lot) => sum + Number(lot.native_cost_basis || 0), 0)
      const dividendsKrw = activeDividends.filter((row) => row.currency === 'KRW').reduce((sum, row) => sum + Number(row.native_amount || 0), 0)
      const dividendsUsd = activeDividends.filter((row) => row.currency === 'USD').reduce((sum, row) => sum + Number(row.native_amount || 0), 0)
      const positions = positionsAt(date)
      let marketValue = 0
      let pricedShares = 0
      let totalShares = 0
      const marketValues = { KR: 0, US: 0, CRYPTO: 0 }
      const pricedSharesByMarket = { KR: 0, US: 0, CRYPTO: 0 }
      const totalSharesByMarket = { KR: 0, US: 0, CRYPTO: 0 }
      for (const [key, rawQuantity] of positions) {
        const [market, ticker] = key.split(':')
        const quantity = Math.max(0, rawQuantity)
        if (!quantity) continue
        totalShares += quantity
        totalSharesByMarket[market] += quantity
        const price = latestPrice(market, ticker, date)
        // Everything but the KR book is quoted in USD here — crypto included, for
        // the reason given in fetch-historical-prices.mjs. Testing for 'US' alone
        // would have valued the whole crypto position at 1 KRW per dollar.
        const rate = market === 'KR' ? 1 : fxRate(date)
        if (price != null && rate != null) {
          marketValue += quantity * price * rate
          pricedShares += quantity
          marketValues[market] += quantity * price * rate
          pricedSharesByMarket[market] += quantity
        }
      }
      const coverage = totalShares > 0 ? pricedShares / totalShares : 0
      const completeMarketValue = coverage >= 0.9 ? marketValue : null
      const unrealized = completeMarketValue == null ? null : completeMarketValue - globalCost
      const returnPct = unrealized == null || globalCost <= 0 ? null : (unrealized / globalCost) * 100
      const krCoverage = totalSharesByMarket.KR > 0 ? pricedSharesByMarket.KR / totalSharesByMarket.KR : 0
      const usCoverage = totalSharesByMarket.US > 0 ? pricedSharesByMarket.US / totalSharesByMarket.US : 0
      const krMarketValue = krCoverage >= 0.9 ? marketValues.KR : null
      const usMarketValueBase = usCoverage >= 0.9 ? marketValues.US : null
      const krUnrealized = krMarketValue == null ? null : krMarketValue - krCost
      const usUnrealized = usMarketValueBase == null ? null : usMarketValueBase - usCost
      const krReturn = krUnrealized == null || krCost <= 0 ? null : (krUnrealized / krCost) * 100
      const usReturn = usUnrealized == null || usCost <= 0 ? null : (usUnrealized / usCost) * 100
      const cryptoCoverage = totalSharesByMarket.CRYPTO > 0 ? pricedSharesByMarket.CRYPTO / totalSharesByMarket.CRYPTO : 0
      const cryptoMarketValueBase = cryptoCoverage >= 0.9 ? marketValues.CRYPTO : null
      const cryptoUnrealized = cryptoMarketValueBase == null ? null : cryptoMarketValueBase - cryptoCost
      const cryptoReturn = cryptoUnrealized == null || cryptoCost <= 0 ? null : (cryptoUnrealized / cryptoCost) * 100
      const shareCount = totalShares || activeOpenLots.reduce((sum, lot) => sum + Number(lot.open_quantity || 0), 0)
      insert.run(date, `${date}T23:59:59.000Z`, globalCost, completeMarketValue, unrealized, returnPct, coverage, krMarketValue, usMarketValueBase, cryptoMarketValueBase, krCost, usCost, cryptoCost, krUnrealized, usUnrealized, cryptoUnrealized, krReturn, usReturn, cryptoReturn, krwCost, usdCost, dividendsKrw, dividendsUsd, positions.size, shareCount)
    }
  })
  rebuild()
  console.log(`Backfilled ${dates.length} monthly portfolio snapshot(s) from ${firstDate} to ${currentDate}.`)
} finally {
  db.close()
}
