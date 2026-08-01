import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const dbPath = process.env.STOCK_DB_PATH || path.join(process.cwd(), 'private-data/outputs/stock-portfolio-observatory/stock-portfolio-observatory.db')
const pricesPath = process.env.STOCK_HISTORICAL_PRICES_PATH || path.join(process.cwd(), 'data/historical-prices.json')
const fxPath = process.env.STOCK_HISTORICAL_FX_RATES_PATH || path.join(process.cwd(), 'data/historical-fx-rates.json')
const manualMappingsPath = process.env.STOCK_MANUAL_MAPPINGS_PATH || path.join(process.cwd(), 'data/manual-mappings.json')
const tossSnapshotPath = process.env.STOCK_TOSS_SNAPSHOT_PATH || path.join(process.cwd(), 'data/toss-snapshot.json')
if (!process.env.FORCE_HISTORICAL_PRICES && fs.existsSync(pricesPath)) {
  const ageMs = Date.now() - fs.statSync(pricesPath).mtimeMs
  const existing = JSON.parse(fs.readFileSync(pricesPath, 'utf8'))
  if (ageMs < 20 * 60 * 60 * 1000 && Number(existing.valuationVersion || 0) >= 2) {
    console.log(`Historical prices are current (${Math.round(ageMs / 3600000)}h old); skipping full refetch.`)
    process.exit(0)
  }
}
const db = new Database(dbPath, { readonly: true, fileMustExist: true })

function dateOnly(value) {
  return String(value ?? '').slice(0, 10)
}

function yahooSymbol(ticker) {
  const raw = String(ticker ?? '').toUpperCase()
  if (raw === 'BRKB') return 'BRK-B'
  return raw.replace('.', '-')
}

function isoDate(seconds) {
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 10)
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

function rowsFromYahoo(result, market, ticker, symbol) {
  const timestamps = result?.timestamp ?? []
  const quote = result?.indicators?.quote?.[0]?.close ?? []
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose ?? []
  const currency = String(result?.meta?.currency ?? (market === 'KR' ? 'KRW' : 'USD'))
  return timestamps
    .map((timestamp, index) => ({
      market,
      ticker,
      symbol,
      currency,
      price_date: isoDate(timestamp),
      close: Number(quote[index]),
      adj_close: Number(adjusted[index]),
      source: 'Yahoo Finance chart API',
    }))
    .filter((row) => Number.isFinite(row.close) && row.close > 0)
}

async function fetchTicker(ticker, market, quoteMarket, quoteTicker, startDate, endDate) {
  const start = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000)
  const end = Math.floor(Date.parse(`${endDate}T00:00:00Z`) / 1000)
  // Crypto history is fetched in USD for every venue, including the KRW one.
  //
  // The current valuation marks each venue at its own order book, because the
  // Korea premium is large enough to matter on today's number. History cannot
  // work that way: Bithumb's candlestick endpoint reaches back about 200 days,
  // far short of this portfolio's start, so a KRW series simply does not exist
  // to fetch. USD close × that day's FX is the only complete series available,
  // and a premium-sized error on a trend chart is a fair trade for one that
  // starts at the beginning.
  const symbols =
    quoteMarket === 'KR' ? [`${quoteTicker}.KS`, `${quoteTicker}.KQ`] : quoteMarket === 'CRYPTO' ? [`${quoteTicker}-USD`] : [yahooSymbol(quoteTicker)]
  for (const symbol of symbols) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d&events=history`
    const payload = await fetchJson(url)
    const result = payload?.chart?.result?.[0]
    if (!result) continue
    const rows = rowsFromYahoo(result, market, ticker, symbol)
    if (rows.length > 0 && (quoteMarket !== 'KR' || result.meta?.currency === 'KRW')) return rows
  }
  return []
}

try {
  const transactions = db.prepare('select market, ticker, min(date) as first_date, max(date) as last_date from transactions where ticker is not null and ticker != \'\' group by market, ticker order by market, ticker').all()
  const holdings = db.prepare('select distinct market, ticker from holdings where ticker is not null and ticker != \'\'').all()
  const currentHoldingKeys = new Set(holdings.map((row) => `${row.market}:${row.ticker}`))
  // Account market and quote market are different dimensions. Korean statements
  // contain US securities; keep their stored market/account identity but fetch
  // the quote as USD and let the backfill apply historical FX from its currency.
  const isKrxCode = (ticker) => /^[0-9A-Z]{6}$/.test(String(ticker).toUpperCase());
  const isUsTicker = (ticker) => /^[A-Z][A-Z.]{0,4}$/.test(String(ticker).toUpperCase())
  const mappings = fs.existsSync(manualMappingsPath) ? JSON.parse(fs.readFileSync(manualMappingsPath, 'utf8')) : {}
  const aliases = new Map(
    (mappings.instrumentAliases ?? []).map((item) => [String(item.from ?? '').toUpperCase(), {
      ticker: String(item.to ?? ''),
      market: String(item.quoteMarket ?? 'US').toUpperCase(),
    }])
  )
  if (fs.existsSync(tossSnapshotPath)) {
    const toss = JSON.parse(fs.readFileSync(tossSnapshotPath, 'utf8'))
    for (const account of toss.accounts ?? []) {
      for (const security of account.securities ?? []) {
        if (security.isinCode && security.symbol) {
          aliases.set(String(security.isinCode).toUpperCase(), {
            ticker: String(security.symbol),
            market: isKrxCode(security.symbol) ? 'KR' : 'US',
          })
        }
      }
    }
  }
  const skipped = [];
  const tickerMap = new Map(
    [...transactions, ...holdings]
      .filter((row) => String(row.ticker).toUpperCase() !== 'QACDS')
      .map((row) => {
        const ticker = String(row.ticker)
        const alias = aliases.get(ticker.toUpperCase())
        const quote = alias ?? (row.market !== 'KR'
          ? { ticker, market: row.market }
          : isKrxCode(ticker)
            ? { ticker, market: 'KR' }
            : isUsTicker(ticker)
              ? { ticker, market: 'US' }
              : null)
        if (!quote) skipped.push(ticker)
        return quote ? { ...row, quoteTicker: quote.ticker, quoteMarket: quote.market } : null
      })
      .filter(Boolean)
      .map((row) => [`${row.market}:${row.ticker}`, row])
  )
  if (skipped.length) {
    // Named, not silent: these are real securities whose history this feed will
    // never carry, and a reader counting rows should know why they are absent.
    console.error(
      `[historical] skipping ${new Set(skipped).size} non-KRX instrument(s) held in Korean accounts ` +
      `(no quote alias exists for them): ${[...new Set(skipped)].sort().join(', ')}`
    )
  }
  const firstDate = dateOnly(transactions.reduce((min, row) => (!min || row.first_date < min ? row.first_date : min), ''))
  const endDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const prices = []
  const missing = []
  const entries = [...tickerMap.values()]
  for (let index = 0; index < entries.length; index += 1) {
    const row = entries[index]
    const result = await fetchTicker(String(row.ticker), String(row.market), String(row.quoteMarket), String(row.quoteTicker), firstDate, endDate)
    if (result.length === 0) {
      missing.push({ market: row.market, ticker: row.ticker, currentHolding: currentHoldingKeys.has(`${row.market}:${row.ticker}`) })
      console.warn(`Historical price missing: ${row.market} ${row.ticker}`)
    } else {
      prices.push(...result)
      console.log(`Historical price loaded: ${row.market} ${row.ticker} (${result.length} rows)`)
    }
  }

  const fxUrl = `https://api.frankfurter.app/${firstDate}..${endDate}?from=USD&to=KRW`
  const fxPayload = await fetchJson(fxUrl)
  const fxRates = Object.entries(fxPayload?.rates ?? {})
    .map(([price_date, values]) => ({ price_date, rate: Number(values.KRW), source: 'Frankfurter API' }))
    .filter((row) => Number.isFinite(row.rate) && row.rate > 0)

  const missingCurrentHoldings = missing.filter((row) => row.currentHolding)
  if (missingCurrentHoldings.length > 0 || fxRates.length === 0) {
    console.error(
      `Historical refresh incomplete (${missingCurrentHoldings.length} current holding price miss(es), ${fxRates.length} FX row(s)); preserving the previous complete snapshot.`
    )
    process.exitCode = 1
  } else {
    fs.mkdirSync(path.dirname(pricesPath), { recursive: true })
    fs.writeFileSync(pricesPath, `${JSON.stringify({ valuationVersion: 2, generatedAt: new Date().toISOString(), startDate: firstDate, endDate, prices, missing }, null, 2)}\n`)
    fs.writeFileSync(fxPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), startDate: firstDate, endDate, rates: fxRates }, null, 2)}\n`)
    console.log(`Wrote ${pricesPath}: ${prices.length} historical price rows, ${missing.length} missing tickers`)
    console.log(`Wrote ${fxPath}: ${fxRates.length} historical FX rows`)
  }
} finally {
  db.close()
}
