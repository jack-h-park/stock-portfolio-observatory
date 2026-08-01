export const MIN_TREND_COST_COVERAGE = 0.9
export const HEALTHY_TREND_COST_COVERAGE = 0.95

export const SNAPSHOT_SERIES_SCOPES = [
  'portfolio:all',
  'asset:securities',
  'listing:KR',
  'listing:US',
  'asset:crypto',
  'venue:BITHUMB',
  'venue:ROBINHOOD_CRYPTO',
]

export function portfolioDate(value = new Date(), timeZone = process.env.STOCK_TIME_ZONE || 'America/Los_Angeles') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function ratio(numerator, denominator, emptyValue = 1) {
  return denominator > 0 ? numerator / denominator : emptyValue
}

function emptyBook() {
  return {
    totalCost: 0,
    pricedCost: 0,
    partialMarketValue: 0,
    positionCount: 0,
    pricedPositionCount: 0,
  }
}

function finishBook(book) {
  const unrealizedGl = book.partialMarketValue - book.pricedCost
  return {
    ...book,
    costCoverage: ratio(book.pricedCost, book.totalCost),
    positionCoverage: ratio(book.pricedPositionCount, book.positionCount),
    unrealizedGl,
    returnPct: book.pricedCost > 0 ? (unrealizedGl / book.pricedCost) * 100 : null,
  }
}

function cryptoVenueScope(position) {
  const account = String(position.account || '').trim().toLowerCase()
  const brokerage = String(position.brokerage || '').trim().toLowerCase()
  if (account === 'bithumb' || brokerage === 'bithumb') return 'venue:BITHUMB'
  if (account === 'robinhood crypto' || brokerage === 'robinhood') return 'venue:ROBINHOOD_CRYPTO'
  return null
}

function scopesForPosition(position) {
  const market = String(position.market || '').toUpperCase()
  if (market === 'CRYPTO') {
    return ['global', 'CRYPTO', 'portfolio:all', 'asset:crypto', cryptoVenueScope(position)].filter(Boolean)
  }
  if (market === 'KR' || market === 'US') {
    return ['global', market, 'portfolio:all', 'asset:securities', `listing:${market}`]
  }
  return []
}

/**
 * Values a portfolio without pretending an unpriced position is worth zero.
 *
 * `marketValue` is nullable. Total cost always includes every position, while
 * G/L and return only compare the priced market value with the corresponding
 * priced cost. This keeps `G/L = market value - cost` algebraically true even
 * when coverage is partial.
 */
export function valuePortfolio(positions) {
  const books = Object.fromEntries(
    ['global', 'KR', 'US', 'CRYPTO', ...SNAPSHOT_SERIES_SCOPES].map((key) => [key, emptyBook()])
  )

  for (const position of positions) {
    const cost = Number(position.cost || 0)
    const marketValue = position.marketValue == null ? null : Number(position.marketValue)
    const priced = marketValue != null && Number.isFinite(marketValue)

    for (const key of scopesForPosition(position)) {
      const book = books[key]
      book.totalCost += cost
      book.positionCount += 1
      if (priced) {
        book.pricedCost += cost
        book.partialMarketValue += marketValue
        book.pricedPositionCount += 1
      }
    }
  }

  return Object.fromEntries(Object.entries(books).map(([key, book]) => [key, finishBook(book)]))
}

export function snapshotSeriesRows(snapshotDate, capturedAt, valuation, fx = null) {
  return SNAPSHOT_SERIES_SCOPES.map((scopeKey) => {
    const book = valuation[scopeKey]
    return {
      snapshot_date: snapshotDate,
      captured_at: capturedAt,
      scope_key: scopeKey,
      total_cost: book.totalCost,
      priced_cost: book.pricedCost,
      market_value: book.partialMarketValue,
      unrealized_gl: book.unrealizedGl,
      return_pct: book.returnPct,
      cost_coverage: book.costCoverage,
      position_coverage: book.positionCoverage,
      position_count: book.positionCount,
      priced_position_count: book.pricedPositionCount,
      fx_rate: fx?.rate ?? null,
      fx_as_of_date: fx?.asOfDate ?? null,
      fx_source: fx?.source ?? null,
    }
  })
}
