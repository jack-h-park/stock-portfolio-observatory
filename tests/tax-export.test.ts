import assert from 'node:assert/strict'
import test from 'node:test'
import { ALL_YEARS, rateOnOrBefore, toRealizedView, type RealizedLotRow } from '../lib/realized-lots'
import {
  NOT_COVERED_LINES,
  TAX_EXPORT_HEADER,
  readExportParams,
  selectTaxExportRows,
  summarizeTaxExport,
  taxExportCsv,
  taxExportNotes,
} from '../lib/tax-export'

const RATES = [{ price_date: '2026-10-12', rate: 1330 }]

function lot(over: Partial<RealizedLotRow> = {}) {
  const row: RealizedLotRow = {
    market: 'CRYPTO',
    currency: 'KRW',
    brokerage: 'Invented Exchange',
    account: 'Invented 1234567890',
    ticker: 'AAA',
    name: 'AAA',
    acquired_date: '2025-01-02',
    sold_date: '2026-10-12',
    quantity_sold: 0.5,
    cost_basis_krw: 700_000,
    proceeds_krw: 665_000,
    realized_gl_krw: -35_000,
    acquisition_cost_usd: 500,
    native_proceeds: 665_000,
    holding_days: 648,
    tax_term: 'Long-term',
    basis: 'replay',
    asset_class: null,
    form_8949_box: null,
    covered_status: null,
    superseded_by: null,
    collectible: null,
    ...over,
  }
  return toRealizedView(row, (d) => rateOnOrBefore(RATES, d))
}

const dataLines = (csv: string) => csv.split('\r\n').slice(1, -1)
const cells = (line: string) => line.split(',')
const col = (name: (typeof TAX_EXPORT_HEADER)[number]) => TAX_EXPORT_HEADER.indexOf(name)

test('header is the 18 columns in spec order', () => {
  assert.deepEqual(
    [...TAX_EXPORT_HEADER],
    ['description', 'date_acquired', 'date_sold', 'proceeds_usd', 'cost_basis_usd', 'gain_loss_usd', 'term', 'form_8949_box', 'covered', 'basis_source', 'row_status', 'asset_class', 'market', 'collectible', 'proceeds_rate_note', 'broker', 'account_alias', 'ticker']
  )
})

test('a 1099b row exports its box, covered flag and basis source', () => {
  const csv = taxExportCsv([lot({ form_8949_box: 'A', covered_status: 'Covered', basis: '1099b', market: 'US', currency: 'USD', asset_class: 'security' })])
  const c = cells(dataLines(csv)[0])
  assert.equal(c[col('form_8949_box')], 'A')
  assert.equal(c[col('covered')], 'covered')
  assert.equal(c[col('basis_source')], '1099b')
  assert.equal(c[col('row_status')], 'reported')
  assert.equal(c[col('asset_class')], 'security')
})

test('values as the ingest stores them are normalised', () => {
  // extract-us-pdf-evidence.py stores "Box A", "Covered" / "Noncovered", "Short-term" / "Long-term".
  const c = cells(dataLines(taxExportCsv([lot({ form_8949_box: 'Box D', covered_status: 'Noncovered', tax_term: 'Short-term' })]))[0])
  assert.equal(c[col('form_8949_box')], 'D')
  assert.equal(c[col('covered')], 'noncovered')
  assert.equal(c[col('term')], 'short')
  const u = cells(dataLines(taxExportCsv([lot({ covered_status: 'Undetermined', tax_term: 'Undetermined' })]))[0])
  assert.equal(u[col('covered')], '')
  assert.equal(u[col('term')], '')
})

test('a replay row has a blank box and blank covered', () => {
  const c = cells(dataLines(taxExportCsv([lot({ form_8949_box: '', covered_status: '' })]))[0])
  assert.equal(c[col('form_8949_box')], '')
  assert.equal(c[col('covered')], '')
  assert.equal(c[col('basis_source')], 'replay')
})

test('unknown dollar figures are blank, not zero', () => {
  const c = cells(dataLines(taxExportCsv([lot({ acquisition_cost_usd: null })]))[0])
  assert.equal(c[col('cost_basis_usd')], '')
  assert.equal(c[col('gain_loss_usd')], '')
  assert.notEqual(c[col('proceeds_usd')], '')
})

test('gain is proceeds minus cost', () => {
  const c = cells(dataLines(taxExportCsv([lot()]))[0])
  assert.equal(c[col('proceeds_usd')], (665000 / 1330).toFixed(2))
  assert.equal(c[col('gain_loss_usd')], (665000 / 1330 - 500).toFixed(2))
})

test('description is quantity then ticker', () => {
  assert.equal(cells(dataLines(taxExportCsv([lot()]))[0])[0], '0.5 AAA')
})

test('crypto and collectible flags', () => {
  const c = cells(dataLines(taxExportCsv([lot(), lot({ collectible: true, market: 'GOLD', asset_class: 'gold' })]))[0])
  assert.equal(c[col('asset_class')], 'crypto')
  assert.equal(c[col('collectible')], 'false')
  const g = cells(dataLines(taxExportCsv([lot({ collectible: true, market: 'GOLD', asset_class: 'gold' })]))[0])
  assert.equal(g[col('collectible')], 'true')
  assert.equal(g[col('asset_class')], 'gold')
  const s = cells(dataLines(taxExportCsv([lot({ market: 'US', asset_class: null })]))[0])
  assert.equal(s[col('asset_class')], 'security')
})

test('an approximate rate is noted', () => {
  const c = cells(dataLines(taxExportCsv([lot({ sold_date: '2026-10-14' })]))[0])
  assert.equal(c[col('proceeds_rate_note')], 'approximate_fx')
})

test('superseded rows appear only in audit and are marked', () => {
  const rows = [lot(), lot({ ticker: 'BBB', superseded_by: 'filing-1' })]
  assert.equal(selectTaxExportRows(rows, { year: '2026', audit: false }).length, 1)
  const audit = selectTaxExportRows(rows, { year: '2026', audit: true })
  assert.equal(audit.length, 2)
  const lines = dataLines(taxExportCsv(audit))
  assert.equal(cells(lines[1])[col('row_status')], 'superseded')
  assert.equal(cells(lines[0])[col('row_status')], 'reported')
})

test('year selection', () => {
  const rows = [lot(), lot({ sold_date: '2025-03-01' })]
  assert.equal(selectTaxExportRows(rows, { year: '2025', audit: false }).length, 1)
  assert.equal(selectTaxExportRows(rows, { year: ALL_YEARS, audit: false }).length, 2)
})

test('aliases follow first appearance and are per file', () => {
  const a = lot({ account: 'Acct One 1111' })
  const b = lot({ account: 'Acct Two 2222' })
  const lines = dataLines(taxExportCsv([a, b, a]))
  const aliases = lines.map((l) => cells(l)[col('account_alias')])
  assert.deepEqual(aliases, ['Invented Exchange A', 'Invented Exchange B', 'Invented Exchange A'])
  const reversed = dataLines(taxExportCsv([b, a])).map((l) => cells(l)[col('account_alias')])
  assert.deepEqual(reversed, ['Invented Exchange A', 'Invented Exchange B'])
  assert.equal(cells(dataLines(taxExportCsv([b, a]))[0])[col('broker')], 'Invented Exchange')
})

test('aliases are per broker', () => {
  const lines = dataLines(taxExportCsv([lot({ brokerage: 'Brk X', account: 'x1' }), lot({ brokerage: 'Brk Y', account: 'y1' })]))
  assert.deepEqual(lines.map((l) => cells(l)[col('account_alias')]), ['Brk X A', 'Brk Y A'])
})

test('aliases continue past 26 accounts', () => {
  const rows = Array.from({ length: 27 }, (_, i) => lot({ account: `acct-${i}` }))
  const aliases = dataLines(taxExportCsv(rows)).map((l) => cells(l)[col('account_alias')])
  assert.equal(aliases[25], 'Invented Exchange Z')
  assert.equal(aliases[26], 'Invented Exchange AA')
})

test('null broker is Unknown', () => {
  const c = cells(dataLines(taxExportCsv([lot({ brokerage: null })]))[0])
  assert.equal(c[col('broker')], 'Unknown')
  assert.equal(c[col('account_alias')], 'Unknown A')
})

test('a ticker or description starting with = + - @ is neutralised', () => {
  for (const lead of ['=', '+', '-', '@']) {
    const line = dataLines(taxExportCsv([lot({ ticker: `${lead}CMD`, brokerage: `${lead}Brk` })]))[0]
    const c = cells(line)
    assert.equal(c[col('ticker')], `'${lead}CMD`)
    assert.equal(c[col('broker')], `'${lead}Brk`)
    assert.equal(c[col('description')], `0.5 ${lead}CMD`)
  }
  const bare = cells(dataLines(taxExportCsv([lot({ quantity_sold: null, ticker: '=SUM(A1)' })]))[0])
  assert.equal(bare[col('description')], "'=SUM(A1)")
  const neg = cells(dataLines(taxExportCsv([lot({ acquisition_cost_usd: 1000 })]))[0])
  assert.match(neg[col('gain_loss_usd')], /^-\d+\.\d\d$/)
})

test('cells with commas, quotes or newlines are quoted', () => {
  const csv = taxExportCsv([lot({ brokerage: 'Brk, "Inc"\nTwo' })])
  assert.ok(csv.includes('"Brk, ""Inc""\nTwo"'))
})

test('the body never contains a stored account string', () => {
  const rows = [lot({ account: 'Invented 1234567890' }), lot({ account: 'Other 9876543210', superseded_by: 'f' })]
  const csv = taxExportCsv(rows)
  const notes = taxExportNotes(summarizeTaxExport(rows), { year: '2026', builtAt: '2026-10-28', audit: true })
  for (const body of [csv, notes]) {
    for (const needle of ['Invented 1234567890', '1234567890', 'Other 9876543210', '9876543210']) {
      assert.ok(!body.includes(needle), needle)
    }
  }
})

test('summary totals leave out superseded rows and count blanks', () => {
  const rows = [
    lot({ acquisition_cost_usd: 400 }),
    lot({ superseded_by: 'f' }),
    lot({ acquisition_cost_usd: null, tax_term: 'Short-term' }),
    lot({ acquisition_cost_usd: 100, tax_term: 'Undetermined' }),
  ]
  const proceeds = 665000 / 1330
  const s = summarizeTaxExport(rows)
  assert.equal(s.rows, 3)
  assert.equal(s.superseded, 1)
  assert.equal(s.blankDollar, 1)
  assert.equal(s.byTerm.long.count, 1)
  assert.ok(Math.abs(s.byTerm.long.gain_usd - (proceeds - 400)) < 1e-9)
  assert.equal(s.byTerm.short.count, 0)
  assert.equal(s.byTerm.short.gain_usd, 0)
  assert.equal(s.byTerm.unknown.count, 1)
  assert.ok(Math.abs(s.byTerm.unknown.gain_usd - (proceeds - 100)) < 1e-9)
})

test('readExportParams falls back for an unknown year and reads audit', () => {
  const years = ['2026', '2025']
  assert.deepEqual(readExportParams(new URLSearchParams('year=abc'), years, '2026'), { year: '2026', audit: false })
  assert.deepEqual(readExportParams(new URLSearchParams(''), years, '2026'), { year: '2026', audit: false })
  assert.equal(readExportParams(new URLSearchParams('year=2025'), years, '2026').year, '2025')
  assert.equal(readExportParams(new URLSearchParams('audit=1'), years, '2026').audit, true)
  assert.equal(readExportParams(new URLSearchParams('audit=yes'), years, '2026').audit, false)
  assert.equal(readExportParams(new URLSearchParams('year=all-years'), years, '2026').year, ALL_YEARS)
})

test('notes state the build date, the row counts and every NOT_COVERED_LINES entry', () => {
  const rows = [lot(), lot({ acquisition_cost_usd: null }), lot({ superseded_by: 'f' })]
  const summary = summarizeTaxExport(rows)
  const notes = taxExportNotes(summary, { year: '2026', builtAt: '2026-10-27', audit: true })
  assert.match(notes, /2026-10-27/)
  assert.match(notes, /2026/)
  assert.match(notes, /Rows: 2/)
  assert.match(notes, /blank dollar figure: 1/i)
  assert.match(notes, /superseded/i)
  for (const line of NOT_COVERED_LINES) assert.ok(notes.includes(line), line)
  assert.match(taxExportNotes(summary, { year: '2026', builtAt: null, audit: false }), /build date is unknown/i)
})
