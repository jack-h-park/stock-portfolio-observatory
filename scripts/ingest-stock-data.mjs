import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { loadLocalEnv } from './env.mjs'
import { resolveCryptoFiles, resolveUsHoldingFiles, resolveUsTransactionFiles } from './source-files.mjs'

loadLocalEnv()

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

const { files: usHoldingFiles, missing: missingHoldingSources } = resolveUsHoldingFiles(dataDir)
const { files: usTransactionFiles, missing: missingTransactionSources } = resolveUsTransactionFiles(dataDir)
// Resolved here as well as in the extract step, so the PDFs behind the crypto
// positions are fingerprinted into source_files and show up on /data-map. The
// extract reads them; this records WHICH files were read.
const { files: cryptoSourceFiles, missing: missingCryptoSourceFiles } = resolveCryptoFiles(dataDir)

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

function normalizeTicker(value) {
  return String(value || '').replace(/^'/, '').trim()
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

function normalizeUsTransactionType(value, action = '') {
  const explicit = text(value).toLowerCase()
  const act = text(action).toLowerCase()
  const raw = `${explicit} ${act}`
  if (explicit === 'cdiv') return 'DIVIDEND'
  if (explicit === 'int') return 'INTEREST'
  if (explicit === 'slip') return 'STOCK_LENDING_INCOME'
  if (explicit === 'rtp') return 'TRANSFER_IN'
  if (explicit === 'ach') return 'TRANSFER_OUT'
  if (explicit === 'itrf') return 'INTERNAL_TRANSFER'
  if (explicit === 'spl') return 'STOCK_SPLIT'
  if (explicit === 'spr' || explicit === 'sxch') return 'CORPORATE_ACTION'
  if (explicit === 'gmpc') return 'OTHER_INCOME'
  if (explicit === 'gold') return 'FEE'
  if (explicit === 'rec') return 'REINVEST'
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
  return ['DIVIDEND', 'INTEREST', 'STOCK_LENDING_INCOME', 'OTHER_INCOME', 'STAKING_REWARD'].includes(type)
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
const krPricesByTicker = new Map((krPriceConfig.prices ?? []).map((p) => [normalizeTicker(p.ticker), p]))
const usPricesByTicker = new Map((usPriceConfig.prices ?? []).map((p) => [normalizeTicker(p.ticker), p]))
// Keyed by venue as well as symbol: BTC on Bithumb and BTC on Robinhood are the
// same asset at two different prices in two different currencies, and collapsing
// them onto the symbol alone would mark one venue's position at the other's book.
const cryptoPricesByKey = new Map((cryptoPriceConfig.prices ?? []).map((p) => [`${p.venue}\t${p.symbol}`, p]))
const cryptoRewardCloses = new Map((cryptoPriceConfig.historical ?? []).map((h) => [`${h.venue}\t${h.symbol}\t${h.date}`, h]))
const manualMappings = loadManualMappings()

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

const now = new Date().toISOString()
db.prepare('insert into meta (key, value) values (?, ?)').run('ingested_at', now)
db.prepare('insert into meta (key, value) values (?, ?)').run('data_dir', dataDir)
db.prepare('insert into meta (key, value) values (?, ?)').run('payload_dir', payloadDir)
db.prepare('insert into meta (key, value) values (?, ?)').run('fx_rates_path', fxRatesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('kr_prices_path', krPricesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('us_prices_path', usPricesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('historical_prices_path', historicalPricesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('historical_fx_rates_path', historicalFxRatesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('us_pdf_evidence_path', usPdfEvidencePath)
db.prepare('insert into meta (key, value) values (?, ?)').run('crypto_activity_path', cryptoActivityPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('crypto_prices_path', cryptoPricesPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('manual_mappings_path', manualMappingsPath)
db.prepare('insert into meta (key, value) values (?, ?)').run('refresh_runs_path', refreshRunsPath)

insertMany(db, 'portfolio_snapshots', previousPortfolioSnapshots, [
  'snapshot_date',
  'captured_at',
  'global_base_cost',
  'global_base_market_value',
  'global_base_unrealized_gl',
  'global_base_return_pct',
  'market_value_coverage',
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
    (manualMappings.incomeRules?.length ?? 0) + (manualMappings.dividendOverrides?.length ?? 0)
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
// Only `holdings` is taken here. The API's order history cannot rebuild Toss
// lots — 18 of its 46 symbols arrived by transfer rather than by order, and a
// transfer is not an order — so the lots stay on the payload until the sending
// brokers' costs are carried across. That split is deliberate and is reported
// as `toss_holdings_lots_provenance` below rather than left to be discovered.
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

  if (source.brokerage === 'Merrill') {
    const rows = parseCsv(fs.readFileSync(source.filename, 'utf8')).filter((r) => r.some((c) => c.trim()))
    let account = 'Merrill'
    const accountLine = rows.find((r) => r[0]?.includes('Selected account'))
    if (accountLine) account = `Merrill ${accountLine.join(' ').split(':').slice(1).join(':').trim()}`
    let currentTicker = ''
    let currentName = ''
    let asOf = '2026-07-15'
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

for (const report of usPdfEvidence.reports ?? []) {
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
    const rows = readCsvObjects(source.filename, (r) => r.includes('Activity Date') && r.includes('Trans Code'))
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
    ].includes(r.type)
)
const missingFxHoldings = holdingRows.filter((r) => r.currency !== r.base_currency && (r.fx_rate_to_base == null || r.base_cost == null))
const missingKrPrices = holdingRows.filter((r) => r.market === 'KR' && r.quantity > 0 && r.native_price == null)
const missingUsPrices = holdingRows.filter((r) => r.market === 'US' && r.quantity > 0 && r.native_market_value == null)
const gainLossReports = (usPdfEvidence.reports ?? []).filter((r) => r.category === 'us_gain_loss_pdf')
const taxDocReports = (usPdfEvidence.reports ?? []).filter((r) => r.category === 'us_tax_document_pdf')

// The Toss fetch is an optional refresh step, so a failed one leaves the last
// snapshot in place and the ingest reads it without complaint. Age is the only
// thing that distinguishes "current" from "the API stopped answering days ago",
// and 203 days of a frozen FX rate is this project's standing lesson in what an
// unwatched snapshot costs.
const tossSnapshotAgeHours = tossSnapshot?.fetchedAt
  ? (Date.now() - Date.parse(tossSnapshot.fetchedAt)) / 3_600_000
  : null
check(
  'toss_snapshot_fresh',
  tossSnapshot == null || (tossSnapshotAgeHours != null && tossSnapshotAgeHours <= 24),
  tossSnapshot == null
    ? 'no Toss snapshot configured'
    : `snapshot is ${tossSnapshotAgeHours == null ? 'undated' : `${tossSnapshotAgeHours.toFixed(1)}h old`}`,
  'warning'
)
// Not a data error — a stated gap, kept loud so it is closed rather than
// forgotten. It shuts when the transferred-in lots carry their sending broker's
// acquisition cost across and Toss lots can be rebuilt from its order history.
check(
  'toss_holdings_lots_provenance',
  tossHoldingCount === 0 || differentProvenance.length === 0,
  tossHoldingCount === 0
    ? 'no live Toss snapshot'
    : `${differentProvenance.length} of ${tossHoldingCount} live Toss position(s) disagree with lots still carried from the payload`,
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
check('fx_rates_available_for_non_base_holdings', missingFxHoldings.length === 0, `${missingFxHoldings.length} holding row(s) missing FX/base cost`)
check('kr_prices_available_for_unrealized_gl', missingKrPrices.length === 0, `${missingKrPrices.length} KR holding row(s) missing current price`, 'warning')
check('us_prices_available_for_unrealized_gl', missingUsPrices.length === 0, `${missingUsPrices.length} US holding row(s) missing market value`, 'warning')
check(
  'us_pdf_evidence_extracted',
  gainLossReports.length >= 3 && taxDocReports.length >= 5,
  `${gainLossReports.length} gain/loss report(s), ${taxDocReports.length} tax document(s)`,
  'warning'
)
// A brokerage export pattern that matched nothing. The prior silent skip is
// exactly what let stale/absent files pass unnoticed; name them on /health.
const missingSources = [...missingHoldingSources, ...missingTransactionSources]
check(
  'expected_us_source_files_present',
  missingSources.length === 0,
  missingSources.length ? `no file matches: ${missingSources.join('; ')}` : 'all expected US brokerage exports found',
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
check(
  'us_ytd_realized_assumption_reviewed',
  usSalesThisYear.length === 0 || ytdRealizedAssumed,
  usSalesThisYear.length === 0
    ? `no ${taxYear} US sales to reconcile`
    : ytdRealizedAssumed
      ? `${ytdSalesDetail}; ytdRealized*Usd set to ${Number(usTaxAssumptions?.ytdRealizedShortGainLossUsd ?? 0)} short / ${Number(usTaxAssumptions?.ytdRealizedLongGainLossUsd ?? 0)} long`
      : `${ytdSalesDetail}, but ytdRealized*Usd is 0${taxPolicy ? '' : ` (no policy file at ${path.basename(taxPolicyPath)})`}`,
  'warning'
)

insertMany(db, 'validation_checks', checks, ['name', 'status', 'detail', 'severity'])

const snapshotDate = now.slice(0, 10)
db.prepare(`
  insert or replace into portfolio_snapshots (
    snapshot_date, captured_at, global_base_cost, global_base_market_value,
    global_base_unrealized_gl, global_base_return_pct, market_value_coverage,
    kr_market_value, us_market_value_base, crypto_market_value_base,
    kr_cost_basis, us_cost_basis_base, crypto_cost_basis_base,
    kr_unrealized_gl, us_unrealized_gl_base, crypto_unrealized_gl_base,
    kr_return_pct, us_return_pct, crypto_return_pct,
    krw_cost, usd_cost, dividends_krw, dividends_usd, holding_count, share_count
  )
  select
    ?, ?,
    coalesce(sum(base_cost), 0),
    coalesce(sum(base_market_value), 0),
    coalesce(sum(base_unrealized_gl), 0),
    case when coalesce(sum(base_cost), 0) > 0 then coalesce(sum(base_unrealized_gl), 0) / sum(base_cost) * 100 else null end,
    case when count(*) > 0 then avg(case when base_market_value is not null then 1.0 else 0.0 end) else 0 end,
    coalesce(sum(case when market = 'KR' then base_market_value else 0 end), 0),
    coalesce(sum(case when market = 'US' then base_market_value else 0 end), 0),
    coalesce(sum(case when market = 'CRYPTO' then base_market_value else 0 end), 0),
    coalesce(sum(case when market = 'KR' then base_cost else 0 end), 0),
    coalesce(sum(case when market = 'US' then base_cost else 0 end), 0),
    coalesce(sum(case when market = 'CRYPTO' then base_cost else 0 end), 0),
    coalesce(sum(case when market = 'KR' then base_unrealized_gl else 0 end), 0),
    coalesce(sum(case when market = 'US' then base_unrealized_gl else 0 end), 0),
    coalesce(sum(case when market = 'CRYPTO' then base_unrealized_gl else 0 end), 0),
    case when coalesce(sum(case when market = 'KR' then base_cost else 0 end), 0) > 0 then coalesce(sum(case when market = 'KR' then base_unrealized_gl else 0 end), 0) / sum(case when market = 'KR' then base_cost else 0 end) * 100 else null end,
    case when coalesce(sum(case when market = 'US' then base_cost else 0 end), 0) > 0 then coalesce(sum(case when market = 'US' then base_unrealized_gl else 0 end), 0) / sum(case when market = 'US' then base_cost else 0 end) * 100 else null end,
    case when coalesce(sum(case when market = 'CRYPTO' then base_cost else 0 end), 0) > 0 then coalesce(sum(case when market = 'CRYPTO' then base_unrealized_gl else 0 end), 0) / sum(case when market = 'CRYPTO' then base_cost else 0 end) * 100 else null end,
    coalesce(sum(case when currency = 'KRW' then native_cost else 0 end), 0),
    coalesce(sum(case when currency = 'USD' then native_cost else 0 end), 0),
    (select coalesce(sum(case when currency = 'KRW' then native_amount else 0 end), 0) from dividends),
    (select coalesce(sum(case when currency = 'USD' then native_amount else 0 end), 0) from dividends),
    count(*),
    coalesce(sum(quantity), 0)
  from holdings
`).run(snapshotDate, now)

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
      ['crypto_activity', { file: cryptoActivityPath, rows: cryptoActivity.transactions?.length ?? 0 }],
      ['crypto_prices', { file: cryptoPricesPath, rows: cryptoPriceConfig.prices?.length ?? 0 }],
      [
        'manual_mappings',
        { file: manualMappingsPath, rows: (manualMappings.incomeRules?.length ?? 0) + (manualMappings.dividendOverrides?.length ?? 0) },
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
