export const MIN_TREND_COST_COVERAGE = 0.9
export const HEALTHY_TREND_COST_COVERAGE = 0.95

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

/**
 * Values a portfolio without pretending an unpriced position is worth zero.
 *
 * `marketValue` is nullable. Total cost always includes every position, while
 * G/L and return only compare the priced market value with the corresponding
 * priced cost. This keeps `G/L = market value - cost` algebraically true even
 * when coverage is partial.
 */
export function valuePortfolio(positions) {
  const books = {
    global: emptyBook(),
    KR: emptyBook(),
    US: emptyBook(),
    CRYPTO: emptyBook(),
  }

  for (const position of positions) {
    const market = String(position.market || '')
    if (!(market in books) || market === 'global') continue
    const cost = Number(position.cost || 0)
    const marketValue = position.marketValue == null ? null : Number(position.marketValue)
    const priced = marketValue != null && Number.isFinite(marketValue)

    for (const key of ['global', market]) {
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
