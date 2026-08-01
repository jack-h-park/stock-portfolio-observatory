import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const root = process.cwd()
const sampleDataDir = path.join(root, 'private-data')
const dbPath =
  process.env.SAMPLE_STOCK_DB_PATH ||
  path.join(sampleDataDir, 'outputs/stock-portfolio-observatory/stock-portfolio-observatory.db')
const sampleSourceDir = path.join(sampleDataDir, 'sample-source')
const now = new Date().toISOString()
const fxRate = 1300

if (fs.existsSync(path.join(root, '.env.local')) && process.env.SAMPLE_FORCE !== '1') {
  console.error('Refusing to seed sample data while .env.local exists.')
  console.error('This protects private-mode runtime snapshots in data/*.json.')
  console.error('Run SAMPLE_FORCE=1 pnpm seed:sample only when you intentionally want to overwrite local ignored sample files.')
  process.exit(1)
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function fingerprint(filePath) {
  const stat = fs.statSync(filePath)
  return {
    filename: path.basename(filePath),
    path: filePath,
    bytes: stat.size,
    mtime_ms: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  }
}

function insertMany(db, table, rows, columns) {
  if (rows.length === 0) return
  const placeholders = columns.map(() => '?').join(', ')
  const stmt = db.prepare(`insert into ${table} (${columns.join(', ')}) values (${placeholders})`)
  const tx = db.transaction((items) => {
    for (const row of items) stmt.run(...columns.map((col) => row[col] ?? null))
  })
  tx(rows)
}

fs.rmSync(dbPath, { force: true })
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
fs.mkdirSync(sampleSourceDir, { recursive: true })

const sourceFiles = {
  holdings: path.join(sampleSourceDir, 'sample-holdings.tsv'),
  taxlots: path.join(sampleSourceDir, 'sample-taxlots.tsv'),
  transactions: path.join(sampleSourceDir, 'sample-transactions.tsv'),
  dividends: path.join(sampleSourceDir, 'sample-dividends.tsv'),
  realized: path.join(sampleSourceDir, 'sample-realized.tsv'),
}

fs.writeFileSync(sourceFiles.holdings, 'market\tticker\tname\tquantity\tcost\nKR\t005930\tSample Electronics\t10\t700000\nUS\tAAPL\tExample Apple\t5\t1000\n')
fs.writeFileSync(sourceFiles.taxlots, 'market\tticker\tacquired_date\tquantity\tcost\nKR\t005930\t2025-01-15\t10\t700000\nUS\tAAPL\t2025-02-10\t5\t1000\n')
fs.writeFileSync(sourceFiles.transactions, 'date\tmarket\tticker\ttype\tquantity\tamount\n2025-01-15\tKR\t005930\tBUY\t10\t700000\n2025-02-10\tUS\tAAPL\tBUY\t5\t1000\n')
fs.writeFileSync(sourceFiles.dividends, 'date\tmarket\tticker\tamount\n2026-01-10\tKR\t005930\t15000\n2026-02-10\tUS\tAAPL\t6\n')
fs.writeFileSync(sourceFiles.realized, 'market\tticker\tquantity_sold\trealized_gl_krw\nUS\tMSFT\t1\t52000\n')

writeJson(path.join(root, 'data/fx-rates.json'), {
  baseCurrency: 'KRW',
  rates: [
    { from: 'USD', to: 'KRW', rate: fxRate, asOfDate: '2026-01-01', source: 'Synthetic sample', sourceUrl: '', note: 'Sample FX rate' },
    { from: 'KRW', to: 'KRW', rate: 1, asOfDate: '2026-01-01', source: 'Synthetic sample', sourceUrl: '', note: 'Base currency' },
  ],
})
writeJson(path.join(root, 'data/kr-prices.json'), {
  generatedAt: now,
  source: 'Synthetic sample',
  sourceUrl: '',
  note: 'Synthetic sample KR price snapshot.',
  prices: [{ ticker: '005930', symbol: '005930.KS', price: 82000, currency: 'KRW', exchangeName: 'KSC', instrumentType: 'EQUITY', asOfDate: '2026-01-01', regularMarketTime: null, shortName: 'Sample Electronics', longName: 'Sample Electronics Co Ltd' }],
  missing: [],
})
writeJson(path.join(root, 'data/us-prices.json'), {
  generatedAt: now,
  source: 'Synthetic sample',
  sourceUrl: '',
  note: 'Synthetic sample US price snapshot.',
  prices: [{ ticker: 'AAPL', symbol: 'AAPL', price: 240, currency: 'USD', exchangeName: 'NMS', instrumentType: 'EQUITY', asOfDate: '2026-01-01', regularMarketTime: null, shortName: 'Example Apple', longName: 'Example Apple Inc' }],
  missing: [],
})
// Crypto: one KRW-quoted venue and one USD-quoted venue, because that pairing is
// the whole reason the crypto market cannot be modelled as a single currency.
writeJson(path.join(root, 'data/crypto-prices.json'), {
  generatedAt: now,
  source: 'Synthetic sample',
  sourceUrl: '',
  note: 'Synthetic sample crypto price snapshot.',
  prices: [
    { venue: 'Sample KRW Exchange', currency: 'KRW', symbol: 'BTC', ticker: 'BTC', price: 90000000, quotedAt: now, asOfDate: '2026-01-01', source: 'Synthetic sample', sourceSymbol: 'BTC_KRW' },
    { venue: 'Sample USD Exchange', currency: 'USD', symbol: 'ETH', ticker: 'ETH', price: 2000, quotedAt: now, asOfDate: '2026-01-01', source: 'Synthetic sample', sourceSymbol: 'ETH-USD' },
  ],
  missing: [],
  historical: [],
  missingHistorical: [],
})
writeJson(path.join(root, 'data/crypto-activity.json'), {
  generatedAt: now,
  source: 'Synthetic sample',
  documents: [
    { name: 'bithumb_statement:sample', category: 'bithumb_statement', filename: 'sample-crypto-statement.pdf', path: path.join(sampleSourceDir, 'sample-crypto-statement.pdf'), venue: 'Sample KRW Exchange', account: 'Sample KRW Exchange', pages: 1, rowCount: 1, metrics: { periodStart: '2025-01-01', periodEnd: '2025-12-31', scopeTypes: '매수/매도/입금/출금', scopeAssets: '전체', trade_count: 1, asset_count: 1 } },
  ],
  transactions: [],
  snapshots: [],
})
// Sample mode writes its own mapping file rather than data/manual-mappings.json,
// which is tracked in git and holds the real override rules. The .env.local
// guard above already stops this on a configured machine, but that guard is
// bypassable with SAMPLE_FORCE=1 and says nothing about mappings specifically.
// Writing elsewhere means sample mode cannot touch the real rules at all.
writeJson(path.join(root, 'data/manual-mappings.sample.json'), {
  version: 1,
  description: 'Synthetic sample mappings.',
  incomeRules: [{ match: { typeIncludes: 'interest' }, category: 'interest', note: 'Sample interest classification.' }],
  dividendOverrides: [],
})
writeJson(path.join(root, 'data/us-pdf-evidence.json'), {
  generatedAt: now,
  source: 'Synthetic sample',
  reports: [{ name: 'gain_loss:sample', category: 'us_gain_loss_pdf', filename: 'sample-gain-loss.pdf', path: path.join(sampleSourceDir, 'sample-gain-loss.pdf'), account_hint: '', account: 'Sample Broker', pages: 1, row_count: 1, metrics: { tax_cost_usd: 1000, units: 5, ticker_count: 1, terms: { lt: 1 } }, lots: [] }],
})
writeJson(path.join(root, 'data/refresh-runs.json'), {
  runs: [{ id: now, startedAt: now, finishedAt: now, durationMs: 1200, status: 'success', steps: [{ name: 'seed:sample', command: 'pnpm seed:sample', startedAt: now, finishedAt: now, durationMs: 1200, status: 'success', exitCode: 0, stdoutTail: 'Wrote synthetic sample database.', stderrTail: '' }] }],
})
fs.writeFileSync(path.join(sampleSourceDir, 'sample-gain-loss.pdf'), 'Synthetic PDF placeholder for source inventory only.\n')
fs.writeFileSync(path.join(sampleSourceDir, 'sample-crypto-statement.pdf'), 'Synthetic PDF placeholder for source inventory only.\n')

const db = new Database(dbPath)
db.exec(`
create table meta (key text primary key, value text not null);
create table source_files (name text primary key, filename text not null, path text not null, bytes integer not null, mtime_ms integer not null, sha256 text not null, row_count integer not null);
create table fx_rates (id integer primary key, from_currency text not null, to_currency text not null, rate real not null, as_of_date text not null, source text not null, source_url text, note text);
create table holdings (id integer primary key, market text not null, currency text not null, base_currency text not null, fx_rate_to_base real, brokerage text, account_type text, source_system text, as_of_date text, account text not null, ticker text not null, name text not null, quantity real not null, native_average_unit_cost real, native_cost real not null, native_price real, native_market_value real, native_unrealized_gl real, native_unrealized_gl_pct real, base_cost real, base_market_value real, base_unrealized_gl real, average_unit_cost real, total_cost_krw real not null, current_price real, pe real, eps real, unrealized_gl_krw real, unrealized_gl_pct real, long_term_qty real, short_term_qty real, lot_count integer);
create table tax_lots (id integer primary key, market text not null, currency text not null, base_currency text not null, fx_rate_to_base real, brokerage text, account_type text, source_system text, as_of_date text, account text not null, ticker text not null, name text not null, acquired_date text not null, open_quantity real not null, native_cost_basis real not null, native_unit_cost real, native_market_value real, native_unrealized_gl real, cost_basis_krw real not null, unit_cost real, holding_days integer, tax_term text, source text);
create table realized_lots (id integer primary key, market text not null, currency text not null, base_currency text not null, brokerage text, source_system text, account text not null, ticker text not null, name text not null, acquired_date text, sold_date text, quantity_sold real, cost_basis_krw real, proceeds_krw real, realized_gl_krw real, holding_days integer, tax_term text, basis text, tax_year text, native_cost_basis real, native_proceeds real, native_realized_gl real, covered_status text, form_8949_box text, superseded_by text, dividends_native real, source text);
create table transactions (id integer primary key, market text not null, currency text not null, base_currency text not null, brokerage text, account_type text, source_system text, date text not null, account text not null, type text not null, raw_type text, ticker text, name text, quantity real, native_amount real, native_settlement real, native_unit_price real, amount_krw real, settlement_krw real, unit_price real, fee real, tax real, balance real, source text, page integer);
create table dividends (id integer primary key, market text not null, currency text not null, base_currency text not null, brokerage text, account_type text, source_system text, date text not null, account text not null, ticker text, name text, native_amount real not null, native_tax_withheld real, amount_krw real not null, type text, income_category text, mapping_status text, mapping_note text, source text, page integer);
create table validation_checks (id integer primary key, name text not null, status text not null, detail text not null, severity text not null);
create table evidence_reports (id integer primary key, name text not null, category text not null, filename text not null, path text not null, account_hint text, pages integer, row_count integer, metrics_json text);
`)

insertMany(db, 'meta', [
  { key: 'ingested_at', value: now },
  { key: 'data_dir', value: sampleDataDir },
  { key: 'payload_dir', value: sampleSourceDir },
  { key: 'fx_rates_path', value: path.join(root, 'data/fx-rates.json') },
  { key: 'kr_prices_path', value: path.join(root, 'data/kr-prices.json') },
  { key: 'us_prices_path', value: path.join(root, 'data/us-prices.json') },
  { key: 'us_pdf_evidence_path', value: path.join(root, 'data/us-pdf-evidence.json') },
  { key: 'manual_mappings_path', value: path.join(root, 'data/manual-mappings.sample.json') },
  { key: 'refresh_runs_path', value: path.join(root, 'data/refresh-runs.json') },
], ['key', 'value'])

insertMany(db, 'source_files', Object.entries(sourceFiles).map(([name, file]) => ({ name, ...fingerprint(file), row_count: name === 'holdings' || name === 'taxlots' ? 2 : 2 })), ['name', 'filename', 'path', 'bytes', 'mtime_ms', 'sha256', 'row_count'])
insertMany(db, 'fx_rates', [
  { from_currency: 'USD', to_currency: 'KRW', rate: fxRate, as_of_date: '2026-01-01', source: 'Synthetic sample', source_url: '', note: 'Sample FX rate' },
  { from_currency: 'KRW', to_currency: 'KRW', rate: 1, as_of_date: '2026-01-01', source: 'Synthetic sample', source_url: '', note: 'Base currency' },
], ['from_currency', 'to_currency', 'rate', 'as_of_date', 'source', 'source_url', 'note'])

insertMany(db, 'holdings', [
  { market: 'KR', currency: 'KRW', base_currency: 'KRW', fx_rate_to_base: 1, brokerage: 'Sample Korea Broker', account_type: 'Taxable', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample KR Account', ticker: '005930', name: 'Sample Electronics', quantity: 10, native_average_unit_cost: 70000, native_cost: 700000, native_price: 82000, native_market_value: 820000, native_unrealized_gl: 120000, native_unrealized_gl_pct: 17.1429, base_cost: 700000, base_market_value: 820000, base_unrealized_gl: 120000, average_unit_cost: 70000, total_cost_krw: 700000, current_price: 82000, unrealized_gl_krw: 120000, unrealized_gl_pct: 17.1429, long_term_qty: 10, short_term_qty: 0, lot_count: 1 },
  { market: 'US', currency: 'USD', base_currency: 'KRW', fx_rate_to_base: fxRate, brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample US Account', ticker: 'AAPL', name: 'Example Apple', quantity: 5, native_average_unit_cost: 200, native_cost: 1000, native_price: 240, native_market_value: 1200, native_unrealized_gl: 200, native_unrealized_gl_pct: 20, base_cost: 1300000, base_market_value: 1560000, base_unrealized_gl: 260000, average_unit_cost: 260000, total_cost_krw: 1300000, current_price: 240, unrealized_gl_krw: 260000, unrealized_gl_pct: 20, long_term_qty: 5, short_term_qty: 0, lot_count: 1 },
  { market: 'US', currency: 'USD', base_currency: 'KRW', fx_rate_to_base: fxRate, brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample US Account', ticker: 'MSFT', name: 'Example Microsoft', quantity: 1, native_average_unit_cost: 300, native_cost: 300, native_price: null, native_market_value: null, native_unrealized_gl: null, native_unrealized_gl_pct: null, base_cost: 390000, base_market_value: null, base_unrealized_gl: null, average_unit_cost: 390000, total_cost_krw: 390000, current_price: null, unrealized_gl_krw: null, unrealized_gl_pct: null, long_term_qty: 0, short_term_qty: 1, lot_count: 0 },
  { market: 'CRYPTO', currency: 'KRW', base_currency: 'KRW', fx_rate_to_base: 1, brokerage: 'Sample KRW Exchange', account_type: 'Crypto', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample KRW Exchange', ticker: 'BTC', name: 'BTC', quantity: 0.05, native_average_unit_cost: 80000000, native_cost: 4000000, native_price: 90000000, native_market_value: 4500000, native_unrealized_gl: 500000, native_unrealized_gl_pct: 12.5, base_cost: 4000000, base_market_value: 4500000, base_unrealized_gl: 500000, average_unit_cost: 80000000, total_cost_krw: 4000000, current_price: 90000000, unrealized_gl_krw: 500000, unrealized_gl_pct: 12.5, long_term_qty: 0.05, short_term_qty: 0, lot_count: 1 },
  { market: 'CRYPTO', currency: 'USD', base_currency: 'KRW', fx_rate_to_base: fxRate, brokerage: 'Sample USD Exchange', account_type: 'Crypto', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample USD Exchange', ticker: 'ETH', name: 'ETH', quantity: 0.4, native_average_unit_cost: 2500, native_cost: 1000, native_price: 2000, native_market_value: 800, native_unrealized_gl: -200, native_unrealized_gl_pct: -20, base_cost: 1300000, base_market_value: 1040000, base_unrealized_gl: -260000, average_unit_cost: 3250000, total_cost_krw: 1300000, current_price: 2600000, unrealized_gl_krw: -260000, unrealized_gl_pct: -20, long_term_qty: 0, short_term_qty: 0.4, lot_count: 1 },
], ['market', 'currency', 'base_currency', 'fx_rate_to_base', 'brokerage', 'account_type', 'source_system', 'as_of_date', 'account', 'ticker', 'name', 'quantity', 'native_average_unit_cost', 'native_cost', 'native_price', 'native_market_value', 'native_unrealized_gl', 'native_unrealized_gl_pct', 'base_cost', 'base_market_value', 'base_unrealized_gl', 'average_unit_cost', 'total_cost_krw', 'current_price', 'pe', 'eps', 'unrealized_gl_krw', 'unrealized_gl_pct', 'long_term_qty', 'short_term_qty', 'lot_count'])

insertMany(db, 'tax_lots', [
  { market: 'KR', currency: 'KRW', base_currency: 'KRW', fx_rate_to_base: 1, brokerage: 'Sample Korea Broker', account_type: 'Taxable', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample KR Account', ticker: '005930', name: 'Sample Electronics', acquired_date: '2025-01-15', open_quantity: 10, native_cost_basis: 700000, native_unit_cost: 70000, native_market_value: 820000, native_unrealized_gl: 120000, cost_basis_krw: 700000, unit_cost: 70000, holding_days: 351, tax_term: 'Long-term', source: 'sample-taxlots.tsv' },
  { market: 'US', currency: 'USD', base_currency: 'KRW', fx_rate_to_base: fxRate, brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample US Account', ticker: 'AAPL', name: 'Example Apple', acquired_date: '2025-02-10', open_quantity: 5, native_cost_basis: 1000, native_unit_cost: 200, native_market_value: 1200, native_unrealized_gl: 200, cost_basis_krw: 1300000, unit_cost: 260000, holding_days: 325, tax_term: 'Long-term', source: 'sample-taxlots.tsv' },
  { market: 'CRYPTO', currency: 'KRW', base_currency: 'KRW', fx_rate_to_base: 1, brokerage: 'Sample KRW Exchange', account_type: 'Crypto', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample KRW Exchange', ticker: 'BTC', name: 'BTC', acquired_date: '2024-11-20', open_quantity: 0.05, native_cost_basis: 4000000, native_unit_cost: 80000000, native_market_value: 4500000, native_unrealized_gl: 500000, cost_basis_krw: 4000000, unit_cost: 80000000, holding_days: 407, tax_term: 'Long-term', source: 'sample-crypto-statement.pdf' },
  { market: 'CRYPTO', currency: 'USD', base_currency: 'KRW', fx_rate_to_base: fxRate, brokerage: 'Sample USD Exchange', account_type: 'Crypto', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample USD Exchange', ticker: 'ETH', name: 'ETH', acquired_date: '2025-06-01', open_quantity: 0.4, native_cost_basis: 1000, native_unit_cost: 2500, native_market_value: 800, native_unrealized_gl: -200, cost_basis_krw: 1300000, unit_cost: 3250000, holding_days: 214, tax_term: 'Short-term', source: 'sample-crypto-statement.pdf' },
], ['market', 'currency', 'base_currency', 'fx_rate_to_base', 'brokerage', 'account_type', 'source_system', 'as_of_date', 'account', 'ticker', 'name', 'acquired_date', 'open_quantity', 'native_cost_basis', 'native_unit_cost', 'native_market_value', 'native_unrealized_gl', 'cost_basis_krw', 'unit_cost', 'holding_days', 'tax_term', 'source'])

insertMany(db, 'transactions', [
  { market: 'KR', currency: 'KRW', base_currency: 'KRW', brokerage: 'Sample Korea Broker', account_type: 'Taxable', source_system: 'sample', date: '2025-01-15', account: 'Sample KR Account', type: 'BUY', raw_type: 'Buy', ticker: '005930', name: 'Sample Electronics', quantity: 10, native_amount: -700000, native_settlement: -700000, native_unit_price: 70000, amount_krw: -700000, settlement_krw: -700000, unit_price: 70000, fee: 0, tax: 0, balance: null, source: 'sample-transactions.tsv', page: null },
  { market: 'US', currency: 'USD', base_currency: 'KRW', brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', date: '2025-02-10', account: 'Sample US Account', type: 'BUY', raw_type: 'Buy', ticker: 'AAPL', name: 'Example Apple', quantity: 5, native_amount: -1000, native_settlement: -1000, native_unit_price: 200, amount_krw: -1300000, settlement_krw: -1300000, unit_price: 260000, fee: 0, tax: 0, balance: null, source: 'sample-transactions.tsv', page: null },
  { market: 'CRYPTO', currency: 'KRW', base_currency: 'KRW', brokerage: 'Sample KRW Exchange', account_type: 'Crypto', source_system: 'sample', date: '2024-11-20', account: 'Sample KRW Exchange', type: 'BUY', raw_type: '매수', ticker: 'BTC', name: 'BTC', quantity: 0.05, native_amount: 4000000, native_settlement: -4000000, native_unit_price: 80000000, amount_krw: 4000000, settlement_krw: -4000000, unit_price: 80000000, fee: 10000, tax: null, balance: 0.05, source: 'sample-crypto-statement.pdf', page: 1 },
  { market: 'CRYPTO', currency: 'KRW', base_currency: 'KRW', brokerage: 'Sample KRW Exchange', account_type: 'Crypto', source_system: 'sample', date: '2025-07-01', account: 'Sample KRW Exchange', type: 'STAKING_REWARD', raw_type: '입금', ticker: 'ETH', name: 'ETH', quantity: 0.001, native_amount: 4000, native_settlement: null, native_unit_price: null, amount_krw: 4000, settlement_krw: null, unit_price: null, fee: null, tax: null, balance: 0.001, source: 'sample-crypto-statement.pdf', page: 1 },
], ['market', 'currency', 'base_currency', 'brokerage', 'account_type', 'source_system', 'date', 'account', 'type', 'raw_type', 'ticker', 'name', 'quantity', 'native_amount', 'native_settlement', 'native_unit_price', 'amount_krw', 'settlement_krw', 'unit_price', 'fee', 'tax', 'balance', 'source', 'page'])

insertMany(db, 'dividends', [
  { market: 'KR', currency: 'KRW', base_currency: 'KRW', brokerage: 'Sample Korea Broker', account_type: 'Taxable', source_system: 'sample', date: '2026-01-10', account: 'Sample KR Account', ticker: '005930', name: 'Sample Electronics', native_amount: 15000, native_tax_withheld: 2300, amount_krw: 15000, type: 'DIVIDEND', income_category: 'dividend', mapping_status: 'mapped', mapping_note: 'Synthetic sample dividend.', source: 'sample-dividends.tsv', page: null },
  { market: 'US', currency: 'USD', base_currency: 'KRW', brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', date: '2026-02-10', account: 'Sample US Account', ticker: 'AAPL', name: 'Example Apple', native_amount: 6, native_tax_withheld: 0.9, amount_krw: 7800, type: 'DIVIDEND', income_category: 'dividend', mapping_status: 'mapped', mapping_note: 'Synthetic sample dividend.', source: 'sample-dividends.tsv', page: null },
  { market: 'US', currency: 'USD', base_currency: 'KRW', brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', date: '2026-03-01', account: 'Sample US Account', ticker: null, name: 'Sample Interest', native_amount: 4, native_tax_withheld: 0, amount_krw: 5200, type: 'INTEREST', income_category: 'interest', mapping_status: 'tickerless_income_rule', mapping_note: 'Synthetic tickerless income.', source: 'sample-dividends.tsv', page: null },
  { market: 'CRYPTO', currency: 'KRW', base_currency: 'KRW', brokerage: 'Sample KRW Exchange', account_type: 'Crypto', source_system: 'sample', date: '2025-07-01', account: 'Sample KRW Exchange', ticker: 'ETH', name: 'ETH', native_amount: 4000, native_tax_withheld: 0, amount_krw: 4000, type: 'STAKING_REWARD', income_category: 'other', mapping_status: 'mapped', mapping_note: 'Synthetic sample staking reward.', source: 'sample-crypto-statement.pdf', page: 1 },
], ['market', 'currency', 'base_currency', 'brokerage', 'account_type', 'source_system', 'date', 'account', 'ticker', 'name', 'native_amount', 'native_tax_withheld', 'amount_krw', 'type', 'income_category', 'mapping_status', 'mapping_note', 'source', 'page'])

insertMany(db, 'realized_lots', [{ market: 'US', currency: 'USD', base_currency: 'KRW', brokerage: 'Sample US Broker', source_system: 'sample', account: 'Sample US Account', ticker: 'MSFT', name: 'Example Microsoft', acquired_date: '2025-01-01', sold_date: '2026-01-15', quantity_sold: 1, cost_basis_krw: 300000, proceeds_krw: 352000, realized_gl_krw: 52000, holding_days: 379, tax_term: 'Long-term', basis: 'replay', tax_year: '2026', native_cost_basis: 220, native_proceeds: 258, native_realized_gl: 38, covered_status: '', form_8949_box: '', superseded_by: null, dividends_native: 3.1, source: 'sample-realized.tsv' }], ['market', 'currency', 'base_currency', 'brokerage', 'source_system', 'account', 'ticker', 'name', 'acquired_date', 'sold_date', 'quantity_sold', 'cost_basis_krw', 'proceeds_krw', 'realized_gl_krw', 'holding_days', 'tax_term', 'basis', 'tax_year', 'native_cost_basis', 'native_proceeds', 'native_realized_gl', 'covered_status', 'form_8949_box', 'superseded_by', 'dividends_native', 'source'])
insertMany(db, 'validation_checks', [
  { name: 'sample:source files', status: 'pass', detail: 'Synthetic source files are present.', severity: 'warning' },
  { name: 'sample:valuation coverage', status: 'pass', detail: 'Sample includes one intentional missing valuation row for Data Ops demonstration.', severity: 'warning' },
], ['name', 'status', 'detail', 'severity'])
insertMany(db, 'evidence_reports', [
  { name: 'gain_loss:sample', category: 'us_gain_loss_pdf', filename: 'sample-gain-loss.pdf', path: path.join(sampleSourceDir, 'sample-gain-loss.pdf'), account_hint: '', pages: 1, row_count: 1, metrics_json: JSON.stringify({ tax_cost_usd: 1000, units: 5, ticker_count: 1, terms: { lt: 1 } }) },
  { name: 'bithumb_statement:sample', category: 'bithumb_statement', filename: 'sample-crypto-statement.pdf', path: path.join(sampleSourceDir, 'sample-crypto-statement.pdf'), account_hint: 'Sample KRW Exchange', pages: 1, row_count: 1, metrics_json: JSON.stringify({ periodStart: '2025-01-01', periodEnd: '2025-12-31', scopeTypes: '매수/매도/입금/출금', scopeAssets: '전체', trade_count: 1, asset_count: 1 }) },
], ['name', 'category', 'filename', 'path', 'account_hint', 'pages', 'row_count', 'metrics_json'])

db.close()
console.log(`Wrote sample database: ${dbPath}`)

// Synthetic briefing archive so /daily-briefing renders in sample mode and CI.
// Real documents are written by the briefing cron on the private host; these
// mirror that schema (fully derived: rows parsed, aggregates precomputed, one
// block per market).
const briefingArchiveDir = path.join(sampleDataDir, 'briefing-archive')

const MARKET_META = {
  US: { id: 'US', label: 'US', flag: '\u{1F1FA}\u{1F1F8}', currency: 'USD', symbol: '$', priceDigits: 2, moverMinCost: 300 },
  KR: { id: 'KR', label: 'Korea', flag: '\u{1F1F0}\u{1F1F7}', currency: 'KRW', symbol: '\u20A9', priceDigits: 0, moverMinCost: 400000 },
}

function derive(meta, rows) {
  const byTicker = new Map()
  let cost = 0
  let gl = 0
  for (const r of rows) {
    cost += r.totalCost
    gl += r.glAmount
    const cur = byTicker.get(r.ticker) || { ticker: r.ticker, name: r.name ?? null, cost: 0, gl: 0, quantity: 0, currentPrice: null, accounts: [] }
    cur.cost += r.totalCost
    cur.gl += r.glAmount
    cur.quantity += r.quantity
    cur.currentPrice = r.currentPrice
    if (!cur.accounts.includes(r.account)) cur.accounts.push(r.account)
    byTicker.set(r.ticker, cur)
  }
  const positions = [...byTicker.values()].map((a) => ({ ...a, pct: (a.gl / a.cost) * 100, marketValue: a.cost + a.gl }))
  const eligible = positions.filter((p) => p.cost >= meta.moverMinCost)
  return {
    totals: { cost, gl, pct: (gl / cost) * 100, marketValue: cost + gl, positions: positions.length, rows: rows.length },
    positions,
    gainers: [...eligible].sort((a, b) => b.pct - a.pct),
    losers: [...eligible].sort((a, b) => a.pct - b.pct),
    largest: [...positions].sort((a, b) => b.marketValue - a.marketValue),
  }
}

const noSession = (reason) => ({ available: false, reason, previousDate: null, marketClosed: false, totals: null, gainers: [], losers: [], activity: [] })

function usRows(applePrice) {
  return [
    { account: 'Sample US Account', ticker: 'AAPL', name: null, quantity: 5, avgCost: 200, totalCost: 1000, currentPrice: applePrice, glAmount: (applePrice - 200) * 5, glPct: ((applePrice - 200) / 200) * 100 },
    { account: 'Sample US Account', ticker: 'MSFT', name: null, quantity: 1, avgCost: 300, totalCost: 300, currentPrice: 255, glAmount: -45, glPct: -15 },
    { account: 'Sample US Account 2', ticker: 'AAPL', name: null, quantity: 2, avgCost: 210, totalCost: 420, currentPrice: applePrice, glAmount: (applePrice - 210) * 2, glPct: ((applePrice - 210) / 210) * 100 },
  ]
}
function krRows(chipPrice) {
  return [
    { account: 'Sample KR Broker', ticker: '000111', name: 'Sample Semiconductor', quantity: 10, avgCost: 100000, totalCost: 1000000, currentPrice: chipPrice, glAmount: (chipPrice - 100000) * 10, glPct: ((chipPrice - 100000) / 100000) * 100 },
    { account: 'Sample KR Broker', ticker: '000222', name: 'Sample Motors', quantity: 4, avgCost: 250000, totalCost: 1000000, currentPrice: 150000, glAmount: -400000, glPct: -40 },
  ]
}

function sampleBriefing(date, dateLabel, { narrativeOnly = false, applePrice = 240, chipPrice = 150000, sessions = {} } = {}) {
  const doc = {
    schemaVersion: 2,
    date,
    dateLabel,
    generatedAt: `${date}T08:05:00.000Z`,
    narrative: {
      macro: `On <b>${dateLabel}</b>, synthetic markets did synthetic things. This sample exists so the page can be evaluated without private data.`,
      moverNotes: {
        AAPL: { why: 'Example Apple is up versus cost in the synthetic sample.', dir: 'up' },
        MSFT: { why: 'Example Microsoft is down versus cost in the synthetic sample.', dir: 'down' },
        '000111': { why: 'Sample Semiconductor is up versus cost in the synthetic Korean sample.', dir: 'up' },
        '000222': { why: 'Sample Motors is down versus cost in the synthetic Korean sample.', dir: 'down' },
      },
      // Ordered by priority, as the briefing writer emits them.
      actions: [
        { kind: 'hold', priority: 'act-now', head: 'Hold Example Microsoft', body: 'Synthetic catalyst lands the next day; the sample thesis is unchanged until then.' },
        { kind: 'watch', priority: 'this-week', head: 'Watch the sample concentration', body: 'Example Apple is the largest synthetic position.' },
        { kind: 'trim', priority: 'fyi', head: 'Sample context', body: 'Nothing to do — this item exists to show the least urgent level.' },
      ],
    },
    markets: [],
  }
  if (narrativeOnly) return doc

  for (const [id, rows] of [['US', usRows(applePrice)], ['KR', krRows(chipPrice)]]) {
    const meta = MARKET_META[id]
    doc.markets.push({
      ...meta,
      holdings: { available: true, markdown: null, rows },
      aggregates: derive(meta, rows),
      session: sessions[id] ?? noSession('no-prior-snapshot'),
    })
  }
  return doc
}

// Three shapes the page has to handle: a backfilled day (narrative only), the
// first day with holdings (nothing to compare against), and a day with a full
// session in each market.
const priorApple = 232
const priorChip = 140000
const usPl = (240 - priorApple) * 7
const krPl = (150000 - priorChip) * 10
const sessions = {
  US: {
    available: true, reason: null, previousDate: '2026-01-02', marketClosed: false,
    totals: { pl: usPl, plPct: (usPl / (priorApple * 7 + 255)) * 100, priorMarketValue: priorApple * 7 + 255, coveredPositions: 2, uncoveredPositions: 0 },
    gainers: [{ ticker: 'AAPL', name: null, pctChange: ((240 - priorApple) / priorApple) * 100, valueChange: usPl, priceFrom: priorApple, priceTo: 240, quantity: 7, marketValue: 1680 }],
    losers: [],
    activity: [{ ticker: 'MSFT', kind: 'bought', quantityChange: 1, quantity: 1, cost: 300 }],
  },
  KR: {
    available: true, reason: null, previousDate: '2026-01-02', marketClosed: false,
    totals: { pl: krPl, plPct: (krPl / (priorChip * 10 + 600000)) * 100, priorMarketValue: priorChip * 10 + 600000, coveredPositions: 2, uncoveredPositions: 0 },
    gainers: [{ ticker: '000111', name: 'Sample Semiconductor', pctChange: ((150000 - priorChip) / priorChip) * 100, valueChange: krPl, priceFrom: priorChip, priceTo: 150000, quantity: 10, marketValue: 1500000 }],
    losers: [],
    activity: [],
  },
}

for (const [date, label, opts] of [
  ['2026-01-01', 'January 1, 2026', { narrativeOnly: true }],
  ['2026-01-02', 'January 2, 2026', { applePrice: priorApple, chipPrice: priorChip }],
  ['2026-01-05', 'January 5, 2026', { applePrice: 240, chipPrice: 150000, sessions }],
]) {
  writeJson(path.join(briefingArchiveDir, `${date}.json`), sampleBriefing(date, label, opts))
}
console.log(`Wrote sample briefing archive: ${briefingArchiveDir}`)
