import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

// FX snapshot for base-currency conversion.
//
// data/fx-rates.json was the one input with no fetcher: the README told you to
// copy the example and edit it by hand. In practice the private-mode file kept
// the SYNTHETIC sample rate (1300) for 203 days, so every global KRW figure was
// understated by ~13% while the dashboard looked fine — /health flagged it as
// stale, but a number nobody edits stays stale.
//
// Same provider and shape as the price snapshots, so all three age together and
// one stale check covers them.

const outPath = process.env.STOCK_FX_RATES_PATH || path.join(process.cwd(), 'data/fx-rates.json')
const baseCurrency = process.env.STOCK_BASE_CURRENCY || 'KRW'
// Currencies held besides the base. Extend when a portfolio adds one.
const quoteCurrencies = (process.env.STOCK_FX_CURRENCIES || 'USD')
  .split(',')
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean)

const SOURCE = 'Yahoo Finance chart API'
const SOURCE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d'

/**
 * Yahoo quotes USD/KRW as the bare `KRW=X`; every other pair is `<FROM><TO>=X`.
 */
function fxSymbol(from, to) {
  return from === 'USD' ? `${to}=X` : `${from}${to}=X`
}

function isoDateFromSeconds(seconds) {
  if (!seconds) return ''
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

async function fetchRate(from, to) {
  const symbol = fxSymbol(from, to)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const json = await res.json()
  const meta = json.chart?.result?.[0]?.meta
  const rate = Number(meta?.regularMarketPrice)
  if (!meta || !Number.isFinite(rate) || rate <= 0) return null
  // The response must actually be priced in the currency we asked for —
  // a wrong-but-plausible rate silently misstates the whole portfolio.
  if (meta.currency && meta.currency.toUpperCase() !== to) return null
  return {
    from,
    to,
    rate: Math.round(rate * 100) / 100,
    asOfDate: isoDateFromSeconds(meta.regularMarketTime),
    source: SOURCE,
    sourceUrl: SOURCE_URL.replace('{symbol}', symbol),
    note: `${from}/${to} spot (${symbol}). Same provider as the price snapshots.`,
  }
}

const rates = []
const missing = []

for (const currency of quoteCurrencies) {
  if (currency === baseCurrency) continue
  const rate = await fetchRate(currency, baseCurrency)
  if (rate) {
    rates.push(rate)
    console.log(`${currency}/${baseCurrency}: ${rate.rate} as of ${rate.asOfDate}`)
  } else {
    missing.push(`${currency}/${baseCurrency}`)
    console.warn(`${currency}/${baseCurrency}: missing`)
  }
}

// The base-to-base identity keeps every consumer on one lookup path instead of
// special-casing "no conversion needed". It is appended LAST on purpose: the
// freshness panel reports rates[0], and an identity rate is always "current",
// so leading with it would mask a stale real rate.
rates.push({
  from: baseCurrency,
  to: baseCurrency,
  rate: 1,
  asOfDate: rates[0]?.asOfDate || new Date().toISOString().slice(0, 10),
  source: 'Identity',
  sourceUrl: '',
  note: 'Base currency',
})

// Never overwrite a good file with a partial one: a half-written FX snapshot
// would silently drop a currency's conversions on the next ingest.
if (missing.length > 0) {
  console.error(`Refusing to write ${outPath}: could not fetch ${missing.join(', ')}. Keeping the existing snapshot.`)
  process.exitCode = 1
} else {
  const output = { baseCurrency, generatedAt: new Date().toISOString(), source: SOURCE, sourceUrl: SOURCE_URL, rates }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`)
  console.log(`Wrote ${outPath}: ${rates.length} rate(s)`)
}
