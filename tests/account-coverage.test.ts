import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// getAccountCoverage() against a database shaped like a real one with a
// Robinhood MCP snapshot: holdings name each account by the last four of its
// number, transactions by the strategy its CSV was filed under. The fixture's
// account numbers are made up.

const dir = mkdtempSync(path.join(tmpdir(), 'account-coverage-'))
const dbPath = path.join(dir, 'portfolio.db')
const snapshotPath = path.join(dir, 'robinhood-snapshot.json')
const mapPath = path.join(dir, 'accounts.local.json')
const cryptoPath = path.join(dir, 'crypto-activity.json')
process.env.STOCK_CRYPTO_ACTIVITY_PATH = cryptoPath
writeFileSync(mapPath, JSON.stringify({ brokerageAccounts: [
  {institution:'mirae',kind:'general',accountNumber:'000000001234'},
  {institution:'mirae',kind:'general',label:'Sample second',accountNumber:'000000005678',retiredOn:'2024-01-01'}
] }))
process.env.STOCK_ACCOUNT_MAP_PATH = mapPath

const daysAgo = (days: number) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

const db = new Database(dbPath)
db.exec(`
create table source_coverage_confirmations (scope text, institution text, account text, kind text, through_date text, source text, sha256 text, empty_holdings integer);
create table source_files (name text primary key, filename text not null, mtime_ms integer not null);
create table holdings (market text, brokerage text, account_type text, account text, as_of_date text, account_wrapper text not null default 'taxable');
create table transactions (market text, brokerage text, account_type text, account text, date text, source_system text);
create table tax_lots (market text, brokerage text, account_type text, account text, as_of_date text);
create table validation_checks (name text, detail text, status text);
`)
const holding = db.prepare('insert into holdings (market, brokerage, account_type, account, as_of_date) values (?, ?, ?, ?, ?)')
const transaction = db.prepare('insert into transactions (market, brokerage, account_type, account, date) values (?, ?, ?, ?, ?)')
for (const [hint, nickname] of [['1111', 'Agentic'], ['2222', 'Mid-term']]) {
  holding.run('US', 'Robinhood', nickname, `Robinhood ${hint}`, daysAgo(0))
}
transaction.run('US', 'Robinhood', 'Agentic', 'Robinhood Agentic', daysAgo(57))
transaction.run('US', 'Robinhood', 'Mid-term', 'Robinhood Mid-term', daysAgo(59))
// Long-term has trades but nothing open: no holdings row, still one account.
transaction.run('US', 'Robinhood', 'Long-term', 'Robinhood Long-term', daysAgo(3))
transaction.run('KR', '미래에셋증권', 'General', 'Sample second', daysAgo(200))
transaction.run('KR', '미래에셋증권', 'General', '미래에셋증권(종합)', daysAgo(200))
transaction.run('US', 'Fidelity', 'Cash', 'Sample Fidelity', daysAgo(100))
const confirmation = db.prepare('insert into source_coverage_confirmations values (?, ?, ?, ?, ?, ?, ?, ?)')
for (const kind of ['holdings','transactions']) confirmation.run('investment','Fidelity','Sample Fidelity',kind,daysAgo(0),'sample.csv','0'.repeat(64),kind === 'holdings' ? 1 : 0)
db.close()

writeFileSync(
  snapshotPath,
  JSON.stringify({
    fetchedAt: `${daysAgo(0)}T04:04:00.000Z`,
    accounts: [
      { accountNumber: '000001111', nickname: 'Agentic', account: 'Robinhood 1111', positions: [], lots: [] },
      { accountNumber: '000002222', nickname: 'Mid-term', account: 'Robinhood 2222', positions: [], lots: [] },
      { accountNumber: '000003333', nickname: 'Long-term', account: 'Robinhood 3333', positions: [], lots: [] },
    ],
  })
)

process.env.STOCK_DB_PATH = dbPath
process.env.STOCK_ROBINHOOD_SNAPSHOT_PATH = snapshotPath
process.env.STOCK_KR_STATEMENTS_DIR = path.join(dir, 'absent')

test('one Robinhood row per account, as stale as its transaction CSVs even when the snapshot is fresh', async () => {
  const { getAccountCoverage } = await import('../lib/adapters/portfolio-db')
  const rows = getAccountCoverage().rows.filter((row) => row.brokerage === 'Robinhood')

  // Three accounts, not one row per label each side happens to use.
  assert.deepEqual(rows.map((row) => row.account).sort(), [
    'Robinhood Agentic · 1111',
    'Robinhood Long-term',
    'Robinhood Mid-term · 2222',
  ])

  const midterm = rows.find((row) => row.account.startsWith('Robinhood Mid-term'))!
  assert.equal(midterm.status, 'action_needed')
  assert.equal(midterm.coveredThrough, daysAgo(59))
  assert.equal(midterm.downloadFrom, daysAgo(60))
  assert.equal(midterm.method, 'manual')
  assert.match(midterm.requiredArtifact, /MCP snapshot/)
  assert.match(midterm.requiredArtifact, /transactions CSV/)
  const [snapshot, csv] = midterm.sources
  assert.equal(snapshot.status, 'current')
  assert.equal(snapshot.coveredThrough, daysAgo(0))
  assert.equal(snapshot.downloadFrom, null)
  assert.equal(csv.status, 'action_needed')
  assert.equal(csv.destination, 'us-transactions/robinhood-transactions-midterm-YYYYMMDD-YYYYMMDD.csv')

  const longterm = rows.find((row) => row.account === 'Robinhood Long-term')!
  assert.equal(longterm.status, 'current')
})

test('a missing disposal marks only its own account, even when that account\'s CSV is recent', async () => {
  const gaps = new Database(dbPath)
  gaps.exec(`create table missing_disposals (market text, brokerage text, account_type text, ticker text, replay_qty real, held_qty real)`)
  gaps.prepare('insert into missing_disposals values (?, ?, ?, ?, ?, ?)').run('US', 'Robinhood', 'Long-term', 'WIDG', 9, 0)
  gaps.prepare('insert into missing_disposals values (?, ?, ?, ?, ?, ?)').run('US', 'Robinhood', 'Long-term', 'ACME', 143, 0)
  gaps.close()
  try {
    const { getAccountCoverage } = await import('../lib/adapters/portfolio-db')
    const rows = getAccountCoverage().rows.filter((row) => row.brokerage === 'Robinhood')

    // Long-term's CSV is three days old, so by date alone it is current.
    const longterm = rows.find((row) => row.account === 'Robinhood Long-term')!
    assert.equal(longterm.status, 'action_needed')
    assert.deepEqual(longterm.missingDisposals, ['ACME', 'WIDG'])
    const csv = longterm.sources.find((source) => source.label === 'CSV')!
    assert.equal(csv.status, 'action_needed')
    assert.deepEqual(csv.missingDisposals, ['ACME', 'WIDG'])
    assert.match(longterm.action, /매도 기록 누락 2종목\(ACME, WIDG\)/)

    // The others carry nothing extra.
    for (const row of rows.filter((row) => row !== longterm)) assert.deepEqual(row.missingDisposals, [])
  } finally {
    const cleanup = new Database(dbPath)
    cleanup.exec('drop table missing_disposals')
    cleanup.close()
  }
})

test('without a snapshot to tie them, holdings and transaction labels stay apart rather than being guessed together', async () => {
  writeFileSync(snapshotPath, 'not json')
  const holdingsOnly = new Database(dbPath)
  // What Gain/Loss PDF lots carry: the account hint, not the strategy.
  holdingsOnly.exec(`update holdings set account_type = substr(account, -4)`)
  holdingsOnly.close()
  const { getAccountCoverage } = await import('../lib/adapters/portfolio-db')
  const rows = getAccountCoverage().rows.filter((row) => row.brokerage === 'Robinhood')
  assert.ok(rows.some((row) => row.account === 'Robinhood 1111' && row.sources.length === 1))
  assert.ok(rows.some((row) => row.account === 'Robinhood Agentic' && row.sources.length === 2))
})


test('closed explicitly labelled brokerage accounts are excluded while the active account displays a masked number', async () => {
  const { getAccountCoverage, getBrokerageAccountHints } = await import('../lib/adapters/portfolio-db')
  const rows = getAccountCoverage().rows
  assert(!rows.some(row => row.account.startsWith('Sample second')))
  assert(rows.some(row => row.account === '미래에셋증권(종합) · …1234'))
  assert.deepEqual(getBrokerageAccountHints().get('Sample second'), { suffix: '…5678', retired: true })
})


test('confirmed Fidelity query and empty snapshot dates replace last-transaction freshness', async () => {
 const {getAccountCoverage}=await import('../lib/adapters/portfolio-db')
 const row=getAccountCoverage().rows.find(row=>row.brokerage==='Fidelity')!
 assert.equal(row.coveredThrough,daysAgo(0))
 assert.equal(row.status,'current')
 assert.match(row.detail,/확인/)
})


test('newer Fidelity observations supersede a retained confirmation', async () => {
 const db=new Database(dbPath)
 db.prepare("update source_coverage_confirmations set through_date = ? where institution = 'Fidelity'").run(daysAgo(5))
 db.prepare('insert into holdings (market, brokerage, account_type, account, as_of_date) values (?,?,?,?,?)').run('US','Fidelity','Cash','Sample Fidelity numbered',daysAgo(0))
 db.prepare('insert into transactions (market, brokerage, account_type, account, date) values (?,?,?,?,?)').run('US','Fidelity','Cash','Sample Fidelity',daysAgo(0))
 try {
  const {getAccountCoverage}=await import('../lib/adapters/portfolio-db')
  assert.equal(getAccountCoverage().rows.find(row=>row.brokerage==='Fidelity')?.coveredThrough,daysAgo(0))
 } finally {
  db.prepare("delete from holdings where brokerage = 'Fidelity'").run()
  db.prepare("delete from transactions where brokerage = 'Fidelity' and date = ?").run(daysAgo(0))
  db.prepare("update source_coverage_confirmations set through_date = ? where institution = 'Fidelity'").run(daysAgo(0))
  db.close()
 }
})


test('Bithumb uses declared full-scope PDF periods even with no recent activity', async () => {
  const db = new Database(dbPath)
  db.prepare('insert into transactions (market, brokerage, account_type, account, date) values (?,?,?,?,?)').run('CRYPTO', 'Bithumb', 'Crypto', 'Bithumb', daysAgo(32))
  db.close()
  const { getAccountCoverage } = await import('../lib/adapters/portfolio-db')
  const document = (start: string, end: string) => ({ category: 'bithumb_statement', venue: 'Bithumb', account: 'Bithumb', filename: 'statement.pdf', metrics: { periodStart: start, periodEnd: end, scopeAssets: '전체', scopeTypes: '매수/매도/입금/출금' } })
  const row = () => getAccountCoverage().rows.find(row => row.brokerage === 'Bithumb')!
  const first = document(daysAgo(60), daysAgo(32))
  const recent = document(daysAgo(33), daysAgo(0))
  writeFileSync(cryptoPath, JSON.stringify({ documents: [first, recent] }))
  assert.equal(row().coveredThrough, daysAgo(0))
  assert.equal(row().status, 'current')
  for (const invalid of [
    { ...recent, account: 'Another account' },
    { ...recent, category: 'bithumb_ledger' },
    { ...recent, metrics: { ...recent.metrics, scopeAssets: 'BTC' } },
    { ...recent, metrics: { ...recent.metrics, scopeTypes: '매도' } },
    document(daysAgo(30), daysAgo(0)), // a missing day between statements
    document(daysAgo(33), '2099-01-01'),
    document('2026-02-30', daysAgo(0)),
  ]) {
    writeFileSync(cryptoPath, JSON.stringify({ documents: [first, invalid] }))
    assert.equal(row().coveredThrough, daysAgo(32))
    assert.equal(row().status, 'action_needed')
  }
})


test('Merrill confirmed query end keeps a quiet account current',async()=>{
 const db=new Database(dbPath)
 db.prepare('insert into transactions (market,brokerage,account_type,account,date) values (?,?,?,?,?)').run('US','Merrill','Cash','Merrill SAMPLE',daysAgo(10))
 db.prepare('insert into holdings (market,brokerage,account_type,account,as_of_date) values (?,?,?,?,?)').run('US','Merrill','Cash','Merrill SAMPLE',daysAgo(0))
 db.prepare('insert into source_coverage_confirmations values (?,?,?,?,?,?,?,?)').run('investment','Merrill','Merrill SAMPLE','transactions',daysAgo(0),'sample.csv','0'.repeat(64),0)
 db.close()
 const {getAccountCoverage}=await import('../lib/adapters/portfolio-db')
 const row=getAccountCoverage().rows.find(row=>row.brokerage==='Merrill')!
 assert.equal(row.coveredThrough,daysAgo(0));assert.equal(row.status,'current')
})
