import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { loadLocalEnv } from './env.mjs'
import {
  GOLD_LATEST_URL,
  buildGoldPriceDocument,
  goldBackfillPlan,
  goldHistoryUrl,
  mergeGoldHistory,
  parseGoldHistory,
  parseGoldLatest,
  seoulDate,
} from './gold-price.mjs'

loadLocalEnv()

// KRX gold price (M04020000, KRW per gram) for the 미래에셋 금현물 holding.
//
// The ingest marks the grams held at `latest.price` and stores `history` for the
// total-assets trend; with no file it values the holding at cost and says so in
// `gold_priced`. Like fetch-fx-rates, a failed or partial fetch never overwrites
// a good file: the previous snapshot stays, the step exits non-zero, and refresh
// treats it as optional.
//
// History accumulates: each run merges the latest page into the stored history,
// one price per date. On the first run, or while the stored history starts after
// the earliest gold purchase, it also pages backwards until it reaches that
// purchase or 400 days, whichever is nearer.

const outPath = process.env.STOCK_GOLD_PRICES_PATH || path.join(process.cwd(), 'data/gold-prices.json')
const dbPath =
  process.env.STOCK_DB_PATH || path.join(process.cwd(), 'private-data/outputs/stock-portfolio-observatory/stock-portfolio-observatory.db')
const MAX_BACKFILL_PAGES = 20

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return { json: await res.json() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function readExisting() {
  try {
    return fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null
  } catch {
    return null
  }
}

/** The first gold purchase on file, from the last ingest; null without a database. */
function earliestGoldPurchase() {
  if (!fs.existsSync(dbPath)) return null
  let db
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db
      .prepare("select min(substr(date, 1, 10)) as date from transactions_all where asset_class = 'gold' and type = 'BUY'")
      .get()
    return row?.date ?? null
  } catch {
    return null
  } finally {
    db?.close()
  }
}

const latestResponse = await getJson(GOLD_LATEST_URL)
const historyResponse = await getJson(goldHistoryUrl(1))
const latest = latestResponse.json ? parseGoldLatest(latestResponse.json) : null
const fetched = historyResponse.json ? parseGoldHistory(historyResponse.json) : null

const problems = [
  !latest && `current price: ${latestResponse.error ?? 'unexpected response shape, code or unit'}`,
  !fetched && `history: ${historyResponse.error ?? 'unexpected response shape'}`,
].filter(Boolean)

if (problems.length) {
  console.error(`Refusing to write ${outPath}: ${problems.join('; ')}. Keeping the existing snapshot.`)
  process.exitCode = 1
} else {
  let history = mergeGoldHistory(readExisting()?.history, fetched)
  const plan = goldBackfillPlan({ history, earliestPurchase: earliestGoldPurchase(), today: seoulDate(new Date().toISOString()) })
  let pages = 1
  if (plan) {
    // A failed or empty page ends the backfill; what was fetched so far is kept.
    for (let page = 2; page <= MAX_BACKFILL_PAGES && history[0]?.date > plan.target; page += 1) {
      const response = await getJson(goldHistoryUrl(page))
      const older = response.json ? parseGoldHistory(response.json) : null
      if (!older?.length) {
        if (!older) console.error(`Gold history page ${page}: ${response.error ?? 'unexpected response shape'}; stopping the backfill.`)
        break
      }
      const before = history[0]?.date
      history = mergeGoldHistory(history, older)
      pages = page
      if (history[0]?.date === before) break
    }
  }
  const doc = buildGoldPriceDocument({ latest, history, fetchedAt: new Date().toISOString() })
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(
    `KRX gold: ${latest.price} KRW/g as of ${latest.date}; ${history.length} daily close(s) from ${history[0]?.date ?? '-'}` +
      `${plan ? ` (backfill to ${plan.target}, ${pages} page(s))` : ''}. Wrote ${outPath}`
  )
}
