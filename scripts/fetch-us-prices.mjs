import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'
import { readUsHoldingTickers, resolveUsHoldingFiles } from './source-files.mjs'

loadLocalEnv()

const dataDir = process.env.STOCK_DATA_DIR || path.join(process.cwd(), 'private-data')
const evidencePath = process.env.STOCK_US_PDF_EVIDENCE_PATH || path.join(process.cwd(), 'data/us-pdf-evidence.json')
const outPath = process.env.STOCK_US_PRICES_PATH || path.join(process.cwd(), 'data/us-prices.json')

// Same resolver the ingest uses, so a re-downloaded holdings export is priced
// from the current file rather than a stale hardcoded name. Entries are
// { brokerage, filename }.
const usHoldingFiles = resolveUsHoldingFiles(dataDir).files

function text(value) {
  return value == null ? '' : String(value).trim()
}

function yahooSymbol(ticker) {
  const raw = text(ticker).toUpperCase()
  if (raw === 'BRKB') return 'BRK-B'
  return raw.replace('.', '-')
}

function isoDateFromSeconds(seconds) {
  if (!seconds) return ''
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

function collectTickers() {
  // One shared reader for the holdings files, in source-files.mjs beside the
  // resolver. This used to be a second copy of the ingest's parsing, and the
  // copy read Merrill by fixed column offsets — correct for the tax-lot layout,
  // and the description column of the flat one. A flat export therefore asked
  // Yahoo for `JPMORGAN`, `SCHWAB`, `INVESCO` and `ML`, and the four misses
  // exited non-zero and failed the whole refresh before the ingest ran.
  const tickers = new Set(readUsHoldingTickers(usHoldingFiles))

  if (fs.existsSync(evidencePath)) {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
    for (const report of evidence.reports ?? []) {
      for (const lot of report.lots ?? []) {
        if (text(lot.ticker)) tickers.add(text(lot.ticker))
      }
    }
  }

  return [...tickers].sort()
}

async function fetchPrice(ticker) {
  const symbol = yahooSymbol(ticker)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const json = await res.json()
  const meta = json.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice)
  if (!meta || meta.currency !== 'USD' || !Number.isFinite(price) || price <= 0) return null
  return {
    ticker,
    symbol,
    price,
    currency: meta.currency,
    exchangeName: meta.exchangeName ?? '',
    instrumentType: meta.instrumentType ?? '',
    asOfDate: isoDateFromSeconds(meta.regularMarketTime),
    regularMarketTime: meta.regularMarketTime ?? null,
    shortName: meta.shortName ?? '',
    longName: meta.longName ?? '',
  }
}

const tickers = collectTickers()
const prices = []
const missing = []

for (const ticker of tickers) {
  const price = await fetchPrice(ticker)
  if (price) {
    prices.push(price)
    console.log(`${ticker}: ${price.price} ${price.symbol}`)
  } else {
    missing.push(ticker)
    console.warn(`${ticker}: missing`)
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  source: 'Yahoo Finance chart API',
  sourceUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d',
  note: 'Read-only market price snapshot for US holdings. Prices are external snapshots and may be delayed.',
  prices,
  missing,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${outPath}: ${prices.length}/${tickers.length} prices`)

if (missing.length > 0) {
  process.exitCode = 1
}
