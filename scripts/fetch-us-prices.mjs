import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'
import { resolveUsHoldingFiles } from './source-files.mjs'

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

function parseCsv(body) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const src = body.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    const next = src[i + 1]
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n') {
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    rows.push(row)
  }
  return rows
}

function readCsvObjects(filePath, headerMatcher) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'))
  const headerIndex = rows.findIndex(headerMatcher)
  if (headerIndex < 0) return []
  const header = rows[headerIndex].map((h) => h.trim())
  return rows
    .slice(headerIndex + 1)
    .filter((r) => r.some((c) => c.trim().length > 0))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
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
  const tickers = new Set()

  // Mirror the ingest's holdings filters so every position that gets ingested
  // also gets priced: keep Chase's non-cash "Alternative Assets" (gold/covered-
  // call ETFs), and read the leading symbol out of Merrill's annotated ticker
  // cell ("JEPI !  Executed Buy").
  const NON_POSITION_CLASSES = new Set(['Cash & Money Market Funds', 'Cash and Money Market Funds'])
  for (const { brokerage, filename } of usHoldingFiles) {
    if (!fs.existsSync(filename)) continue
    if (brokerage === 'Chase') {
      const rows = readCsvObjects(filename, (r) => r.includes('Account name') && r.includes('Ticker'))
      for (const row of rows) {
        const ticker = text(row.Ticker)
        if (ticker && ticker !== 'QACDS' && !NON_POSITION_CLASSES.has(text(row['Asset Class']))) tickers.add(ticker)
      }
    } else {
      const rows = parseCsv(fs.readFileSync(filename, 'utf8')).filter((r) => r.some((c) => c.trim()))
      for (const row of rows) {
        const symbol = /^([A-Z][A-Z0-9.-]{0,11})\b/.exec(text(row[1]))?.[1]
        if (symbol && Number.isFinite(Number(text(row[2]).replace(/,/g, '')))) {
          tickers.add(symbol)
        }
      }
    }
  }

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
