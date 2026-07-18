import fs from 'node:fs'
import path from 'node:path'

const dataDir = process.env.STOCK_DATA_DIR || path.join(process.cwd(), 'private-data')
const payloadDir = path.join(dataDir, '.codex_sheet_payloads')
const holdingsPath = path.join(payloadDir, 'summary.noapost.tsv')
const outPath = process.env.STOCK_KR_PRICES_PATH || path.join(process.cwd(), 'data/kr-prices.json')

function text(value) {
  return value == null ? '' : String(value).trim()
}

function number(value) {
  const raw = text(value)
  if (!raw || raw.startsWith('=')) return null
  const cleaned = raw.replace(/[$,%]/g, '').replace(/,/g, '').replace(/^\((.*)\)$/, '-$1')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function readTsv(filePath) {
  const body = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim()
  const [header, ...lines] = body.split(/\r?\n/)
  const columns = header.split('\t')
  return lines.filter(Boolean).map((line) => {
    const cells = line.split('\t')
    return Object.fromEntries(columns.map((col, i) => [col, cells[i] ?? '']))
  })
}

function isoDateFromSeconds(seconds) {
  if (!seconds) return ''
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

async function fetchCandidate(ticker, suffix) {
  const symbol = `${ticker}.${suffix}`
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const json = await res.json()
  const meta = json.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice)
  if (!meta || meta.currency !== 'KRW' || !Number.isFinite(price) || price <= 0) return null
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

async function fetchPrice(ticker) {
  const candidates = []
  for (const suffix of ['KS', 'KQ']) {
    const result = await fetchCandidate(ticker, suffix)
    if (result) candidates.push(result)
  }
  if (candidates.length === 0) return null
  const preferredTypes = new Set(['EQUITY', 'ETF'])
  return candidates.sort((a, b) => {
    const typeScore = Number(preferredTypes.has(b.instrumentType)) - Number(preferredTypes.has(a.instrumentType))
    if (typeScore) return typeScore
    return (b.regularMarketTime ?? 0) - (a.regularMarketTime ?? 0)
  })[0]
}

const rows = readTsv(holdingsPath).filter((r) => text(r.Account).toLowerCase() !== 'total')
const tickers = [...new Set(rows.map((r) => text(r.Ticker).replace(/^'/, '')).filter(Boolean))].sort()
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
  note: 'Read-only market price snapshot for KR holdings. Prices are external snapshots and may be delayed.',
  prices,
  missing,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${outPath}: ${prices.length}/${tickers.length} prices`)

if (missing.length > 0) {
  process.exitCode = 1
}
