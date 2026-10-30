import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeAllocation, type AllocationSecurity } from '../lib/asset-allocation'

const security = (over: Partial<AllocationSecurity>): AllocationSecurity => ({
  wrapper: 'taxable',
  market: 'KR',
  ticker: 'KRX1',
  name: 'Example',
  asset_class: 'security',
  valueKrw: 100,
  ...over,
})

const valueOf = (rows: { key: string; valueKrw: number }[], key: string) => rows.find((row) => row.key === key)?.valueKrw

test('a security with no mapping takes its market, and is listed as a market default', () => {
  const r = summarizeAllocation({
    securities: [security({ ticker: 'KRX1' }), security({ market: 'US', ticker: 'AAA', valueKrw: 300 })],
    cryptoKrw: 0,
    goldKrw: 0,
    cashKrw: 0,
    classes: {},
  })
  assert.equal(valueOf(r.classes, 'kr_equity'), 100)
  assert.equal(valueOf(r.classes, 'us_equity'), 300)
  assert.deepEqual(r.marketDefaults.map((row) => row.ticker), ['AAA', 'KRX1'])
})

test('a gold ETF mapped to gold joins physical gold, out of US equity', () => {
  const r = summarizeAllocation({
    securities: [security({ market: 'US', ticker: 'IAU', valueKrw: 400 }), security({ market: 'US', ticker: 'AAA', valueKrw: 600 })],
    cryptoKrw: 0,
    goldKrw: 1000,
    cashKrw: 0,
    classes: { 'US:IAU': 'gold' },
  })
  assert.equal(valueOf(r.classes, 'gold'), 1400)
  assert.equal(valueOf(r.classes, 'us_equity'), 600)
  assert.deepEqual(r.marketDefaults.map((row) => row.ticker), ['AAA'])
})

test('every won lands in exactly one class and one wrapper, and the percentages add to 100', () => {
  const r = summarizeAllocation({
    securities: [
      security({ valueKrw: 1000 }),
      security({ wrapper: 'isa', market: 'US', ticker: 'AAA', valueKrw: 500 }),
      security({ wrapper: 'irp', ticker: 'PENSION:t:abc', valueKrw: 500 }),
    ],
    cryptoKrw: 1000,
    goldKrw: 500,
    cashKrw: 1500,
    classes: {},
  })
  assert.equal(r.totalKrw, 5000)
  const sum = (rows: { valueKrw: number }[]) => rows.reduce((total, row) => total + row.valueKrw, 0)
  assert.equal(sum(r.classes), 5000)
  assert.equal(sum(r.wrappers), 5000)
  assert.equal(valueOf(r.wrappers, 'taxable'), 4000)
  assert.equal(valueOf(r.wrappers, 'isa'), 500)
  assert.equal(r.classes.reduce((total, row) => total + row.pct, 0).toFixed(6), '100.000000')
  assert.equal(r.classes.find((row) => row.key === 'cash')?.pct, 30)
})

test('a class with nothing in it is dropped, and an empty portfolio has no percentages', () => {
  const r = summarizeAllocation({ securities: [], cryptoKrw: 0, goldKrw: 0, cashKrw: 0, classes: {} })
  assert.equal(r.totalKrw, 0)
  assert.deepEqual(r.classes, [])
  assert.deepEqual(r.wrappers, [])
})

test('one security held in several accounts is listed once, under the name of its largest holding', () => {
  const r = summarizeAllocation({
    securities: [
      security({ ticker: '000660', name: 'Example Hynix', valueKrw: 100 }),
      security({ wrapper: 'isa', ticker: '000660', name: 'Example Hynix Co', valueKrw: 300 }),
      security({ market: 'US', ticker: 'AAA', valueKrw: 200 }),
    ],
    cryptoKrw: 0,
    goldKrw: 0,
    cashKrw: 0,
    classes: {},
  })
  assert.deepEqual(
    r.marketDefaults.map((row) => [row.ticker, row.name, row.valueKrw]),
    [
      ['000660', 'Example Hynix Co', 400],
      ['AAA', 'Example', 200],
    ],
  )
  assert.equal(valueOf(r.classes, 'kr_equity'), 400)
})

test('everything a pension holds is one pension class, whatever the mapping says', () => {
  const r = summarizeAllocation({
    securities: [
      security({ wrapper: 'irp', ticker: 'PENSION:t:cash:abc', name: 'Cash', valueKrw: 50 }),
      security({ wrapper: 'irp', ticker: '360750', valueKrw: 250 }),
      security({ wrapper: 'pension_savings', ticker: 'PENSION:t:fund1', name: 'Example fund', valueKrw: 200 }),
    ],
    cryptoKrw: 0,
    goldKrw: 0,
    cashKrw: 0,
    classes: { 'KR:360750': 'us_equity' },
  })
  assert.deepEqual(r.classes.map((row) => [row.key, row.valueKrw]), [['pension', 500]])
  assert.equal(valueOf(r.wrappers, 'pension'), 500)
  assert.deepEqual(r.marketDefaults, [])
  assert.deepEqual(r.unclassified, [])
})

test('a security outside KR and US with no mapping is unclassified, not guessed', () => {
  const r = summarizeAllocation({
    securities: [security({ market: 'JP', ticker: '7203', name: 'Example JP', valueKrw: 70 })],
    cryptoKrw: 0,
    goldKrw: 0,
    cashKrw: 0,
    classes: {},
  })
  assert.equal(valueOf(r.classes, 'unclassified'), 70)
  assert.deepEqual(r.unclassified.map((row) => row.name), ['Example JP'])
  assert.deepEqual(r.marketDefaults, [])
})

test('a security mapped away from its market class is listed under the class it moved to', () => {
  const r = summarizeAllocation({
    securities: [
      security({ market: 'US', ticker: 'IAU', name: 'Gold Trust', valueKrw: 300 }),
      security({ market: 'US', ticker: 'IAU', name: 'Gold Trust', wrapper: 'isa', valueKrw: 100 }),
      security({ market: 'US', ticker: 'MSTR', name: 'Strategy', valueKrw: 200 }),
      security({ market: 'KR', ticker: '360750', name: 'US500 ETF', valueKrw: 50 }),
      security({ market: 'US', ticker: 'AAPL', name: 'Apple', valueKrw: 900 }),
      security({ market: 'KR', ticker: 'KRX1', name: 'Mapped to its own market class', valueKrw: 10 }),
    ],
    cryptoKrw: 0,
    goldKrw: 0,
    cashKrw: 0,
    classes: { 'US:IAU': 'gold', 'US:MSTR': 'crypto', 'KR:360750': 'us_equity', 'KR:KRX1': 'kr_equity' },
  })
  const listed = (key: string) => (r.reclassified[key as keyof typeof r.reclassified] ?? []).map((row) => [row.ticker, row.valueKrw])
  assert.deepEqual(listed('gold'), [['IAU', 400]])
  assert.deepEqual(listed('crypto'), [['MSTR', 200]])
  assert.deepEqual(listed('us_equity'), [['360750', 50]])
  assert.deepEqual(listed('kr_equity'), [])
})
