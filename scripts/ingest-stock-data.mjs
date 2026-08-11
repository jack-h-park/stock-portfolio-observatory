import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { loadLocalEnv } from './env.mjs'
import { portfolioDate, valuePortfolio } from './portfolio-snapshot.mjs'
import { resolveCryptoFiles, resolveUsHoldingFiles, resolveUsTransactionFiles } from './source-files.mjs'

loadLocalEnv()

const now = new Date().toISOString()
const snapshotDate = portfolioDate(new Date(now))

const dataDir = process.env.STOCK_DATA_DIR || path.join(process.cwd(), 'private-data')
const payloadDir = path.join(dataDir, '.codex_sheet_payloads')
const outDir = path.join(dataDir, 'outputs/stock-portfolio-observatory')
const dbPath = process.env.STOCK_DB_PATH || path.join(outDir, 'stock-portfolio-observatory.db')
const fxRatesPath = process.env.STOCK_FX_RATES_PATH || path.join(process.cwd(), 'data/fx-rates.json')
const krPricesPath = process.env.STOCK_KR_PRICES_PATH || path.join(process.cwd(), 'data/kr-prices.json')
const usPricesPath = process.env.STOCK_US_PRICES_PATH || path.join(process.cwd(), 'data/us-prices.json')
const historicalPricesPath = process.env.STOCK_HISTORICAL_PRICES_PATH || path.join(process.cwd(), 'data/historical-prices.json')
const historicalFxRatesPath = process.env.STOCK_HISTORICAL_FX_RATES_PATH || path.join(process.cwd(), 'data/historical-fx-rates.json')
const usPdfEvidencePath = process.env.STOCK_US_PDF_EVIDENCE_PATH || path.join(process.cwd(), 'data/us-pdf-evidence.json')
const robinhoodSnapshotPath =
  process.env.STOCK_ROBINHOOD_SNAPSHOT_PATH || path.join(process.cwd(), 'data/robinhood-snapshot.json')
const cryptoActivityPath = process.env.STOCK_CRYPTO_ACTIVITY_PATH || path.join(process.cwd(), 'data/crypto-activity.json')
const cryptoPricesPath = process.env.STOCK_CRYPTO_PRICES_PATH || path.join(process.cwd(), 'data/crypto-prices.json')
const manualMappingsPath = process.env.STOCK_MANUAL_MAPPINGS_PATH || path.join(process.cwd(), 'data/manual-mappings.json')
const refreshRunsPath = process.env.STOCK_REFRESH_RUNS_PATH || path.join(process.cwd(), 'data/refresh-runs.json')
// Read-only here: the ingest never writes tax policy. It reads one corner of it
// so a hand-entered assumption can be checked against the transactions the
// ingest actually sees — see `us_ytd_realized_assumption_reviewed` below.
const taxPolicyPath = process.env.STOCK_TAX_POLICY_PATH || path.join(process.cwd(), 'data/tax-policy.json')

const sources = {
  holdings: 'summary.noapost.tsv',
  taxlots: 'taxlots.tsv',
  transactions: 'transactions.tsv',
  dividends: 'dividends.tsv',
  realized: 'realized.tsv',
}

const {
  files: usHoldingFiles, missing: missingHoldingSources, problems: holdingSourceProblems,
} = resolveUsHoldingFiles(dataDir)
const {
  files: usTransactionFiles, missing: missingTransactionSources, problems: transactionSourceProblems,
} = resolveUsTransactionFiles(dataDir)
// Resolved here as well as in the extract step, so the PDFs behind the crypto
// positions are fingerprinted into source_files and show up on /data-map. The
// extract reads them; this records WHICH files were read.
const {
  files: cryptoSourceFiles, missing: missingCryptoSourceFiles, problems: cryptoSourceProblems,
} = resolveCryptoFiles(dataDir)

// Filenames whose declared period cannot be true — a date in the future, or one
// before the account existed. Every name under STOCK_DATA_DIR is typed by hand,
// and one of them was wrong for weeks: a Robinhood export dated 20060716 sat
// beside the 20260716 it was meant to be. It never changed a number, but only
// because "newest" happens to sort 2026 above 2006 — a coincidence, not a check.
const sourceDateProblems = [...holdingSourceProblems, ...transactionSourceProblems, ...cryptoSourceProblems]

// Resolved by pattern (see source-files.mjs), so a re-downloaded export with a
// new date is read instead of silently ignored. `missing*Sources` names any
// spec that matched nothing — surfaced as a validation check below rather than
// vanishing quietly, which is how a whole brokerage used to disappear.
for (const source of [...usHoldingFiles, ...usTransactionFiles]) {
  console.error(`[source] ${source.brokerage}${source.account ? ` (${source.account})` : ''}: ${path.basename(source.filename)}`)
}
for (const source of cryptoSourceFiles) {
  console.error(`[source] ${source.venue} (crypto): ${path.basename(source.filename)}`)
}
for (const gap of [...missingHoldingSources, ...missingTransactionSources, ...missingCryptoSourceFiles]) {
  console.error(`[source] MISSING — no file matches ${gap}`)
}
for (const problem of sourceDateProblems) {
  console.error(`[source] IMPLAUSIBLE DATE — ${problem}`)
}

// Certificates parsed by scripts/extract-kr-statements.py. They cover only the
// accounts whose statements exist, so they REPLACE the hand-dumped payload rows
// for those accounts and leave every other account (today: Toss) untouched \u2014
// swapping the files wholesale would delete the brokerage that is not covered yet.
const krStatementsDir = process.env.STOCK_KR_STATEMENTS_DIR || path.join(process.cwd(), 'data/kr-statements')

function readTsvAt(dir, filename) {
  const filePath = path.join(dir, filename)
  if (!fs.existsSync(filePath)) return null
  return parseTsv(fs.readFileSync(filePath, 'utf8'), filePath)
}

function parseTsv(raw, filePath) {
  const text = raw.replace(/^\uFEFF/, '').trim()
  if (!text) return { columns: [], rows: [], filePath }
  const [header, ...lines] = text.split(/\r?\n/)
  const columns = header.split('\t')
  const rows = lines
    .filter(Boolean)
    .map((line) => {
      const cells = line.split('\t')
      const row = {}
      columns.forEach((col, i) => {
        row[col] = cells[i] ?? ''
      })
      return row
    })
  return { columns, rows, filePath }
}

function readTsv(filename) {
  return parseTsv(fs.readFileSync(path.join(payloadDir, filename), 'utf8'), path.join(payloadDir, filename))
}

/** First non-empty value among aliases — the statements renamed some headers. */
function pick(row, ...names) {
  for (const name of names) {
    const value = row[name]
    if (value !== undefined && String(value).trim() !== '') return value
  }
  return ''
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
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

function fingerprint(filePath) {
  const buf = fs.readFileSync(filePath)
  const stat = fs.statSync(filePath)
  return {
    path: filePath,
    basename: path.basename(filePath),
    bytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  }
}

// A ticker is the only thing tying a buy to the position it opened, so when an
// issuer renames one the history splits in two: the old symbol holds lots that
// are never closed, the new one holds shares that were never bought. State
// Street's SPLG -> SPYM rebrand did exactly that — the 2025 Chase buy says
// SPLG, the 2026 tax-lot export says SPYM, same CUSIP 78464A854, same share.
// Renames are declared in the mappings file rather than here, because which
// symbol an operator's own statements carry is data, not code.
function normalizeTicker(value) {
  const raw = String(value || '').replace(/^'/, '').trim()
  return tickerRenames.get(raw.toUpperCase()) ?? raw
}

function text(value) {
  return value == null ? '' : String(value).trim()
}

function number(value) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.startsWith('=')) return null
  const cleaned = raw.replace(/[$,%]/g, '').replace(/,/g, '').replace(/^\((.*)\)$/, '-$1')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function dateIso(value) {
  const raw = text(value)
  if (!raw) return ''
  const d = new Date(raw.replace(/ ET$/, ''))
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return raw
}

function normalizeTerm(value) {
  const raw = text(value).toLowerCase()
  if (raw === 'lt') return 'Long-term'
  if (raw === 'st') return 'Short-term'
  if (raw.includes('long')) return 'Long-term'
  if (raw.includes('short')) return 'Short-term'
  return text(value)
}

function dateFromGainLossFilename(filename) {
  const match = text(filename).match(/as of (\d{1,2})_(\d{1,2})_(\d{4})/i)
  if (!match) return ''
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

// What placed a Robinhood trade, out of the CSV's own Description.
//
// Robinhood appends the origin as a line under the security name and the CUSIP:
// `Microsoft\nCUSIP: 594918104\nRecurring`. The ingest was discarding it — `name`
// strips from `CUSIP:` to the end — so a dividend reinvestment and a deliberate
// buy were indistinguishable rows.
//
// The vocabulary is the broker's own, checked against its order history rather
// than guessed: on Mid-term the CSV's 82 `Dividend Reinvestment`, 31 `Recurring`
// and 589 unmarked rows match `get_equity_orders`'s 82 `drip`, 31 `recurring`
// and 589 `user` exactly. `Primary Issue` (2 rows, an IPO allocation) is `user`
// there too, so it is mapped the same way rather than given a fourth value the
// live source does not use.
const ROBINHOOD_ORIGINS = [
  [/dividend reinvestment/i, 'drip'],
  [/recurring/i, 'recurring'],
]

function robinhoodPlacedAgent(description, type) {
  // Only a trade was placed by anything. A dividend, a transfer or a stock
  // lending payment has no origin to record, and giving them one would invite
  // reading `user` as "somebody did this deliberately".
  if (type !== 'BUY' && type !== 'SELL') return null
  const tail = text(description).split('\n').slice(1).join(' ')
  for (const [pattern, agent] of ROBINHOOD_ORIGINS) {
    if (pattern.test(tail)) return agent
  }
  return 'user'
}

function normalizeUsTransactionType(value, action = '') {
  const explicit = text(value).toLowerCase()
  const act = text(action).toLowerCase()
  const raw = `${explicit} ${act}`
  if (explicit === 'cdiv') return 'DIVIDEND'
  if (explicit === 'int') return 'INTEREST'
  if (explicit === 'slip') return 'STOCK_LENDING_INCOME'
  if (explicit === 'rtp') return 'TRANSFER_IN'
  // `ACH` is a rail, not a direction. Robinhood files money in and money out
  // under the one Trans Code and says which in the description, so reading the
  // code alone sent 22 of the 25 ACH rows the wrong way — every deposit booked
  // as a withdrawal. Nothing here defaults: a bare `ACH` with a silent
  // description falls through to surface as an unmapped type, because a
  // confident guess at the direction of a cash movement is worse than a
  // visible gap.
  if (explicit === 'ach') {
    // A cancel reverses a deposit, so the money leaves the way a withdrawal does.
    if (act.includes('withdraw') || act.includes('cancel')) return 'TRANSFER_OUT'
    if (act.includes('deposit')) return 'TRANSFER_IN'
  }
  if (explicit === 'itrf') return 'INTERNAL_TRANSFER'
  if (explicit === 'spl') return 'STOCK_SPLIT'
  if (explicit === 'spr' || explicit === 'sxch') return 'CORPORATE_ACTION'
  if (explicit === 'gmpc') return 'OTHER_INCOME'
  if (explicit === 'gold') return 'FEE'
  // `REC` is a receipt of securities, not a reinvestment. Chase prints its own
  // `Reinvest` code for reinvestments — 10 rows carry it, at the fractional
  // quantities and negative amounts a reinvestment has — while the two `REC`
  // rows are whole positions arriving with no amount and no price at all. The
  // delivering side names them: Fidelity booked `TRANSFER OF ASSETS ACAT
  // DELIVER` for exactly -318 QQQI and -1 SCHD on 2026-07-21, the same day
  // Chase received 318 and 1. Robinhood uses the code for the same shape from
  // the other end — its one `REC` row is the sign-up share it handed over, also
  // shares arriving with no money against them.
  //
  // TRANSFER_IN is the classification only. What such a row COST is settled
  // downstream by the US replay, which dispatches on the absence of a cost on
  // the row rather than on the type, and can still tell an ACAT receive from a
  // grant by whether a delivery was in transit.
  if (explicit === 'rec') return 'TRANSFER_IN'
  if (explicit === 'bnk') return 'CASH_SWEEP'
  if (explicit === 'jnl') return 'JOURNAL'
  if (explicit === 'stk splt') return 'STOCK_SPLIT'
  if (act.startsWith('electronic funds transfer received')) return 'TRANSFER_IN'
  if (act.startsWith('electronic funds transfer paid')) return 'TRANSFER_OUT'
  if (explicit === 'dividend' || act.startsWith('dividend received')) return 'DIVIDEND'
  if (explicit === 'interest' || act.startsWith('interest')) return 'INTEREST'
  if (explicit === 'reinvest' || act.startsWith('reinvestment')) return 'REINVEST'
  if (explicit === 'buy' || act.startsWith('you bought')) return 'BUY'
  if (explicit === 'sell' || act.startsWith('you sold')) return 'SELL'
  if (act.startsWith('transfer of assets acat deliver')) return 'TRANSFER_OUT'
  if (act.startsWith('transfer of assets acat receive')) return 'TRANSFER_IN'
  // Fidelity names the far account inline — `TRANSFERRED TO VS Z35-581892-1
  // (Cash)` — so the description is unique per counterparty and never matches a
  // fixed string. The direction is the only part that generalises.
  //
  // TRANSFER_OUT rather than INTERNAL_TRANSFER on purpose: the far account here
  // is a cash-management account, which is banking rather than investing and is
  // deliberately outside this portfolio. Money moving there has left, and
  // calling it internal would net it back into a total that no longer holds it.
  if (act.startsWith('transferred to') || explicit.startsWith('transferred to')) return 'TRANSFER_OUT'
  if (act.startsWith('transferred from') || explicit.startsWith('transferred from')) return 'TRANSFER_IN'
  if (raw.includes('dividend')) return 'DIVIDEND'
  if (raw.includes('interest')) return 'INTEREST'
  if (raw.includes('reinvest')) return 'REINVEST'
  if (raw.includes('buy') || raw.includes('bought')) return 'BUY'
  if (raw.includes('sell') || raw.includes('sold')) return 'SELL'
  if (raw.includes('deposit') || raw.includes('dbs')) return 'TRANSFER_IN'
  if (raw.includes('withdraw') || raw.includes('wdl')) return 'TRANSFER_OUT'
  return text(value || action).toUpperCase()
}

function normalizeMerrillTransactionType(description, type = '') {
  const explicit = text(type).toLowerCase()
  const desc = text(description).toLowerCase()
  if (explicit) return normalizeUsTransactionType(explicit, description)
  // Structure before vocabulary. Merrill names the security inside the
  // description, so `Security Transfer In SCHWAB US DIVIDEND EQTY` matched the
  // `dividend` substring below and booked a 320-share ACAT receipt as a
  // dividend — the shares vanished from the lot walk and reappeared only as a
  // $0.00 income row. The prefix says what the row IS; the rest is a fund name.
  if (desc.startsWith('security transfer in')) return 'TRANSFER_IN'
  if (desc.startsWith('security transfer out')) return 'TRANSFER_OUT'
  if (desc.includes('reinvestment')) return 'REINVEST'
  if (desc.includes('dividend')) return 'DIVIDEND'
  if (desc.includes('interest')) return 'INTEREST'
  if (desc.includes('stock lending')) return 'STOCK_LENDING_INCOME'
  if (desc.includes('other income')) return 'OTHER_INCOME'
  if (desc.startsWith('funds received')) return 'TRANSFER_IN'
  if (desc.startsWith('security transfer in')) return 'TRANSFER_IN'
  if (desc.startsWith('security transfer out')) return 'TRANSFER_OUT'
  if (desc.includes('purchase')) return 'BUY'
  if (desc.includes('sale') || desc.includes('sold')) return 'SELL'
  if (desc.includes('deposit') || desc.includes('transfer received')) return 'TRANSFER_IN'
  if (desc.includes('withdraw') || desc.includes('transfer paid')) return 'TRANSFER_OUT'
  return text(type || description).toUpperCase()
}

function isIncomeType(type) {
  // STAKING_REWARD is its own type rather than folded into INTEREST: it is paid
  // in coin, so it simultaneously opens a tax lot and books income, and the two
  // are taxed on different bases. Collapsing it into an existing type would hide
  // that from the income views.
  //
  // SHARE_REWARD is the equity side of the same shape — a granted share, paid in
  // stock. It is not assigned by the type normalizer: a grant and an ACAT
  // receive both arrive as a bare `REC` with no amount, and only the FIFO replay
  // can tell them apart by whether a delivery was in transit. See the arrival
  // branch of the US replay, which is where the type is set.
  return ['DIVIDEND', 'INTEREST', 'STOCK_LENDING_INCOME', 'OTHER_INCOME', 'STAKING_REWARD', 'SHARE_REWARD'].includes(type)
}

function loadManualMappings() {
  if (!fs.existsSync(manualMappingsPath)) {
    return { version: 1, incomeRules: [], dividendOverrides: [] }
  }
  return JSON.parse(fs.readFileSync(manualMappingsPath, 'utf8'))
}

// A missing or unparseable policy file is not an ingest failure — the tax pages
// bootstrap from the example. It is reported as `null` so the check below can
// say "no policy file" rather than silently reading the assumption as 0.
function loadTaxPolicy() {
  if (!fs.existsSync(taxPolicyPath)) return null
  try {
    return JSON.parse(fs.readFileSync(taxPolicyPath, 'utf8'))
  } catch {
    return null
  }
}

function includesText(value, needle) {
  if (!needle) return true
  return text(value).toLowerCase().includes(text(needle).toLowerCase())
}

function mappingMatches(row, match = {}) {
  return (
    includesText(row.market, match.market) &&
    includesText(row.currency, match.currency) &&
    includesText(row.brokerage, match.brokerage) &&
    includesText(row.account, match.accountIncludes) &&
    includesText(row.ticker, match.ticker) &&
    includesText(row.name, match.nameIncludes) &&
    includesText(row.type, match.typeIncludes) &&
    includesText(row.source, match.sourceIncludes)
  )
}

function defaultIncomeCategory(row) {
  const type = text(row.type).toUpperCase()
  const name = text(row.name).toUpperCase()
  if (type.includes('INTEREST') || name.includes('INTEREST PAYMENT')) return 'interest'
  if (type.includes('STOCK_LENDING') || name.includes('STOCK LENDING')) return 'stock_lending'
  if (type.includes('OTHER_INCOME')) return 'other'
  // A granted share is ordinary income at its receipt-date value, not a payout
  // on a position already held — it is 1099-MISC, not 1099-DIV. Stated rather
  // than left to the fallback so it cannot drift into the dividend bucket.
  if (type.includes('SHARE_REWARD')) return 'other'
  if (type.includes('DIVIDEND') || type.includes('배당') || type.includes('분배')) return 'dividend'
  return 'other'
}

function applyDividendMappings(row, mappings) {
  const out = {
    ...row,
    income_category: defaultIncomeCategory(row),
    mapping_status: row.ticker ? 'ticker_mapped' : 'tickerless',
    mapping_note: 'auto classified',
  }
  for (const rule of mappings.incomeRules ?? []) {
    if (!mappingMatches(out, rule.match)) continue
    Object.assign(out, rule.set ?? {})
    out.mapping_status = out.mapping_status === 'tickerless' ? 'tickerless_categorized' : 'categorized'
    out.mapping_note = rule.note || rule.id || out.mapping_note
  }
  for (const override of mappings.dividendOverrides ?? []) {
    if (!mappingMatches(out, override.match)) continue
    Object.assign(out, override.set ?? {})
    if (out.ticker) out.ticker = normalizeTicker(out.ticker)
    out.mapping_status = 'manual_override'
    out.mapping_note = override.note || override.id || 'manual override'
  }
  return out
}

function loadFxRates() {
  if (!fs.existsSync(fxRatesPath)) {
    return { baseCurrency: 'KRW', rates: [] }
  }
  return JSON.parse(fs.readFileSync(fxRatesPath, 'utf8'))
}

function loadKrPrices() {
  if (!fs.existsSync(krPricesPath)) {
    return { prices: [], missing: [] }
  }
  return JSON.parse(fs.readFileSync(krPricesPath, 'utf8'))
}

function loadUsPrices() {
  if (!fs.existsSync(usPricesPath)) {
    return { prices: [], missing: [] }
  }
  return JSON.parse(fs.readFileSync(usPricesPath, 'utf8'))
}

function loadUsPdfEvidence() {
  if (!fs.existsSync(usPdfEvidencePath)) {
    return { reports: [] }
  }
  return JSON.parse(fs.readFileSync(usPdfEvidencePath, 'utf8'))
}

function loadCryptoActivity() {
  if (!fs.existsSync(cryptoActivityPath)) {
    return { documents: [], transactions: [], snapshots: [] }
  }
  return JSON.parse(fs.readFileSync(cryptoActivityPath, 'utf8'))
}

function loadCryptoPrices() {
  if (!fs.existsSync(cryptoPricesPath)) {
    return { prices: [], missing: [], historical: [], missingHistorical: [] }
  }
  return JSON.parse(fs.readFileSync(cryptoPricesPath, 'utf8'))
}

const fxConfig = loadFxRates()
const krPriceConfig = loadKrPrices()
const usPriceConfig = loadUsPrices()
const usPdfEvidence = loadUsPdfEvidence()
const cryptoActivity = loadCryptoActivity()
const cryptoPriceConfig = loadCryptoPrices()
const manualMappings = loadManualMappings()
// Loaded before the first normalizeTicker call: every ticker in this ingest,
// from any source, is read through the rename table so the old and new symbol
// land on one position. Chained renames are NOT followed — a symbol renamed
// twice needs both entries pointed at the current symbol, which the
// `manual_mapping_renames_resolve` check below insists on.
const tickerRenames = new Map(
  (manualMappings.tickerRenames ?? [])
    .filter((r) => text(r.from) && text(r.to))
    .map((r) => [text(r.from).replace(/^'/, '').toUpperCase(), text(r.to).replace(/^'/, '').trim()])
)
const krPricesByTicker = new Map((krPriceConfig.prices ?? []).map((p) => [normalizeTicker(p.ticker), p]))
const usPricesByTicker = new Map((usPriceConfig.prices ?? []).map((p) => [normalizeTicker(p.ticker), p]))
// Keyed by venue as well as symbol: BTC on Bithumb and BTC on Robinhood are the
// same asset at two different prices in two different currencies, and collapsing
// them onto the symbol alone would mark one venue's position at the other's book.
const cryptoPricesByKey = new Map((cryptoPriceConfig.prices ?? []).map((p) => [`${p.venue}\t${p.symbol}`, p]))
const cryptoRewardCloses = new Map((cryptoPriceConfig.historical ?? []).map((h) => [`${h.venue}\t${h.symbol}\t${h.date}`, h]))

function fxRate(from, to = fxConfig.baseCurrency || 'KRW') {
  if (from === to) return { rate: 1, asOfDate: '', source: 'native', sourceUrl: '' }
  return fxConfig.rates.find((r) => r.from === from && r.to === to) ?? null
}

function toBase(value, currency) {
  if (value == null) return null
  const fx = fxRate(currency)
  if (!fx) return null
  return value * fx.rate
}

function insertMany(db, table, rows, columns) {
  if (rows.length === 0) return
  const placeholders = columns.map(() => '?').join(', ')
  const stmt = db.prepare(`insert into ${table} (${columns.join(', ')}) values (${placeholders})`)
  const tx = db.transaction((items) => {
    for (const item of items) stmt.run(columns.map((col) => item[col] ?? null))
  })
  tx(rows)
}

function required(value) {
  return text(value).length > 0
}

fs.mkdirSync(outDir, { recursive: true })
let previousPortfolioSnapshots = []
if (fs.existsSync(dbPath)) {
  const previousDb = new Database(dbPath, { readonly: true })
  try {
    const hasSnapshots = previousDb
      .prepare("select 1 from sqlite_master where type = 'table' and name = 'portfolio_snapshots'")
      .get()
    if (hasSnapshots) previousPortfolioSnapshots = previousDb.prepare('select * from portfolio_snapshots order by snapshot_date').all()
  } finally {
    previousDb.close()
  }
  fs.rmSync(dbPath)
}

const datasets = Object.fromEntries(Object.entries(sources).map(([name, file]) => [name, readTsv(file)]))

// Certificate rows win for the accounts they cover; the payload keeps the rest.
// `holdings` is deliberately absent from the statements — a 거래내역증명서 records
// movements, not a position snapshot — so that dataset stays on the payload and
// the existing holdings-vs-taxlots checks now compare the sheet against the
// broker's own history, which is a comparison worth having.
const krStatements = Object.fromEntries(
  ['taxlots', 'transactions', 'dividends', 'realized'].map((name) => [name, readTsvAt(krStatementsDir, `${name}.tsv`)])
)
const statementAccounts = new Set((krStatements.transactions?.rows ?? []).map((r) => text(r.Account)).filter(Boolean))
// Per-account coverage end, written by extract-kr-statements.py alongside the
// TSVs. Read separately from taxlots' own `As Of Date` because that column
// only exists on OPEN lots, and 삼성증권 never has one — every RSU vest
// transfers straight to Toss inside the same statement period, so its lots
// are always empty and it would otherwise be invisible to any freshness check
// built off them. See `samsung_statement_fresh` below.
const krAsOfPath = path.join(krStatementsDir, 'as-of.json')
const krAsOfByAccount = fs.existsSync(krAsOfPath)
  ? JSON.parse(fs.readFileSync(krAsOfPath, 'utf8'))?.accounts ?? {}
  : {}

// What the statement parser could not handle, written beside the TSVs.
//
// Read here because a row the parser drops never reaches a TSV, and every check
// in this file works on rows that did. `transaction_types_mapped` counts
// unmapped rows among the ones it was handed — these are the ones it was not
// handed, so it passes while the transaction is gone. That is not hypothetical:
// the refresh printed `unmapped-type: 신주인수권증서출고`, dropped the row that
// closes a 신주인수권 lot, and reported every check passing.
//
// stderr is where findings go to die. This is the same findings, as data.
const krExtractReportPath = path.join(krStatementsDir, 'extract-report.json')
const krExtractReport = fs.existsSync(krExtractReportPath)
  ? JSON.parse(fs.readFileSync(krExtractReportPath, 'utf8'))
  : null
const krExtractFindings = krExtractReport?.findings ?? []
const krDroppedRowFindings = krExtractFindings.filter((f) => f.drops_rows && f.rows > 0)
const krKeptRowFindings = krExtractFindings.filter((f) => !f.drops_rows && f.rows > 0)
if (statementAccounts.size) {
  for (const [name, parsed] of Object.entries(krStatements)) {
    if (!parsed) continue
    const kept = datasets[name].rows.filter((r) => !statementAccounts.has(text(r.Account)))
    const dropped = datasets[name].rows.length - kept.length
    datasets[name] = { columns: parsed.columns, rows: [...kept, ...parsed.rows], filePath: parsed.filePath }
    console.error(`[kr-statements] ${name}: ${parsed.rows.length} certificate row(s) replace ${dropped} payload row(s)`)
  }
  console.error(`[kr-statements] accounts covered: ${[...statementAccounts].join(', ')}`)
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

db.exec(`
create table meta (
  key text primary key,
  value text not null
);

create table source_files (
  name text primary key,
  filename text not null,
  path text not null,
  bytes integer not null,
  mtime_ms integer not null,
  sha256 text not null,
  row_count integer not null
);

create table fx_rates (
  id integer primary key,
  from_currency text not null,
  to_currency text not null,
  rate real not null,
  as_of_date text not null,
  source text not null,
  source_url text,
  note text
);

create table holdings (
  id integer primary key,
  market text not null,
  currency text not null,
  base_currency text not null,
  fx_rate_to_base real,
  brokerage text,
  account_type text,
  source_system text,
  as_of_date text,
  account text not null,
  ticker text not null,
  name text not null,
  quantity real not null,
  native_average_unit_cost real,
  native_cost real not null,
  native_price real,
  native_market_value real,
  native_unrealized_gl real,
  native_unrealized_gl_pct real,
  base_cost real,
  base_market_value real,
  base_unrealized_gl real,
  average_unit_cost real,
  total_cost_krw real not null,
  current_price real,
  pe real,
  eps real,
  unrealized_gl_krw real,
  unrealized_gl_pct real,
  long_term_qty real,
  short_term_qty real,
  lot_count integer
);

create table tax_lots (
  id integer primary key,
  market text not null,
  currency text not null,
  base_currency text not null,
  fx_rate_to_base real,
  brokerage text,
  account_type text,
  source_system text,
  as_of_date text,
  account text not null,
  ticker text not null,
  name text not null,
  acquired_date text not null,
  open_quantity real not null,
  native_cost_basis real not null,
  native_unit_cost real,
  native_market_value real,
  native_unrealized_gl real,
  cost_basis_krw real not null,
  unit_cost real,
  holding_days integer,
  tax_term text,
  source text
);

create table realized_lots (
  id integer primary key,
  market text not null,
  currency text not null,
  base_currency text not null,
  brokerage text,
  source_system text,
  account text not null,
  ticker text not null,
  name text not null,
  acquired_date text,
  sold_date text,
  quantity_sold real,
  cost_basis_krw real,
  proceeds_krw real,
  realized_gl_krw real,
  holding_days integer,
  tax_term text,
  -- basis says where the figure came from and therefore what it can be used
  -- for. 'replay' is this repo's own FIFO walk of the transactions: available
  -- year-round, and the only thing that exists for a year whose forms have not
  -- been issued yet. '1099b' is the broker's filed number, with wash sales and
  -- return-of-capital basis adjustments already applied. They disagree by
  -- construction, so a page that shows one must be able to say which it is.
  basis text,
  tax_year text,
  native_cost_basis real,
  native_proceeds real,
  native_realized_gl real,
  covered_status text,
  form_8949_box text,
  -- Set on a replay row whose year a filing covers: kept rather than deleted so
  -- the estimate stays auditable next to the figure that replaced it.
  superseded_by text,
  -- Dividends received on this ticker between acquisition and sale. Makes the
  -- realized figure a total return rather than a price return.
  --
  -- Two columns because the two markets can honestly fill different ones. A US
  -- lot and every dividend it earned are quoted in the same currency, so the
  -- native figure is exact. A Korean position is not so tidy: the same security
  -- in one 미래에셋 account can carry lots booked in won and lots booked in
  -- dollars, depending on how each order was placed, while its dividend arrives
  -- in one currency for the whole position. Won is the unit both sides of that
  -- always have, so Korea attributes there and leaves the native column null.
  dividends_native real,
  dividends_krw real,
  source text
);

create table transactions (
  id integer primary key,
  market text not null,
  currency text not null,
  base_currency text not null,
  brokerage text,
  account_type text,
  source_system text,
  date text not null,
  account text not null,
  type text not null,
  raw_type text,
  ticker text,
  name text,
  quantity real,
  native_amount real,
  native_settlement real,
  native_unit_price real,
  amount_krw real,
  settlement_krw real,
  unit_price real,
  fee real,
  tax real,
  balance real,
  -- What placed the order, where the broker says: 'drip', 'recurring', 'user'.
  -- A dividend reinvestment and a deliberate buy are the same row otherwise, and
  -- they are not the same decision. Null wherever the source does not say.
  placed_agent text,
  source text,
  page integer
);

create table dividends (
  id integer primary key,
  market text not null,
  currency text not null,
  base_currency text not null,
  brokerage text,
  account_type text,
  source_system text,
  date text not null,
  account text not null,
  ticker text,
  name text,
  native_amount real not null,
  native_tax_withheld real,
  amount_krw real not null,
  type text,
  income_category text,
  mapping_status text,
  mapping_note text,
  source text,
  page integer
);

create table validation_checks (
  id integer primary key,
  name text not null,
  status text not null,
  detail text not null,
  severity text not null
);

create table evidence_reports (
  id integer primary key,
  name text not null,
  category text not null,
  filename text not null,
  path text not null,
  account_hint text,
  pages integer,
  row_count integer,
  metrics_json text
);

create table portfolio_snapshots (
  id integer primary key,
  snapshot_date text not null unique,
  captured_at text not null,
  global_base_cost real not null,
  global_base_market_value real,
  global_base_unrealized_gl real,
  global_base_return_pct real,
  market_value_coverage real,
  priced_base_cost real,
  position_coverage real,
  kr_market_value_coverage real,
  us_market_value_coverage real,
  crypto_market_value_coverage real,
  kr_market_value real,
  us_market_value_base real,
  crypto_market_value_base real,
  kr_cost_basis real,
  us_cost_basis_base real,
  crypto_cost_basis_base real,
  kr_unrealized_gl real,
  us_unrealized_gl_base real,
  crypto_unrealized_gl_base real,
  kr_return_pct real,
  us_return_pct real,
  crypto_return_pct real,
  krw_cost real not null,
  usd_cost real not null,
  dividends_krw real not null,
  dividends_usd real not null,
  holding_count integer not null,
  share_count real not null
);

create index idx_portfolio_snapshots_date on portfolio_snapshots(snapshot_date);

create table historical_prices (
  id integer primary key,
  market text not null,
  ticker text not null,
  symbol text not null,
  currency text not null,
  price_date text not null,
  close real not null,
  adj_close real,
  source text not null,
  unique(market, ticker, price_date)
);

create index idx_historical_prices_lookup on historical_prices(market, ticker, price_date);

create table historical_fx_rates (
  id integer primary key,
  price_date text not null unique,
  rate real not null,
  source text not null
);
`)

db.prepare('insert into meta (key, value) values (?, ?)').run('ingested_at', now)
db.prepare('insert into meta (key, value) values (?, ?)').run('data_dir', dataDir)
db.prepare('insert into meta (key, value) values (?, ?)').run('payload_dir', payloadDir)
db.prepare('insert into meta (key, value) values (?, ?)').run('fx_rates_path', fxRatesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('kr_prices_path', krPricesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('us_prices_path', usPricesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('historical_prices_path', historicalPricesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('historical_fx_rates_path', historicalFxRatesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('us_pdf_evidence_path', usPdfEvidencePath)
db.prepare('insert into meta (key, value) values (?, ?)').run('robinhood_snapshot_path', robinhoodSnapshotPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('crypto_activity_path', cryptoActivityPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('crypto_prices_path', cryptoPricesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('manual_mappings_path', manualMappingsPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('refresh_runs_path', refreshRunsPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('portfolio_snapshot_version', '2')

// Drop today's prior observation and any UTC-dated "tomorrow" row from the old
// implementation. On the iMac, a refresh after 17:00 Pacific used to write the
// next UTC date; preserving it would leave a stale future row ahead of the new
// portfolio-local snapshot forever.
insertMany(db, 'portfolio_snapshots', previousPortfolioSnapshots.filter((row) => row.snapshot_date < snapshotDate), [
  'snapshot_date',
  'captured_at',
  'global_base_cost',
  'global_base_market_value',
  'global_base_unrealized_gl',
  'global_base_return_pct',
  'market_value_coverage',
  'priced_base_cost',
  'position_coverage',
  'kr_market_value_coverage',
  'us_market_value_coverage',
  'crypto_market_value_coverage',
  'kr_market_value',
  'us_market_value_base',
  // Carried forward like every other snapshot column: the database is dropped
  // and rebuilt on each ingest, so a column missing from this list loses its
  // whole history on the next refresh rather than just today's value.
  'crypto_market_value_base',
  'kr_cost_basis',
  'us_cost_basis_base',
  'crypto_cost_basis_base',
  'kr_unrealized_gl',
  'us_unrealized_gl_base',
  'crypto_unrealized_gl_base',
  'kr_return_pct',
  'us_return_pct',
  'crypto_return_pct',
  'krw_cost',
  'usd_cost',
  'dividends_krw',
  'dividends_usd',
  'holding_count',
  'share_count',
])

const historicalPriceDocument = fs.existsSync(historicalPricesPath)
  ? JSON.parse(fs.readFileSync(historicalPricesPath, 'utf8'))
  : { prices: [] }
const historicalFxDocument = fs.existsSync(historicalFxRatesPath)
  ? JSON.parse(fs.readFileSync(historicalFxRatesPath, 'utf8'))
  : { rates: [] }
insertMany(db, 'historical_prices', historicalPriceDocument.prices ?? [], [
  'market',
  'ticker',
  'symbol',
  'currency',
  'price_date',
  'close',
  'adj_close',
  'source',
])
insertMany(db, 'historical_fx_rates', historicalFxDocument.rates ?? [], ['price_date', 'rate', 'source'])

// The 주식종합 account held US ETFs, so a Korean statement carries USD rows. Only
// its trades record 환율; its 345 dividend and transfer rows do not, and the
// parser deliberately leaves their won figure empty rather than invent one. Use
// the rate for that date from the historical table the refresh already keeps,
// falling back to the closest earlier date so a payout on a market holiday is
// converted rather than silently dropped to zero.
const historicalFxDates = (historicalFxDocument.rates ?? [])
  .map((r) => ({ date: r.price_date, rate: Number(r.rate) }))
  .filter((r) => r.date && Number.isFinite(r.rate))
  .sort((a, b) => a.date.localeCompare(b.date))

function krwOn(nativeAmount, currency, date) {
  if (nativeAmount == null) return null
  if (!currency || currency === 'KRW') return nativeAmount
  let best = null
  for (const entry of historicalFxDates) {
    if (entry.date > date) break
    best = entry
  }
  const rate = best?.rate ?? fxRate(currency)?.rate ?? null
  return rate == null ? null : nativeAmount * rate
}

/** Dollar amount at the trade date, for figures the US tax engine consumes. */
function usdOn(nativeAmount, currency, date) {
  if (nativeAmount == null) return null
  if (currency === 'USD') return nativeAmount
  let best = null
  for (const entry of historicalFxDates) {
    if (entry.date > date) break
    best = entry
  }
  const rate = best?.rate ?? fxRate('USD')?.rate ?? null
  return rate ? nativeAmount / rate : null
}

// Closing prices for US tickers, by date. The crypto side already values a
// reward at its receipt-date close rather than at zero (see
// `crypto_rewards_valued_at_receipt`); this is the same table put to the same
// use for a US share that arrived without a price on it.
const usHistoricalCloses = new Map()
for (const p of historicalPriceDocument.prices ?? []) {
  if (text(p.market) !== 'US') continue
  const ticker = text(p.ticker)
  const date = text(p.price_date)
  const close = number(p.close)
  if (!ticker || !date || !(close > 0)) continue
  if (!usHistoricalCloses.has(ticker)) usHistoricalCloses.set(ticker, [])
  usHistoricalCloses.get(ticker).push({ date, close })
}
for (const series of usHistoricalCloses.values()) series.sort((a, b) => a.date.localeCompare(b.date))

/**
 * Close for a US ticker on a date, falling back to the most recent earlier one
 * so a receipt dated to a market holiday still resolves. Returns the entry
 * rather than the number, because a caller that values something off a
 * different day's close has to be able to say so.
 */
function usCloseOn(ticker, date) {
  const series = usHistoricalCloses.get(ticker)
  if (!series) return null
  let best = null
  for (const entry of series) {
    if (entry.date > date) break
    best = entry
  }
  return best
}

/** Won amount for a Korea row: the parser's figure when it had one, else converted. */
function krAmount(row, krwKey, nativeKey = 'Native Amount') {
  const explicit = number(row[krwKey])
  if (explicit != null) return explicit
  return krwOn(number(row[nativeKey]), text(row.Currency), text(row.Date) || text(row['Sold Date']))
}

insertMany(
  db,
  'fx_rates',
  fxConfig.rates.map((r) => ({
    from_currency: r.from,
    to_currency: r.to,
    rate: r.rate,
    as_of_date: r.asOfDate,
    source: r.source,
    source_url: r.sourceUrl,
    note: r.note,
  })),
  ['from_currency', 'to_currency', 'rate', 'as_of_date', 'source', 'source_url', 'note']
)

for (const [name, file] of Object.entries(sources)) {
  const fp = fingerprint(path.join(payloadDir, file))
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, datasets[name].rows.length)
}
for (const source of [...usHoldingFiles, ...usTransactionFiles]) {
  if (!fs.existsSync(source.filename)) continue
  const fp = fingerprint(source.filename)
  const name = `${source.brokerage}:${fp.basename}`
  const rowCount = parseCsv(fs.readFileSync(source.filename, 'utf8')).filter((r) => r.some((c) => c.trim())).length
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, rowCount)
}
if (fs.existsSync(fxRatesPath)) {
  const fp = fingerprint(fxRatesPath)
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run('fx_rates', fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, fxConfig.rates.length)
}
if (fs.existsSync(krPricesPath)) {
  const fp = fingerprint(krPricesPath)
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run('kr_prices', fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, krPriceConfig.prices?.length ?? 0)
}
if (fs.existsSync(usPricesPath)) {
  const fp = fingerprint(usPricesPath)
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run('us_prices', fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, usPriceConfig.prices?.length ?? 0)
}
if (fs.existsSync(usPdfEvidencePath)) {
  const fp = fingerprint(usPdfEvidencePath)
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run('us_pdf_evidence', fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, usPdfEvidence.reports?.length ?? 0)
}
// Recorded like every other generated input, and for one reason beyond symmetry:
// nothing on a timer regenerates this file, so its mtime is the only place the
// question "when did anyone last ask Robinhood" is answerable outside the check.
if (fs.existsSync(robinhoodSnapshotPath)) {
  const fp = fingerprint(robinhoodSnapshotPath)
  const snapshot = JSON.parse(fs.readFileSync(robinhoodSnapshotPath, 'utf8'))
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run('robinhood_snapshot', fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, snapshot.accounts?.length ?? 0)
}
if (fs.existsSync(cryptoActivityPath)) {
  const fp = fingerprint(cryptoActivityPath)
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run('crypto_activity', fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, cryptoActivity.transactions?.length ?? 0)
}
if (fs.existsSync(cryptoPricesPath)) {
  const fp = fingerprint(cryptoPricesPath)
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run('crypto_prices', fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, cryptoPriceConfig.prices?.length ?? 0)
}
for (const source of cryptoSourceFiles) {
  if (!fs.existsSync(source.filename)) continue
  const fp = fingerprint(source.filename)
  const rows = (cryptoActivity.documents ?? []).find((d) => d.filename === fp.basename)?.rowCount ?? 0
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run(`${source.venue}:${fp.basename}`, fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, rows)
}
if (fs.existsSync(manualMappingsPath)) {
  const fp = fingerprint(manualMappingsPath)
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    'manual_mappings',
    fp.basename,
    fp.path,
    fp.bytes,
    fp.mtimeMs,
    fp.sha256,
    (manualMappings.incomeRules?.length ?? 0) +
      (manualMappings.dividendOverrides?.length ?? 0) +
      (manualMappings.tickerRenames?.length ?? 0) +
      (manualMappings.instrumentAliases?.length ?? 0)
  )
}
for (const report of usPdfEvidence.reports ?? []) {
  if (!fs.existsSync(report.path)) continue
  const fp = fingerprint(report.path)
  db.prepare(
    'insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, ?, ?, ?, ?)'
  ).run(report.name, fp.basename, fp.path, fp.bytes, fp.mtimeMs, fp.sha256, report.row_count ?? 0)
}

let holdingRows = datasets.holdings.rows
  .filter((r) => text(r.Account).toLowerCase() !== 'total')
  .map((r) => {
    const ticker = normalizeTicker(r.Ticker)
    const priceSnapshot = krPricesByTicker.get(ticker)
    const quantity = number(r.Quantity) ?? 0
    const nativeCost = number(r['Total Cost']) ?? 0
    const currentPrice = number(r['Current Price']) ?? priceSnapshot?.price ?? null
    const marketValue = currentPrice == null ? null : currentPrice * quantity
    const unrealized = marketValue == null ? number(r['Unrealized G/L Amt.']) : marketValue - nativeCost
    const unrealizedPct = unrealized == null || nativeCost === 0 ? number(r['Unrealized Gain/Loss (%)']) : (unrealized / nativeCost) * 100
    const averageCost = number(r['Average Unit Cost']) ?? (quantity > 0 ? nativeCost / quantity : null)
    return {
      market: 'KR',
      currency: 'KRW',
      base_currency: 'KRW',
      fx_rate_to_base: 1,
      brokerage: text(r.Account).split('(')[0],
      account_type: text(r.Account).match(/\(([^)]+)\)/)?.[1] ?? '',
      source_system: priceSnapshot ? 'korea_sheet_payload+yahoo_chart' : 'korea_sheet_payload',
      as_of_date: priceSnapshot?.asOfDate || '2026-07-15',
      account: text(r.Account),
      ticker,
      name: text(r.Name),
      quantity,
      native_average_unit_cost: averageCost,
      native_cost: nativeCost,
      native_price: currentPrice,
      native_market_value: marketValue,
      native_unrealized_gl: unrealized,
      native_unrealized_gl_pct: unrealizedPct,
      base_cost: nativeCost,
      base_market_value: marketValue,
      base_unrealized_gl: unrealized,
      average_unit_cost: averageCost,
      total_cost_krw: nativeCost,
      current_price: currentPrice,
      pe: number(r.PE),
      eps: number(r.EPS),
      unrealized_gl_krw: unrealized,
      unrealized_gl_pct: unrealizedPct,
      long_term_qty: number(r['Long-Term Qty']),
      short_term_qty: number(r['Short-Term Qty']),
      lot_count: number(r['Lot Count']),
    }
  })

// Toss positions straight from the broker, replacing the spreadsheet's copy of
// them. The sheet's Toss rows had not moved since 2026-07-15 while the account
// kept trading, so this is the difference between a dashboard that is current
// and one that quietly multiplies a fortnight-old quantity by today's price.
//
// Only `holdings` is taken here, and deliberately so. The API's order history
// cannot rebuild Toss lots — 18 of its 46 symbols arrived by transfer rather
// than by order, and a transfer is not an order — so the lots come from the
// 거래내역서 PDFs instead, where a 타사대체입고 arrives lot by lot with the
// sending broker's cost already carried across. The two sources are kept
// separate because they age differently: this snapshot is refreshed hourly, a
// statement only when one is downloaded. `toss_holdings_lots_provenance` below
// measures the gap between them rather than papering over it.
const tossSnapshotPath = process.env.STOCK_TOSS_SNAPSHOT_PATH || path.join(process.cwd(), 'data/toss-snapshot.json')
const tossSnapshot = fs.existsSync(tossSnapshotPath)
  ? JSON.parse(fs.readFileSync(tossSnapshotPath, 'utf8'))
  : null
const tossAccountLabel = process.env.STOCK_TOSS_ACCOUNT_LABEL || '토스증권'
let tossHoldingCount = 0

if (tossSnapshot?.accounts?.length) {
  const asOf = String(tossSnapshot.fetchedAt || '').slice(0, 10)
  const usdRate = fxRate('USD')?.rate ?? null
  const rows = []
  for (const account of tossSnapshot.accounts) {
    for (const item of account.holdings?.items ?? []) {
      const currency = text(item.currency) || 'KRW'
      const toKrw = (value) => (value == null ? null : currency === 'KRW' ? value : usdRate == null ? null : value * usdRate)
      const quantity = number(item.quantity) ?? 0
      const nativeCost = number(item.marketValue?.purchaseAmount) ?? 0
      const marketValue = number(item.marketValue?.amount)
      const unrealized = number(item.profitLoss?.amount)
      const rate = number(item.profitLoss?.rate)
      rows.push({
        market: text(item.marketCountry) === 'US' ? 'US' : 'KR',
        currency,
        base_currency: 'KRW',
        fx_rate_to_base: currency === 'KRW' ? 1 : usdRate,
        brokerage: tossAccountLabel,
        account_type: '',
        source_system: 'toss_open_api',
        as_of_date: asOf,
        account: tossAccountLabel,
        ticker: normalizeTicker(item.symbol),
        name: text(item.name),
        quantity,
        native_average_unit_cost: number(item.averagePurchasePrice),
        native_cost: nativeCost,
        native_price: number(item.lastPrice),
        native_market_value: marketValue,
        native_unrealized_gl: unrealized,
        native_unrealized_gl_pct: rate == null ? null : rate * 100,
        base_cost: toKrw(nativeCost),
        base_market_value: toKrw(marketValue),
        base_unrealized_gl: toKrw(unrealized),
        average_unit_cost: toKrw(number(item.averagePurchasePrice)),
        total_cost_krw: toKrw(nativeCost) ?? 0,
        current_price: toKrw(number(item.lastPrice)),
        pe: null,
        eps: null,
        unrealized_gl_krw: toKrw(unrealized),
        unrealized_gl_pct: rate == null ? null : rate * 100,
        long_term_qty: null,
        short_term_qty: null,
        lot_count: null,
      })
    }
  }
  if (rows.length) {
    const replaced = holdingRows.filter((r) => r.account === tossAccountLabel).length
    holdingRows = [...holdingRows.filter((r) => r.account !== tossAccountLabel), ...rows]
    tossHoldingCount = rows.length
    console.error(`[toss] ${rows.length} live holding(s) replace ${replaced} payload row(s) (fetched ${asOf})`)
  }
}

const taxLotRows = datasets.taxlots.rows.map((r) => {
  const currency = text(r.Currency) || 'KRW'
  const costKrw = krAmount(r, 'Cost Basis (KRW)', 'Native Cost Basis') ?? 0
  const quantity = number(r['Open Quantity']) ?? 0
  return {
    market: 'KR',
    currency,
    base_currency: 'KRW',
    fx_rate_to_base: currency === 'KRW' ? 1 : (quantity && number(r['Native Cost Basis'])
      ? costKrw / number(r['Native Cost Basis']) : null),
    brokerage: text(r.Account).split('(')[0],
    account_type: text(r.Account).match(/\(([^)]+)\)/)?.[1] ?? '',
    source_system: text(r['As Of Date']) ? 'korea_statement' : 'korea_sheet_payload',
    // The dumped payload froze this at its extraction date; a statement carries
    // its own. Reading the row means the dashboard stops claiming 2026-07-15
    // forever after the source has moved on.
    as_of_date: text(r['As Of Date']) || '2026-07-15',
    account: text(r.Account),
    ticker: normalizeTicker(r.Ticker),
    name: text(r.Name),
    acquired_date: text(r['Acquired Date']),
    open_quantity: quantity,
    native_cost_basis: number(pick(r, 'Native Cost Basis', 'Cost Basis (KRW)')) ?? 0,
    native_unit_cost: number(pick(r, 'Native Unit Cost', 'Unit Cost')),
    native_market_value: null,
    native_unrealized_gl: null,
    cost_basis_krw: costKrw,
    unit_cost: quantity ? costKrw / quantity : number(r['Unit Cost']),
    holding_days: number(pick(r, 'Holding Days', 'Holding Days as of 2026-07-15')),
    tax_term: text(r['Tax Term']),
    source: text(r.Source),
  }
})

// Positions for the statement accounts, summed from their own lots rather than
// read from the spreadsheet. A 거래내역증명서 has no position snapshot, but every
// lot in it was derived from one, so the sum is the position — and it is the
// position the broker's own history implies rather than the one somebody last
// typed. It found a ₩498,120 government bond the sheet never listed.
//
// Long/short quantities come free here: the lots carry their own tax term, where
// the sheet had them as a column nobody recomputed.
//
// EXCEPT where a live API already answers the question. When a Toss snapshot
// was fetched, the API keeps Toss's positions and the statements supply only its
// lots: the snapshot is refreshed hourly while the newest 거래내역서 is only ever
// as fresh as the last one downloaded by hand, so deriving positions from lots
// would drop every trade made since that download. The two are then compared
// rather than merged (`toss_holdings_lots_provenance`).
//
// But when no snapshot was fetched — no credentials, or an allowlist that stopped
// matching — that reasoning inverts. The fallback is not the API, it is the
// hand-made payload frozen at 2026-07-15, which has no refresh path at all: the
// statements are strictly the fresher of the two and the only one a re-download
// can move. So Toss joins this path exactly when the API did not answer.
//
// Safe because the two agree today, which was checked rather than assumed: the
// statement lots reproduce all 36 payload positions to the won (₩<KR_HOLDINGS_TOTAL> on
// both sides). The one difference is an addition — 15 units of 한화솔루션 51R
// (<WARRANT_CODE>), a 신주인수권증서 received 2026-06-29 at zero cost that the sheet
// never listed — the same kind of find as the ₩498,120 bond above.
const lotDerivedHoldingAccounts = new Set(
  [...statementAccounts].filter((account) => account !== tossAccountLabel || tossHoldingCount === 0)
)
if (lotDerivedHoldingAccounts.size) {
  const grouped = new Map()
  for (const lot of taxLotRows) {
    if (!lotDerivedHoldingAccounts.has(lot.account) || !(lot.open_quantity > 0)) continue
    const key = `${lot.account}\t${lot.ticker}`
    const cur = grouped.get(key) ?? {
      account: lot.account, ticker: lot.ticker, name: lot.name, currency: lot.currency,
      asOf: lot.as_of_date, quantity: 0, cost: 0, nativeCost: 0, long: 0, short: 0, lots: 0,
    }
    cur.quantity += lot.open_quantity
    cur.cost += lot.cost_basis_krw ?? 0
    cur.nativeCost += lot.native_cost_basis ?? 0
    cur[lot.tax_term === 'Long-term' ? 'long' : 'short'] += lot.open_quantity
    cur.lots += 1
    if (lot.name) cur.name = lot.name
    grouped.set(key, cur)
  }
  const derived = [...grouped.values()].map((g) => {
    const priceSnapshot = krPricesByTicker.get(g.ticker)
    const currentPrice = priceSnapshot?.price ?? null
    const marketValue = currentPrice == null ? null : currentPrice * g.quantity
    const unrealized = marketValue == null ? null : marketValue - g.cost
    return {
      market: 'KR',
      currency: 'KRW',
      base_currency: 'KRW',
      fx_rate_to_base: 1,
      brokerage: g.account.split('(')[0],
      account_type: g.account.match(/\(([^)]+)\)/)?.[1] ?? '',
      source_system: priceSnapshot ? 'korea_statement+yahoo_chart' : 'korea_statement',
      as_of_date: priceSnapshot?.asOfDate || g.asOf,
      account: g.account,
      ticker: g.ticker,
      name: g.name,
      quantity: g.quantity,
      native_average_unit_cost: g.quantity > 0 ? g.cost / g.quantity : null,
      native_cost: g.cost,
      native_price: currentPrice,
      native_market_value: marketValue,
      native_unrealized_gl: unrealized,
      native_unrealized_gl_pct: unrealized == null || g.cost === 0 ? null : (unrealized / g.cost) * 100,
      base_cost: g.cost,
      base_market_value: marketValue,
      base_unrealized_gl: unrealized,
      average_unit_cost: g.quantity > 0 ? g.cost / g.quantity : null,
      total_cost_krw: g.cost,
      current_price: currentPrice,
      pe: null,
      eps: null,
      unrealized_gl_krw: unrealized,
      unrealized_gl_pct: unrealized == null || g.cost === 0 ? null : (unrealized / g.cost) * 100,
      long_term_qty: g.long,
      short_term_qty: g.short,
      lot_count: g.lots,
    }
  })
  if (derived.length) {
    const replaced = holdingRows.filter((r) => lotDerivedHoldingAccounts.has(r.account)).length
    holdingRows = [...holdingRows.filter((r) => !lotDerivedHoldingAccounts.has(r.account)), ...derived]
    console.error(`[kr-statements] holdings: ${derived.length} position(s) summed from lots replace ${replaced} payload row(s)`)
  }
}

const realizedRows = datasets.realized.rows.map((r) => {
  const currency = text(r.Currency) || 'KRW'
  const cost = krAmount(r, 'Cost Basis (KRW)', 'Native Cost Basis')
  const proceeds = krAmount(r, 'Proceeds (KRW)', 'Native Proceeds')
  return {
    market: 'KR',
    currency,
    base_currency: 'KRW',
    brokerage: text(r.Account).split('(')[0],
    source_system: currency === 'KRW' && !text(r['Native Cost Basis']) ? 'korea_sheet_payload' : 'korea_statement',
    account: text(r.Account),
    ticker: normalizeTicker(r.Ticker),
    name: text(r.Name),
    acquired_date: text(r['Acquired Date']),
    sold_date: text(r['Sold Date']),
    quantity_sold: number(r['Quantity Sold']),
    cost_basis_krw: cost,
    proceeds_krw: proceeds,
    // Recomputed from the converted legs rather than read: a USD sale's gain in
    // won is not its dollar gain times anything the parser knew at the time.
    realized_gl_krw: cost == null || proceeds == null ? number(r['Realized G/L (KRW)']) : proceeds - cost,
    holding_days: number(r['Holding Days']),
    tax_term: text(r['Tax Term']),
    // Korea's lots are replayed too, just from certificates rather than from a
    // transaction export. Marked so the column means the same thing everywhere.
    basis: 'replay',
    tax_year: text(r['Sold Date']).slice(0, 4),
    native_cost_basis: number(r['Native Cost Basis']),
    native_proceeds: number(r['Native Proceeds']),
    native_realized_gl:
      number(r['Native Proceeds']) == null || number(r['Native Cost Basis']) == null
        ? null
        : number(r['Native Proceeds']) - number(r['Native Cost Basis']),
    source: text(r.Source),
  }
})

const transactionRows = datasets.transactions.rows.map((r) => ({
  market: 'KR',
  currency: text(r.Currency) || 'KRW',
  base_currency: 'KRW',
  brokerage: text(r.Account).split('(')[0],
  account_type: text(r.Account).match(/\(([^)]+)\)/)?.[1] ?? '',
  source_system: text(r.Currency) ? 'korea_statement' : 'korea_sheet_payload',
  date: text(r.Date),
  account: text(r.Account),
  type: text(r.Type),
  raw_type: text(r['Raw Type']),
  ticker: normalizeTicker(r.Ticker),
  name: text(r.Name),
  quantity: number(r.Quantity),
  native_amount: number(pick(r, 'Native Amount', 'Amount (KRW)')),
  native_settlement: number(r['Settlement (KRW)']),
  native_unit_price: number(r['Unit Price']),
  amount_krw: krAmount(r, 'Amount (KRW)'),
  settlement_krw: number(r['Settlement (KRW)']),
  unit_price: number(r['Unit Price']),
  fee: number(r.Fee),
  tax: number(r.Tax),
  balance: number(r.Balance),
  source: text(r.Source),
  page: number(r.Page),
}))

// Toss orders, but ONLY after the newest statement.
//
// The API's order history cannot rebuild Toss's lots from scratch — that is the
// reason stated where the snapshot is read, and it still holds: 18 of its
// symbols arrived by transfer, and a transfer is not an order. But rebuilding
// from scratch was never the only option. The statements are authoritative up to
// the day they were printed; past that day they say nothing at all, and until
// now neither did anything else. Seven of the eight positions that failed
// `toss_holdings_lots_provenance` were plain purchases sitting unread in
// data/toss-snapshot.json, already fetched every hour by the refresh and thrown
// away — 카카오 +50, 미래에셋증권 +20, NAVER +10 on 2026-07-29, each matching the
// shortfall to the unit.
//
// So the cutoff is the newest statement date, and the API supplies only what
// comes after it. Self-healing by construction: download a newer 거래내역서 and
// the cutoff moves forward, these rows drop out, and the statement's version —
// which carries transfers and corporate actions the order book has no concept
// of — takes their place. Nothing is ever counted twice.
//
// WHAT THIS CANNOT SEE, and the second half is not what it looked like.
//
// The obvious half: anything in the window that was not an order. A 타사대체입고
// or a 신주인수권증서 arriving after the cutoff has no order behind it.
//
// The half that had to be asked about: **the endpoint does not return every
// order either.** 토스증권 support confirmed on 2026-08-02 that
// /api/v1/orders answers for 지정가 and 시장가 orders only — 시간외 단일가 and
// 장후 시간외종가 fills are absent by design, not by fault. Three purchases were
// missing from an otherwise exact 3,474-order history and that is why:
// <KR_TICKER_A> on 2025-09-19 and 2025-10-29, <KR_TICKER_B> on 2026-03-06. They reconcile
// against the certificates, which carry every fill regardless of session.
//
// So this bridge is a best-effort gap-filler and never an authority. An
// after-hours purchase made after the cutoff will simply not be here, and the
// lots will be short by it until the next 거래내역서 is downloaded.
//
// That is survivable only because it is detected rather than assumed away:
// holdings come from the API, which does carry every position, so a fill this
// bridge could not see leaves live > lots and `toss_holdings_lots_provenance`
// names it. The bridge closes the gap it can explain and leaves the rest
// visible — which is also why the certificates stay the authority for lots
// rather than being replaced by the API.
const tossOrderNotes = []
let tossBridgeCutoff = null
let tossBridgedFills = 0
let tossBridgedSells = 0

if (tossSnapshot?.accounts?.length) {
  const usdRate = fxRate('USD')?.rate ?? null
  // The statement's own last word, not today's date and not the lot dates: a
  // certificate covers a period, and its final transaction is where it stops
  // being able to answer.
  for (const r of transactionRows) {
    if (r.account !== tossAccountLabel || r.source_system !== 'korea_statement') continue
    if (r.date && (tossBridgeCutoff == null || r.date > tossBridgeCutoff)) tossBridgeCutoff = r.date
  }

  const fills = []
  for (const account of tossSnapshot.accounts) {
    for (const order of account.orders ?? []) {
      if (text(order.status) !== 'FILLED') continue
      const exec = order.execution ?? {}
      // filledAt over orderedAt: an order placed before the close and filled the
      // next session belongs to the day the shares actually moved, which is the
      // day the statement would have recorded it.
      const date = String(exec.filledAt || order.orderedAt || '').slice(0, 10)
      const quantity = number(exec.filledQuantity)
      if (!date || !quantity) continue
      if (tossBridgeCutoff && date <= tossBridgeCutoff) continue
      fills.push({ order, exec, date, quantity })
    }
  }
  fills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // FIFO over the statement's own lots, so a sale in the window consumes the
  // oldest open lot exactly as the certificate's replay would have. Mutating
  // taxLotRows in place keeps one lot ledger rather than a second one that would
  // then have to be reconciled against the first.
  const openLots = new Map()
  for (const lot of taxLotRows) {
    if (lot.account !== tossAccountLabel || !(lot.open_quantity > 0)) continue
    if (!openLots.has(lot.ticker)) openLots.set(lot.ticker, [])
    openLots.get(lot.ticker).push(lot)
  }
  for (const lots of openLots.values()) lots.sort((a, b) => String(a.acquired_date).localeCompare(String(b.acquired_date)))

  for (const { order, exec, date, quantity } of fills) {
    const currency = text(order.currency) || 'KRW'
    const toKrw = (v) => (v == null ? null : currency === 'KRW' ? v : usdRate == null ? null : v * usdRate)
    const ticker = normalizeTicker(order.symbol)
    const security = tossSnapshot.accounts
      .flatMap((a) => a.securities ?? [])
      .find((s) => normalizeTicker(s.symbol) === ticker)
    const name = text(security?.name) || ticker
    const market = currency === 'USD' ? 'US' : 'KR'
    const side = text(order.side).toUpperCase()
    const gross = number(exec.filledAmount) ?? 0
    const commission = number(exec.commission) ?? 0
    const tax = number(exec.tax) ?? 0
    // Fees land on the side that makes them a cost either way: added to what a
    // purchase cost, subtracted from what a sale returned. A basis that ignores
    // them overstates every gain by exactly the amount actually paid to trade.
    const nativeAmount = side === 'BUY' ? gross + commission + tax : gross - commission - tax
    const unitPrice = number(exec.averageFilledPrice)

    transactionRows.push({
      market,
      currency,
      base_currency: 'KRW',
      brokerage: tossAccountLabel,
      account_type: '',
      source_system: 'toss_open_api_orders',
      date,
      account: tossAccountLabel,
      type: side === 'SELL' ? 'SELL' : 'BUY',
      raw_type: `${text(order.orderType)} ${side}`.trim(),
      ticker,
      name,
      quantity,
      native_amount: nativeAmount,
      native_settlement: null,
      native_unit_price: unitPrice,
      amount_krw: toKrw(nativeAmount),
      settlement_krw: null,
      unit_price: toKrw(unitPrice),
      fee: commission,
      tax,
      balance: null,
      source: 'toss-snapshot.json',
      page: null,
    })
    tossBridgedFills += 1

    if (side === 'BUY') {
      const lot = {
        market,
        currency,
        base_currency: 'KRW',
        fx_rate_to_base: currency === 'KRW' ? 1 : usdRate,
        brokerage: tossAccountLabel,
        account_type: '',
        source_system: 'toss_open_api_orders',
        as_of_date: date,
        account: tossAccountLabel,
        ticker,
        name,
        acquired_date: date,
        open_quantity: quantity,
        native_cost_basis: nativeAmount,
        native_unit_cost: quantity ? nativeAmount / quantity : null,
        native_market_value: null,
        native_unrealized_gl: null,
        cost_basis_krw: toKrw(nativeAmount) ?? 0,
        unit_cost: quantity ? (toKrw(nativeAmount) ?? 0) / quantity : null,
        holding_days: null,
        tax_term: '',
        source: 'toss-snapshot.json',
      }
      taxLotRows.push(lot)
      if (!openLots.has(ticker)) openLots.set(ticker, [])
      openLots.get(ticker).push(lot)
      continue
    }

    tossBridgedSells += 1
    let remaining = quantity
    const lots = openLots.get(ticker) ?? []
    for (const lot of lots) {
      if (remaining <= 1e-9) break
      if (!(lot.open_quantity > 0)) continue
      const taken = Math.min(lot.open_quantity, remaining)
      const share = lot.open_quantity ? taken / lot.open_quantity : 0
      const costKrw = (lot.cost_basis_krw ?? 0) * share
      const nativeCost = (lot.native_cost_basis ?? 0) * share
      const proceedsNative = quantity ? nativeAmount * (taken / quantity) : 0
      const proceedsKrw = toKrw(proceedsNative)
      const days = lot.acquired_date
        ? Math.round((Date.parse(date) - Date.parse(lot.acquired_date)) / 86_400_000)
        : null
      realizedRows.push({
        market,
        currency,
        base_currency: 'KRW',
        brokerage: tossAccountLabel,
        source_system: 'toss_open_api_orders',
        account: tossAccountLabel,
        ticker,
        name,
        acquired_date: lot.acquired_date,
        sold_date: date,
        quantity_sold: taken,
        cost_basis_krw: costKrw,
        proceeds_krw: proceedsKrw,
        realized_gl_krw: proceedsKrw == null ? null : proceedsKrw - costKrw,
        holding_days: days,
        // Same 365-day boundary the certificate replay uses, so a lot does not
        // change tax term depending on which source happened to close it.
        tax_term: days == null ? '' : days > 365 ? 'Long-term' : 'Short-term',
        basis: 'replay',
        tax_year: date.slice(0, 4),
        native_cost_basis: nativeCost,
        native_proceeds: proceedsNative,
        native_realized_gl: proceedsNative - nativeCost,
      })
      lot.open_quantity -= taken
      lot.cost_basis_krw = (lot.cost_basis_krw ?? 0) - costKrw
      lot.native_cost_basis = (lot.native_cost_basis ?? 0) - nativeCost
      remaining -= taken
    }
    if (remaining > 1e-6) {
      // A sale with no lot behind it means the shares arrived some way the order
      // book cannot show — a transfer in, most likely. Named rather than dropped:
      // silently selling from nothing would book the whole proceeds as gain.
      tossOrderNotes.push(`${date} ${ticker}: sold ${quantity} with only ${quantity - remaining} in open lots`)
    }
  }

  if (tossBridgedFills) {
    console.error(
      `[toss] ${tossBridgedFills} order fill(s) after the statement cutoff ${tossBridgeCutoff ?? '(none)'} ` +
        `bridged into transactions and lots (${tossBridgedSells} sell(s))` +
        (tossOrderNotes.length ? `; ${tossOrderNotes.length} note(s)` : '')
    )
    for (const note of tossOrderNotes) console.error(`[toss]   ${note}`)
  }
}

const dividendRows = datasets.dividends.rows.map((r) => ({
  market: 'KR',
  currency: text(r.Currency) || 'KRW',
  base_currency: 'KRW',
  brokerage: text(r.Account).split('(')[0],
  account_type: text(r.Account).match(/\(([^)]+)\)/)?.[1] ?? '',
  source_system: text(r.Currency) ? 'korea_statement' : 'korea_sheet_payload',
  date: text(r.Date),
  account: text(r.Account),
  ticker: normalizeTicker(r.Symbol),
  name: text(r.Name),
  native_amount: number(pick(r, 'Native Amount', 'Amount (KRW)')) ?? 0,
  native_tax_withheld: null,
  amount_krw: krAmount(r, 'Amount (KRW)') ?? 0,
  type: text(r.Type),
  source: text(r.Source),
  page: number(r.Page),
}))

// Chase asset classes that are not positions. An allowlist would silently drop
// whatever class the broker invents next; a denylist of cash-like classes fails
// in the visible direction instead.
const CHASE_NON_POSITION_CLASSES = new Set(['Cash & Money Market Funds', 'Cash and Money Market Funds'])

// Which of Merrill's two holdings layouts the ingest actually read. Only one of
// them carries tax lots, and `pick: 'latest'` means downloading the flat one
// REPLACES the lot detail with nothing — the positions stay right and the lots
// simply stop existing. That is this repo's standing failure shape, so the
// layout is recorded here and reported as its own check rather than left to be
// noticed on a tax-planning screen that has quietly gone empty.
let merrillHoldingsLayout = null

const MONTH_ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// When a Fidelity positions export was taken, from its own footer:
// `"Date downloaded Jul-31-2026 at 8:24 p.m ET"`. Not from the filename — the
// whole of docs/data-sources.md rests on filenames not being believed — and not
// from the row dates, because a positions snapshot has none. Note the month-name
// format: the Fidelity TRANSACTIONS export stamps the same sentence
// `07/31/2026`, so the two cannot share a parser.
function fidelityHoldingsAsOf(filename) {
  const match = fs
    .readFileSync(filename, 'utf8')
    .match(/Date downloaded\s+([A-Za-z]{3})[a-z]*-(\d{1,2})-(\d{4})/i)
  if (!match) return ''
  const month = MONTH_ABBREVIATIONS.indexOf(match[1].toLowerCase()) + 1
  if (!month) return ''
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

// Money-market sweeps: the account's cash wearing a ticker. Declared here rather
// than beside the replay that also uses it, because the holdings parsers below
// have to exclude exactly this set — if a parser admitted a sweep the reconcile
// skips, the position would count toward the portfolio total while having
// nothing on the replay side to answer for it.
const US_CASH_EQUIVALENT_TICKERS = new Set(['SPAXX', 'QACDS', 'FDRXX', 'SPRXX'])

// Rows inside Merrill's positions table that are not positions. The `Balances`
// block and the `Total` row share the table with the holdings and have the same
// shape as them, so they are excluded by the label in the Symbol column rather
// than by hoping a ticker pattern happens not to match `Cash balance`.
const MERRILL_NON_POSITION_ROWS = new Set([
  'Balances',
  'Money accounts',
  'Cash balance',
  'Pending activity',
  'Total',
  'Reinvestments',
])

// Brokers decorate the ticker cell with trade annotations — Merrill exported
// "JEPI !  Executed Buy". Read the leading symbol rather than requiring the
// whole cell to be one, or the annotated position vanishes.
const TICKER_CELL = /^([A-Z][A-Z0-9.-]{0,11})\b/

for (const source of usHoldingFiles) {
  if (!fs.existsSync(source.filename)) continue
  if (source.brokerage === 'Chase') {
    const rows = readCsvObjects(source.filename, (r) => r.includes('Account name') && r.includes('Ticker'))
    for (const r of rows) {
      if (!required(r.Ticker) || !required(r.Quantity)) continue
      // Keep every asset class except cash. Filtering to "Equity" dropped
      // $15,783 of real positions — Chase files gold ETFs (IAU, SGOL) and
      // covered-call ETFs (JEPQ) under "Alternative Assets", and they are
      // holdings like any other. Cash and money-market sweeps are not
      // positions, so those stay out (QACDS below is the sweep ticker).
      if (CHASE_NON_POSITION_CLASSES.has(text(r['Asset Class']))) continue
      if (normalizeTicker(r.Ticker) === 'QACDS') continue
      const quantity = number(r.Quantity) ?? 0
      const cost = number(r.Cost) ?? number(r['Orig Cost (Base)']) ?? 0
      const marketValue = number(r.Value)
      const unrealized = number(r['Unrealized G/L Amt.'])
      const currency = text(r['Base CCY']) || 'USD'
      const fx = fxRate(currency)
      const asOf = dateIso(r['As of'] || r['Pricing Date'])
      const account = `${source.brokerage} ${text(r['Account name'])} ${text(r['Account number'])}`.trim()
      const shared = {
        market: 'US',
        currency,
        base_currency: 'KRW',
        fx_rate_to_base: fx?.rate ?? null,
        brokerage: source.brokerage,
        account_type: text(r['Account type'] || r['Acct Type']),
        source_system: path.basename(source.filename),
        as_of_date: asOf,
        account,
        ticker: normalizeTicker(r.Ticker),
        name: text(r.Description),
      }
      taxLotRows.push({
        ...shared,
        acquired_date: dateIso(r['Acquisition Date']),
        open_quantity: quantity,
        native_cost_basis: cost,
        native_unit_cost: number(r['Unit Cost']),
        native_market_value: marketValue,
        native_unrealized_gl: unrealized,
        cost_basis_krw: toBase(cost, currency) ?? 0,
        unit_cost: toBase(number(r['Unit Cost']), currency),
        holding_days: number(r['Days held']),
        tax_term: normalizeTerm(r['Tax term']),
        source: path.basename(source.filename),
      })
    }
  }

  // Fidelity's positions export, the source that did not exist. Its trades were
  // ingested and its positions were not, so every screen showed a portfolio
  // smaller than the real one — about $51k across five tickers at the peak —
  // and nothing anywhere said so. `us_brokerage_positions_ingested` could only
  // infer from the transactions that the account looked closed; this file is
  // the account saying otherwise for itself.
  //
  // One account per row, and the filer refuses a multi-account export, so the
  // account label is read off the rows rather than assumed. It will not match
  // the `Fidelity Account` the transactions carry — that export has no account
  // column at all — which is the same two-sided labelling the Robinhood sources
  // already have, and why the replay reconciles per brokerage and not per
  // account.
  if (source.brokerage === 'Fidelity') {
    const rows = readCsvObjects(source.filename, (r) => r.includes('Account number') && r.includes('Symbol'))
    for (const r of rows) {
      const accountNumber = text(r['Account number'])
      // The export ends in three paragraphs of disclaimer, each a single quoted
      // cell. An account number is what makes a row a position row.
      if (!/^[A-Z0-9]{6,}$/.test(accountNumber)) continue
      // `SPAXX**` — Fidelity footnotes the core position in the symbol itself.
      const symbol = normalizeTicker(text(r.Symbol).replace(/\*+$/, ''))
      if (!symbol) continue
      if (US_CASH_EQUIVALENT_TICKERS.has(symbol)) continue
      const quantity = number(r.Quantity)
      if (quantity == null) continue
      const cost = number(r['Cost basis total']) ?? 0
      const value = number(r['Current value'])
      const unrealized = number(r['Total gain/loss dollar'])
      holdingRows.push({
        market: 'US',
        currency: 'USD',
        base_currency: 'KRW',
        fx_rate_to_base: fxRate('USD')?.rate ?? null,
        brokerage: source.brokerage,
        account_type: text(r.Type),
        source_system: path.basename(source.filename),
        as_of_date: fidelityHoldingsAsOf(source.filename),
        // Fidelity prefixes the registered name with the custodian in brackets
        // — `[Fidelity] Individual - TOD` — which would render as
        // "Fidelity [Fidelity] Individual - TOD". Drop the bracket, keep the
        // rest of the broker's own words for the account.
        account: `${source.brokerage} ${text(r['Account name']).replace(/^\[[^\]]*\]\s*/, '')} ${accountNumber}`.trim(),
        ticker: symbol,
        name: text(r.Description),
        quantity,
        native_average_unit_cost: number(r['Average cost basis']),
        native_cost: cost,
        native_price: number(r['Last price']),
        native_market_value: value,
        native_unrealized_gl: unrealized,
        native_unrealized_gl_pct: number(r['Total gain/loss percent']),
        base_cost: toBase(cost, 'USD'),
        base_market_value: toBase(value, 'USD'),
        base_unrealized_gl: toBase(unrealized, 'USD'),
        average_unit_cost: null,
        total_cost_krw: toBase(cost, 'USD') ?? 0,
        current_price: null,
        pe: null,
        eps: null,
        unrealized_gl_krw: null,
        unrealized_gl_pct: null,
        long_term_qty: null,
        short_term_qty: null,
        lot_count: null,
      })
    }
    continue
  }

  if (source.brokerage === 'Merrill') {
    const rows = parseCsv(fs.readFileSync(source.filename, 'utf8')).filter((r) => r.some((c) => c.trim()))
    let account = 'Merrill'
    const accountLine = rows.find((r) => r[0]?.includes('Selected account'))
    if (accountLine) account = `Merrill ${accountLine.join(' ').split(':').slice(1).join(':').trim()}`
    let currentTicker = ''
    let currentName = ''
    // The export's own `Exported on: 07/31/2026 08:48 PM ET`. This was a
    // hardcoded '2026-07-15' — right for the one file on disk when it was
    // written, and quietly wrong for every download after it. A positions
    // snapshot that reports the wrong date is worse than one that reports none,
    // because the staleness checks believe it.
    const exportedLine = rows.find((r) => text(r[0]).startsWith('Exported on:'))
    const asOf = exportedLine ? dateIso(text(exportedLine[0]).replace(/^Exported on:\s*/, '').replace(/\s+\d{1,2}:\d{2}.*$/, '')) : ''

    // Which of Merrill's two holdings layouts this is. Both are reached from the
    // same page and neither says which it is, so the header row is the only
    // thing that can tell them apart:
    //
    //   tax-lot detail   Symbol | Quantity | Unit Cost | Cost Basis | Price | …
    //                    with an `Acquisition Date` block under each position.
    //   flat positions   Symbol | Description | Quantity | Price | … |
    //                    Total Client Investment | Unrealized Gain/Loss
    //
    // The columns do not merely move, they differ — the flat layout carries no
    // lots at all and calls the basis something else — so reading either by
    // fixed offsets means one of them is silently misread. Column NAMES are read
    // instead, from whichever header the file actually has.
    const headerIndex = rows.findIndex((r) => r.some((c) => text(c) === 'Symbol'))
    const header = headerIndex >= 0 ? rows[headerIndex].map((c) => text(c)) : []
    const columnOf = (name) => header.indexOf(name)
    const flatLayout = headerIndex >= 0 && columnOf('Total Client Investment') >= 0 && columnOf('Cost Basis') < 0
    merrillHoldingsLayout = { flat: flatLayout, file: path.basename(source.filename), asOf }

    if (flatLayout) {
      const symbolAt = columnOf('Symbol')
      const cell = (r, name) => (columnOf(name) >= 0 ? r[columnOf(name)] : '')
      for (const r of rows.slice(headerIndex + 1)) {
        const label = text(r[symbolAt])
        // The `Balances` block and the `Total` row sit in the same table as the
        // positions and look like them: `Money accounts` has a quantity of 28
        // and a price of $1.00, and `Total` carries the account's whole value.
        // Booking either as a position would add the cash sweep to the equity
        // total and then add the total to itself.
        if (!label || MERRILL_NON_POSITION_ROWS.has(label)) continue
        const symbol = TICKER_CELL.exec(label)?.[1]
        if (!symbol) continue
        const quantity = number(cell(r, 'Quantity'))
        if (quantity == null) continue
        const cost = number(cell(r, 'Total Client Investment')) ?? 0
        const value = number(cell(r, 'Value'))
        const unrealized = number(text(cell(r, 'Unrealized Gain/Loss $ Chg % Chg')).split(' ')[0])
        holdingRows.push({
          market: 'US',
          currency: 'USD',
          base_currency: 'KRW',
          fx_rate_to_base: fxRate('USD')?.rate ?? null,
          brokerage: source.brokerage,
          account_type: '',
          source_system: path.basename(source.filename),
          as_of_date: asOf,
          account,
          ticker: normalizeTicker(symbol),
          name: text(cell(r, 'Description')) || symbol,
          quantity,
          // This layout prints no unit cost. Basis over quantity is not a guess
          // at one, it is the definition of one, so it is derived rather than
          // left null — the tax-lot layout supplies the same number directly.
          native_average_unit_cost: quantity ? cost / quantity : null,
          native_cost: cost,
          native_price: number(cell(r, 'Price')),
          native_market_value: value,
          native_unrealized_gl: unrealized,
          native_unrealized_gl_pct: null,
          base_cost: toBase(cost, 'USD'),
          base_market_value: toBase(value, 'USD'),
          base_unrealized_gl: toBase(unrealized, 'USD'),
          average_unit_cost: null,
          total_cost_krw: toBase(cost, 'USD') ?? 0,
          current_price: null,
          pe: null,
          eps: null,
          unrealized_gl_krw: null,
          unrealized_gl_pct: null,
          long_term_qty: null,
          short_term_qty: null,
          lot_count: null,
        })
      }
      continue
    }

    for (const r of rows) {
      const symbol = TICKER_CELL.exec(text(r[1]))?.[1]
      if (symbol && number(r[2]) != null && text(r[2]) !== '') {
        currentTicker = symbol
        currentName = currentTicker
        const quantity = number(r[2]) ?? 0
        const cost = number(r[4]) ?? 0
        const price = number(r[5])
        const value = number(r[6])
        holdingRows.push({
          market: 'US',
          currency: 'USD',
          base_currency: 'KRW',
          fx_rate_to_base: fxRate('USD')?.rate ?? null,
          brokerage: source.brokerage,
          account_type: '',
          source_system: path.basename(source.filename),
          as_of_date: asOf,
          account,
          ticker: currentTicker,
          name: currentName,
          quantity,
          native_average_unit_cost: number(r[3]),
          native_cost: cost,
          native_price: price,
          native_market_value: value,
          native_unrealized_gl: number(text(r[7]).split(' ')[0]),
          native_unrealized_gl_pct: null,
          base_cost: toBase(cost, 'USD'),
          base_market_value: toBase(value, 'USD'),
          base_unrealized_gl: toBase(number(text(r[7]).split(' ')[0]), 'USD'),
          average_unit_cost: null,
          total_cost_krw: toBase(cost, 'USD') ?? 0,
          current_price: null,
          pe: null,
          eps: null,
          unrealized_gl_krw: null,
          unrealized_gl_pct: null,
          long_term_qty: null,
          short_term_qty: null,
          lot_count: null,
        })
      } else if (currentTicker && text(r[2]).match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
        taxLotRows.push({
          market: 'US',
          currency: 'USD',
          base_currency: 'KRW',
          fx_rate_to_base: fxRate('USD')?.rate ?? null,
          brokerage: source.brokerage,
          account_type: '',
          source_system: path.basename(source.filename),
          as_of_date: asOf,
          account,
          ticker: currentTicker,
          name: currentName,
          acquired_date: dateIso(text(r[2]).replace(/\s+\(.+\)$/, '')),
          open_quantity: number(r[3]) ?? 0,
          native_cost_basis: number(r[5]) ?? 0,
          native_unit_cost: number(r[4]),
          native_market_value: number(r[7]),
          native_unrealized_gl: number(text(r[8]).split(' ')[0]),
          cost_basis_krw: toBase(number(r[5]) ?? 0, 'USD') ?? 0,
          unit_cost: toBase(number(r[4]), 'USD'),
          holding_days: null,
          tax_term: normalizeTerm(r[2]),
          source: path.basename(source.filename),
        })
      }
    }
  }
}

// Robinhood lots straight from the broker's MCP, replacing three Gain/Loss PDFs
// that arrived only because the account holder emailed customer support and
// waited. That is not a refresh path: it has no cadence, no credential and no
// script, so the positions behind it could only ever get older.
//
// The same boundary Toss follows. A broker download is a file a person fetched
// and dropped under STOCK_DATA_DIR; a snapshot is machine-generated and lives in
// the repo's gitignored `data/`. Which side a file sits on is what answers "what
// do I still have to fetch by hand", and `us-holdings/` could not answer it
// while the PDFs sat there looking like the CSVs beside them.
//
// One raw file, timestamped, with the modelling left here — so changing how the
// data is shaped never costs another 67 API calls. Unlike the Toss snapshot no
// cron writes this one; it is regenerated by a session that can reach the MCP,
// which is exactly why `robinhood_snapshot_fresh` below has to be loud.
const robinhoodSnapshot = fs.existsSync(robinhoodSnapshotPath)
  ? JSON.parse(fs.readFileSync(robinhoodSnapshotPath, 'utf8'))
  : null

// The MCP's own field names are not frozen by anything this repo controls, and a
// renamed key would otherwise drop lots silently — a position quietly worth less
// rather than an error. So each field is read through its plausible aliases and
// anything that still cannot be mapped is counted, named and surfaced by
// `robinhood_snapshot_lots_mapped` rather than skipped.
const firstOf = (object, keys) => {
  for (const key of keys) {
    const value = object?.[key]
    if (value != null && value !== '') return value
  }
  return null
}
const robinhoodUnmappedLots = []
let robinhoodSnapshotLotCount = 0
const robinhoodSymbolsWithoutLots = []
// The MCP position carries no security name, only a ticker — the PDFs did, so
// this is what keeps a name on a ticker the reports already covered instead of
// falling back to blank the moment the snapshot takes over.
const robinhoodNameByTicker = new Map()
for (const report of usPdfEvidence.reports ?? []) {
  if (report.category !== 'us_gain_loss_pdf') continue
  for (const lot of report.lots ?? []) {
    const ticker = normalizeTicker(text(lot.ticker))
    if (ticker && text(lot.name) && !robinhoodNameByTicker.has(ticker)) robinhoodNameByTicker.set(ticker, text(lot.name))
  }
}

if (robinhoodSnapshot?.accounts?.length) {
  const asOf = String(robinhoodSnapshot.fetchedAt || '').slice(0, 10)
  for (const account of robinhoodSnapshot.accounts ?? []) {
    const accountNumber = text(firstOf(account, ['accountNumber', 'account_number']))
    // The last four is the label the database has always carried ("Robinhood
    // 1478") and every downstream join is on that string, so the full account
    // number is only ever a way of deriving it.
    const hint = accountNumber.slice(-4)
    const label = text(account.account) || `Robinhood ${hint}`.trim()
    const nickname = text(account.nickname)
    const positions = account.positions ?? []
    // Robinhood names the security on the position, not on the lot.
    const nameBySymbol = new Map(
      positions
        .map((p) => [text(firstOf(p, ['symbol', 'instrument_symbol', 'ticker'])), text(firstOf(p, ['name', 'simple_name', 'instrument_name']))])
        .filter(([symbol, name]) => symbol && name)
    )
    // `get_equity_tax_lots` is one call per symbol per account, so a partial
    // pull is the expected failure, not an exotic one. Whatever the generating
    // session could not fetch is recorded in the snapshot and named here — the
    // one outcome that must never happen is a short answer that reads as a
    // complete one.
    const lotGroups = account.lots ?? []
    const symbolsWithLots = new Set()
    for (const group of lotGroups) {
      const groupSymbol = text(firstOf(group, ['symbol', 'instrument_symbol', 'ticker']))
      for (const lot of group.lots ?? []) {
        const symbol = normalizeTicker(text(firstOf(lot, ['symbol', 'instrument_symbol', 'ticker'])) || groupSymbol)
        // `quantity_available` is what is free to sell, which a pledged or
        // pending-settlement lot understates. The position is `quantity`.
        const quantity = number(firstOf(lot, ['quantity', 'open_quantity', 'units']))
        const cost = number(firstOf(lot, ['tax_cost_basis', 'cost_basis', 'total_cost', 'native_cost_basis']))
        if (!required(symbol) || quantity == null || cost == null) {
          robinhoodUnmappedLots.push(`${label} ${groupSymbol || '?'} ${text(firstOf(lot, ['open_lot_id', 'id'])) || 'lot'}`)
          continue
        }
        symbolsWithLots.add(symbol)
        robinhoodSnapshotLotCount += 1
        const unitCost = number(firstOf(lot, ['cost_per_share', 'average_cost', 'unit_cost', 'price', 'native_unit_cost']))
        const resolvedUnitCost = unitCost ?? (quantity ? cost / quantity : null)
        taxLotRows.push({
          market: 'US',
          currency: 'USD',
          base_currency: 'KRW',
          fx_rate_to_base: fxRate('USD')?.rate ?? null,
          brokerage: 'Robinhood',
          account_type: nickname || hint,
          source_system: 'robinhood_mcp',
          as_of_date: asOf,
          account: label,
          ticker: symbol,
          name: nameBySymbol.get(symbol) || robinhoodNameByTicker.get(symbol) || '',
          acquired_date: String(text(firstOf(lot, ['open_date', 'acquired_date', 'opened_at', 'created_at', 'acquisition_date']))).slice(0, 10),
          open_quantity: quantity,
          native_cost_basis: cost,
          native_unit_cost: resolvedUnitCost,
          native_market_value: null,
          native_unrealized_gl: null,
          cost_basis_krw: toBase(cost, 'USD') ?? 0,
          unit_cost: toBase(resolvedUnitCost, 'USD'),
          holding_days: null,
          tax_term: normalizeTerm(firstOf(lot, ['term', 'tax_term', 'gl_term'])),
          source: path.basename(robinhoodSnapshotPath),
        })
      }
    }
    for (const position of positions) {
      const symbol = normalizeTicker(text(firstOf(position, ['symbol', 'instrument_symbol', 'ticker'])))
      if (symbol && !symbolsWithLots.has(symbol)) robinhoodSymbolsWithoutLots.push(`${label} ${symbol}`)
    }
    console.error(
      `[robinhood] ${label}${nickname ? ` (${nickname})` : ''}: ` +
      `${positions.length} position(s), ${lotGroups.length} symbol(s) with lots (fetched ${asOf || 'undated'})`
    )
  }
}

// The Gain/Loss PDFs remain the source only while no snapshot exists. Cutting
// them the moment the snapshot was wired would have emptied every Robinhood
// position on any machine that has not generated one yet — a silent loss of 691
// lots, which is a worse failure than the staleness this replaces. Toss made the
// same trade for the same reason: the live source is preferred, the hand-fetched
// one is the floor, and a check says which answered.
//
// They keep being PARSED either way. `extract-us-pdf-evidence.py` still registers
// them as evidence — they are the only record of these positions before the
// snapshot existed, and `us_pdf_evidence_extracted` asserts on their presence.
// What changes is that their lots stop reaching the database once the MCP can.
for (const report of robinhoodSnapshotLotCount > 0 ? [] : usPdfEvidence.reports ?? []) {
  if (report.category !== 'us_gain_loss_pdf') continue
  const asOf = dateFromGainLossFilename(report.filename) || '2026-07-16'
  for (const lot of report.lots ?? []) {
    if (!required(lot.ticker) || lot.open_quantity == null || lot.native_cost_basis == null) continue
    const quantity = Number(lot.open_quantity)
    const cost = Number(lot.native_cost_basis)
    const unitCost = Number(lot.native_unit_cost)
    taxLotRows.push({
      market: 'US',
      currency: 'USD',
      base_currency: 'KRW',
      fx_rate_to_base: fxRate('USD')?.rate ?? null,
      brokerage: 'Robinhood',
      account_type: text(lot.account_hint),
      source_system: 'us_gain_loss_pdf',
      as_of_date: asOf,
      account: text(lot.account) || `Robinhood ${text(report.account_hint)}`.trim(),
      ticker: normalizeTicker(lot.ticker),
      name: text(lot.name),
      acquired_date: text(lot.acquired_date),
      open_quantity: quantity,
      native_cost_basis: cost,
      native_unit_cost: Number.isFinite(unitCost) ? unitCost : quantity ? cost / quantity : null,
      native_market_value: null,
      native_unrealized_gl: null,
      cost_basis_krw: toBase(cost, 'USD') ?? 0,
      unit_cost: toBase(Number.isFinite(unitCost) ? unitCost : quantity ? cost / quantity : null, 'USD'),
      holding_days: null,
      tax_term: normalizeTerm(lot.tax_term),
      source: text(lot.source) || text(report.filename),
    })
  }
}

const chaseLotsByKey = new Map()
for (const lot of taxLotRows.filter((r) => r.market === 'US' && r.brokerage === 'Chase')) {
  const key = `${lot.account}\t${lot.ticker}`
  const cur = chaseLotsByKey.get(key) || { ...lot, quantity: 0, cost: 0, marketValue: 0, unrealized: 0, lotCount: 0 }
  cur.quantity += lot.open_quantity
  cur.cost += lot.native_cost_basis
  cur.marketValue += lot.native_market_value ?? 0
  cur.unrealized += lot.native_unrealized_gl ?? 0
  cur.lotCount += 1
  chaseLotsByKey.set(key, cur)
}
for (const lot of chaseLotsByKey.values()) {
  holdingRows.push({
    market: 'US',
    currency: lot.currency || 'USD',
    base_currency: 'KRW',
    fx_rate_to_base: fxRate(lot.currency || 'USD')?.rate ?? null,
    brokerage: lot.brokerage,
    account_type: lot.account_type,
    source_system: lot.source_system,
    as_of_date: lot.as_of_date,
    account: lot.account,
    ticker: lot.ticker,
    name: lot.name,
    quantity: lot.quantity,
    native_average_unit_cost: lot.quantity ? lot.cost / lot.quantity : null,
    native_cost: lot.cost,
    native_price: lot.quantity ? lot.marketValue / lot.quantity : null,
    native_market_value: lot.marketValue,
    native_unrealized_gl: lot.unrealized,
    native_unrealized_gl_pct: lot.cost ? (lot.unrealized / lot.cost) * 100 : null,
    base_cost: toBase(lot.cost, lot.currency || 'USD'),
    base_market_value: toBase(lot.marketValue, lot.currency || 'USD'),
    base_unrealized_gl: toBase(lot.unrealized, lot.currency || 'USD'),
    average_unit_cost: null,
    total_cost_krw: toBase(lot.cost, lot.currency || 'USD') ?? 0,
    current_price: null,
    pe: null,
    eps: null,
    unrealized_gl_krw: null,
    unrealized_gl_pct: null,
    long_term_qty: null,
    short_term_qty: null,
    lot_count: lot.lotCount,
  })
}

const robinhoodLotsByKey = new Map()
for (const lot of taxLotRows.filter((r) => r.market === 'US' && r.brokerage === 'Robinhood')) {
  const key = `${lot.account}\t${lot.ticker}`
  const cur = robinhoodLotsByKey.get(key) || { ...lot, quantity: 0, cost: 0, longQty: 0, shortQty: 0, lotCount: 0 }
  cur.quantity += lot.open_quantity
  cur.cost += lot.native_cost_basis
  if (lot.tax_term === 'Long-term') cur.longQty += lot.open_quantity
  if (lot.tax_term === 'Short-term') cur.shortQty += lot.open_quantity
  cur.lotCount += 1
  robinhoodLotsByKey.set(key, cur)
}
for (const lot of robinhoodLotsByKey.values()) {
  const priceSnapshot = usPricesByTicker.get(lot.ticker)
  const nativePrice = priceSnapshot?.price ?? null
  const marketValue = nativePrice == null ? null : nativePrice * lot.quantity
  const unrealized = marketValue == null ? null : marketValue - lot.cost
  holdingRows.push({
    market: 'US',
    currency: 'USD',
    base_currency: 'KRW',
    fx_rate_to_base: fxRate('USD')?.rate ?? null,
    brokerage: lot.brokerage,
    account_type: lot.account_type,
    source_system: lot.source_system,
    as_of_date: lot.as_of_date,
    account: lot.account,
    ticker: lot.ticker,
    name: lot.name,
    quantity: lot.quantity,
    native_average_unit_cost: lot.quantity ? lot.cost / lot.quantity : null,
    native_cost: lot.cost,
    native_price: nativePrice,
    native_market_value: marketValue,
    native_unrealized_gl: unrealized,
    native_unrealized_gl_pct: unrealized == null || lot.cost === 0 ? null : (unrealized / lot.cost) * 100,
    base_cost: toBase(lot.cost, 'USD'),
    base_market_value: toBase(marketValue, 'USD'),
    base_unrealized_gl: toBase(unrealized, 'USD'),
    average_unit_cost: null,
    total_cost_krw: toBase(lot.cost, 'USD') ?? 0,
    current_price: nativePrice,
    pe: null,
    eps: null,
    unrealized_gl_krw: toBase(unrealized, 'USD'),
    unrealized_gl_pct: unrealized == null || lot.cost === 0 ? null : (unrealized / lot.cost) * 100,
    long_term_qty: lot.longQty,
    short_term_qty: lot.shortQty,
    lot_count: lot.lotCount,
  })
}

for (const source of usTransactionFiles) {
  if (!fs.existsSync(source.filename)) continue
  if (source.brokerage === 'Chase') {
    const rows = readCsvObjects(source.filename, (r) => r.includes('Trade Date') && r.includes('Ticker'))
    for (const r of rows) {
      const type = normalizeUsTransactionType(r.Type)
      const amount = number(r['Amount USD']) ?? number(r['Amount Local'])
      const tax = number(r['Tax Withheld'])
      const currency = text(r['Local Currency']) || 'USD'
      const row = {
        market: 'US',
        currency,
        base_currency: 'KRW',
        brokerage: source.brokerage,
        account_type: text(r['Account Type']),
        source_system: path.basename(source.filename),
        date: dateIso(r['Trade Date']),
        account: `${source.brokerage} ${text(r['Account Name'])} ${text(r['Account Number'])}`.trim(),
        type,
        raw_type: text(r.Type),
        ticker: normalizeTicker(r.Ticker),
        name: text(r.Description),
        quantity: number(r.Quantity),
        native_amount: amount,
        native_settlement: amount,
        native_unit_price: number(r['Price USD']) ?? number(r['Price Local']),
        amount_krw: toBase(amount, currency),
        settlement_krw: toBase(amount, currency),
        unit_price: toBase(number(r['Price USD']) ?? number(r['Price Local']), currency),
        fee: number(r['Commissions USD']) ?? number(r['Commissions Local']),
        tax,
        balance: number(r.Balance),
        source: path.basename(source.filename),
        page: null,
      }
      transactionRows.push(row)
      if (isIncomeType(type)) {
        dividendRows.push({
          market: 'US',
          currency: row.currency,
          base_currency: 'KRW',
          brokerage: source.brokerage,
          account_type: row.account_type,
          source_system: row.source_system,
          date: row.date,
          account: row.account,
          ticker: row.ticker,
          name: row.name,
          native_amount: amount ?? 0,
          native_tax_withheld: tax,
          amount_krw: toBase(amount ?? 0, row.currency) ?? 0,
          type: row.raw_type,
          source: row.source,
          page: null,
        })
      }
    }
  }
  if (source.brokerage === 'Fidelity') {
    const rows = readCsvObjects(source.filename, (r) => r.includes('Run Date') && r.includes('Action') && r.includes('Symbol'))
    for (const r of rows) {
      if (!text(r['Run Date']).match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) continue
      const type = normalizeUsTransactionType('', r.Action)
      if (!type) continue
      const amount = number(r['Amount ($)'])
      const row = {
        market: 'US',
        currency: 'USD',
        base_currency: 'KRW',
        brokerage: source.brokerage,
        account_type: text(r.Type),
        source_system: path.basename(source.filename),
        date: dateIso(r['Run Date']),
        account: `${source.brokerage} Account`,
        type,
        raw_type: text(r.Action),
        ticker: normalizeTicker(r.Symbol),
        name: text(r.Description),
        quantity: number(r.Quantity),
        native_amount: amount,
        native_settlement: amount,
        native_unit_price: number(r['Price ($)']),
        amount_krw: toBase(amount, 'USD'),
        settlement_krw: toBase(amount, 'USD'),
        unit_price: toBase(number(r['Price ($)']), 'USD'),
        fee: number(r['Fees ($)']) ?? number(r['Commission ($)']),
        tax: null,
        balance: number(r['Cash Balance ($)']),
        source: path.basename(source.filename),
        page: null,
      }
      transactionRows.push(row)
      if (isIncomeType(type)) {
        dividendRows.push({
          market: 'US',
          currency: 'USD',
          base_currency: 'KRW',
          brokerage: source.brokerage,
          account_type: row.account_type,
          source_system: row.source_system,
          date: row.date,
          account: row.account,
          ticker: row.ticker,
          name: row.name,
          native_amount: amount ?? 0,
          native_tax_withheld: null,
          amount_krw: toBase(amount ?? 0, 'USD') ?? 0,
          type: row.raw_type,
          source: row.source,
          page: null,
        })
      }
    }
  }
  if (source.brokerage === 'Merrill') {
    const rows = readCsvObjects(source.filename, (r) => r.map((c) => c.trim()).includes('Trade Date') && r.map((c) => c.trim()).includes('Symbol/ CUSIP'))
    for (const r of rows) {
      if (!text(r['Trade Date']).match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) continue
      const type = normalizeMerrillTransactionType(r.Description, r.Type)
      const amount = number(r.Amount)
      const row = {
        market: 'US',
        currency: 'USD',
        base_currency: 'KRW',
        brokerage: source.brokerage,
        account_type: 'Brokerage',
        source_system: path.basename(source.filename),
        date: dateIso(r['Trade Date']),
        account: `${source.brokerage} ${text(r.Account)}`.trim(),
        type,
        raw_type: text(r.Type) || text(r.Description).split(/\s+/).slice(0, 4).join(' '),
        ticker: normalizeTicker(r['Symbol/ CUSIP']),
        name: text(r.Description),
        quantity: number(r.Quantity),
        native_amount: amount,
        native_settlement: amount,
        native_unit_price: number(r.Price),
        amount_krw: toBase(amount, 'USD'),
        settlement_krw: toBase(amount, 'USD'),
        unit_price: toBase(number(r.Price), 'USD'),
        fee: null,
        tax: null,
        balance: null,
        source: path.basename(source.filename),
        page: null,
      }
      transactionRows.push(row)
      if (isIncomeType(type)) {
        dividendRows.push({
          market: 'US',
          currency: 'USD',
          base_currency: 'KRW',
          brokerage: source.brokerage,
          account_type: row.account_type,
          source_system: row.source_system,
          date: row.date,
          account: row.account,
          ticker: row.ticker,
          name: row.name,
          native_amount: amount ?? 0,
          native_tax_withheld: null,
          amount_krw: toBase(amount ?? 0, 'USD') ?? 0,
          type: row.type,
          source: row.source,
          page: null,
        })
      }
    }
  }
  if (source.brokerage === 'Robinhood') {
    // REVERSED, and the FIFO replay is why.
    //
    // Robinhood writes its CSVs newest-first. The replay sorts rows by date and
    // that sort is stable, so rows sharing a date stay in the order they were
    // read — which meant every same-day trade was walked backwards. FIFO that
    // consumes the LAST lot opened that day is not FIFO, and it silently changes
    // which lot a later sale is paired against, and therefore its holding period
    // and its realized gain.
    //
    // Verified against the broker's own order history rather than assumed: of
    // the 44 (day, ticker) groups on Mid-term holding more than one trade,
    // reversing the file reproduces the execution-timestamp order in 42. The two
    // it does not are ties — two fills of one order stamped the same
    // millisecond — where no true order exists to recover in either source.
    const rows = readCsvObjects(source.filename, (r) => r.includes('Activity Date') && r.includes('Trans Code')).reverse()
    for (const r of rows) {
      if (!text(r['Activity Date']).match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) continue
      const type = normalizeUsTransactionType(r['Trans Code'], r.Description)
      const amount = number(r.Amount)
      const row = {
        market: 'US',
        currency: 'USD',
        base_currency: 'KRW',
        brokerage: source.brokerage,
        account_type: source.account ?? '',
        source_system: path.basename(source.filename),
        date: dateIso(r['Activity Date']),
        account: `${source.brokerage} ${source.account ?? ''}`.trim(),
        type,
        raw_type: text(r['Trans Code']),
        ticker: normalizeTicker(r.Instrument),
        name: text(r.Description).replace(/\s*CUSIP:.*$/s, '').trim(),
        quantity: number(r.Quantity),
        native_amount: amount,
        native_settlement: amount,
        native_unit_price: number(r.Price),
        amount_krw: toBase(amount, 'USD'),
        settlement_krw: toBase(amount, 'USD'),
        unit_price: toBase(number(r.Price), 'USD'),
        fee: null,
        tax: null,
        balance: null,
        // Read BEFORE `name` drops everything from `CUSIP:` onward — which is
        // where this lives, so it was being thrown away one line above.
        placed_agent: robinhoodPlacedAgent(r.Description, type),
        source: path.basename(source.filename),
        page: null,
      }
      transactionRows.push(row)
      if (isIncomeType(type)) {
        dividendRows.push({
          market: 'US',
          currency: 'USD',
          base_currency: 'KRW',
          brokerage: source.brokerage,
          account_type: row.account_type,
          source_system: row.source_system,
          date: row.date,
          account: row.account,
          ticker: row.ticker,
          name: row.name,
          native_amount: amount ?? 0,
          native_tax_withheld: null,
          amount_krw: toBase(amount ?? 0, 'USD') ?? 0,
          type: row.type,
          source: row.source,
          page: null,
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// US realized lots, replayed from the transactions
// ---------------------------------------------------------------------------
//
// Korea rebuilds its lots from certificates that go back to the account's first
// trade. The US cannot copy that: `tax_lots` here comes from broker exports of
// the lots that are still OPEN, so a lot that was sold is simply absent, and
// matching a past sale against present lots is impossible. So the lots are
// rebuilt by replaying `transactions` instead — the same FIFO walk as
// `build_lots()` in scripts/extract-kr-statements.py, with the same stated
// assumption: FIFO is ours, not the broker's, so where the broker chose
// differently the per-lot split will differ. Its 1099-B, read below, is the
// figure that files; this one is the management figure available year-round.
//
// Every US sale falls inside its brokerage's transaction history, so the walk
// has an opening lot for all of them. That is asserted, not assumed:
// `us_realized_replay_lots_matched` fails if a disposal ever runs out of lots.

const US_LONG_TERM_DAYS = 365
// Sweep money-market funds are the cash balance wearing a ticker. They are not
// positions, they are never sold at a gain, and reconciling them against
// `holdings` (which rightly omits them) would report a permanent mismatch.
const usRealizedRows = []
const usReplayNotes = []
const usReplayLotCostLookups = []
// Arrivals whose cost this repo estimated from a historical close because no
// source carried one. Their own check, so the estimate stays declared.
const usPricedArrivals = []

// The brokers' own lot exports, indexed by where they came from and when they
// opened, so the replay can ask them what a row does not say.
//
// Robinhood books a share it hands you as `REC` with the Price and Amount
// columns empty — the shares are stated, the money is not — so the replay had
// nothing to open the lot with and opened it at zero. Meanwhile the same lot
// sits in Robinhood's tax-lot export with its cost on it: 0.011612 MSFT
// acquired 2024-06-17 for $5.14. The two never disagreed; they were just never
// introduced.
//
// That row is a granted share, not the dividend reinvestment #88 read it as.
// It is the FIRST MSFT row in the history — the next MSFT purchase is
// 2024-10-15, so on 2024-06-17 the position was zero and there was no dividend
// to reinvest. The 2024-09-12 `CDIV` then pays on exactly 0.011612 shares: the
// REC opened the position rather than being paid by one. It lands three days
// after the first $100 ACH deposit, which is when Robinhood hands out its
// sign-up share.
//
// Keyed on acquisition date rather than quantity, because the quantities are
// rounded differently by the two exports — the CSV says 0.0116 where the lot
// export says 0.011612 — and a tolerance wide enough to cover that on a
// fractional share is wide enough to match the wrong lot on a whole one. A date
// carrying more than one lot for the same security is ambiguous and is left
// alone rather than guessed at.
const usBrokerLotCostByOpening = new Map()
for (const lot of taxLotRows) {
  if (lot.market !== 'US' || !(lot.native_unit_cost > 0) || !lot.acquired_date) continue
  const key = `${lot.brokerage}\t${lot.ticker}\t${lot.acquired_date}`
  const seen = usBrokerLotCostByOpening.get(key)
  if (seen === undefined) usBrokerLotCostByOpening.set(key, lot.native_unit_cost)
  else if (seen !== lot.native_unit_cost) usBrokerLotCostByOpening.set(key, null)
}
let usReplayMismatches = []
let usReplayAsOfSkew = []
// Robinhood's holdings can come from the MCP snapshot, which answers live,
// while the replay is only ever as current as the last downloaded transaction
// CSV. A trade the CSV has not caught up to yet is not a wrong replay — it is
// the same two-source-age gap `toss_holdings_lots_provenance` already tracks
// for Toss, so it gets its own bucket here instead of counting against a check
// whose whole point is to catch a REPLAY defect.
let robinhoodReplayMismatches = []
let usReplayReconcilableCount = 0
// `${brokerage}|${ticker}` -> ascending [date, quantity held after that date's
// rows]. Needed to divide a dividend by the shares that actually earned it.
const usPositionTimeline = new Map()

/** Shares held at the START of a date: the closing balance of the last day before it.
 *
 * Deliberately not the closing balance of the date itself. A dividend is paid on
 * what was held when it was declared, and the same day's rows routinely include
 * the disposal that ended the position — Merrill's last QQQI payment landed on
 * the day the residual 0.5725 shares were sold, and dividing by the closing
 * balance divided $0.38 by 0.0067 shares. */
function usPositionAsOf(key, date) {
  const timeline = usPositionTimeline.get(key)
  if (!timeline?.length) return 0
  let held = 0
  for (const entry of timeline) {
    if (entry.date >= date) break
    held = entry.quantity
  }
  return held
}

/** Trim floating-point noise without pretending to more precision than we have. */
function usRound(value, places) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function usHoldingDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

{
  const rows = transactionRows.filter((r) => r.market === 'US')

  // Merrill books a reinvestment as two rows: `Reinvestment Share(s)` carries
  // the quantity with a zero amount, `Reinvestment Program` carries the cost
  // with no quantity. Taking the share leg at face value opens the lot at zero
  // cost, which later books the entire proceeds as gain — a QQQI sale came out
  // at +$32.14 against a true +$1.36. Paired here rather than on the stored
  // transaction so the two legs still sum to what Merrill actually reported.
  const merrillReinvestCost = new Map()
  for (const r of rows) {
    if (r.brokerage === 'Merrill' && text(r.name).toLowerCase().startsWith('reinvestment program')) {
      merrillReinvestCost.set(`${r.date}|${r.ticker}`, Math.abs(number(r.native_amount) ?? 0))
    }
  }
  const costOf = (r) => {
    if (r.brokerage === 'Merrill' && text(r.name).toLowerCase().startsWith('reinvestment share')) {
      return merrillReinvestCost.get(`${r.date}|${r.ticker}`) ?? 0
    }
    return Math.abs(number(r.native_amount) ?? 0)
  }

  // Within one date: purchases, then disposals, then arrivals that carry no cost
  // of their own. A delivery has to be walked before the receipt that claims it
  // (an ACAT settles on one day at both ends), while a same-day buy still has to
  // precede its own sale.
  const rank = (r) => {
    const costless = costOf(r) <= 0 && Math.abs(number(r.native_unit_price) ?? 0) <= 0
    if (r.type === 'SELL' || r.type === 'TRANSFER_OUT') return 1
    if (costless) return 2
    return 0
  }
  const ordered = [...rows].sort(
    (a, b) => String(a.date).localeCompare(String(b.date)) || rank(a) - rank(b)
  )

  const openLots = new Map()   // `${brokerage}|${ticker}` -> [lot]
  const inTransit = new Map()  // ticker -> [lot] delivered out, awaiting a receive
  const lotsFor = (key) => {
    if (!openLots.has(key)) openLots.set(key, [])
    return openLots.get(key)
  }
  const transitFor = (ticker) => {
    if (!inTransit.has(ticker)) inTransit.set(ticker, [])
    return inTransit.get(ticker)
  }

  // A split or a share exchange restates the share count without any money
  // changing hands, so the position keeps its total cost and its acquisition
  // dates and only the per-share figures move. US brokers book the shares ADDED
  // by a split, not the resulting total; a paired corporate action books a
  // blank-quantity leg for the old security and a quantity leg for the new one,
  // and that quantity IS the result (Lucid's 1-for-10 reverse split turned 71
  // shares into 7.1). Both reduce to "restate to a target quantity".
  const restate = (key, target, label, date, ticker, brokerage) => {
    const held = lotsFor(key)
    const current = held.reduce((sum, lot) => sum + lot.qty, 0)
    if (current <= 1e-9 || target <= 1e-9) {
      usReplayNotes.push(`${date} ${brokerage} ${ticker}: ${label} with no position to restate`)
      return
    }
    const factor = target / current
    for (const lot of held) {
      lot.qty *= factor
      lot.unit /= factor
    }
  }

  const snapshot = (key, date) => {
    const total = (openLots.get(key) ?? []).reduce((sum, lot) => sum + lot.qty, 0)
    if (!usPositionTimeline.has(key)) usPositionTimeline.set(key, [])
    const timeline = usPositionTimeline.get(key)
    const last = timeline[timeline.length - 1]
    if (last && last.date === date) last.quantity = total
    else timeline.push({ date, quantity: total })
  }

  for (const r of ordered) {
    const ticker = text(r.ticker)
    if (!ticker || US_CASH_EQUIVALENT_TICKERS.has(ticker)) continue
    const key = `${r.brokerage}|${ticker}`
    const qty = Math.abs(number(r.quantity) ?? 0)
    const amount = costOf(r)
    const unitPrice = Math.abs(number(r.native_unit_price) ?? 0)

    if (r.type === 'STOCK_SPLIT') {
      restate(key, lotsFor(key).reduce((s, l) => s + l.qty, 0) + qty, 'split', r.date, ticker, r.brokerage)
      snapshot(key, r.date)
      continue
    }
    if (r.type === 'CORPORATE_ACTION') {
      if (qty > 0) restate(key, qty, text(r.raw_type) || 'corporate action', r.date, ticker, r.brokerage)
      snapshot(key, r.date)
      continue
    }
    // Lots are pooled per brokerage, so a move between two accounts at the same
    // broker changes nothing and needs no handling of its own.
    if (r.type === 'INTERNAL_TRANSFER' || qty <= 0) continue

    if (r.type === 'BUY' || r.type === 'REINVEST' || r.type === 'TRANSFER_IN') {
      if (amount <= 0 && unitPrice <= 0) {
        // A row with neither an amount nor a price is not a purchase: it is
        // shares arriving. The type cannot settle it — an ACAT receive and a
        // grant both normalize to TRANSFER_IN, and a reinvestment that the
        // broker priced nowhere on the row reaches here too — but the absence
        // of any cost on the row can. Take the delivering broker's lots so the
        // acquisition dates and cost survive the move, which is what decides
        // the holding period on a later sale.
        let remaining = qty
        const pool = transitFor(ticker)
        while (remaining > 1e-9 && pool.length) {
          const lot = pool[0]
          const take = Math.min(lot.qty, remaining)
          lotsFor(key).push({ ...lot, qty: take })
          lot.qty -= take
          remaining -= take
          if (lot.qty <= 1e-9) pool.shift()
        }
        if (remaining > 1e-6) {
          // Nothing in transit either — but the broker's own lot export may
          // still know what these shares cost, so ask it before giving up.
          const lotUnitCost = usBrokerLotCostByOpening.get(`${r.brokerage}\t${ticker}\t${r.date}`)
          if (lotUnitCost) {
            lotsFor(key).push({
              acquired: r.date, qty: remaining, unit: lotUnitCost, name: text(r.name), account: r.account,
            })
            usReplayLotCostLookups.push(
              `${r.date} ${r.brokerage} ${ticker}: ${usRound(remaining, 6)} unit(s) at ${lotUnitCost} ` +
                `from the broker's lot export (${r.type}/${text(r.raw_type)} carried no cost)`
            )
          } else {
            // No delivery claimed these shares, no statement carried a cost, and
            // the broker's own lot export does not list them either. What is
            // left is a grant, and a granted share is property received at its
            // market value — that value is the holder's basis in it. Take the
            // day's close, the same figure the crypto side already uses for a
            // staking reward.
            //
            // ORDER MATTERS HERE. This test used to be "nothing was in transit,
            // therefore granted", which was true only while the two branches
            // above did not exist. Plenty of costed arrivals have nothing in
            // transit — a reinvestment the broker priced only in its lot export
            // is one — so reaching this conclusion before asking the lot export
            // would retype them as rewards and invent income never received.
            // The grant is what remains after every source that could name a
            // cost has been asked and declined.
            //
            // The consequence, deliberately left as it is: an arrival that IS a
            // grant but that the broker's lot export prices takes the branch
            // above and books no SHARE_REWARD income. The basis is right either
            // way — a grant is based at the market value the lot export already
            // carries — so nothing on the gain side is wrong; what is missing is
            // the 1099-MISC side of a share received for nothing. The
            // 2024-06-17 Robinhood MSFT sign-up share is exactly this case.
            // Deciding it needs a rule for telling a priced grant from a priced
            // reinvestment, which no column on either export currently gives.
            //
            // A zero-cost lot books its whole proceeds as gain on a later sale
            // and looks exactly like a real answer, so zero survives only where
            // there is no close to use.
            const close = usCloseOn(ticker, r.date)
            lotsFor(key).push({
              acquired: r.date,
              qty: remaining,
              unit: close?.close ?? 0,
              name: text(r.name),
              account: r.account,
            })
            const arrival =
              `${r.date} ${r.brokerage} ${ticker}: ${usRound(remaining, 6)} of ${usRound(qty, 6)} unit(s) ` +
              `arrived with no cost on the row, none in transit, and none on a broker lot opened that ` +
              `day (${r.type}/${text(r.raw_type)})`
            if (close) {
              const value = remaining * close.close
              // The grant is income as well as a lot: shares received for nothing
              // are ordinary income at that same receipt-date value, and the two
              // are taxed on different bases. This is the double life STAKING_REWARD
              // already has on the crypto side, which is why the type mirrors it.
              //
              // Retyped here rather than by the type normalizer because only this
              // point in the replay knows it is a grant — the normalizer sees a
              // bare `REC`, which is equally an ACAT receive. `raw_type` keeps the
              // broker's own code, so nothing the source said is overwritten.
              r.type = 'SHARE_REWARD'
              r.native_amount = usRound(value, 4)
              r.amount_krw = krwOn(value, r.currency || 'USD', r.date)
              r.native_unit_price = usRound(close.close, 4)
              r.unit_price = krwOn(close.close, r.currency || 'USD', r.date)
              // `native_settlement` is deliberately left alone: a grant settles no
              // cash, and the settlement columns are what the account's money
              // movements are read from.
              dividendRows.push({
                market: 'US',
                currency: r.currency || 'USD',
                base_currency: fxConfig.baseCurrency || 'KRW',
                brokerage: r.brokerage,
                account_type: r.account_type,
                source_system: r.source_system,
                date: r.date,
                account: r.account,
                ticker,
                name: text(r.name),
                native_amount: usRound(value, 4),
                native_tax_withheld: null,
                amount_krw: krwOn(value, r.currency || 'USD', r.date) ?? 0,
                type: r.type,
                source: r.source,
                page: null,
              })
              // An estimate, not a reported figure. Recorded separately from the
              // notes so it can be raised as its own standing warning rather than
              // passing for a cost the broker actually gave us.
              const note =
                `${arrival} — booked as SHARE_REWARD income and valued at the ${close.date} close of ` +
                `$${usRound(close.close, 4)} = $${usRound(value, 2)}`
              usPricedArrivals.push(note)
              usReplayNotes.push(note)
            } else {
              usReplayNotes.push(`${arrival} — opened at zero cost`)
            }
          }
        }
      } else {
        const cost = amount > 0 ? amount : qty * unitPrice
        lotsFor(key).push({
          acquired: r.date, qty, unit: cost / qty, name: text(r.name), account: r.account,
        })
      }
      snapshot(key, r.date)
      continue
    }

    if (r.type === 'SELL' || r.type === 'TRANSFER_OUT') {
      let remaining = qty
      const held = lotsFor(key)
      const saleUnit = amount > 0 ? amount / qty : unitPrice
      while (remaining > 1e-9 && held.length) {
        const lot = held[0]
        const take = Math.min(lot.qty, remaining)
        if (r.type === 'SELL') {
          const cost = take * lot.unit
          const proceeds = take * saleUnit
          const days = usHoldingDays(lot.acquired, r.date)
          usRealizedRows.push({
            market: 'US',
            currency: r.currency || 'USD',
            base_currency: fxConfig.baseCurrency || 'KRW',
            brokerage: r.brokerage,
            source_system: 'us_transaction_replay',
            account: r.account,
            ticker,
            name: lot.name || text(r.name),
            acquired_date: lot.acquired,
            sold_date: r.date,
            quantity_sold: usRound(take, 8),
            cost_basis_krw: krwOn(cost, r.currency || 'USD', r.date),
            proceeds_krw: krwOn(proceeds, r.currency || 'USD', r.date),
            realized_gl_krw: krwOn(proceeds - cost, r.currency || 'USD', r.date),
            holding_days: days,
            tax_term: days > US_LONG_TERM_DAYS ? 'Long-term' : 'Short-term',
            basis: 'replay',
            tax_year: String(r.date).slice(0, 4),
            native_cost_basis: usRound(cost, 4),
            native_proceeds: usRound(proceeds, 4),
            native_realized_gl: usRound(proceeds - cost, 4),
            covered_status: '',
            form_8949_box: '',
            superseded_by: null,
            dividends_native: null,
            source: r.source,
          })
        } else {
          // A transfer is not a disposal. The lot leaves this brokerage intact
          // and waits to be claimed by the receiving one; booking it as a sale
          // would invent a gain that was never realized and never taxable.
          transitFor(ticker).push({ ...lot, qty: take })
        }
        lot.qty -= take
        remaining -= take
        if (lot.qty <= 1e-9) held.shift()
      }
      if (remaining > 1e-6) {
        usReplayNotes.push(
          `${r.date} ${r.brokerage} ${ticker}: ${usRound(remaining, 6)} unit(s) disposed with no ` +
            `matching open lot (${r.type}/${text(r.raw_type)})`
        )
      }
      snapshot(key, r.date)
    }
  }

  // Replaying to the present should reproduce what the brokerage says it holds.
  // Compared per brokerage rather than per account because the two sides label
  // accounts differently — Robinhood's transactions are named by strategy
  // ("Mid-term") and its holdings by account number ("1478") — and because lots
  // move freely between accounts at one broker.
  const usHoldingQty = new Map()
  for (const h of holdingRows) {
    if (h.market !== 'US' || US_CASH_EQUIVALENT_TICKERS.has(text(h.ticker))) continue
    const key = `${h.brokerage}|${text(h.ticker)}`
    usHoldingQty.set(key, (usHoldingQty.get(key) ?? 0) + (number(h.quantity) ?? 0))
  }
  // A brokerage with no holdings rows at all cannot be reconciled against
  // anything; that gap is already reported by `us_brokerage_positions_ingested`
  // and would otherwise be counted again here as one mismatch per position.
  const reconcilableBrokerages = new Set([...usHoldingQty.keys()].map((k) => k.split('|')[0]))
  const usReplayQty = new Map()
  for (const [key, lots] of openLots) {
    const total = lots.reduce((sum, lot) => sum + lot.qty, 0)
    if (total > 1e-9) usReplayQty.set(key, total)
  }
  // A holdings export is a photograph, and the transactions run past it. Chase
  // stamped its 2026-07-31 tax-lot file as of 07-30 and a 5-share AAPL buy
  // settled on the 31st, so the replay held 47 against the file's 42 — both
  // correct, a day apart. Left undistinguished, that reads exactly like a
  // basis error, and the only way to tell was to open the account and count.
  //
  // So the arithmetic that settles it is done here instead: net the movements
  // dated after the snapshot and see whether they are the whole difference.
  // What remains is what the clock cannot explain.
  const brokerageAsOf = new Map()
  for (const h of holdingRows) {
    if (h.market !== 'US' || !h.as_of_date) continue
    const seen = brokerageAsOf.get(h.brokerage)
    if (!seen || h.as_of_date > seen) brokerageAsOf.set(h.brokerage, h.as_of_date)
  }
  const OPENS = new Set(['BUY', 'REINVEST', 'TRANSFER_IN', 'STOCK_SPLIT'])
  const CLOSES = new Set(['SELL', 'TRANSFER_OUT'])
  const postSnapshotNet = new Map()
  for (const r of rows) {
    const asOf = brokerageAsOf.get(r.brokerage)
    if (!asOf || !r.date || r.date <= asOf) continue
    const ticker = text(r.ticker)
    if (!ticker) continue
    const qty = number(r.quantity) ?? 0
    const signed = OPENS.has(r.type) ? qty : CLOSES.has(r.type) ? -qty : 0
    if (!signed) continue
    const key = `${r.brokerage}|${ticker}`
    postSnapshotNet.set(key, (postSnapshotNet.get(key) ?? 0) + signed)
  }

  for (const key of new Set([...usReplayQty.keys(), ...usHoldingQty.keys()])) {
    if (!reconcilableBrokerages.has(key.split('|')[0])) continue
    const replayed = usReplayQty.get(key) ?? 0
    const held = usHoldingQty.get(key) ?? 0
    if (Math.abs(replayed - held) > 1e-3) {
      const since = postSnapshotNet.get(key) ?? 0
      const asOf = brokerageAsOf.get(key.split('|')[0])
      // Explained only when the post-snapshot movement accounts for the gap in
      // full. A partial match is still a discrepancy — it just has a plausible
      // story attached, which is the shape a real error would also wear.
      if (Math.abs(replayed - held - since) <= 1e-3) {
        usReplayAsOfSkew.push(
          `${key.replace('|', ' ')}: ${usRound(since, 4)} traded after the ${asOf} snapshot`
        )
        continue
      }
      const entry = `${key.replace('|', ' ')}: replay ${usRound(replayed, 4)} vs holdings ${usRound(held, 4)}`
      if (key.startsWith('Robinhood|') && robinhoodSnapshotLotCount > 0) robinhoodReplayMismatches.push(entry)
      else usReplayMismatches.push(entry)
    }
  }
  usReplayReconcilableCount = new Set(
    [...usReplayQty.keys(), ...usHoldingQty.keys()].filter((k) => reconcilableBrokerages.has(k.split('|')[0]))
  ).size
  console.error(
    `[us-realized] replayed ${usRealizedRows.length} realized lot(s) from ${rows.length} US transaction(s); ` +
      `${usReplayMismatches.length} position(s) disagree with holdings, ${usReplayAsOfSkew.length} explained by post-snapshot trades, ${robinhoodReplayMismatches.length} more Robinhood-only (see robinhood_holdings_replay_provenance); ${usReplayNotes.length} note(s)`
  )
  for (const note of usReplayNotes.slice(0, 20)) console.error(`[us-realized]   ${note}`)
  for (const note of usReplayLotCostLookups) console.error(`[us-realized]   ${note}`)
}

// ---------------------------------------------------------------------------
// Crypto (Bithumb, Robinhood Crypto)
// ---------------------------------------------------------------------------
//
// One market, two currencies. Every other source in this file arrives as a
// holdings export plus a transaction log; neither crypto venue publishes
// holdings at all, so the POSITION IS DERIVED — it is the running sum of the
// transactions and nothing else. That is only safe because both documents print
// a balance we did not compute (Bithumb a running balance on every row,
// Robinhood a month-end quantity per symbol), and the checks below refuse to
// let a derived position disagree with it.
//
// Costs include fees. A Bithumb 매수 moves 정산금액 out of the account and the
// fee is the part of it that does not become coin, so excluding it would
// understate what the position actually cost — Bithumb's own UI reports the
// fee-exclusive figure, which is why its 평균매수가 sits below ours.

const CRYPTO_MARKET = 'CRYPTO'
const cryptoTransactionRows = []
const cryptoHoldingRows = []
const cryptoTaxLotRows = []
const cryptoRealizedRows = []

function cryptoTransactionType(row) {
  if (row.type === 'BUY' || row.type === 'SELL') return row.type
  if (row.type === 'REWARD') return 'STAKING_REWARD'
  if (row.type === 'CASH_REWARD') {
    // 예치금 이용료 is interest on an idle won balance; a points-shop or event
    // credit is not. They are taxed differently, so they must not share a type.
    return /이자|이용료/.test(row.note ?? '') ? 'INTEREST' : 'OTHER_INCOME'
  }
  if (row.type === 'CASH_IN' || row.type === 'TRANSFER_IN') return 'TRANSFER_IN'
  if (row.type === 'CASH_OUT' || row.type === 'TRANSFER_OUT') return 'TRANSFER_OUT'
  return String(row.type ?? '').toUpperCase()
}

/** Native cash value of a row, in the venue's own currency. */
function cryptoNativeAmount(row) {
  if (row.type === 'REWARD') {
    // Paid in coin, so the row carries no cash figure — 거래금액 just repeats the
    // quantity. Value it at that day's close, which is both its cost basis and
    // the amount of income it represents.
    if (row.currency !== 'KRW') return number(row.amount)
    const close = cryptoRewardCloses.get(`${row.venue}\t${row.symbol}\t${row.date}`)
    if (!close) return null
    return (number(row.quantity) ?? 0) * close.close
  }
  return number(row.amount)
}

const cryptoActivityRows = cryptoActivity.transactions ?? []

for (const row of cryptoActivityRows) {
  const type = cryptoTransactionType(row)
  const currency = row.currency
  const fx = fxRate(currency)
  const nativeAmount = cryptoNativeAmount(row)
  const fee = number(row.fee)
  const account = row.account
  const quantity = number(row.quantity)

  const transaction = {
    market: CRYPTO_MARKET,
    currency,
    base_currency: fxConfig.baseCurrency || 'KRW',
    brokerage: row.venue,
    account_type: 'Crypto',
    source_system: row.venue === 'Bithumb' ? 'bithumb_statement_pdf' : 'robinhood_crypto_statement_pdf',
    date: row.date,
    account,
    type,
    raw_type: row.rawType,
    ticker: row.symbol || null,
    name: row.symbol || (row.isCash ? currency : ''),
    quantity,
    native_amount: nativeAmount,
    native_settlement: number(row.settlement),
    native_unit_price: number(row.price),
    amount_krw: toBase(nativeAmount, currency),
    settlement_krw: toBase(number(row.settlement), currency),
    unit_price: toBase(number(row.price), currency),
    fee,
    tax: null,
    // The running balance the venue printed. Kept on the row so /positions can
    // show the exchange's own figure beside ours instead of only our sum.
    balance: row.isCash ? number(row.cashBalance) : number(row.assetBalance),
    source: row.source,
    page: row.page ?? null,
  }
  cryptoTransactionRows.push(transaction)

  if (isIncomeType(type)) {
    dividendRows.push({
      market: CRYPTO_MARKET,
      currency,
      base_currency: fxConfig.baseCurrency || 'KRW',
      brokerage: row.venue,
      account_type: 'Crypto',
      source_system: transaction.source_system,
      date: row.date,
      account,
      ticker: row.symbol || null,
      name: transaction.name,
      native_amount: nativeAmount ?? 0,
      native_tax_withheld: null,
      amount_krw: toBase(nativeAmount ?? 0, currency) ?? 0,
      type,
      source: row.source,
      page: row.page ?? null,
    })
  }

  if (!row.symbol || row.isCash || quantity == null) continue

  // Acquisitions open a lot; disposals consume open lots first-in-first-out.
  // FIFO rather than the US default of specific-identification because neither
  // venue reports which lot it closed, and FIFO is what Korean crypto rules
  // assume — picking a lot we were not told about would invent a tax position.
  const lotKey = `${row.venue}\t${account}\t${row.symbol}`
  if (type === 'BUY' || type === 'STAKING_REWARD' || type === 'TRANSFER_IN') {
    cryptoTaxLotRows.push({
      market: CRYPTO_MARKET,
      currency,
      base_currency: fxConfig.baseCurrency || 'KRW',
      fx_rate_to_base: fx?.rate ?? null,
      brokerage: row.venue,
      account_type: 'Crypto',
      source_system: transaction.source_system,
      as_of_date: now.slice(0, 10),
      account,
      ticker: row.symbol,
      name: row.symbol,
      acquired_date: row.date,
      open_quantity: Math.abs(quantity),
      native_cost_basis: (nativeAmount ?? 0) + (fee ?? 0),
      native_unit_price: quantity ? ((nativeAmount ?? 0) + (fee ?? 0)) / Math.abs(quantity) : null,
      native_market_value: null,
      native_unrealized_gl: null,
      source: row.source,
      _key: lotKey,
      _order: `${row.date} ${row.time ?? ''}`,
    })
  } else if (type === 'SELL') {
    let remaining = Math.abs(quantity)
    const proceeds = (nativeAmount ?? 0) - (fee ?? 0)
    const open = cryptoTaxLotRows.filter((lot) => lot._key === lotKey && lot.open_quantity > 1e-12)
    open.sort((a, b) => a._order.localeCompare(b._order))
    for (const lot of open) {
      if (remaining <= 1e-12) break
      const take = Math.min(lot.open_quantity, remaining)
      const share = take / Math.abs(quantity)
      const lotCost = (lot.native_unit_price ?? 0) * take
      const lotProceeds = proceeds * share
      const holdingDays = Math.round(
        (Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${lot.acquired_date}T00:00:00Z`)) / 86400000
      )
      cryptoRealizedRows.push({
        market: CRYPTO_MARKET,
        currency,
        base_currency: fxConfig.baseCurrency || 'KRW',
        brokerage: row.venue,
        source_system: transaction.source_system,
        account,
        ticker: row.symbol,
        name: row.symbol,
        acquired_date: lot.acquired_date,
        sold_date: row.date,
        quantity_sold: take,
        cost_basis_krw: toBase(lotCost, currency),
        proceeds_krw: toBase(lotProceeds, currency),
        realized_gl_krw: toBase(lotProceeds - lotCost, currency),
        holding_days: holdingDays,
        tax_term: holdingDays > 365 ? 'Long-term' : 'Short-term',
        basis: 'replay',
        tax_year: String(row.date).slice(0, 4),
        native_cost_basis: lotCost,
        native_proceeds: lotProceeds,
        native_realized_gl: lotProceeds - lotCost,
        source: row.source,
      })
      lot.open_quantity -= take
      lot.native_cost_basis -= lotCost
      remaining -= take
    }
  }
}

const cryptoAsOfDate = now.slice(0, 10)
for (const lot of cryptoTaxLotRows) {
  const holdingDays = Math.round(
    (Date.parse(`${cryptoAsOfDate}T00:00:00Z`) - Date.parse(`${lot.acquired_date}T00:00:00Z`)) / 86400000
  )
  lot.holding_days = holdingDays
  lot.tax_term = holdingDays > 365 ? 'Long-term' : 'Short-term'
  lot.cost_basis_krw = toBase(lot.native_cost_basis, lot.currency) ?? 0
  lot.unit_cost = toBase(lot.native_unit_price, lot.currency)
}

// Positions are the open lots, grouped. Fully-closed lots stay in the table so
// /positions can show the whole history, but contribute nothing to the holding.
const cryptoPositions = new Map()
for (const lot of cryptoTaxLotRows) {
  const key = lot._key
  const entry = cryptoPositions.get(key) ?? {
    lot,
    quantity: 0,
    nativeCost: 0,
    lotCount: 0,
    longTermQty: 0,
    shortTermQty: 0,
  }
  entry.quantity += lot.open_quantity
  entry.nativeCost += lot.native_cost_basis
  if (lot.open_quantity > 1e-12) {
    entry.lotCount += 1
    if (lot.tax_term === 'Long-term') entry.longTermQty += lot.open_quantity
    else entry.shortTermQty += lot.open_quantity
  }
  cryptoPositions.set(key, entry)
}

for (const [key, entry] of cryptoPositions) {
  if (entry.quantity <= 1e-12) continue
  const [venue, account, symbol] = key.split('\t')
  const lot = entry.lot
  const currency = lot.currency
  const fx = fxRate(currency)
  const quote = cryptoPricesByKey.get(`${venue}\t${symbol}`)
  const price = quote?.price ?? null
  const marketValue = price == null ? null : price * entry.quantity
  const unrealized = marketValue == null ? null : marketValue - entry.nativeCost
  const averageCost = entry.quantity > 0 ? entry.nativeCost / entry.quantity : null

  cryptoHoldingRows.push({
    market: CRYPTO_MARKET,
    currency,
    base_currency: fxConfig.baseCurrency || 'KRW',
    fx_rate_to_base: fx?.rate ?? null,
    brokerage: venue,
    account_type: 'Crypto',
    source_system: `${lot.source_system}+${quote?.source ?? 'no_quote'}`,
    as_of_date: quote?.asOfDate || cryptoAsOfDate,
    account,
    ticker: symbol,
    name: quote?.name || symbol,
    quantity: entry.quantity,
    native_average_unit_cost: averageCost,
    native_cost: entry.nativeCost,
    native_price: price,
    native_market_value: marketValue,
    native_unrealized_gl: unrealized,
    native_unrealized_gl_pct: unrealized == null || entry.nativeCost === 0 ? null : (unrealized / entry.nativeCost) * 100,
    base_cost: toBase(entry.nativeCost, currency),
    base_market_value: toBase(marketValue, currency),
    base_unrealized_gl: toBase(unrealized, currency),
    average_unit_cost: toBase(averageCost, currency),
    total_cost_krw: toBase(entry.nativeCost, currency) ?? 0,
    current_price: toBase(price, currency),
    pe: null,
    eps: null,
    unrealized_gl_krw: toBase(unrealized, currency),
    unrealized_gl_pct: unrealized == null || entry.nativeCost === 0 ? null : (unrealized / entry.nativeCost) * 100,
    long_term_qty: entry.longTermQty,
    short_term_qty: entry.shortTermQty,
    lot_count: entry.lotCount,
  })
}

for (const lot of cryptoTaxLotRows) {
  delete lot._key
  delete lot._order
}

holdingRows.push(...cryptoHoldingRows)
taxLotRows.push(...cryptoTaxLotRows)
realizedRows.push(...cryptoRealizedRows)
transactionRows.push(...cryptoTransactionRows)

// ---------------------------------------------------------------------------
// US realized lots as the broker filed them (Form 1099-B)
// ---------------------------------------------------------------------------
//
// The replay above is an estimate the whole year round; this is the figure that
// files. The broker has already applied wash sales and return-of-capital basis
// adjustments, and it reports these amounts to the IRS individually, so they are
// not recomputed here — only read, attributed to a ticker, and marked as a
// filing so a tax page can tell the two apart.
//
// A form is issued annually and only after the year closes, so the current year
// has none. That is not a gap to be filled: it is why E exists.

const us1099bRows = []
const us1099bNotes = []
const us1099bCoverage = new Map() // `${brokerage}|${year}` -> source filename

{
  const brokerageFromFilename = (filename) => {
    const name = String(filename ?? '').toLowerCase()
    for (const candidate of ['Robinhood', 'Chase', 'Fidelity', 'Merrill']) {
      if (name.includes(candidate.toLowerCase())) return candidate
    }
    return ''
  }

  // The consolidated forms leave the Symbol column blank and identify a security
  // by CUSIP, which nothing else in this database carries. Rather than hand-maintain
  // a CUSIP table, each row is matched back to the sales it reports: same
  // brokerage, same trade date, and proceeds that agree to the cent. The broker
  // aggregates lots of one security into a single line (two SGOV sales on
  // 2025-10-22 are filed as one 5.017-unit row), so the comparison is against the
  // summed proceeds per ticker for that day, which is exactly what it aggregates.
  const salesByDay = new Map()
  for (const r of transactionRows) {
    if (r.market !== 'US' || r.type !== 'SELL') continue
    const key = `${r.brokerage}|${r.date}|${text(r.ticker)}`
    const current = salesByDay.get(key) ?? { proceeds: 0, quantity: 0, name: text(r.name), account: r.account }
    current.proceeds += Math.abs(number(r.native_amount) ?? 0)
    current.quantity += Math.abs(number(r.quantity) ?? 0)
    salesByDay.set(key, current)
  }

  const resolveTicker = (brokerage, row) => {
    if (text(row.symbol)) return { ticker: text(row.symbol), match: null }
    const candidates = []
    for (const [key, value] of salesByDay) {
      const [b, date, ticker] = key.split('|')
      if (b !== brokerage || date !== row.sold_date) continue
      if (Math.abs(value.proceeds - Number(row.proceeds ?? 0)) <= 0.01) candidates.push({ ticker, value })
    }
    // Only an unambiguous match is used. Two securities sold the same day for
    // the same amount would otherwise be assigned by luck.
    if (candidates.length === 1) return { ticker: candidates[0].ticker, match: candidates[0].value }
    return { ticker: '', match: null }
  }

  for (const report of (usPdfEvidence.reports ?? []).filter((r) => r.category === 'us_tax_document_pdf')) {
    const brokerage = brokerageFromFilename(report.filename)
    const year = text(report.metrics?.tax_year_hint)
    const rows = report.form_1099b ?? []
    for (const mismatch of report.metrics?.form_1099b_totals_mismatches ?? []) {
      us1099bNotes.push(mismatch)
    }
    if (!brokerage && rows.length) {
      us1099bNotes.push(`${report.filename}: ${rows.length} 1099-B row(s) but no brokerage in the filename`)
      continue
    }
    // A form with no sales still records that the year WAS checked — the
    // difference between "nothing was sold" and "nobody looked" is the whole
    // point of this section, and four of the five forms are the former.
    if (brokerage && year) us1099bCoverage.set(`${brokerage}|${year}`, report.filename)
    for (const row of rows) {
      const { ticker, match } = resolveTicker(brokerage, row)
      if (!ticker) {
        us1099bNotes.push(
          `${report.filename}: ${row.sold_date} ${row.description || row.cusip} $${row.proceeds} ` +
            `could not be matched to a recorded sale, so it carries no ticker`
        )
      }
      const soldDate = row.sold_date
      const acquired = row.acquired_date === 'Various' ? null : row.acquired_date
      const days = acquired ? usHoldingDays(acquired, soldDate) : null
      const proceeds = Number(row.proceeds ?? 0)
      const cost = Number(row.cost_basis ?? 0)
      const gain = Number(row.gain_loss ?? 0)
      us1099bRows.push({
        market: 'US',
        currency: 'USD',
        base_currency: fxConfig.baseCurrency || 'KRW',
        brokerage,
        source_system: 'us_form_1099b',
        account: match?.account || `${brokerage} (1099-B)`,
        ticker,
        name: match?.name || text(row.description),
        // The form aggregates lots and prints "Various" rather than a date. It
        // is left null instead of guessed: the term is stated separately and is
        // what the filing actually turns on.
        acquired_date: acquired,
        sold_date: soldDate,
        quantity_sold: Number(row.quantity ?? 0),
        cost_basis_krw: krwOn(cost, 'USD', soldDate),
        proceeds_krw: krwOn(proceeds, 'USD', soldDate),
        // Taken from the form, not recomputed: the broker's gain already carries
        // the wash-sale and return-of-capital adjustments that make it differ
        // from proceeds minus our cost.
        realized_gl_krw: krwOn(gain, 'USD', soldDate),
        holding_days: days,
        tax_term: `${text(row.term)}-term`.replace('-term-term', '-term'),
        basis: '1099b',
        tax_year: year || String(soldDate).slice(0, 4),
        native_cost_basis: cost,
        native_proceeds: proceeds,
        native_realized_gl: gain,
        covered_status: text(row.covered_status),
        form_8949_box: text(row.form_8949_box),
        superseded_by: null,
        dividends_native: null,
        source: report.filename,
      })
    }
  }

  // The filing wins for a year it covers. The replay rows are kept and marked
  // rather than dropped, so the estimate stays next to the number that replaced
  // it and the difference between them can be explained instead of discovered.
  for (const row of usRealizedRows) {
    const filing = us1099bCoverage.get(`${row.brokerage}|${row.tax_year}`)
    if (filing) row.superseded_by = filing
  }

  console.error(
    `[us-1099b] ${us1099bRows.length} filed lot(s) from ` +
      `${(usPdfEvidence.reports ?? []).filter((r) => r.category === 'us_tax_document_pdf').length} form(s); ` +
      `${usRealizedRows.filter((r) => r.superseded_by).length} replay lot(s) superseded; ${us1099bNotes.length} note(s)`
  )
  for (const note of us1099bNotes.slice(0, 20)) console.error(`[us-1099b]   ${note}`)
}

// ---------------------------------------------------------------------------
// Dividends received while a realized lot was held
// ---------------------------------------------------------------------------
//
// The 「주식 매도 & 손익」 sheet records `누적배당금` against each closed position,
// which is what makes its return figures total return rather than price return.
// The database has both halves — dividend rows and realized lots — and has never
// joined them, so it cannot say which closed positions actually paid.
//
// Ticker plus the acquired/sold window is the attribution. A dividend is
// credited to a lot when it was paid while that lot was held, apportioned across
// whichever lots were open on that date so a payment is counted once no matter
// how many lots shared the position.

{
  const byTickerBrokerage = new Map()
  for (const d of dividendRows) {
    if (d.market !== 'US') continue
    const ticker = text(d.ticker)
    if (!ticker) continue
    const key = `${d.brokerage}|${ticker}`
    if (!byTickerBrokerage.has(key)) byTickerBrokerage.set(key, [])
    byTickerBrokerage.get(key).push({ date: text(d.date), amount: number(d.native_amount) ?? 0 })
  }

  // Only the replay lots carry an acquisition date; a 1099-B line aggregates
  // lots and prints "Various", so there is no window to attribute against and
  // the field stays null rather than being filled with a guess.
  const attributable = usRealizedRows.filter((r) => r.acquired_date && r.sold_date)
  for (const lot of attributable) lot.dividends_native = 0
  let attributed = 0
  for (const [key, dividends] of byTickerBrokerage) {
    const lots = attributable.filter((r) => `${r.brokerage}|${r.ticker}` === key)
    if (!lots.length) continue
    for (const dividend of dividends) {
      // A payment is divided by the shares that EARNED it, which is the whole
      // position on that date — not just the fraction that later happened to be
      // sold. Apportioning across the sold lots alone put $144.68 of JEPQ
      // dividends onto a 0.786-share lot, because 0.786 shares were all this
      // list could see of a 293-share position.
      const heldQty = usPositionAsOf(key, dividend.date)
      if (heldQty <= 0) continue
      const perShare = dividend.amount / heldQty
      // Strict on the acquisition side: a reinvestment lot is created BY the
      // payment, so it cannot also have earned it. Inclusive on the sale side,
      // because shares sold on the pay date were held when it was declared.
      const holders = lots.filter((r) => r.acquired_date < dividend.date && dividend.date <= r.sold_date)
      if (!holders.length) continue
      for (const holder of holders) {
        // The lot's size while it was held is taken as the quantity later sold.
        // A split restates it mid-life, so a payment either side of one is
        // apportioned on the post-split count; the error is small and bounded,
        // and the alternative is to carry a per-lot quantity timeline.
        holder.dividends_native += perShare * (holder.quantity_sold ?? 0)
      }
      attributed += 1
    }
  }
  for (const lot of attributable) lot.dividends_native = usRound(lot.dividends_native, 4)
  const paid = attributable.filter((r) => (r.dividends_native ?? 0) > 0).length
  console.error(
    `[us-realized] ${attributed} dividend payment(s) attributed to ${paid} of ${attributable.length} realized lot(s)`
  )
}

const krDividendNotes = []
let krDividendStats = null

// ---------------------------------------------------------------------------
// The same join, for Korea
// ---------------------------------------------------------------------------
//
// This is the half the US block above could not reach, and it is the half the
// 「주식 매도 & 손익」 sheet was still being kept by hand for: 22 of its `비고`
// entries are a `누적배당금` against a closed position, and every one of them went
// through a Korean broker.
//
// Three things differ from the US side, and each is a decision rather than a
// port.
//
// INCOME IS NOT ALL DIVIDENDS HERE. The US dividend rows arrive already typed;
// Korea's carry the broker's own wording — `배당금외화입금`, but also `세금환급`,
// `예탁금이용료입금`, `선환전차액입금`. 76 of the 1,011 rows are zero-amount tax
// refunds. `defaultIncomeCategory` already knows the difference and already
// reads 배당/분배, so it decides rather than a second list drifting beside it.
//
// THE POSITION IS ONE POSITION, WHATEVER CURRENCY EACH TRADE WAS BOOKED IN. A
// 미래에셋 종합 holding can carry lots in both — SCHD has four won-booked lots
// and three dollar-booked ones, all sold the same day — because the currency
// follows how each order was placed, not what the security is. A dividend is
// earned by the shares, so the denominator counts them all and the match is on
// account and ticker alone.
//
// WHICH IS WHY THE FIGURE IS IN WON. It is the unit both sides always have:
// every Korean row carries `amount_krw` / `cost_basis_krw`, converted at the
// historical rate on its own date. Attributing in the lot's native currency
// would have to skip the mixed-currency positions or silently add dollars to a
// won lot, and those positions are exactly the ones the sheet recorded.
{
  // Shares held per account|ticker over time, from the transactions the
  // certificates rebuild. Same shape as the US timeline and for the same
  // reason: a payment is divided by the shares that earned it.
  const krTimeline = new Map()
  {
    // The same direction rule the certificate lot engine uses, and it has to be
    // the same one. A split is booked as an out and one or more ins, and the
    // direction lives in the broker's wording rather than in the normalized
    // type — so counting only BUY/SELL leaves the position short by whatever a
    // split added. That understates the denominator, which overstates the
    // per-share figure, which overstates every lot it touches: before this the
    // 2025-10 미래에셋 disposals came out roughly double the 누적배당금 the
    // sheet had recorded by hand for the same tickers.
    const opening = new Set(['BUY', 'TRANSFER_IN', 'REINVEST'])
    const closing = new Set(['SELL', 'TRANSFER_OUT'])
    const directional = new Set(['STOCK_SPLIT', 'CORPORATE_ACTION'])
    const held = new Map()
    const ordered = [...transactionRows]
      .filter((r) => text(r.ticker) && number(r.quantity))
      .sort((a, b) => text(a.date).localeCompare(text(b.date)))
    for (const r of ordered) {
      const key = `${r.account}|${text(r.ticker)}`
      const qty = Math.abs(number(r.quantity) ?? 0)
      let kind = r.type
      if (directional.has(kind)) {
        const raw = text(r.raw_type)
        kind = raw.includes('입고') ? 'TRANSFER_IN' : raw.includes('출고') ? 'TRANSFER_OUT' : null
      }
      if (opening.has(kind)) held.set(key, (held.get(key) ?? 0) + qty)
      else if (closing.has(kind)) held.set(key, (held.get(key) ?? 0) - qty)
      else continue
      if (!krTimeline.has(key)) krTimeline.set(key, [])
      const timeline = krTimeline.get(key)
      const last = timeline[timeline.length - 1]
      if (last && last.date === r.date) last.quantity = held.get(key)
      else timeline.push({ date: r.date, quantity: held.get(key) })
    }
  }

  /** Shares held at the START of a date — the balance before that day's rows.
   *  A payment is earned by what was held when it was declared, and the same
   *  day routinely carries the disposal that ended the position. */
  const krPositionAsOf = (key, date) => {
    const timeline = krTimeline.get(key)
    if (!timeline?.length) return 0
    let qty = 0
    for (const entry of timeline) {
      if (entry.date >= date) break
      qty = entry.quantity
    }
    return qty
  }

  const byKey = new Map()
  for (const d of dividendRows) {
    if (d.market !== 'KR') continue
    if (defaultIncomeCategory(d) !== 'dividend') continue
    const ticker = text(d.ticker)
    const amount = number(d.amount_krw) ?? 0
    if (!ticker || !(amount > 0)) continue
    const key = `${d.account}|${ticker}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push({ date: text(d.date), amount })
  }

  const lotsByKey = new Map()
  const krLots = realizedRows.filter((r) => r.market === 'KR' && r.acquired_date && r.sold_date)
  for (const lot of krLots) {
    lot.dividends_krw = 0
    const key = `${lot.account}|${text(lot.ticker)}`
    if (!lotsByKey.has(key)) lotsByKey.set(key, [])
    lotsByKey.get(key).push(lot)
  }

  let attributed = 0
  let afterClose = 0
  const unattributed = krDividendNotes
  for (const [key, dividends] of byKey) {
    const lots = lotsByKey.get(key) ?? []
    for (const dividend of dividends) {
      // Strict on the acquisition side — a lot opened by the payment cannot
      // have earned it — and inclusive on the sale side, since shares sold on
      // the pay date were held when it was declared.
      const holders = lots.filter((r) => r.acquired_date < dividend.date && dividend.date <= r.sold_date)
      const heldQty = krPositionAsOf(key, dividend.date)
      if (!holders.length || heldQty <= 0) {
        // Most dividends were paid on shares still held, and those have no
        // realized lot to attach to by definition. Of the rest, one class is
        // expected and one is not.
        //
        // KOREA PAYS LONG AFTER THE RECORD DATE — a quarter or more. 삼성전자's
        // 미래에셋 종합 position closed on 2024-04-01 and its next two payments
        // landed on 04-19 and 05-20, earned by shares that were held when the
        // register closed and paid to an account that no longer had them. The
        // certificates carry no record date, so there is nothing here to
        // attribute those against; counted, not warned about, and deliberately
        // not fixed with a guessed grace window that would misfile a payment
        // whenever a position was closed and reopened inside it.
        if (!lots.length) continue
        const lastSold = lots.reduce((max, r) => (r.sold_date > max ? r.sold_date : max), '')
        if (dividend.date > lastSold) afterClose += 1
        else unattributed.push(`${dividend.date} ${key}`)
        continue
      }
      const perShare = dividend.amount / heldQty
      for (const holder of holders) {
        holder.dividends_krw += perShare * (holder.quantity_sold ?? 0)
      }
      attributed += 1
    }
  }
  for (const lot of krLots) lot.dividends_krw = Math.round(lot.dividends_krw)
  const paid = krLots.filter((r) => (r.dividends_krw ?? 0) > 0)
  const total = paid.reduce((sum, r) => sum + r.dividends_krw, 0)
  krDividendStats = { attributed, lots: paid.length, of: krLots.length, krw: total, afterClose }
  console.error(
    `[kr-realized] ${attributed} dividend payment(s) attributed to ${paid.length} of ${krLots.length} ` +
      `realized lot(s), ₩${total.toLocaleString('en-US')} in all`
  )
  if (afterClose) {
    console.error(`[kr-realized]   ${afterClose} payment(s) landed after the position closed — Korea pays long after the record date`)
  }
  if (unattributed.length) {
    console.error(`[kr-realized]   ${unattributed.length} payment(s) inside a closed position's life matched no lot window`)
  }
}

realizedRows.push(...usRealizedRows, ...us1099bRows)

for (let i = 0; i < dividendRows.length; i += 1) {
  dividendRows[i] = applyDividendMappings(dividendRows[i], manualMappings)
}

insertMany(db, 'holdings', holdingRows, [
  'market',
  'currency',
  'base_currency',
  'fx_rate_to_base',
  'brokerage',
  'account_type',
  'source_system',
  'as_of_date',
  'account',
  'ticker',
  'name',
  'quantity',
  'native_average_unit_cost',
  'native_cost',
  'native_price',
  'native_market_value',
  'native_unrealized_gl',
  'native_unrealized_gl_pct',
  'base_cost',
  'base_market_value',
  'base_unrealized_gl',
  'average_unit_cost',
  'total_cost_krw',
  'current_price',
  'pe',
  'eps',
  'unrealized_gl_krw',
  'unrealized_gl_pct',
  'long_term_qty',
  'short_term_qty',
  'lot_count',
])
insertMany(db, 'tax_lots', taxLotRows, [
  'market',
  'currency',
  'base_currency',
  'fx_rate_to_base',
  'brokerage',
  'account_type',
  'source_system',
  'as_of_date',
  'account',
  'ticker',
  'name',
  'acquired_date',
  'open_quantity',
  'native_cost_basis',
  'native_unit_cost',
  'native_market_value',
  'native_unrealized_gl',
  'cost_basis_krw',
  'unit_cost',
  'holding_days',
  'tax_term',
  'source',
])
insertMany(db, 'realized_lots', realizedRows, [
  'market',
  'currency',
  'base_currency',
  'brokerage',
  'source_system',
  'account',
  'ticker',
  'name',
  'acquired_date',
  'sold_date',
  'quantity_sold',
  'cost_basis_krw',
  'proceeds_krw',
  'realized_gl_krw',
  'holding_days',
  'tax_term',
  'basis',
  'tax_year',
  'native_cost_basis',
  'native_proceeds',
  'native_realized_gl',
  'covered_status',
  'form_8949_box',
  'superseded_by',
  'dividends_native',
  'dividends_krw',
  'source',
])
insertMany(db, 'transactions', transactionRows, [
  'market',
  'currency',
  'base_currency',
  'brokerage',
  'account_type',
  'source_system',
  'date',
  'account',
  'type',
  'raw_type',
  'ticker',
  'name',
  'quantity',
  'native_amount',
  'native_settlement',
  'native_unit_price',
  'amount_krw',
  'settlement_krw',
  'unit_price',
  'fee',
  'tax',
  'balance',
  'placed_agent',
  'source',
  'page',
])
insertMany(db, 'dividends', dividendRows, [
  'market',
  'currency',
  'base_currency',
  'brokerage',
  'account_type',
  'source_system',
  'date',
  'account',
  'ticker',
  'name',
  'native_amount',
  'native_tax_withheld',
  'amount_krw',
  'type',
  'income_category',
  'mapping_status',
  'mapping_note',
  'source',
  'page',
])
insertMany(
  db,
  'evidence_reports',
  [
    ...(usPdfEvidence.reports ?? []).map((r) => ({
      name: r.name,
      category: r.category,
      filename: r.filename,
      path: r.path,
      account_hint: r.account_hint,
      pages: r.pages,
      row_count: r.row_count,
      metrics_json: JSON.stringify(r.metrics ?? {}),
    })),
    // The crypto PDFs are evidence in the same sense the US gain/loss reports
    // are — except here they are the ONLY source, so /health showing their
    // coverage is the difference between "the position is backed by documents"
    // and "the position is backed by a JSON file somebody generated".
    ...(cryptoActivity.documents ?? []).map((d) => ({
      name: d.name,
      category: d.category,
      filename: d.filename,
      path: d.path,
      account_hint: d.account,
      pages: d.pages,
      row_count: d.rowCount,
      metrics_json: JSON.stringify(d.metrics ?? {}),
    })),
  ],
  ['name', 'category', 'filename', 'path', 'account_hint', 'pages', 'row_count', 'metrics_json']
)

const checks = []
function check(name, ok, detail, severity = 'error') {
  checks.push({ name, status: ok ? 'pass' : 'fail', detail, severity })
}

// Shares leaving one of these accounts should arrive in another of them, and
// when they do not, the cost basis they were carrying is somewhere this
// pipeline cannot see.
//
// Found by hand once already, expensively: 22 삼성전자 vested into the RSU
// account on 2026-07-08 and left it on 2026-07-16, three days after the Toss
// statement stops covering. The outbound leg was recorded, the inbound leg was
// not, and nothing asked where the shares went — it surfaced as a live position
// 22 units larger than its lots, and took a walk through four accounts to
// explain.
//
// Quantities are consumed rather than matched one to one, because a
// 타사대체입고 arrives lot by lot: one outbound row for 57 shares becomes four
// inbound rows carrying each lot's own cost. Requiring equal rows would call
// every real transfer a break, which is how a check earns its way to being
// ignored.
//
// Only the outbound direction is judged. An arrival with no departure is
// ordinary — shares come in from institutions this pipeline has never seen —
// and where it matters, `us_replay_arrivals_carry_cost` already reports the
// ones that landed without a cost.
// The two sides of the stack disagree about the sign of a departure and the
// filter below used to believe only one of them. US brokers write an outbound
// quantity NEGATIVE — Fidelity's ACAT deliver is `-318` — while the Korean
// parsers write a magnitude and put the direction in the type. `r.quantity > 0`
// therefore excluded every US outbound leg there has ever been (Chase 51,
// Fidelity 8, Merrill 1), leaving the loop with nothing but the 20 Korean ones.
// The check below then reported "every outbound transfer lands in another
// account" over a set that contained no US transfer at all — a green tick
// computed from an empty room, which is worse than a red one because nobody
// goes looking.
//
// Direction is the type's job, magnitude is the quantity's, and reading each
// from where it lives is what makes both conventions work.
const transferQty = (r) => Math.abs(number(r.quantity) ?? 0)
// A sweep fund is the cash balance wearing a ticker, and its withdrawals are
// spending rather than securities leaving. All 51 of Chase's outbound rows with
// a ticker are `QACDS` intra-day sweep movements; admitting them would invent 51
// unexplained departures and hand them to the basis-carry below, which exists to
// write lots nobody documented.
const transferPairable = (r) =>
  text(r.ticker) && !US_CASH_EQUIVALENT_TICKERS.has(text(r.ticker)) && transferQty(r) > 0 && r.date

const TRANSFER_PAIR_WINDOW_DAYS = 14
const transferInPool = transactionRows
  .filter((r) => r.type === 'TRANSFER_IN' && transferPairable(r))
  .map((r) => ({ row: r, left: transferQty(r) }))
const unpairedTransferOut = []
for (const out of transactionRows
  .filter((r) => r.type === 'TRANSFER_OUT' && transferPairable(r))
  .sort((a, b) => a.date.localeCompare(b.date))) {
  let need = transferQty(out)
  for (const candidate of transferInPool) {
    if (need <= 1e-9) break
    const { row, left } = candidate
    if (left <= 1e-9 || row.ticker !== out.ticker || row.account === out.account) continue
    const days = Math.abs(Date.parse(row.date) - Date.parse(out.date)) / 86_400_000
    if (days > TRANSFER_PAIR_WINDOW_DAYS) continue
    const taken = Math.min(left, need)
    candidate.left -= taken
    need -= taken
  }
  if (need > 1e-6) unpairedTransferOut.push({ row: out, missing: need })
}

// Carrying the basis across, rather than waiting for the receiving broker to
// print a statement.
//
// The departing row already says what the shares cost — 삼성증권's 타사출고
// carries 단가 277,500 — so the only thing missing is somewhere to put it. The
// destination is not named on the outbound row (the receiving side names the
// sender, never the other way round), so it is identified by elimination:
// exactly one account whose LIVE position exceeds its lots by exactly this
// quantity of exactly this security. Both halves have to be unambiguous, and
// when they are not, nothing is written and the check below says so.
//
// This is the one place the pipeline records a lot no document asserts, so the
// conditions are deliberately narrow:
//
//   - the receiving account must have a live position feed, because the
//     shortfall it is matched against is only meaningful against a live number
//   - exactly one candidate account, and exactly one unpaired leg for that
//     ticker — a tie is ambiguous and stays unwritten
//   - the outbound row must carry a unit price; without one there is no basis
//     to carry and a zero-cost lot would be worse than a missing one
//
// Self-superseding: the lot exists only while the shortfall does. Download the
// receiving statement and its own 타사대체입고 rows fill the gap, the shortfall
// closes, and this stops firing — there is no state to clean up and no way to
// double count, because the condition that creates the lot is the absence of
// the real one.
//
// Holding period travels with the shares. A transfer between two of your own
// accounts does not restart the clock, so the acquired date comes from
// replaying the SENDING account's own history for that security and reading
// which lots the departure consumed — not from the transfer date, which would
// turn a five-year holding into a one-day one and move it to short-term.
const OPENING_TRANSFER_TYPES = new Set(['BUY', 'TRANSFER_IN', 'REINVEST'])
const CLOSING_TRANSFER_TYPES = new Set(['SELL', 'TRANSFER_OUT'])
const transferCarriedLots = []
const transferCarryDeclined = []
let transferCarriedLegs = 0
if (unpairedTransferOut.length) {
  const liveAccounts = new Set(
    holdingRows.filter((r) => r.source_system === 'toss_open_api').map((r) => r.account)
  )
  const lotQty = new Map()
  for (const lot of taxLotRows) {
    const key = `${lot.account}\t${lot.ticker}`
    lotQty.set(key, (lotQty.get(key) ?? 0) + (lot.open_quantity ?? 0))
  }

  for (const { row: out, missing } of unpairedTransferOut) {
    const candidates = holdingRows.filter(
      (h) =>
        liveAccounts.has(h.account) &&
        h.ticker === out.ticker &&
        h.account !== out.account &&
        Math.abs(h.quantity - (lotQty.get(`${h.account}\t${h.ticker}`) ?? 0) - missing) <= 1e-6
    )
    const sameTicker = unpairedTransferOut.filter((u) => u.row.ticker === out.ticker)
    const unitPrice = number(out.native_unit_price) ?? number(out.unit_price)
    if (candidates.length !== 1 || sameTicker.length !== 1 || !unitPrice) {
      transferCarryDeclined.push(
        `${out.date} ${out.account} ${out.ticker} ${missing}: ` +
          (!unitPrice
            ? 'the outbound row carries no unit price'
            : sameTicker.length !== 1
              ? `${sameTicker.length} unpaired legs for this security`
              : `${candidates.length} account(s) short by this amount`)
      )
      continue
    }
    const destination = candidates[0]

    // FIFO over the sending account's own rows, to learn when the departing
    // shares were acquired rather than assuming they were acquired on the way
    // out.
    //
    // Magnitude here for the same reason as above, and it matters twice: a US
    // disposal is negative, so the old filter dropped every SELL and
    // TRANSFER_OUT from the walk. `out` itself was one of them — it could never
    // appear in its own replay, so `acquired` stayed empty and the carry always
    // declined — and the lots those disposals had already consumed stayed in the
    // queue, which would have handed back purchases that were sold years ago.
    const queue = []
    let acquired = []
    for (const r of transactionRows
      .filter((r) => r.account === out.account && r.ticker === out.ticker && r.date && transferQty(r) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))) {
      if (OPENING_TRANSFER_TYPES.has(r.type)) {
        queue.push({ date: r.date, qty: transferQty(r) })
        continue
      }
      if (!CLOSING_TRANSFER_TYPES.has(r.type)) continue
      let need = transferQty(r)
      const consumed = []
      while (need > 1e-9 && queue.length) {
        const head = queue[0]
        const taken = Math.min(head.qty, need)
        consumed.push({ date: head.date, qty: taken })
        head.qty -= taken
        need -= taken
        if (head.qty <= 1e-9) queue.shift()
      }
      if (r === out) acquired = consumed
    }
    // A departure the sending account's own history cannot account for means
    // the sending side is itself incomplete; carrying a date guessed from
    // nothing would be worse than leaving the shortfall visible.
    const accountedFor = acquired.reduce((sum, a) => sum + a.qty, 0)
    if (accountedFor < missing - 1e-6) {
      transferCarryDeclined.push(
        `${out.date} ${out.account} ${out.ticker} ${missing}: the sending account's own lots only ` +
          `account for ${accountedFor}, so the acquired date is unknown`
      )
      continue
    }

    let left = missing
    transferCarriedLegs += 1
    for (const slice of acquired) {
      if (left <= 1e-9) break
      const qty = Math.min(slice.qty, left)
      left -= qty
      const cost = qty * unitPrice
      taxLotRows.push({
        market: destination.market,
        currency: out.currency || destination.currency,
        base_currency: 'KRW',
        fx_rate_to_base: destination.fx_rate_to_base ?? 1,
        brokerage: destination.brokerage,
        account_type: destination.account_type,
        source_system: 'transfer_basis_carry',
        as_of_date: out.date,
        account: destination.account,
        ticker: out.ticker,
        name: out.name || destination.name,
        acquired_date: slice.date,
        open_quantity: qty,
        native_cost_basis: cost,
        native_unit_cost: unitPrice,
        native_market_value: null,
        native_unrealized_gl: null,
        cost_basis_krw: cost,
        unit_cost: unitPrice,
        holding_days: null,
        tax_term: '',
        source: `carried from ${out.account} 타사출고 ${out.date}`,
      })
      transferCarriedLots.push(
        `${out.ticker} ${qty} unit(s) acquired ${slice.date} at ${unitPrice}, ` +
          `${out.account} -> ${destination.account} on ${out.date}`
      )
    }
  }
  if (transferCarriedLots.length) {
    console.error(`[transfer] ${transferCarriedLots.length} lot(s) carried across an unrecorded arrival`)
    for (const note of transferCarriedLots) console.error(`[transfer]   ${note}`)
  }
}

const holdingsByKey = new Map()
for (const r of holdingRows) holdingsByKey.set(`${r.account}\t${r.ticker}`, r)

const lotsByKey = new Map()
for (const r of taxLotRows) {
  const key = `${r.account}\t${r.ticker}`
  const cur = lotsByKey.get(key) || { quantity: 0, cost: 0 }
  cur.quantity += r.open_quantity
  cur.cost += r.cost_basis_krw
  lotsByKey.set(key, cur)
}

const quantityMismatches = []
const costMismatches = []
// Holdings that are live while their lots are not. Comparing the two would
// only ever restate that fact, once per position, as an error that aborts the
// refresh — so they are counted separately and reported as their own check.
const differentProvenance = []
for (const [key, holding] of holdingsByKey) {
  if (!(holding.market === 'KR' || (holding.market === 'US' && ['Chase', 'Robinhood'].includes(holding.brokerage)))) continue
  if (holding.source_system === 'toss_open_api') {
    const lots = lotsByKey.get(key) || { quantity: 0, cost: 0 }
    if (Math.abs(holding.quantity - lots.quantity) > 1e-6) differentProvenance.push(key)
    continue
  }
  const lots = lotsByKey.get(key) || { quantity: 0, cost: 0 }
  if (Math.abs(holding.quantity - lots.quantity) > 1e-6) {
    quantityMismatches.push({ key, holding: holding.quantity, lots: lots.quantity })
  }
  if (Math.abs(holding.total_cost_krw - lots.cost) > 1) {
    costMismatches.push({ key, holding: holding.total_cost_krw, lots: lots.cost })
  }
}

// Lots the statements still show open, for which the live snapshot lists no
// position AT ALL.
//
// The loop above cannot see these. It walks holdings, so a lot with no holding
// row beside it is never a key it visits — which means the one shape worth
// noticing most, a position that disappeared from the broker, was the one shape
// the check was structurally blind to. It found 7 of 38 quantity disagreements
// while silently passing over an eighth position that had stopped existing.
//
// Deliberately Toss-only, and deliberately not folded into `quantityMismatches`
// above. That path is `error` severity and aborts the refresh, and the same
// union over US accounts would put every replayed lot whose holding is missing
// into it — Chase SPLG is exactly that today, and it is already reported, as a
// warning, by `us_realized_replay_reconciles_holdings`. Promoting a known
// warning to a refresh-stopping error is not what closing this blind spot means.
//
// Only meaningful against a live snapshot: without one the positions are summed
// FROM these lots, so a lot can never lack a position and the set is always
// empty. The check skips that case wholesale.
const tossOrphanLots = []
if (tossHoldingCount > 0) {
  for (const [key, lots] of lotsByKey) {
    const [account, ticker] = key.split('\t')
    if (account !== tossAccountLabel || holdingsByKey.has(key)) continue
    if (!(lots.quantity > 1e-6)) continue
    tossOrphanLots.push(ticker)
  }
}

const txDividendCount = transactionRows.filter((r) => isIncomeType(r.type)).length
const invalidHoldings = holdingRows.filter((r) => !required(r.account) || !required(r.ticker) || r.quantity < 0)
const invalidLots = taxLotRows.filter(
  (r) => !required(r.account) || !required(r.ticker) || !required(r.acquired_date) || r.open_quantity < 0
)
const invalidTransactions = transactionRows.filter((r) => !required(r.date) || !required(r.account) || !required(r.type))
const invalidDividends = dividendRows.filter((r) => !required(r.date) || !required(r.account) || r.amount_krw < 0)
const unmappedTypes = transactionRows.filter(
  (r) =>
    ![
      'BUY',
      'SELL',
      'DIVIDEND',
      'INTEREST',
      'REINVEST',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'CASH_SWEEP',
      'JOURNAL',
      'STOCK_SPLIT',
      'STOCK_LENDING_INCOME',
      'OTHER_INCOME',
      'INTERNAL_TRANSFER',
      'CORPORATE_ACTION',
      'FEE',
      'STAKING_REWARD',
      'SHARE_REWARD',
    ].includes(r.type)
)
const missingFxHoldings = holdingRows.filter((r) => r.currency !== r.base_currency && (r.fx_rate_to_base == null || r.base_cost == null))
// Bonds are identified by ISIN (KR103502GA34), equities by a six-digit code, and
// the KR price fetcher only quotes the latter. A bond with no equity quote is not
// a coverage gap — it is an instrument this feed was never going to price — and
// flagging it would leave a warning that can never be cleared, which is how a
// checklist stops being read. The bond still carries its cost basis; it simply
// has no market value here.
const isEquityTicker = (ticker) => /^\d{6}$/.test(String(ticker ?? ''))
const missingKrPrices = holdingRows.filter(
  (r) => r.market === 'KR' && r.quantity > 0 && r.native_price == null && isEquityTicker(r.ticker)
)
const missingUsPrices = holdingRows.filter((r) => r.market === 'US' && r.quantity > 0 && r.native_market_value == null)
const gainLossReports = (usPdfEvidence.reports ?? []).filter((r) => r.category === 'us_gain_loss_pdf')
const taxDocReports = (usPdfEvidence.reports ?? []).filter((r) => r.category === 'us_tax_document_pdf')

// The Toss fetch is an optional refresh step, so a failed one leaves the last
// snapshot in place and the ingest reads it without complaint. Age is the only
// thing that distinguishes "current" from "the API stopped answering days ago",
// and 203 days of a frozen FX rate is this project's standing lesson in what an
// unwatched snapshot costs.
//
// WHY THIS ASKS ABOUT THE POSITIONS AND NOT THE SNAPSHOT. It used to check the
// snapshot alone, which meant it only ever evaluated when a snapshot existed —
// with no credentials it reported "no Toss snapshot configured" and PASSED,
// while Toss's 36 positions (84% of Korean trades) sat on the hand-made payload
// frozen at 2026-07-15 with nothing anywhere saying so. A freshness check whose
// quiet case is the stale case is the silent gap it was meant to close.
//
// So the question is "how old is the thing the positions are actually standing
// on", and every answer names a source and an age. The threshold follows the
// source, because the sources are refreshed by different mechanisms and one
// deadline for all three would either nag about a statement that is doing its
// job or excuse a snapshot that stopped updating.
const tossSnapshotAgeHours = tossSnapshot?.fetchedAt
  ? (Date.now() - Date.parse(tossSnapshot.fetchedAt)) / 3_600_000
  : null
const tossPositionRows = holdingRows.filter((r) => r.account === tossAccountLabel)
// `source_system` carries a `+yahoo_chart` suffix once a position is priced, and
// that suffix is about the PRICE. Backing means where the quantity came from.
const tossBackingSystem = tossPositionRows[0]?.source_system?.split('+')[0] ?? null
// as_of_date on a holding row is the price date, not the position date — the
// priced branches overwrite it — so the position date is read from the lots and
// the payload's own frozen constant instead of from the row.
const tossLotAsOf = taxLotRows
  .filter((r) => r.account === tossAccountLabel && r.as_of_date)
  .reduce((max, r) => (max == null || r.as_of_date > max ? r.as_of_date : max), null)
const daysSince = (date) => (date ? (Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000 : null)
// A hand-downloaded 거래내역서 is never hours old and demanding that it be would
// leave a warning that can never be cleared, which is how a checklist stops
// being read. Monthly-plus-slack is the cadence a statement can actually keep.
const tossStatementMaxDays = Number(process.env.STOCK_TOSS_STATEMENT_MAX_DAYS || 35)

let tossPositionsOk
let tossPositionsDetail
if (tossPositionRows.length === 0) {
  tossPositionsOk = true
  tossPositionsDetail = 'no Toss positions'
} else if (tossBackingSystem === 'toss_open_api') {
  tossPositionsOk = tossSnapshotAgeHours != null && tossSnapshotAgeHours <= 24
  tossPositionsDetail =
    `${tossPositionRows.length} position(s) from the Open API snapshot, ` +
    `${tossSnapshotAgeHours == null ? 'undated' : `${tossSnapshotAgeHours.toFixed(1)}h old`}`
} else if (tossBackingSystem === 'korea_statement') {
  const age = daysSince(tossLotAsOf)
  tossPositionsOk = age != null && age <= tossStatementMaxDays
  tossPositionsDetail =
    `${tossPositionRows.length} position(s) rebuilt from the 거래내역서, as of ${tossLotAsOf ?? 'an undated statement'}` +
    `${age == null ? '' : ` (${age.toFixed(0)}d old)`} — no Open API snapshot, so download a newer statement to move this`
} else {
  // The payload has no refresh path — no script writes it and no credential
  // unlocks it — so its age is never the point and this never passes. The way
  // out is to run extract:kr-statements, not to wait.
  const age = daysSince('2026-07-15')
  tossPositionsOk = false
  tossPositionsDetail =
    `${tossPositionRows.length} position(s) still on the hand-maintained payload frozen at 2026-07-15` +
    `${age == null ? '' : ` (${age.toFixed(0)}d old)`} — neither the Open API nor the 거래내역서 supplied them`
}
check('toss_positions_fresh', tossPositionsOk, tossPositionsDetail, 'warning')

// The bridge reports what it did even when it did nothing, because "no fills
// after the cutoff" and "the orders never got read" look identical from the
// outside and mean opposite things. A note here is a sale the lots could not
// cover, which would otherwise book the entire proceeds as gain.
check(
  'toss_orders_bridge_statement',
  tossOrderNotes.length === 0,
  tossSnapshot?.accounts?.length
    ? tossBridgedFills === 0
      ? `no order fills after the statement cutoff ${tossBridgeCutoff ?? '(no statement)'} — statements and snapshot cover the same ground`
      : `${tossBridgedFills} fill(s) after ${tossBridgeCutoff ?? '(no statement)'} bridged into transactions and lots; ` +
        `시간외 fills are not returned by this endpoint, so the window may still be short — ` +
        `toss_holdings_lots_provenance is what would say so` +
        (tossOrderNotes.length ? `; ${tossOrderNotes.length} sold more than the open lots hold: ${tossOrderNotes.join('; ')}` : '')
    : 'no Open API snapshot — nothing to bridge with',
  'warning'
)
// Holdings and lots come from two sources that age differently — the API
// snapshot is hourly, the statements are as old as the last download — so this
// is a staleness measure, not a data error. A non-zero count names the
// positions that have traded since the newest 거래내역서 and is expected to
// reappear whenever the account trades; it closes again on the next statement.
//
// The two halves are reported separately because they mean different things. A
// quantity that disagrees is ordinary drift — the account bought since the
// statement. A lot with NO live position is not drift: the broker is no longer
// carrying something the statements say is open, which is either a corporate
// action that closed it or a position that went missing. The tickers are named
// for that reason; there should never be many, and each one wants an answer.
check(
  'toss_holdings_lots_provenance',
  tossHoldingCount === 0 || (differentProvenance.length === 0 && tossOrphanLots.length === 0),
  tossHoldingCount === 0
    // Not "no snapshot, nothing to say" — this check exists to compare a LIVE
    // position against a rebuilt lot, and without a snapshot there is no second
    // provenance for the first to disagree with. That is not the same as the
    // positions being current, which is what `toss_positions_fresh` reports.
    ? 'no Open API snapshot — no second provenance to compare against (see toss_positions_fresh)'
    : `${differentProvenance.length} of ${tossHoldingCount} live Toss position(s) disagree with the lots rebuilt ` +
      `from the statements` +
      (tossOrphanLots.length
        ? `; ${tossOrphanLots.length} open lot(s) have no live position at all (${tossOrphanLots.join(', ')})`
        : ''),
  'warning'
)
// 삼성증권 has exactly one source — its own 거래내역확인서 — and no live
// alternative and no scheduled refresh at all: nobody but a person downloads
// it, on no cadence anyone has committed to. An RSU vest sits invisible until
// somebody thinks to go get a fresh statement, which is precisely the failure
// this account already caused once (docs/data-sources.md: "an account with no
// position looks exactly like an account nobody parses"). The one thing that
// can catch the next one without a human remembering is staleness that names
// itself — not the vest, which no automated source here can see coming, but
// the fact that nobody has checked in a while.
//
// Dividends are the fastest-recurring event in this account (quarterly-ish:
// Aug, Nov, Apr, Jul) and vests are rarer, so a threshold tuned to catch a
// missed quarter's dividend catches a missed vest for free.
const samsungAccountLabel = '삼성증권(주식보상)'
const samsungAsOf = krAsOfByAccount[samsungAccountLabel] || null
const samsungAgeDays = daysSince(samsungAsOf)
const samsungStatementMaxDays = Number(process.env.STOCK_SAMSUNG_STATEMENT_MAX_DAYS || 120)
check(
  'samsung_statement_fresh',
  samsungAsOf != null && samsungAgeDays != null && samsungAgeDays <= samsungStatementMaxDays,
  samsungAsOf == null
    ? 'no 삼성증권 statement parsed — its RSU vests and dividends are invisible until one is downloaded'
    : `statement covers to ${samsungAsOf} (${samsungAgeDays.toFixed(0)}d old) — download a newer 거래내역확인서 ` +
      'in case a vest or a dividend landed since then',
  'warning'
)
check('reconcilable_holdings_vs_taxlots_quantity', quantityMismatches.length === 0, `${quantityMismatches.length} mismatch(es)`)
check('reconcilable_holdings_vs_taxlots_cost_basis', costMismatches.length === 0, `${costMismatches.length} mismatch(es)`)
check(
  'dividend_rows_match_transactions',
  txDividendCount === dividendRows.length,
  `${txDividendCount} transaction dividends vs ${dividendRows.length} dividend rows`
)
check('holdings_required_fields', invalidHoldings.length === 0, `${invalidHoldings.length} invalid holding row(s)`)
check('taxlots_required_fields', invalidLots.length === 0, `${invalidLots.length} invalid tax lot row(s)`)
check('transactions_required_fields', invalidTransactions.length === 0, `${invalidTransactions.length} invalid transaction row(s)`)
check('dividends_required_fields', invalidDividends.length === 0, `${invalidDividends.length} invalid dividend row(s)`)
check('transaction_types_mapped', unmappedTypes.length === 0, `${unmappedTypes.length} unmapped transaction type row(s)`, 'warning')

// The other half of that question, asked of the rows this file never received.
// A dropped row is worse than an unmapped one: unmapped is a row whose meaning
// is unknown, dropped is a transaction the portfolio has no idea happened, and
// only the parser knows. Severity is deliberately the same as its in-band twin
// above — a new Korean word must not stop a refresh — but it is now a check that
// fails rather than a line in a log that scrolled past.
check(
  'kr_statement_rows_all_reach_the_ingest',
  krDroppedRowFindings.length === 0,
  krExtractReport == null
    ? 'no statement extract report — run extract:kr-statements'
    : krDroppedRowFindings.length === 0
      ? 'the statement parser dropped no rows'
      : `${krDroppedRowFindings.reduce((n, f) => n + f.rows, 0)} row(s) dropped before reaching the ingest: ` +
        krDroppedRowFindings.map((f) => `${f.kind} — ${f.samples.slice(0, 3).join(', ')}`).join('; '),
  'warning'
)

// Findings that kept their row. Named separately so they cannot dilute the one
// above: an ISIN that stayed its own ticker is a note, and 2,211 of them must
// not read as the same kind of event as one lost transaction.
check(
  'kr_statement_parse_notes',
  krKeptRowFindings.length === 0,
  krKeptRowFindings.length === 0
    ? 'the statement parser reported nothing it had to work around'
    : krKeptRowFindings.map((f) => `${f.kind}: ${f.rows} row(s), ${f.distinct} distinct`).join('; '),
  'warning'
)

// Locked statements are neither: the file was never opened, so its rows are
// absent without even a finding to describe them.
check(
  'kr_statements_all_opened',
  (krExtractReport?.lockedStatements ?? []).length === 0,
  (krExtractReport?.lockedStatements ?? []).length === 0
    ? 'every statement opened'
    : `${krExtractReport.lockedStatements.length} statement(s) could not be opened (set STOCK_PDF_PASSWORD): ${krExtractReport.lockedStatements.join(', ')}`
)
check('fx_rates_available_for_non_base_holdings', missingFxHoldings.length === 0, `${missingFxHoldings.length} holding row(s) missing FX/base cost`)
check('kr_prices_available_for_unrealized_gl', missingKrPrices.length === 0, `${missingKrPrices.length} KR holding row(s) missing current price`, 'warning')
check('us_prices_available_for_unrealized_gl', missingUsPrices.length === 0, `${missingUsPrices.length} US holding row(s) missing market value`, 'warning')
// The same question `toss_positions_fresh` asks, of the source that can answer
// it least well on its own: how old is the thing the Robinhood positions are
// actually standing on, and which source supplied it.
//
// Toss has a cron. This does not — nothing on a timer can reach the MCP, so the
// snapshot only moves when a session regenerates it, and a snapshot nobody
// regenerates is the exact failure this project keeps meeting. A quiet stale
// case would reproduce the thing it replaced. So the PDF case never passes at
// any age: the way out is to regenerate, not to wait.
const robinhoodSnapshotAgeHours = robinhoodSnapshot?.fetchedAt
  ? (Date.now() - Date.parse(robinhoodSnapshot.fetchedAt)) / 3_600_000
  : null
const robinhoodPositionRows = holdingRows.filter((r) => r.market === 'US' && r.brokerage === 'Robinhood')
// `source_system` can carry a `+`-suffixed pricing source; the backing is the
// part before it, because it is where the QUANTITY came from.
const robinhoodBackingSystem = robinhoodPositionRows[0]?.source_system?.split('+')[0] ?? null
// A week, because regenerating is a deliberate act somebody has to choose to
// take. Daily would be a warning nobody can clear, which is how a checklist
// stops being read.
const robinhoodSnapshotMaxDays = Number(process.env.STOCK_ROBINHOOD_SNAPSHOT_MAX_DAYS || 7)

let robinhoodFreshOk
let robinhoodFreshDetail
if (robinhoodPositionRows.length === 0) {
  robinhoodFreshOk = true
  robinhoodFreshDetail = 'no Robinhood positions'
} else if (robinhoodBackingSystem === 'robinhood_mcp') {
  const ageDays = robinhoodSnapshotAgeHours == null ? null : robinhoodSnapshotAgeHours / 24
  robinhoodFreshOk = ageDays != null && ageDays <= robinhoodSnapshotMaxDays
  robinhoodFreshDetail =
    `${robinhoodPositionRows.length} position(s) from the MCP snapshot, ` +
    `${ageDays == null ? 'undated' : `${ageDays.toFixed(1)}d old`} ` +
    `(${robinhoodSnapshotLotCount} lot(s); regenerate with the Robinhood MCP, no cron can)`
} else {
  const asOf = robinhoodPositionRows[0]?.as_of_date ?? null
  const ageDays = asOf ? (Date.now() - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000 : null
  robinhoodFreshOk = false
  robinhoodFreshDetail =
    `${robinhoodPositionRows.length} position(s) still on the hand-obtained Gain/Loss PDFs, as of ${asOf ?? 'an undated report'}` +
    `${ageDays == null ? '' : ` (${ageDays.toFixed(0)}d old)`} — those arrived by emailing customer support and have no ` +
    `refresh path at all; write ${path.basename(robinhoodSnapshotPath)} from the Robinhood MCP`
}
check('robinhood_snapshot_fresh', robinhoodFreshOk, robinhoodFreshDetail, 'warning')

// A lot the snapshot carried but this ingest could not read is a position
// quietly worth less, which is indistinguishable from a right answer. A symbol
// with a position and no lots is the partial-pull case — `get_equity_tax_lots`
// is one call per symbol and rate limits are expected — and it is named rather
// than counted so the next regeneration knows what to go back for.
check(
  'robinhood_snapshot_lots_mapped',
  robinhoodUnmappedLots.length === 0 && robinhoodSymbolsWithoutLots.length === 0,
  robinhoodSnapshot == null
    ? 'no MCP snapshot — nothing to map (see robinhood_snapshot_fresh)'
    : robinhoodUnmappedLots.length === 0 && robinhoodSymbolsWithoutLots.length === 0
      ? `${robinhoodSnapshotLotCount} lot(s) mapped, every position has lots`
      : `${robinhoodUnmappedLots.length} lot(s) unreadable` +
        (robinhoodUnmappedLots.length ? ` (${robinhoodUnmappedLots.slice(0, 3).join(', ')})` : '') +
        `; ${robinhoodSymbolsWithoutLots.length} position(s) have no lots` +
        (robinhoodSymbolsWithoutLots.length ? ` (${robinhoodSymbolsWithoutLots.slice(0, 5).join(', ')})` : ''),
  'warning'
)
check(
  'us_pdf_evidence_extracted',
  gainLossReports.length >= 3 && taxDocReports.length >= 5,
  `${gainLossReports.length} gain/loss report(s), ${taxDocReports.length} tax document(s)`,
  'warning'
)
// A brokerage export pattern that matched nothing. The prior silent skip is
// exactly what let stale/absent files pass unnoticed; name them on /health.
// A brokerage whose TRANSACTIONS we read but whose POSITIONS we do not.
//
// Fidelity was in this state and nobody noticed: source-files.mjs has a
// transaction spec for it and no holdings spec, so its trades, dividends and
// transfers all landed while its positions were structurally absent from the
// portfolio total. Nothing broke — every screen simply showed a smaller
// portfolio than existed, which is this repo's recurring failure mode.
//
// Only brokerages with ZERO holdings rows are evaluated, which is what makes
// the derived position trustworthy enough to judge on: for a brokerage we do
// price, an incomplete transaction history would make a derived quantity wrong,
// but a brokerage we do not price at all has nothing to compare against anyway.
//
// It stays quiet while the derived position nets to zero — an emptied account
// needs no holdings file, and a permanent warning about one is how a check gets
// ignored. It fires the moment a position opens there.
// Core money-market sweeps. A balance in one of these IS the account's cash, not
// an equity position, so a brokerage holding nothing but its sweep is empty.
const CASH_SWEEP_TICKERS = new Set(['SPAXX', 'FDRXX', 'SPRXX', 'FZFXX', 'FGXXX'])
const usTransactionBrokerages = new Set(
  transactionRows.filter((r) => r.market === 'US' && r.brokerage).map((r) => r.brokerage)
)
const usHoldingBrokerages = new Set(holdingRows.filter((r) => r.market === 'US' && r.brokerage).map((r) => r.brokerage))
const uncoveredBrokerages = [...usTransactionBrokerages].filter((b) => !usHoldingBrokerages.has(b)).sort()

const uncoveredDetail = []
const uncoveredWithPositions = []
for (const brokerage of uncoveredBrokerages) {
  const derived = new Map()
  for (const row of transactionRows) {
    if (row.market !== 'US' || row.brokerage !== brokerage || !row.ticker || row.quantity == null) continue
    if (CASH_SWEEP_TICKERS.has(String(row.ticker).toUpperCase())) continue
    derived.set(row.ticker, (derived.get(row.ticker) ?? 0) + Number(row.quantity))
  }
  // Below a whole share is ACAT dust, not a position. A transfer moves whole
  // shares and leaves the fraction behind, so an emptied account keeps a
  // remainder like 0.008 SCHD — worth pennies, and alarming about it forever
  // is how the check stops being read. The threshold is in shares because these
  // are precisely the tickers we have no price for: a brokerage with no
  // holdings source contributes nothing to the price snapshot either.
  const open = [...derived.entries()].filter(([, quantity]) => Math.abs(quantity) >= 1)
  const dust = [...derived.entries()].filter(([, quantity]) => Math.abs(quantity) > 1e-6 && Math.abs(quantity) < 1)
  if (open.length === 0) {
    uncoveredDetail.push(
      `${brokerage}: transactions only, no whole-share position derived (account appears closed` +
      `${dust.length ? `; ${dust.length} fractional remainder(s)` : ''})`
    )
    continue
  }
  uncoveredWithPositions.push(brokerage)
  uncoveredDetail.push(
    `${brokerage}: no holdings source, but ${open.length} ticker(s) hold a derived position — ` +
    open.map(([ticker, quantity]) => `${ticker} ${Number(quantity.toFixed(6))}`).join(', ')
  )
}

// Merrill's positions are right either way; what the flat layout costs is the
// tax lots, and nothing else here would say so. A brokerage's lots going from 58
// to zero changes every holding-period and tax-planning figure for that account
// while no total looks wrong, which is precisely the kind of silence this file
// keeps adding checks against.
//
// Clearable, and that is the point of scoping it to Merrill rather than to "any
// brokerage without lots": exporting the tax-lot view once resolves it. Fidelity
// would fail such a general check forever — its positions export has no lot
// detail to give — and a warning that can never be cleared is how a checklist
// stops being read.
const merrillLotCount = taxLotRows.filter((r) => r.brokerage === 'Merrill').length
check(
  'merrill_holdings_carry_lot_detail',
  merrillHoldingsLayout == null || !merrillHoldingsLayout.flat || merrillLotCount > 0,
  merrillHoldingsLayout == null
    ? 'no Merrill holdings export read'
    : merrillHoldingsLayout.flat
      ? `${merrillHoldingsLayout.file} is the positions-only layout (basis under "Total Client Investment"), so ` +
        'Merrill has no tax lots and no holding periods — re-export the tax-lot view, which carries both'
      : `${merrillHoldingsLayout.file} is the tax-lot layout; ${merrillLotCount} lot(s) read`,
  'warning'
)

check(
  'us_brokerage_positions_ingested',
  uncoveredWithPositions.length === 0,
  uncoveredDetail.length ? uncoveredDetail.join('; ') : 'every US brokerage with transactions also has positions ingested',
  'warning'
)

const missingSources = [...missingHoldingSources, ...missingTransactionSources]
check(
  'expected_us_source_files_present',
  missingSources.length === 0,
  missingSources.length ? `no file matches: ${missingSources.join('; ')}` : 'all expected US brokerage exports found',
  'warning'
)

// A filename whose period cannot be true. Covers every source directory, not
// just the US ones, because the names are hand-typed everywhere; it is here
// rather than beside the crypto checks because there is one grammar now and one
// answer to give about it.
check(
  'source_file_dates_plausible',
  sourceDateProblems.length === 0,
  sourceDateProblems.length
    ? `${sourceDateProblems.length} source file(s) with an impossible period: ${sourceDateProblems.join('; ')}`
    : 'every source filename declares a period between the account opening and today',
  'warning'
)

// --- Crypto ---------------------------------------------------------------
//
// The crypto position is a sum of transactions with no holdings export behind
// it, so these checks are not belt-and-braces — they are the only thing standing
// between a parser regression and a portfolio total that is quietly wrong. Each
// compares our arithmetic against a figure the venue printed itself.

const cryptoDocuments = cryptoActivity.documents ?? []
const cryptoHoldingsByKey = new Map(cryptoHoldingRows.map((r) => [`${r.brokerage}\t${r.ticker}`, r]))

// 1. Bithumb prints a running balance on every row. The newest row per symbol
//    therefore states the current position outright. Document order decides
//    which row is newest: three fills can share one timestamp.
const bithumbBalances = new Map()
for (const row of cryptoActivityRows) {
  if (row.venue !== 'Bithumb' || row.isCash || !row.symbol || row.assetBalance == null) continue
  const key = row.symbol
  const rank = `${row.docPeriodEnd}\t${String(1e9 - (row.order ?? 0)).padStart(12, '0')}`
  const prev = bithumbBalances.get(key)
  if (!prev || rank > prev.rank) bithumbBalances.set(key, { rank, balance: row.assetBalance })
}

// 2. Robinhood prints a month-end quantity per symbol. The newest statement is
//    the comparable one — earlier months describe positions since changed.
const rhSnapshots = cryptoActivity.snapshots ?? []
const rhLatestDate = rhSnapshots.reduce((max, s) => (s.asOfDate > max ? s.asOfDate : max), '')
const rhLatest = new Map(rhSnapshots.filter((s) => s.asOfDate === rhLatestDate).map((s) => [s.symbol, s.quantity]))

const cryptoBalanceBreaks = []
for (const [symbol, printed] of bithumbBalances) {
  const derived = cryptoHoldingsByKey.get(`Bithumb\t${symbol}`)?.quantity ?? 0
  if (Math.abs(derived - printed.balance) > 1e-8) {
    cryptoBalanceBreaks.push(`Bithumb ${symbol}: derived ${derived} vs printed ${printed.balance}`)
  }
}
// Robinhood's newest statement lags the present by up to a month, so a symbol
// bought after it was issued is expected to exceed the snapshot rather than
// match it. Only a derived position BELOW the snapshot is a genuine break:
// coins cannot vanish between statements without a transaction saying so.
for (const [symbol, printed] of rhLatest) {
  const derived = cryptoHoldingsByKey.get(`Robinhood\t${symbol}`)?.quantity ?? 0
  if (derived + 1e-8 < printed) {
    cryptoBalanceBreaks.push(`Robinhood ${symbol}: derived ${derived} below ${rhLatestDate} statement ${printed}`)
  }
}

check(
  'crypto_positions_match_venue_balances',
  cryptoBalanceBreaks.length === 0,
  cryptoBalanceBreaks.length
    ? cryptoBalanceBreaks.join('; ')
    : `${bithumbBalances.size + rhLatest.size} position(s) match the balance the venue printed`
)

// 3. The 확인서 declare the period and the filters they were issued under. A
//    document pulled with a narrowed filter is indistinguishable from a complete
//    one by its contents, and a filename already lied about its period once.
const bithumbDocs = cryptoDocuments.filter((d) => d.category === 'bithumb_statement')
const filteredDocs = bithumbDocs.filter(
  (d) => d.metrics?.scopeAssets !== '전체' || d.metrics?.scopeTypes !== '매수/매도/입금/출금'
)
check(
  'crypto_statements_unfiltered',
  filteredDocs.length === 0,
  filteredDocs.length
    ? `narrowed scope in: ${filteredDocs.map((d) => `${d.filename} (${d.metrics?.scopeTypes} / ${d.metrics?.scopeAssets})`).join('; ')}`
    : `${bithumbDocs.length} statement(s) issued over all assets and all transaction types`
)

// 4. Overlapping periods double-count every trade they share; a gap silently
//    drops one. Both are invisible in the totals, so assert on the periods the
//    documents declare rather than on their filenames.
const periods = bithumbDocs
  .map((d) => ({ filename: d.filename, start: d.metrics?.periodStart ?? '', end: d.metrics?.periodEnd ?? '' }))
  .filter((p) => p.start && p.end)
  .sort((a, b) => a.start.localeCompare(b.start))
const periodBreaks = []
for (let i = 1; i < periods.length; i += 1) {
  const previous = periods[i - 1]
  const current = periods[i]
  if (current.start <= previous.end) {
    periodBreaks.push(`${previous.filename} (…${previous.end}) overlaps ${current.filename} (${current.start}…)`)
    continue
  }
  const expected = new Date(`${previous.end}T00:00:00Z`)
  expected.setUTCDate(expected.getUTCDate() + 1)
  const nextDay = expected.toISOString().slice(0, 10)
  if (current.start !== nextDay) {
    periodBreaks.push(`gap between ${previous.filename} (…${previous.end}) and ${current.filename} (${current.start}…)`)
  }
}
check(
  'crypto_statement_periods_contiguous',
  periodBreaks.length === 0 && periods.length === bithumbDocs.length,
  periodBreaks.length
    ? periodBreaks.join('; ')
    : `${periods.length} statement(s) cover ${periods[0]?.start ?? 'n/a'}..${periods[periods.length - 1]?.end ?? 'n/a'} without gap or overlap`
)

const missingCryptoPrices = cryptoHoldingRows.filter((r) => r.quantity > 0 && r.native_price == null)
check(
  'crypto_prices_available_for_unrealized_gl',
  missingCryptoPrices.length === 0,
  `${missingCryptoPrices.length} crypto holding row(s) missing current price`,
  'warning'
)

// A reward with no close for its date has no cost basis, which understates the
// position's cost and overstates its gain. Small in won, wrong in kind.
const unvaluedRewards = cryptoTransactionRows.filter((r) => r.type === 'STAKING_REWARD' && r.native_amount == null)
check(
  'crypto_rewards_valued_at_receipt',
  unvaluedRewards.length === 0,
  `${unvaluedRewards.length} staking reward(s) missing a receipt-date close`,
  'warning'
)

// A cash deposit whose 비고 the 확인서 left blank cannot be told apart from the
// holder moving their own money in, so it is booked as a transfer and earns no
// income row. Two real rows are like this (both promotional credits whose reason
// the .xlsx export names and the PDF does not), and defaulting them to "not
// income" is the conservative direction — but a silent default is how income
// goes unreported, so name them.
const unclassifiedCashIn = cryptoActivityRows.filter(
  (r) => r.venue === 'Bithumb' && r.isCash && r.type === 'CASH_IN' && !String(r.note ?? '').trim()
)
check(
  'crypto_cash_deposits_classified',
  unclassifiedCashIn.length === 0,
  unclassifiedCashIn.length
    ? `${unclassifiedCashIn.length} deposit(s) with no counterparty or reason, booked as transfers: ${unclassifiedCashIn
        .map((r) => `${r.date} ${r.amount}`)
        .join(', ')}`
    : 'every cash deposit carries a counterparty or a reason',
  'warning'
)

const missingCryptoSources = missingCryptoSourceFiles
check(
  'expected_crypto_source_files_present',
  missingCryptoSources.length === 0,
  missingCryptoSources.length ? `no file matches: ${missingCryptoSources.join('; ')}` : 'all expected crypto exports found',
  'warning'
)

// The US year-to-date realized figures are hand-entered assumptions that the tax
// estimate reads straight through (lib/tax-planning.ts reads
// `ytdRealizedShortGainLossUsd` / `ytdRealizedLongGainLossUsd`). They ship as 0
// in the example policy and nothing ever revisits them, so a year with real
// sales is estimated as if nothing had been sold — and it fails silently,
// because 0 is a perfectly legitimate value that no schema check can reject.
// The ingest already knows what was actually sold, so it is the only place that
// can tell "nothing was sold" apart from "nobody updated the number".
const taxPolicy = loadTaxPolicy()
const usTaxAssumptions = (taxPolicy?.jurisdictions ?? []).find((j) => j?.code === 'US')?.manualAssumptions ?? null
const taxYear = String(usTaxAssumptions?.taxInputYear ?? new Date().getFullYear())
const usSalesThisYear = transactionRows.filter(
  (r) => r.market === 'US' && r.type === 'SELL' && String(r.date ?? '').slice(0, 4) === taxYear
)
const usSalesProceeds = usSalesThisYear.reduce((sum, r) => sum + Math.abs(Number(r.native_amount) || 0), 0)
const ytdRealizedAssumed =
  Number(usTaxAssumptions?.ytdRealizedShortGainLossUsd ?? 0) !== 0 ||
  Number(usTaxAssumptions?.ytdRealizedLongGainLossUsd ?? 0) !== 0
// The detail has to describe the state it is actually in. It used to be built
// for the failing case only, so once the assumption WAS filled in the row read
// "pass … but ytdRealized*Usd is 0" — a passing check asserting the very thing
// that would have failed it. On a page whose job is to be believed, a line that
// contradicts its own status is worse than no line.
const ytdSalesDetail = `${usSalesThisYear.length} US sale(s) in ${taxYear} totalling $${usSalesProceeds.toFixed(2)} in proceeds`

// What the data says was realized, rather than only whether somebody typed
// something. A filing supersedes the replay for a year it covers, so the
// comparison uses whichever basis is authoritative for that year.
// WORLDWIDE, not US-market-only.
//
// `ytdRealized*Usd` is passed to estimateUsCapitalGainTax as `ytdShortGainUsd`,
// where it joins the same pool as the projected gains — and that pool is every
// priced lot regardless of market, because a US person reports worldwide capital
// gains. The US-market-only sub-estimate that backs the foreign-tax-credit
// limitation passes ytd 0 instead, which is the tell: scope is already decided
// upstream, and this check only has to match it.
//
// Comparing a correctly worldwide assumption against a US-only replay reported a
// disagreement that was really a scope mismatch — KRW 740,800 of Korean gains
// read as a $573 discrepancy in a figure that was right.
//
// Non-USD rows convert at their own trade date, not today's rate: a gain is
// realized in dollars on the day it is realized, and this portfolio's Korean
// sales sit six months back.
const realizedForTaxYear = realizedRows.filter((r) => r.tax_year === taxYear && !r.superseded_by)
const realizedUsdOf = (r) => usdOn(Number(r.native_realized_gl) || 0, text(r.currency), text(r.sold_date))
const unconvertible = realizedForTaxYear.filter((r) => realizedUsdOf(r) == null)
const sumUsd = (term) =>
  realizedForTaxYear
    .filter((r) => text(r.tax_term).toLowerCase().startsWith(term))
    .reduce((sum, r) => sum + (realizedUsdOf(r) ?? 0), 0)
const computedShortUsd = sumUsd('short')
const computedLongUsd = sumUsd('long')
const usRealizedForTaxYear = realizedForTaxYear.filter((r) => r.market === 'US')
const computedBasis = usRealizedForTaxYear.some((r) => r.basis === '1099b') ? '1099-B' : 'replay'
// Named per market so a mismatch says WHERE it came from rather than only how big.
const computedByMarket = [...new Set(realizedForTaxYear.map((r) => r.market))].sort().map((market) => {
  const rows = realizedForTaxYear.filter((r) => r.market === market)
  return `${market} ${rows.reduce((sum, r) => sum + (realizedUsdOf(r) ?? 0), 0).toFixed(2)}`
})
const assumedShortUsd = Number(usTaxAssumptions?.ytdRealizedShortGainLossUsd ?? 0)
const assumedLongUsd = Number(usTaxAssumptions?.ytdRealizedLongGainLossUsd ?? 0)
// A dollar: below the rounding these figures are carried at, and far below
// anything that moves a tax bracket.
const ytdAgrees =
  Math.abs(assumedShortUsd - computedShortUsd) <= 1 && Math.abs(assumedLongUsd - computedLongUsd) <= 1

// The computed figure is published for the tax pages but deliberately NOT wired
// into `ytdRealized*Usd` itself. It is a FIFO replay of our own, and where the
// broker applied a return-of-capital basis adjustment the two genuinely differ
// — CONY 2025 is -$86.70 replayed against -$30.26 filed. An assumption that
// quietly rewrites itself to an estimate would be believed precisely because
// nobody entered it. So the operator still types the number, and this check
// tells them what the data makes it and when the two have drifted apart.
db.prepare('insert or replace into meta (key, value) values (?, ?)').run(
  'us_ytd_realized_computed',
  JSON.stringify({
    taxYear,
    basis: computedBasis,
    shortUsd: Number(computedShortUsd.toFixed(2)),
    longUsd: Number(computedLongUsd.toFixed(2)),
    lots: realizedForTaxYear.length,
    // Worldwide, so the tax page can show which market each part came from
    // rather than implying the whole figure is US-sourced.
    scope: 'worldwide',
    byMarket: computedByMarket,
    unconvertibleLots: unconvertible.length,
  })
)

check(
  'us_ytd_realized_assumption_reviewed',
  usSalesThisYear.length === 0 || (ytdRealizedAssumed && ytdAgrees),
  usSalesThisYear.length === 0
    ? `no ${taxYear} US sales to reconcile`
    : ytdAgrees && ytdRealizedAssumed
      ? `${ytdSalesDetail}; ytdRealized*Usd matches the worldwide ${computedBasis} figure ` +
        `(${computedShortUsd.toFixed(2)} short / ${computedLongUsd.toFixed(2)} long — ${computedByMarket.join(', ')})`
      : `${ytdSalesDetail}; worldwide ${computedBasis} gives ${computedShortUsd.toFixed(2)} short / ` +
        `${computedLongUsd.toFixed(2)} long (${computedByMarket.join(', ')}) but ytdRealized*Usd is ` +
        `${assumedShortUsd} / ${assumedLongUsd}` +
        `${unconvertible.length ? `; ${unconvertible.length} lot(s) had no FX for their trade date` : ''}` +
        `${taxPolicy ? '' : ` (no policy file at ${path.basename(taxPolicyPath)})`}`,
  'warning'
)

// A rename whose target is itself renamed would leave the ingest with the
// symbol halfway through the chain, splitting the position it was written to
// join — the failure it was meant to fix, wearing a third ticker. Cheap to
// state here, and it turns a silent half-merge into a named check.
const unresolvedRenames = [...tickerRenames.entries()]
  .filter(([, to]) => tickerRenames.has(to.toUpperCase()))
  .map(([from, to]) => `${from} -> ${to} -> ${tickerRenames.get(to.toUpperCase())}`)
check(
  'manual_mapping_renames_resolve',
  unresolvedRenames.length === 0,
  tickerRenames.size === 0
    ? 'no ticker renames declared'
    : unresolvedRenames.length === 0
      ? `${tickerRenames.size} ticker rename(s) point at a current symbol`
      : `${unresolvedRenames.length} rename(s) chain instead of pointing at the current symbol: ` +
        unresolvedRenames.slice(0, 3).join('; ')
)

// The replay is only believable if walking it forward reproduces the positions
// the brokers report today. Anything it cannot reproduce is named here rather
// than left for a wrong cost basis to reveal on some later sale.
check(
  'us_realized_replay_reconciles_holdings',
  usReplayMismatches.length === 0,
  usReplayReconcilableCount === 0
    ? 'no US holdings to reconcile the replay against'
    : usReplayMismatches.length === 0
      ? `all ${usReplayReconcilableCount} replayed US position(s) match holdings` +
        (usReplayAsOfSkew.length ? ` (${usReplayAsOfSkew.length} after allowing for trades since the snapshot: ${usReplayAsOfSkew.slice(0, 3).join('; ')})` : '')
      : `${usReplayMismatches.length} of ${usReplayReconcilableCount} position(s) disagree: ${usReplayMismatches
          .slice(0, 5)
          .join('; ')}` +
        (usReplayAsOfSkew.length ? `; ${usReplayAsOfSkew.length} more explained by trades since the snapshot` : ''),
  'warning'
)

// Deliberately Robinhood-only and deliberately not folded into
// `us_realized_replay_reconciles_holdings`, for the same reason
// `toss_holdings_lots_provenance` stands apart from that check: the two sides
// are different vintages by design once a live snapshot backs the holdings,
// and that gap is expected to widen as trades happen and narrow only when the
// transaction CSVs are re-downloaded — never on a cadence the replay controls.
check(
  'robinhood_holdings_replay_provenance',
  robinhoodSnapshotLotCount === 0 || robinhoodReplayMismatches.length === 0,
  robinhoodSnapshotLotCount === 0
    ? 'no MCP snapshot backing Robinhood holdings — nothing to compare the replay against'
    : robinhoodReplayMismatches.length === 0
      ? `all Robinhood position(s) backed by the MCP snapshot match the transaction-replayed lots`
      : `${robinhoodReplayMismatches.length} Robinhood position(s) disagree with the transaction-replayed lots ` +
        `(expected once trades outrun the downloaded CSVs — download fresh ones to close it): ${robinhoodReplayMismatches
          .slice(0, 6)
          .join('; ')}`,
  'warning'
)

// A disposal with no open lot behind it means the opening side is outside the
// history we hold, and its proceeds would otherwise be booked entirely as gain.
const usUnmatchedDisposals = usReplayNotes.filter((n) => n.includes('no matching open lot'))
check(
  'us_realized_replay_lots_matched',
  usUnmatchedDisposals.length === 0,
  usUnmatchedDisposals.length === 0
    ? `${usRealizedRows.length} US realized lot(s) replayed, every disposal matched to an opening lot`
    : `${usUnmatchedDisposals.length} disposal(s) with no opening lot: ${usUnmatchedDisposals.slice(0, 3).join('; ')}`
)

// Shares that arrived carrying no cost — neither on the row nor from a
// delivering broker — sit at zero cost until the gap is closed. Harmless while
// they are held, and a fictitious gain the day they are sold.
const usZeroCostArrivals = usReplayNotes.filter((n) => n.includes('opened at zero cost'))
// Recovering a cost from the lot export is a normal outcome, not a fault, but
// it is a lot the transaction row did not describe — so it is stated rather
// than left for someone to notice in a total.
check(
  'us_replay_arrival_costs_from_lots',
  true,
  usReplayLotCostLookups.length === 0
    ? 'no arrival needed its cost read off a broker lot'
    : `${usReplayLotCostLookups.length} arrival(s) took their cost from the broker's own lot export: ${usReplayLotCostLookups.slice(0, 3).join('; ')}`,
  'warning'
)
check(
  'us_replay_arrivals_carry_cost',
  usZeroCostArrivals.length === 0,
  usZeroCostArrivals.length === 0
    ? 'every replayed arrival carries a cost'
    : `${usZeroCostArrivals.length} arrival(s) opened at zero cost: ${usZeroCostArrivals.slice(0, 3).join('; ')}`,
  'warning'
)

// Reported where the walk ends rather than where it starts: by here the carry
// above has had its chance, so a leg that still counts is one nothing could
// complete. A leg whose basis WAS carried is named but does not warn — the
// document gap is real and the numbers are no longer wrong because of it, and a
// warning that stands until someone downloads a statement is a warning people
// learn to scroll past.
check(
  'transfer_legs_pair_across_accounts',
  unpairedTransferOut.length === transferCarriedLegs,
  unpairedTransferOut.length === 0
    ? transferCarriedLegs === 0
      ? 'every outbound transfer lands in another account'
      : `every outbound transfer is accounted for; ${transferCarriedLegs} by carrying the basis rather than by an arrival record`
    : `${unpairedTransferOut.length} outbound transfer(s) with no matching arrival within ` +
      `${TRANSFER_PAIR_WINDOW_DAYS}d — the receiving account's statement is older than the move, ` +
      `so its lots were short by that much: ` +
      unpairedTransferOut.map((u) => `${u.row.date} ${u.row.account} ${u.row.ticker}: ${u.missing}`).slice(0, 5).join('; ') +
      (transferCarriedLegs ? `; ${transferCarriedLegs} had their basis carried across (see transfer_basis_carried_on_arrival)` : ''),
  'warning'
)

// The carry writes lots no document asserts, so it says so out loud every run.
// A decline is the louder half: it means a transfer's basis is genuinely
// unaccounted for and the shortfall stays in the numbers until a statement
// closes it.
check(
  'transfer_basis_carried_on_arrival',
  transferCarryDeclined.length === 0,
  transferCarryDeclined.length === 0
    ? transferCarriedLots.length === 0
      ? 'no transfer needed its basis carried'
      : `${transferCarriedLots.length} lot(s) carried from the sending account's own row: ${transferCarriedLots.slice(0, 5).join('; ')}`
    : `${transferCarryDeclined.length} transfer(s) could not have their basis carried: ${transferCarryDeclined.slice(0, 5).join('; ')}`,
  'warning'
)

// An arrival valued from a historical close carries a cost, so the zero-cost
// check passes on it — but the figure is this repo's estimate, not one any
// broker reported, and a sale of that lot books a gain against it. Raised on its
// own so an estimated basis cannot quietly read as a filed one.
check(
  'us_replay_arrivals_priced_from_close',
  usPricedArrivals.length === 0,
  usPricedArrivals.length === 0
    ? 'every replayed arrival took its cost from the row, the delivering lot, or the broker lot export'
    : `${usPricedArrivals.length} arrival(s) valued at a historical close: ${usPricedArrivals.slice(0, 3).join('; ')}`,
  'warning'
)

// A 1099-B line that could not be tied to a recorded sale has no ticker, so it
// can be totalled but not attributed to a position.
check(
  'us_1099b_rows_attributed',
  us1099bNotes.length === 0,
  us1099bRows.length === 0
    ? 'no 1099-B sales in any filed form'
    : us1099bNotes.length === 0
      ? `${us1099bRows.length} filed 1099-B lot(s) matched to recorded sales across ${us1099bCoverage.size} broker-year(s)`
      : `${us1099bNotes.length} issue(s): ${us1099bNotes.slice(0, 3).join('; ')}`,
  'warning'
)

// A dividend dated INSIDE a closed position's life should land on one of its
// lots; one that does not means the two halves disagree about when the position
// existed. Payments that arrive after the last disposal are excluded from the
// fault and counted separately — Korea pays a quarter or more after the record
// date, so they are the normal tail of closing a position rather than a defect.
check(
  'kr_realized_dividends_attributed',
  krDividendNotes.length === 0,
  krDividendStats == null
    ? 'no Korean realized lots to attribute against'
    : krDividendNotes.length === 0
      ? `${krDividendStats.attributed} payment(s) attributed to ${krDividendStats.lots} of ` +
        `${krDividendStats.of} lot(s), ₩${Math.round(krDividendStats.krw).toLocaleString('en-US')} in all` +
        (krDividendStats.afterClose ? `; ${krDividendStats.afterClose} paid after the position closed` : '')
      : `${krDividendNotes.length} payment(s) inside a closed position's life matched no lot window: ` +
        krDividendNotes.slice(0, 3).join('; '),
  'warning'
)

insertMany(db, 'validation_checks', checks, ['name', 'status', 'detail', 'severity'])

const currentValuation = valuePortfolio(
  holdingRows.map((row) => ({
    market: row.market,
    cost: row.base_cost,
    marketValue: row.base_market_value,
  }))
)
const nativeKrwCost = holdingRows
  .filter((row) => row.currency === 'KRW')
  .reduce((sum, row) => sum + Number(row.native_cost || 0), 0)
const nativeUsdCost = holdingRows
  .filter((row) => row.currency === 'USD')
  .reduce((sum, row) => sum + Number(row.native_cost || 0), 0)
const dividendsKrw = dividendRows
  .filter((row) => row.currency === 'KRW')
  .reduce((sum, row) => sum + Number(row.native_amount || 0), 0)
const dividendsUsd = dividendRows
  .filter((row) => row.currency === 'USD')
  .reduce((sum, row) => sum + Number(row.native_amount || 0), 0)

db.prepare(`
  insert or replace into portfolio_snapshots (
    snapshot_date, captured_at, global_base_cost, global_base_market_value,
    global_base_unrealized_gl, global_base_return_pct, market_value_coverage,
    priced_base_cost, position_coverage, kr_market_value_coverage,
    us_market_value_coverage, crypto_market_value_coverage,
    kr_market_value, us_market_value_base, crypto_market_value_base,
    kr_cost_basis, us_cost_basis_base, crypto_cost_basis_base,
    kr_unrealized_gl, us_unrealized_gl_base, crypto_unrealized_gl_base,
    kr_return_pct, us_return_pct, crypto_return_pct,
    krw_cost, usd_cost, dividends_krw, dividends_usd, holding_count, share_count
  ) values (${Array.from({ length: 30 }, () => '?').join(', ')})
`).run(
  snapshotDate, now,
  currentValuation.global.totalCost, currentValuation.global.partialMarketValue,
  currentValuation.global.unrealizedGl, currentValuation.global.returnPct,
  currentValuation.global.costCoverage, currentValuation.global.pricedCost,
  currentValuation.global.positionCoverage, currentValuation.KR.costCoverage,
  currentValuation.US.costCoverage, currentValuation.CRYPTO.costCoverage,
  currentValuation.KR.partialMarketValue, currentValuation.US.partialMarketValue,
  currentValuation.CRYPTO.partialMarketValue, currentValuation.KR.totalCost,
  currentValuation.US.totalCost, currentValuation.CRYPTO.totalCost,
  currentValuation.KR.unrealizedGl, currentValuation.US.unrealizedGl,
  currentValuation.CRYPTO.unrealizedGl, currentValuation.KR.returnPct,
  currentValuation.US.returnPct, currentValuation.CRYPTO.returnPct,
  nativeKrwCost, nativeUsdCost, dividendsKrw, dividendsUsd,
  currentValuation.global.positionCount,
  holdingRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
)

db.exec(`
create index idx_holdings_account on holdings(account);
create index idx_holdings_ticker on holdings(ticker);
create index idx_tax_lots_ticker on tax_lots(ticker);
create index idx_transactions_date on transactions(date);
create index idx_transactions_type on transactions(type);
create index idx_dividends_date on dividends(date);
`)

const report = {
  ingestedAt: now,
  dbPath,
  sourceFiles: Object.fromEntries(
    [
      ...Object.entries(sources).map(([name, file]) => [name, { file, rows: datasets[name].rows.length }]),
      ['kr_prices', { file: krPricesPath, rows: krPriceConfig.prices?.length ?? 0 }],
      ['us_prices', { file: usPricesPath, rows: usPriceConfig.prices?.length ?? 0 }],
      ['us_pdf_evidence', { file: usPdfEvidencePath, rows: usPdfEvidence.reports?.length ?? 0 }],
      ['robinhood_snapshot', { file: robinhoodSnapshotPath, rows: robinhoodSnapshot?.accounts?.length ?? 0 }],
      ['crypto_activity', { file: cryptoActivityPath, rows: cryptoActivity.transactions?.length ?? 0 }],
      ['crypto_prices', { file: cryptoPricesPath, rows: cryptoPriceConfig.prices?.length ?? 0 }],
      [
        'manual_mappings',
        {
          file: manualMappingsPath,
          rows:
            (manualMappings.incomeRules?.length ?? 0) +
            (manualMappings.dividendOverrides?.length ?? 0) +
            (manualMappings.tickerRenames?.length ?? 0) +
            (manualMappings.instrumentAliases?.length ?? 0),
        },
      ],
    ]
  ),
  checks,
}
fs.writeFileSync(path.join(outDir, 'validation-report.json'), JSON.stringify(report, null, 2))
db.close()

// Two different questions, deliberately answered by two different counts:
// `failed` decides the exit code — only an ERROR aborts the refresh. The
// printed line reports EVERY check that did not pass, warnings included,
// because the refresh cron greps exactly this line to decide whether to alert.
// Counting warnings as "passing" here made that alert unreachable for the one
// class of failure it was written to catch: the survivable kind that exits 0.
const failed = checks.filter((c) => c.status !== 'pass' && c.severity === 'error')
const notPassing = checks.filter((c) => c.status !== 'pass')
console.log(`Wrote ${dbPath}`)
console.log(`Validation: ${checks.length - notPassing.length}/${checks.length} checks passing`)
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2))
  process.exitCode = 1
}
