// gold-price.mjs — parse Naver's KRX gold (M04020000) responses into the
// data/gold-prices.json document. Pure: fetch-gold-price.mjs does the fetching,
// and the tests run these against saved fixtures, never the network.

export const GOLD_CODE = 'M04020000'
export const GOLD_SOURCE = 'Naver Finance KRX gold (M04020000)'
export const GOLD_LATEST_URL = `https://m.stock.naver.com/front-api/marketIndex/productDetail?category=metals&reutersCode=${GOLD_CODE}`
// pageSize below 10 is rejected by the endpoint.
export const GOLD_HISTORY_PAGE_SIZE = 60
/** One page of daily closes, newest first: page 1 is the latest `pageSize` trading days, page 2 the ones before. */
export function goldHistoryUrl(page = 1, pageSize = GOLD_HISTORY_PAGE_SIZE) {
  return `https://m.stock.naver.com/front-api/marketIndex/prices?category=metals&reutersCode=${GOLD_CODE}&page=${page}&pageSize=${Math.max(10, pageSize)}`
}
export const GOLD_HISTORY_URL = goldHistoryUrl(1)
/** How far back a backfill reaches when no purchase is older. */
export const GOLD_BACKFILL_DAYS = 400

/** "177,480" -> 177480. Anything that is not a positive number ("-", "", "0") is null. */
export function parsePrice(value) {
  if (value == null) return null
  const n = Number(String(value).replace(/,/g, '').trim())
  return String(value).trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

const seoulFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The calendar date in Seoul of an ISO timestamp, as YYYY-MM-DD; null if unparseable. */
export function seoulDate(iso) {
  const time = Date.parse(String(iso ?? ''))
  return Number.isFinite(time) ? seoulFormatter.format(new Date(time)) : null
}

/**
 * The current price from the productDetail response, or null.
 *
 * The code and unit are checked, not assumed: a response for the international
 * gold contract (USD per troy ounce) would be a plausible-looking number that
 * misstates the holding by an order of magnitude.
 */
export function parseGoldLatest(json) {
  const r = json?.isSuccess ? json.result : null
  if (!r || typeof r !== 'object') return null
  if (r.reutersCode && r.reutersCode !== GOLD_CODE) return null
  if (r.unit && r.unit !== '원/g') return null
  const price = parsePrice(r.closePrice)
  const date = seoulDate(r.localTradedAt)
  return price != null && date ? { date, price } : null
}

/** Daily closes from the prices response, oldest first, one per date; null if the call failed. */
export function parseGoldHistory(json) {
  if (!json?.isSuccess || !Array.isArray(json.result)) return null
  const byDate = new Map()
  for (const row of json.result) {
    const price = parsePrice(row?.closePrice)
    const date = seoulDate(row?.localTradedAt)
    if (price != null && date) byDate.set(date, price)
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, price]) => ({ date, price }))
}

export function buildGoldPriceDocument({ latest, history, fetchedAt }) {
  return { source: GOLD_SOURCE, code: GOLD_CODE, unit: 'KRW/g', fetchedAt, latest, history }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The stored history and a fetch merged: one price per date, the fetched price
 * winning a date both have, oldest first. A malformed stored row is dropped. The
 * file accumulates this way, so the trend can value grams bought long before
 * the latest page.
 */
export function mergeGoldHistory(existing, fetched) {
  const byDate = new Map()
  for (const row of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(fetched) ? fetched : [])]) {
    const price = Number(row?.price)
    if (ISO_DATE.test(String(row?.date ?? '')) && Number.isFinite(price) && price > 0) byDate.set(row.date, price)
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, price]) => ({ date, price }))
}

function minusDays(date, days) {
  const time = Date.parse(`${date}T00:00:00Z`) - days * 86_400_000
  return new Date(time).toISOString().slice(0, 10)
}

/**
 * Whether to page backwards, and to which date. The target is the earliest gold
 * purchase, but never more than GOLD_BACKFILL_DAYS before today (with no known
 * purchase, that floor). Nothing to do when the stored history already reaches
 * the target.
 */
export function goldBackfillPlan({ history, earliestPurchase, today }) {
  const floor = minusDays(today, GOLD_BACKFILL_DAYS)
  const target = earliestPurchase && earliestPurchase > floor ? earliestPurchase : floor
  const oldest = (Array.isArray(history) ? history : []).map((row) => row?.date).filter((d) => ISO_DATE.test(String(d ?? ''))).sort()[0]
  return oldest && oldest <= target ? null : { target }
}
