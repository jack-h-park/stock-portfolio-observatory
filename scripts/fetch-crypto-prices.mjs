import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const activityPath = process.env.STOCK_CRYPTO_ACTIVITY_PATH || path.join(process.cwd(), 'data/crypto-activity.json')
const outPath = process.env.STOCK_CRYPTO_PRICES_PATH || path.join(process.cwd(), 'data/crypto-prices.json')
const fxRatesPath = process.env.STOCK_FX_RATES_PATH || path.join(process.cwd(), 'data/fx-rates.json')

// Crypto is priced PER VENUE, not once per symbol.
//
// The same BTC is worth materially different amounts on a Korean won order book
// than on a US dollar one — the Korea premium has run from roughly -3% to +7%
// over the period this portfolio covers. Pricing the Bithumb position from a USD
// quote and an FX rate would therefore be wrong by a margin larger than most
// days' moves, in a direction that changes sign. So each venue's holding is
// marked at the venue's own book: Bithumb's KRW position from Bithumb, the
// Robinhood USD position from a USD quote converted with the same FX snapshot
// every other USD figure in this app uses.
const BITHUMB_SOURCE = 'Bithumb public ticker API'
const BITHUMB_URL = 'https://api.bithumb.com/public/ticker/{symbol}_KRW'
const BITHUMB_CANDLE_URL = 'https://api.bithumb.com/public/candlestick/{symbol}_KRW/24h'
const YAHOO_SOURCE = 'Yahoo Finance chart API'
const YAHOO_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d'
const YAHOO_RANGE_URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={from}&period2={to}&interval=1d'
const YAHOO_HOURLY_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=730d&interval=1h'
// Bithumb's 24h candle closes at midnight KST, which is 15:00 UTC.
const CANDLE_CLOSE_UTC_HOUR = 15
const FX_URL = 'https://api.frankfurter.app/{from}..{to}?from=USD&to=KRW'

function loadActivity() {
  if (!fs.existsSync(activityPath)) return { transactions: [] }
  return JSON.parse(fs.readFileSync(activityPath, 'utf8'))
}

function isoFromMs(ms) {
  const n = Number(ms)
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : ''
}

function isoFromSeconds(seconds) {
  const n = Number(seconds)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : ''
}

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
    if (response.ok) return response.json()
    if (response.status !== 429 && response.status < 500) return null
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
  }
  return null
}

async function fetchBithumb(symbol) {
  const payload = await fetchJson(BITHUMB_URL.replace('{symbol}', encodeURIComponent(symbol)))
  if (payload?.status !== '0000') return null
  const price = Number(payload.data?.closing_price)
  if (!Number.isFinite(price) || price <= 0) return null
  const quotedAt = isoFromMs(payload.data?.date)
  return {
    price,
    currency: 'KRW',
    quotedAt,
    asOfDate: quotedAt.slice(0, 10),
    source: BITHUMB_SOURCE,
    sourceSymbol: `${symbol}_KRW`,
  }
}

async function fetchYahoo(symbol) {
  const pair = `${symbol}-USD`
  const payload = await fetchJson(YAHOO_URL.replace('{symbol}', encodeURIComponent(pair)))
  const meta = payload?.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice)
  // The response must actually be priced in USD. A symbol that resolves to some
  // other listing would otherwise be silently mixed into a USD total.
  if (!meta || meta.currency !== 'USD' || !Number.isFinite(price) || price <= 0) return null
  const quotedAt = isoFromSeconds(meta.regularMarketTime)
  return {
    price,
    currency: 'USD',
    quotedAt,
    asOfDate: quotedAt.slice(0, 10),
    source: YAHOO_SOURCE,
    sourceSymbol: pair,
  }
}

// --- Historical closes for reward valuation -------------------------------
//
// A staking payout arrives as quantity with no cash figure attached: Bithumb's
// 거래금액 column repeats the ETH amount rather than its won value. The lot still
// has a cost basis — its market value on the day it was received, which is also
// the amount that is income — so that day's close has to be looked up.
//
// Robinhood needs none of this: its statement prints the reward's USD value on
// the row, so those lots are already complete.

async function bithumbDailyCloses(symbol) {
  const payload = await fetchJson(BITHUMB_CANDLE_URL.replace('{symbol}', encodeURIComponent(symbol)))
  if (payload?.status !== '0000') return new Map()
  return new Map(
    (payload.data ?? [])
      .map((row) => [isoFromMs(row[0]).slice(0, 10), Number(row[2])])
      .filter(([date, close]) => date && Number.isFinite(close) && close > 0)
  )
}

async function yahooDailyCloses(symbol, fromDate, toDate) {
  const from = Math.floor(Date.parse(`${fromDate}T00:00:00Z`) / 1000)
  const to = Math.floor(Date.parse(`${toDate}T00:00:00Z`) / 1000) + 86400
  const url = YAHOO_RANGE_URL.replace('{symbol}', encodeURIComponent(`${symbol}-USD`))
    .replace('{from}', String(from))
    .replace('{to}', String(to))
  const result = (await fetchJson(url))?.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  return new Map(
    (result?.timestamp ?? [])
      .map((seconds, index) => [isoFromSeconds(seconds).slice(0, 10), Number(closes[index])])
      .filter(([date, close]) => date && Number.isFinite(close) && close > 0)
  )
}

/**
 * USD closes sampled at the same instant Bithumb's daily candle closes.
 *
 * Bithumb's 24h candle for a date closes at 00:00 KST — 15:00 UTC — while
 * Yahoo's daily bar for the same date closes at 00:00 UTC, nine hours later.
 * Comparing the two dailies therefore charges every overnight move to the
 * premium: it put BTC's 200-day range at -7%..+9.6% when the simultaneous spot
 * reading was +0.01%. Hourly bars let both sides be read at 15:00 UTC, so what
 * is left is the venue gap rather than the clock gap.
 *
 * Yahoo serves hourly bars for about 730 days, comfortably longer than the ~200
 * days of candles Bithumb will return.
 */
async function yahooClosesAtCandleBoundary(symbol) {
  const url = YAHOO_HOURLY_URL.replace('{symbol}', encodeURIComponent(`${symbol}-USD`))
  const result = (await fetchJson(url))?.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  const series = new Map()
  ;(result?.timestamp ?? []).forEach((seconds, index) => {
    const at = new Date(Number(seconds) * 1000)
    if (at.getUTCHours() !== CANDLE_CLOSE_UTC_HOUR) return
    const close = Number(closes[index])
    if (!Number.isFinite(close) || close <= 0) return
    series.set(at.toISOString().slice(0, 10), close)
  })
  return series
}

async function usdKrwRates(fromDate, toDate) {
  const payload = await fetchJson(FX_URL.replace('{from}', fromDate).replace('{to}', toDate))
  return new Map(
    Object.entries(payload?.rates ?? {})
      .map(([date, values]) => [date, Number(values.KRW)])
      .filter(([, rate]) => Number.isFinite(rate) && rate > 0)
  )
}

/** Nearest quote at or before `date`, walking back up to a week. */
function onOrBefore(map, date, maxBackDays = 7) {
  const cursor = new Date(`${date}T00:00:00Z`)
  for (let i = 0; i <= maxBackDays; i += 1) {
    const key = cursor.toISOString().slice(0, 10)
    if (map.has(key)) return { value: map.get(key), date: key }
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return null
}

const activity = loadActivity()

// Price what is actually held, not every symbol ever traded: a fully exited
// position needs no quote, and asking for one would report a permanent gap.
const positions = new Map()
for (const row of activity.transactions ?? []) {
  if (row.isCash || !row.symbol) continue
  const key = `${row.venue}\t${row.currency}\t${row.symbol}`
  const quantity = Number(row.quantity ?? 0) * (row.type === 'SELL' && row.venue === 'Bithumb' ? -1 : 1)
  positions.set(key, (positions.get(key) ?? 0) + quantity)
}

const wanted = [...positions.entries()]
  .filter(([, quantity]) => Math.abs(quantity) > 1e-12)
  .map(([key]) => {
    const [venue, currency, symbol] = key.split('\t')
    return { venue, currency, symbol }
  })
  .sort((a, b) => `${a.venue}${a.symbol}`.localeCompare(`${b.venue}${b.symbol}`))

// Both sides of every held symbol, regardless of which venue holds it.
//
// Valuation only needs the venue's own book, but the Korea premium is the gap
// BETWEEN the books, so it cannot be measured from one of them. Fetching both
// here also means the premium is read from the same quotes the positions are
// marked at, rather than from a second set fetched moments later at slightly
// different prices.
const symbols = [...new Set(wanted.map((entry) => entry.symbol))].sort()
const krwQuotes = new Map()
const usdQuotes = new Map()
for (const symbol of symbols) {
  const [krw, usd] = await Promise.all([fetchBithumb(symbol), fetchYahoo(symbol)])
  if (krw) krwQuotes.set(symbol, krw)
  if (usd) usdQuotes.set(symbol, usd)
}

const prices = []
const missing = []
for (const entry of wanted) {
  const quote = entry.currency === 'KRW' ? krwQuotes.get(entry.symbol) : usdQuotes.get(entry.symbol)
  if (!quote) {
    missing.push(entry)
    console.warn(`Crypto price missing: ${entry.venue} ${entry.symbol} (${entry.currency})`)
    continue
  }
  prices.push({ ...entry, ticker: entry.symbol, ...quote })
  console.log(`Crypto price loaded: ${entry.venue} ${entry.symbol} = ${quote.price} ${quote.currency}`)
}

// Reward rows priced in the coin itself, i.e. carrying no cash value of their own.
const rewardDates = new Map()
for (const row of activity.transactions ?? []) {
  if (row.type !== 'REWARD' || row.isCash || !row.symbol || row.currency !== 'KRW') continue
  const key = `${row.venue}\t${row.symbol}`
  if (!rewardDates.has(key)) rewardDates.set(key, new Set())
  rewardDates.get(key).add(row.date)
}

const historical = []
const missingHistorical = []
for (const [key, dates] of rewardDates) {
  const [venue, symbol] = key.split('\t')
  const wantedDates = [...dates].sort()
  const venueCloses = await bithumbDailyCloses(symbol)

  // Bithumb's candlestick endpoint only reaches back ~200 days, and rewards
  // predate that. For the older ones fall back to the USD close converted at
  // that day's FX — a venue-premium error on a reward worth a few thousand won
  // is immaterial, whereas silently dropping the lot's cost basis is not.
  const uncovered = wantedDates.filter((date) => !onOrBefore(venueCloses, date))
  let usdCloses = new Map()
  let fxRates = new Map()
  if (uncovered.length > 0) {
    const from = uncovered[0]
    const to = uncovered[uncovered.length - 1]
    usdCloses = await yahooDailyCloses(symbol, from, to)
    fxRates = await usdKrwRates(from, to)
  }

  for (const date of wantedDates) {
    const venueClose = onOrBefore(venueCloses, date)
    if (venueClose) {
      historical.push({
        venue,
        symbol,
        currency: 'KRW',
        date,
        close: venueClose.value,
        closeDate: venueClose.date,
        source: `${BITHUMB_SOURCE} (candlestick 24h)`,
      })
      continue
    }
    const usd = onOrBefore(usdCloses, date)
    const fx = onOrBefore(fxRates, date)
    if (usd && fx) {
      historical.push({
        venue,
        symbol,
        currency: 'KRW',
        date,
        close: usd.value * fx.value,
        closeDate: usd.date,
        source: `${YAHOO_SOURCE} (${symbol}-USD) × Frankfurter USD/KRW`,
      })
      continue
    }
    missingHistorical.push({ venue, symbol, date })
    console.warn(`Crypto historical close missing: ${venue} ${symbol} ${date}`)
  }
}

// --- Korea premium ---------------------------------------------------------
//
// The gap between a coin's won order book and its dollar order book, expressed
// as a percentage of the dollar price converted at spot FX:
//
//     premium = krwPrice / (usdPrice × usdKrw) - 1
//
// Positive means Korean buyers are paying more than the global price. It is not
// a rounding artifact: over the period this portfolio covers it has run from
// roughly -3% to +7%, which is why the Bithumb position is marked at Bithumb
// rather than at a converted USD quote.
//
// FX comes from data/fx-rates.json — the same snapshot the ingest converts every
// USD figure with, and written earlier in the same refresh. Fetching a fresh rate
// here would let the premium disagree with the portfolio it is measured against.
function loadSpotFx() {
  if (!fs.existsSync(fxRatesPath)) return null
  const document = JSON.parse(fs.readFileSync(fxRatesPath, 'utf8'))
  return (document.rates ?? []).find((rate) => rate.from === 'USD' && rate.to === 'KRW') ?? null
}

const spotFx = loadSpotFx()
const premiumSpot = []
for (const symbol of symbols) {
  const krw = krwQuotes.get(symbol)
  const usd = usdQuotes.get(symbol)
  if (!krw || !usd || !spotFx) continue
  const impliedKrw = usd.price * spotFx.rate
  premiumSpot.push({
    symbol,
    krwPrice: krw.price,
    usdPrice: usd.price,
    fxRate: spotFx.rate,
    impliedKrw,
    premiumPct: (krw.price / impliedKrw - 1) * 100,
    krwAsOfDate: krw.asOfDate,
    usdAsOfDate: usd.asOfDate,
    fxAsOfDate: spotFx.asOfDate,
  })
}
for (const row of premiumSpot) {
  console.log(`Korea premium: ${row.symbol} ${row.premiumPct >= 0 ? '+' : ''}${row.premiumPct.toFixed(2)}%`)
}

// History reaches back only as far as Bithumb's candlestick endpoint does —
// about 200 days. There is no longer KRW series to be had, so the chart is
// bounded by the data rather than by a choice, and says so on the page.
const premiumHistory = []
if (spotFx) {
  for (const symbol of symbols) {
    const krwSeries = await bithumbDailyCloses(symbol)
    const dates = [...krwSeries.keys()].sort()
    if (dates.length === 0) continue
    const usdSeries = await yahooClosesAtCandleBoundary(symbol)
    const fxSeries = await usdKrwRates(dates[0], dates[dates.length - 1])
    for (const date of dates) {
      // Same-day only for the USD leg: a stale close paired with a live KRW one
      // would report a price move as a premium, which is the error this whole
      // alignment exists to remove. FX may reach back — it is a weekday fix, and
      // crypto trades through the weekend.
      const usd = usdSeries.has(date) ? { value: usdSeries.get(date), date } : null
      const fx = onOrBefore(fxSeries, date, 7)
      if (!usd || !fx) continue
      const impliedKrw = usd.value * fx.value
      premiumHistory.push({
        symbol,
        date,
        krwClose: krwSeries.get(date),
        usdClose: usd.value,
        fxRate: fx.value,
        impliedKrw,
        premiumPct: (krwSeries.get(date) / impliedKrw - 1) * 100,
      })
    }
  }
  premiumHistory.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol))
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: `${BITHUMB_SOURCE} (KRW venues), ${YAHOO_SOURCE} (USD venues)`,
      sourceUrl: `${BITHUMB_URL} | ${YAHOO_URL}`,
      prices,
      missing,
      historical,
      missingHistorical,
      premium: { spot: premiumSpot, history: premiumHistory },
    },
    null,
    2
  )}\n`
)
console.log(
  `Wrote ${outPath}: ${prices.length} crypto price(s), ${missing.length} missing, ` +
  `${historical.length} reward-date close(s), ${missingHistorical.length} missing, ` +
  `${premiumSpot.length} premium quote(s), ${premiumHistory.length} premium history point(s)`
)
if (missing.length > 0 || missingHistorical.length > 0) process.exitCode = 1
