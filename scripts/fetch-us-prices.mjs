import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const dataDir = process.env.STOCK_DATA_DIR || path.join(process.cwd(), 'private-data')
const evidencePath = process.env.STOCK_US_PDF_EVIDENCE_PATH || path.join(process.cwd(), 'data/us-pdf-evidence.json')
const outPath = process.env.STOCK_US_PRICES_PATH || path.join(process.cwd(), 'data/us-prices.json')

const usHoldingFiles = [
  path.join(dataDir, '미국증권사 보유종목 현황 (Tax Lot 구분 포함)', 'Chase-taxlots-20260715.csv'),
  path.join(dataDir, '미국증권사 보유종목 현황 (Tax Lot 구분 포함)', 'Merrill-ExportData15072026205306-20260715.csv'),
]

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

  for (const filePath of usHoldingFiles) {
    if (!fs.existsSync(filePath)) continue
    if (filePath.includes('Chase-taxlots')) {
      const rows = readCsvObjects(filePath, (r) => r.includes('Account name') && r.includes('Ticker'))
      for (const row of rows) {
        if (text(row['Asset Class']) === 'Equity' && text(row.Ticker) && text(row.Ticker) !== 'QACDS') tickers.add(text(row.Ticker))
      }
    } else {
      const rows = parseCsv(fs.readFileSync(filePath, 'utf8')).filter((r) => r.some((c) => c.trim()))
      for (const row of rows) {
        const ticker = text(row[1])
        if (/^[A-Z][A-Z0-9. -]{0,12}$/.test(ticker) && Number.isFinite(Number(text(row[2]).replace(/,/g, '')))) {
          tickers.add(ticker)
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
