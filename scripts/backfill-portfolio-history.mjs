import Database from 'better-sqlite3'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'
import { valuePortfolio } from './portfolio-snapshot.mjs'

loadLocalEnv()

const dbPath = process.env.STOCK_DB_PATH || path.join(process.cwd(), 'private-data/outputs/stock-portfolio-observatory/stock-portfolio-observatory.db')
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
  const snapshotColumnsPresent = new Set(db.prepare('pragma table_info(portfolio_snapshots)').all().map((column) => column.name))
  for (const column of [
    'priced_base_cost',
    'position_coverage',
    'kr_market_value_coverage',
    'us_market_value_coverage',
    'crypto_market_value_coverage',
  ]) {
    if (!snapshotColumnsPresent.has(column)) db.exec(`alter table portfolio_snapshots add column ${column} real`)
  }
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

  const openLots = db.prepare('select market, account, ticker, acquired_date, currency, open_quantity, native_cost_basis, cost_basis_krw from tax_lots').all()
  const realizedLots = db.prepare('select market, account, ticker, acquired_date, sold_date, quantity_sold, cost_basis_krw from realized_lots').all()
  const dividends = db.prepare('select date, currency, native_amount from dividends').all()
  const historicalPrices = db.prepare('select market, ticker, currency, price_date, close from historical_prices order by market, ticker, price_date').all()
  const historicalFxRates = db.prepare('select price_date, rate from historical_fx_rates order by price_date').all()
  const dates = monthEnds(firstDate, currentDate)
  const currentPositions = db
    .prepare('select market, base_cost as cost, base_market_value as marketValue from holdings where quantity != 0')
    .all()

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

  // Columns as a list, with the placeholders counted from it. Hand-maintaining a
  // parallel run of `?` is a standing trap: adding the four crypto columns to the
  // SQL left the placeholder run one short, and the step died with "24 values for
  // 25 columns" — a failure that only surfaces at run time, after every earlier
  // step has already done its work.
  const snapshotColumns = [
    'snapshot_date', 'captured_at', 'global_base_cost', 'global_base_market_value',
    'global_base_unrealized_gl', 'global_base_return_pct', 'market_value_coverage',
    'priced_base_cost', 'position_coverage', 'kr_market_value_coverage',
    'us_market_value_coverage', 'crypto_market_value_coverage',
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
      const activeOpenLots = openLots.filter((lot) => dateOnly(lot.acquired_date) && dateOnly(lot.acquired_date) <= date)
      const activeRealizedLots = realizedLots.filter(
        (lot) => dateOnly(lot.acquired_date) && dateOnly(lot.acquired_date) <= date && (!lot.sold_date || dateOnly(lot.sold_date) > date)
      )
      const activeDividends = dividends.filter((dividend) => dateOnly(dividend.date) <= date)
      const krwCost = activeOpenLots.filter((lot) => lot.currency === 'KRW').reduce((sum, lot) => sum + Number(lot.native_cost_basis || 0), 0)
      const usdCost = activeOpenLots.filter((lot) => lot.currency === 'USD').reduce((sum, lot) => sum + Number(lot.native_cost_basis || 0), 0)
      const dividendsKrw = activeDividends.filter((row) => row.currency === 'KRW').reduce((sum, row) => sum + Number(row.native_amount || 0), 0)
      const dividendsUsd = activeDividends.filter((row) => row.currency === 'USD').reduce((sum, row) => sum + Number(row.native_amount || 0), 0)
      const positions = positionsAt(date)
      let totalShares = 0
      const valuationPositions = []
      for (const [key, rawPosition] of positions) {
        const [market, , ticker] = key.split('\t')
        const quantity = Math.max(0, rawPosition.quantity)
        if (!quantity) continue
        totalShares += quantity
        const price = latestPrice(market, ticker, date)
        // Quote currency, not the account's market, decides whether FX applies.
        // A US security held in a Korean account is stored under market=KR so its
        // lots stay with that account, while its historical quote is still USD.
        const rate = price?.currency === 'KRW' ? 1 : fxRate(date)
        valuationPositions.push({
          market,
          cost: rawPosition.cost,
          marketValue: price != null && rate != null ? quantity * Number(price.close) * rate : null,
        })
      }
      const valuation = valuePortfolio(valuationPositions)
      const shareCount = totalShares || activeOpenLots.reduce((sum, lot) => sum + Number(lot.open_quantity || 0), 0)
      insert.run(
        date, `${date}T23:59:59.000Z`, valuation.global.totalCost,
        valuation.global.partialMarketValue, valuation.global.unrealizedGl, valuation.global.returnPct,
        valuation.global.costCoverage, valuation.global.pricedCost, valuation.global.positionCoverage,
        valuation.KR.costCoverage, valuation.US.costCoverage, valuation.CRYPTO.costCoverage,
        valuation.KR.partialMarketValue, valuation.US.partialMarketValue, valuation.CRYPTO.partialMarketValue,
        valuation.KR.totalCost, valuation.US.totalCost, valuation.CRYPTO.totalCost,
        valuation.KR.unrealizedGl, valuation.US.unrealizedGl, valuation.CRYPTO.unrealizedGl,
        valuation.KR.returnPct, valuation.US.returnPct, valuation.CRYPTO.returnPct,
        krwCost, usdCost, dividendsKrw, dividendsUsd, valuation.global.positionCount, shareCount
      )
    }
    // A standalone backfill may be the first command run against an older DB.
    // Upgrade its preserved current row too; the normal production refresh has
    // already written these values during ingest, so this is idempotent there.
    const currentValuation = valuePortfolio(currentPositions)
    db.prepare(`
      update portfolio_snapshots set
        global_base_cost = ?, global_base_market_value = ?,
        global_base_unrealized_gl = ?, global_base_return_pct = ?,
        market_value_coverage = ?, priced_base_cost = ?, position_coverage = ?,
        kr_market_value_coverage = ?, us_market_value_coverage = ?, crypto_market_value_coverage = ?,
        kr_market_value = ?, us_market_value_base = ?, crypto_market_value_base = ?,
        kr_cost_basis = ?, us_cost_basis_base = ?, crypto_cost_basis_base = ?,
        kr_unrealized_gl = ?, us_unrealized_gl_base = ?, crypto_unrealized_gl_base = ?,
        kr_return_pct = ?, us_return_pct = ?, crypto_return_pct = ?, holding_count = ?
      where snapshot_date = ?
    `).run(
      currentValuation.global.totalCost, currentValuation.global.partialMarketValue,
      currentValuation.global.unrealizedGl, currentValuation.global.returnPct,
      currentValuation.global.costCoverage, currentValuation.global.pricedCost,
      currentValuation.global.positionCoverage, currentValuation.KR.costCoverage,
      currentValuation.US.costCoverage, currentValuation.CRYPTO.costCoverage,
      currentValuation.KR.partialMarketValue, currentValuation.US.partialMarketValue,
      currentValuation.CRYPTO.partialMarketValue, currentValuation.KR.totalCost,
      currentValuation.US.totalCost, currentValuation.CRYPTO.totalCost,
      currentValuation.KR.unrealizedGl, currentValuation.US.unrealizedGl,
      currentValuation.CRYPTO.unrealizedGl, currentValuation.KR.returnPct,
      currentValuation.US.returnPct, currentValuation.CRYPTO.returnPct,
      currentValuation.global.positionCount, currentDate
    )
  })
  rebuild()
  console.log(`Backfilled ${dates.length} monthly portfolio snapshot(s) from ${firstDate} to ${currentDate}.`)
} finally {
  db.close()
}
