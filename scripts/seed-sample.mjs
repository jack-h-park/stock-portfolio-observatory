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
writeJson(path.join(root, 'data/manual-mappings.json'), {
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

const db = new Database(dbPath)
db.exec(`
create table meta (key text primary key, value text not null);
create table source_files (name text primary key, filename text not null, path text not null, bytes integer not null, mtime_ms integer not null, sha256 text not null, row_count integer not null);
create table fx_rates (id integer primary key, from_currency text not null, to_currency text not null, rate real not null, as_of_date text not null, source text not null, source_url text, note text);
create table holdings (id integer primary key, market text not null, currency text not null, base_currency text not null, fx_rate_to_base real, brokerage text, account_type text, source_system text, as_of_date text, account text not null, ticker text not null, name text not null, quantity real not null, native_average_unit_cost real, native_cost real not null, native_price real, native_market_value real, native_unrealized_gl real, native_unrealized_gl_pct real, base_cost real, base_market_value real, base_unrealized_gl real, average_unit_cost real, total_cost_krw real not null, current_price real, pe real, eps real, unrealized_gl_krw real, unrealized_gl_pct real, long_term_qty real, short_term_qty real, lot_count integer);
create table tax_lots (id integer primary key, market text not null, currency text not null, base_currency text not null, fx_rate_to_base real, brokerage text, account_type text, source_system text, as_of_date text, account text not null, ticker text not null, name text not null, acquired_date text not null, open_quantity real not null, native_cost_basis real not null, native_unit_cost real, native_market_value real, native_unrealized_gl real, cost_basis_krw real not null, unit_cost real, holding_days integer, tax_term text, source text);
create table realized_lots (id integer primary key, market text not null, currency text not null, base_currency text not null, brokerage text, source_system text, account text not null, ticker text not null, name text not null, acquired_date text, sold_date text, quantity_sold real, cost_basis_krw real, proceeds_krw real, realized_gl_krw real, holding_days integer, tax_term text, source text);
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
  { key: 'manual_mappings_path', value: path.join(root, 'data/manual-mappings.json') },
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
], ['market', 'currency', 'base_currency', 'fx_rate_to_base', 'brokerage', 'account_type', 'source_system', 'as_of_date', 'account', 'ticker', 'name', 'quantity', 'native_average_unit_cost', 'native_cost', 'native_price', 'native_market_value', 'native_unrealized_gl', 'native_unrealized_gl_pct', 'base_cost', 'base_market_value', 'base_unrealized_gl', 'average_unit_cost', 'total_cost_krw', 'current_price', 'pe', 'eps', 'unrealized_gl_krw', 'unrealized_gl_pct', 'long_term_qty', 'short_term_qty', 'lot_count'])

insertMany(db, 'tax_lots', [
  { market: 'KR', currency: 'KRW', base_currency: 'KRW', fx_rate_to_base: 1, brokerage: 'Sample Korea Broker', account_type: 'Taxable', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample KR Account', ticker: '005930', name: 'Sample Electronics', acquired_date: '2025-01-15', open_quantity: 10, native_cost_basis: 700000, native_unit_cost: 70000, native_market_value: 820000, native_unrealized_gl: 120000, cost_basis_krw: 700000, unit_cost: 70000, holding_days: 351, tax_term: 'Long-term', source: 'sample-taxlots.tsv' },
  { market: 'US', currency: 'USD', base_currency: 'KRW', fx_rate_to_base: fxRate, brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', as_of_date: '2026-01-01', account: 'Sample US Account', ticker: 'AAPL', name: 'Example Apple', acquired_date: '2025-02-10', open_quantity: 5, native_cost_basis: 1000, native_unit_cost: 200, native_market_value: 1200, native_unrealized_gl: 200, cost_basis_krw: 1300000, unit_cost: 260000, holding_days: 325, tax_term: 'Long-term', source: 'sample-taxlots.tsv' },
], ['market', 'currency', 'base_currency', 'fx_rate_to_base', 'brokerage', 'account_type', 'source_system', 'as_of_date', 'account', 'ticker', 'name', 'acquired_date', 'open_quantity', 'native_cost_basis', 'native_unit_cost', 'native_market_value', 'native_unrealized_gl', 'cost_basis_krw', 'unit_cost', 'holding_days', 'tax_term', 'source'])

insertMany(db, 'transactions', [
  { market: 'KR', currency: 'KRW', base_currency: 'KRW', brokerage: 'Sample Korea Broker', account_type: 'Taxable', source_system: 'sample', date: '2025-01-15', account: 'Sample KR Account', type: 'BUY', raw_type: 'Buy', ticker: '005930', name: 'Sample Electronics', quantity: 10, native_amount: -700000, native_settlement: -700000, native_unit_price: 70000, amount_krw: -700000, settlement_krw: -700000, unit_price: 70000, fee: 0, tax: 0, balance: null, source: 'sample-transactions.tsv', page: null },
  { market: 'US', currency: 'USD', base_currency: 'KRW', brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', date: '2025-02-10', account: 'Sample US Account', type: 'BUY', raw_type: 'Buy', ticker: 'AAPL', name: 'Example Apple', quantity: 5, native_amount: -1000, native_settlement: -1000, native_unit_price: 200, amount_krw: -1300000, settlement_krw: -1300000, unit_price: 260000, fee: 0, tax: 0, balance: null, source: 'sample-transactions.tsv', page: null },
], ['market', 'currency', 'base_currency', 'brokerage', 'account_type', 'source_system', 'date', 'account', 'type', 'raw_type', 'ticker', 'name', 'quantity', 'native_amount', 'native_settlement', 'native_unit_price', 'amount_krw', 'settlement_krw', 'unit_price', 'fee', 'tax', 'balance', 'source', 'page'])

insertMany(db, 'dividends', [
  { market: 'KR', currency: 'KRW', base_currency: 'KRW', brokerage: 'Sample Korea Broker', account_type: 'Taxable', source_system: 'sample', date: '2026-01-10', account: 'Sample KR Account', ticker: '005930', name: 'Sample Electronics', native_amount: 15000, native_tax_withheld: 2300, amount_krw: 15000, type: 'DIVIDEND', income_category: 'dividend', mapping_status: 'mapped', mapping_note: 'Synthetic sample dividend.', source: 'sample-dividends.tsv', page: null },
  { market: 'US', currency: 'USD', base_currency: 'KRW', brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', date: '2026-02-10', account: 'Sample US Account', ticker: 'AAPL', name: 'Example Apple', native_amount: 6, native_tax_withheld: 0.9, amount_krw: 7800, type: 'DIVIDEND', income_category: 'dividend', mapping_status: 'mapped', mapping_note: 'Synthetic sample dividend.', source: 'sample-dividends.tsv', page: null },
  { market: 'US', currency: 'USD', base_currency: 'KRW', brokerage: 'Sample US Broker', account_type: 'Taxable', source_system: 'sample', date: '2026-03-01', account: 'Sample US Account', ticker: null, name: 'Sample Interest', native_amount: 4, native_tax_withheld: 0, amount_krw: 5200, type: 'INTEREST', income_category: 'interest', mapping_status: 'tickerless_income_rule', mapping_note: 'Synthetic tickerless income.', source: 'sample-dividends.tsv', page: null },
], ['market', 'currency', 'base_currency', 'brokerage', 'account_type', 'source_system', 'date', 'account', 'ticker', 'name', 'native_amount', 'native_tax_withheld', 'amount_krw', 'type', 'income_category', 'mapping_status', 'mapping_note', 'source', 'page'])

insertMany(db, 'realized_lots', [{ market: 'US', currency: 'USD', base_currency: 'KRW', brokerage: 'Sample US Broker', source_system: 'sample', account: 'Sample US Account', ticker: 'MSFT', name: 'Example Microsoft', acquired_date: '2025-01-01', sold_date: '2026-01-15', quantity_sold: 1, cost_basis_krw: 300000, proceeds_krw: 352000, realized_gl_krw: 52000, holding_days: 379, tax_term: 'Long-term', source: 'sample-realized.tsv' }], ['market', 'currency', 'base_currency', 'brokerage', 'source_system', 'account', 'ticker', 'name', 'acquired_date', 'sold_date', 'quantity_sold', 'cost_basis_krw', 'proceeds_krw', 'realized_gl_krw', 'holding_days', 'tax_term', 'source'])
insertMany(db, 'validation_checks', [
  { name: 'sample:source files', status: 'pass', detail: 'Synthetic source files are present.', severity: 'warning' },
  { name: 'sample:valuation coverage', status: 'pass', detail: 'Sample includes one intentional missing valuation row for Data Ops demonstration.', severity: 'warning' },
], ['name', 'status', 'detail', 'severity'])
insertMany(db, 'evidence_reports', [{ name: 'gain_loss:sample', category: 'us_gain_loss_pdf', filename: 'sample-gain-loss.pdf', path: path.join(sampleSourceDir, 'sample-gain-loss.pdf'), account_hint: '', pages: 1, row_count: 1, metrics_json: JSON.stringify({ tax_cost_usd: 1000, units: 5, ticker_count: 1, terms: { lt: 1 } }) }], ['name', 'category', 'filename', 'path', 'account_hint', 'pages', 'row_count', 'metrics_json'])

db.close()
console.log(`Wrote sample database: ${dbPath}`)
