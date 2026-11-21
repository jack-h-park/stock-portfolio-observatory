import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { periodTiles } from '@/lib/overview-period-tiles'
import type { RealizedLotView } from '@/lib/realized-lots'

const lot = (sold_year: string, realized_gl_krw: number) => ({ sold_year, realized_gl_krw, cost_basis_krw: 0, proceeds_krw: 0, cost_usd: null, proceeds_usd: null, gain_usd: null }) as unknown as RealizedLotView

const base = {
  currentMonth: '2026-11',
  currentYear: '2026',
  inflow: { periods: [{ period: '2026-10', total: 300 }, { period: '2026-11', total: 120 }], monthlyAverage: 200, hasRecords: true },
  income: { rowCount: 4, ytd: 50, trailing12m: 70 },
  realized: [lot('2026', 100), lot('2026', -30), lot('2025', 999)],
}

test('reads this month, this year and the trailing context', () => {
  assert.deepEqual(periodTiles(base), {
    inflowMonth: 120,
    inflowMonthlyAverage: 200,
    inflowLastMonth: null,
    incomeYtd: 50,
    incomeTrailing12m: 70,
    realizedYtdKrw: 70,
    realizedYtdCount: 2,
  })
})

test('a source with records but nothing this period is a real zero', () => {
  const tiles = periodTiles({ ...base, inflow: { ...base.inflow, periods: [{ period: '2026-10', total: 300 }] }, realized: [lot('2025', 5)] })
  assert.equal(tiles.inflowMonth, 0)
  // The zero says where the records stop.
  assert.equal(tiles.inflowLastMonth, '2026-10')
  assert.equal(tiles.realizedYtdKrw, 0)
  assert.equal(tiles.realizedYtdCount, 0)
})

test('a source with no records at all is unavailable, not zero', () => {
  const tiles = periodTiles({
    ...base,
    inflow: { periods: [], monthlyAverage: 0, hasRecords: false },
    income: { rowCount: 0, ytd: 0, trailing12m: 0 },
    realized: [],
  })
  assert.equal(tiles.inflowMonth, null)
  assert.equal(tiles.inflowMonthlyAverage, null)
  assert.equal(tiles.inflowLastMonth, null)
  assert.equal(tiles.incomeYtd, null)
  assert.equal(tiles.realizedYtdKrw, null)
})
