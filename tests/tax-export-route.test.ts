import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'

// The adapter reads one database, fixed when it is first imported, so every test
// rebuilds its own tables in that single scratch file. All fixture years are in the
// past, so "the latest year with sales" is the default no matter what today is.
const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'tax-export-route-')), 'portfolio.db')
process.env.STOCK_DB_PATH = dbPath

const OLD_COLUMNS = `market text, currency text, brokerage text, account text, ticker text, name text,
  acquired_date text, sold_date text, quantity_sold real, cost_basis_krw real, proceeds_krw real,
  realized_gl_krw real, acquisition_cost_usd real, native_proceeds real, holding_days integer,
  tax_term text, basis text`
const EXTRA_COLUMNS = 'owner text, asset_class text, form_8949_box text, covered_status text, superseded_by text'
const HEADER_LINE = 'description,date_acquired,date_sold,proceeds_usd,cost_basis_usd,gain_loss_usd,term,form_8949_box,covered,basis_source,row_status,asset_class,market,collectible,proceeds_rate_note,broker,account_alias,ticker\r\n'

type Cell = string | number | null

function rebuild(extra: boolean, rows: Cell[][]) {
  const db = new Database(dbPath)
  db.exec('drop table if exists realized_lots')
  db.exec(`create table realized_lots (${OLD_COLUMNS}${extra ? `, ${EXTRA_COLUMNS}` : ''})`)
  const width = rows[0].length
  const insert = db.prepare(`insert into realized_lots values (${Array(width).fill('?').join(',')})`)
  for (const row of rows) insert.run(...row)
  db.close()
}

function lot(o: { ticker: string; broker?: string; account?: string; sold?: string; owner?: string; superseded?: string | null }, extra = true): Cell[] {
  const base: Cell[] = [
    'US', 'USD', o.broker ?? 'Invented Broker', o.account ?? 'ACC-1', o.ticker, `${o.ticker} Inc`,
    '2024-01-02', o.sold ?? '2025-03-04', 10, 1000, 1500, 500, 0.7, 1.1, 427, 'Long-term', 'lot',
  ]
  return extra ? [...base, o.owner ?? 'self', 'stock', 'A', 'covered', o.superseded ?? null] : base
}

const url = (p: string, query = '') => new Request(`http://x${p}${query}`)

async function handlers() {
  const csv = (await import('../app/realized/export/route')).GET
  const notes = (await import('../app/realized/export/notes/route')).GET
  return { csv, notes }
}

const bodyLines = (text: string) => text.split('\r\n').filter(Boolean)

test('the CSV ignores table filters', async () => {
  rebuild(true, [
    lot({ ticker: 'AAA', broker: 'OnlyOne' }),
    lot({ ticker: 'BBB', broker: 'Another' }),
    lot({ ticker: 'CCC', broker: 'Another', sold: '2024-06-01' }),
  ])
  const { csv } = await handlers()
  const res = await csv(url('/realized/export', '?year=2025&brokerage=OnlyOne&term=Long-term&q=zzz&market=KR'))
  const lines = bodyLines(await res.text())
  assert.equal(lines.length, 3)
  assert.ok(lines.some((l) => l.includes(',AAA')))
  assert.ok(lines.some((l) => l.includes(',BBB')))
})

test('the CSV leaves out other owners and superseded rows; audit adds superseded', async () => {
  rebuild(true, [
    lot({ ticker: 'AAA' }),
    lot({ ticker: 'BBB', owner: 'spouse' }),
    lot({ ticker: 'CCC', superseded: 'filing-1' }),
  ])
  const { csv } = await handlers()
  const plain = bodyLines(await (await csv(url('/realized/export', '?year=2025'))).text())
  assert.equal(plain.length, 2)
  assert.ok(plain[1].endsWith(',AAA'))
  const audit = bodyLines(await (await csv(url('/realized/export', '?year=2025&audit=1'))).text())
  assert.equal(audit.length, 3)
  assert.ok(audit.some((l) => l.includes(',superseded,') && l.endsWith(',CCC')))
  assert.ok(!audit.some((l) => l.endsWith(',BBB')))
})

test('an unknown year uses the default year and names it in the file name', async () => {
  rebuild(true, [lot({ ticker: 'AAA' }), lot({ ticker: 'OLD', sold: '2024-06-01' })])
  const { csv } = await handlers()
  const res = await csv(url('/realized/export', '?year=abc'))
  assert.match(res.headers.get('content-disposition') ?? '', /tax-realized-2025\.csv/)
  const lines = bodyLines(await res.text())
  assert.equal(lines.length, 2)
  assert.ok(lines[1].endsWith(',AAA'))
})

test('a year with no sales returns the header only', async () => {
  // Only another owner's sale exists, so no year has sales for the export.
  rebuild(true, [lot({ ticker: 'BBB', owner: 'spouse' })])
  const { csv } = await handlers()
  const res = await csv(url('/realized/export', '?year=2025'))
  assert.equal(res.status, 200)
  assert.equal(await res.text(), HEADER_LINE)
})

test('all-years names the file tax-realized-all-years.csv; audit adds -audit', async () => {
  rebuild(true, [lot({ ticker: 'AAA' }), lot({ ticker: 'OLD', sold: '2024-06-01' })])
  const { csv, notes } = await handlers()
  const all = await csv(url('/realized/export', '?year=all-years'))
  assert.match(all.headers.get('content-disposition') ?? '', /tax-realized-all-years\.csv/)
  assert.equal(bodyLines(await all.text()).length, 3)
  const audit = await csv(url('/realized/export', '?year=all-years&audit=1'))
  assert.match(audit.headers.get('content-disposition') ?? '', /tax-realized-all-years-audit\.csv/)
  const note = await notes(url('/realized/export/notes', '?year=2025&audit=1'))
  assert.match(note.headers.get('content-disposition') ?? '', /tax-realized-2025-audit-notes\.txt/)
  const plainNote = await notes(url('/realized/export/notes', '?year=2025'))
  assert.match(plainNote.headers.get('content-disposition') ?? '', /tax-realized-2025-notes\.txt/)
})

test('headers', async () => {
  rebuild(true, [lot({ ticker: 'AAA' })])
  const { csv, notes } = await handlers()
  const c = await csv(url('/realized/export'))
  assert.equal(c.headers.get('content-type'), 'text/csv; charset=utf-8')
  const n = await notes(url('/realized/export/notes'))
  assert.equal(n.headers.get('content-type'), 'text/plain; charset=utf-8')
  for (const res of [c, n]) {
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="/)
  }
})

test('the response bodies contain no stored account string', async () => {
  const account = 'ACCT-1234567890123456'
  rebuild(true, [lot({ ticker: 'AAA', account }), lot({ ticker: 'BBB', account: '9876543210987654', superseded: 'f' })])
  const { csv, notes } = await handlers()
  for (const q of ['', '?audit=1', '?year=all-years&audit=1']) {
    const c = await (await csv(url('/realized/export', q))).text()
    const n = await (await notes(url('/realized/export/notes', q))).text()
    for (const text of [c, n]) {
      assert.ok(!text.includes('1234567890'), 'first account leaked')
      assert.ok(!text.includes('9876543210'), 'second account leaked')
    }
  }
})

test('the notes route reports the same row count as the CSV', async () => {
  rebuild(true, [lot({ ticker: 'AAA' }), lot({ ticker: 'BBB' }), lot({ ticker: 'CCC', superseded: 'f' })])
  const { csv, notes } = await handlers()
  const rows = bodyLines(await (await csv(url('/realized/export', '?year=2025'))).text()).length - 1
  const text = await (await notes(url('/realized/export/notes', '?year=2025'))).text()
  assert.match(text, new RegExp(`Rows: ${rows}\\r\\n`))
  assert.equal(rows, 2)
})

test('works on a database without the extra columns', async () => {
  rebuild(false, [lot({ ticker: 'AAA' }, false)])
  const { csv, notes } = await handlers()
  const res = await csv(url('/realized/export'))
  assert.equal(res.status, 200)
  const lines = bodyLines(await res.text())
  assert.equal(lines.length, 2)
  const cells = lines[1].split(',')
  assert.equal(cells[7], '')
  assert.equal((await notes(url('/realized/export/notes'))).status, 200)
})
