// gold-price.mjs — parse Naver's KRX gold (M04020000) responses into the
// data/gold-prices.json document. Pure: fetch-gold-price.mjs does the fetching,
// and the tests run these against saved fixtures, never the network.

export const GOLD_CODE = 'M04020000'
export const GOLD_SOURCE = 'Naver Finance KRX gold (M04020000)'
export const GOLD_LATEST_URL = `https://m.stock.naver.com/front-api/marketIndex/productDetail?category=metals&reutersCode=${GOLD_CODE}`
// pageSize below 10 is rejected by the endpoint.
export const GOLD_HISTORY_URL = `https://m.stock.naver.com/front-api/marketIndex/prices?category=metals&reutersCode=${GOLD_CODE}&page=1&pageSize=60`

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
