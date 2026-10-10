import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'
import { GOLD_HISTORY_URL, GOLD_LATEST_URL, buildGoldPriceDocument, parseGoldHistory, parseGoldLatest } from './gold-price.mjs'

loadLocalEnv()

// KRX gold price (M04020000, KRW per gram) for the 미래에셋 금현물 holding.
//
// The ingest marks the grams held at `latest.price`; with no file it values the
// holding at cost and says so in `gold_priced`. Like fetch-fx-rates, a failed or
// partial fetch never overwrites a good file: the previous snapshot stays, the
// step exits non-zero, and refresh treats it as optional.

const outPath = process.env.STOCK_GOLD_PRICES_PATH || path.join(process.cwd(), 'data/gold-prices.json')

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return { json: await res.json() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const latestResponse = await getJson(GOLD_LATEST_URL)
const historyResponse = await getJson(GOLD_HISTORY_URL)
const latest = latestResponse.json ? parseGoldLatest(latestResponse.json) : null
const history = historyResponse.json ? parseGoldHistory(historyResponse.json) : null

const problems = [
  !latest && `current price: ${latestResponse.error ?? 'unexpected response shape, code or unit'}`,
  !history && `history: ${historyResponse.error ?? 'unexpected response shape'}`,
].filter(Boolean)

if (problems.length) {
  console.error(`Refusing to write ${outPath}: ${problems.join('; ')}. Keeping the existing snapshot.`)
  process.exitCode = 1
} else {
  const doc = buildGoldPriceDocument({ latest, history, fetchedAt: new Date().toISOString() })
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`KRX gold: ${latest.price} KRW/g as of ${latest.date}; ${history.length} daily close(s). Wrote ${outPath}`)
}
