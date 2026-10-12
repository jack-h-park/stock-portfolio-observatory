import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runIngest } from './ingest-harness'
import { writeSheetPayloads } from './sheet-payloads'

// Korea measures a foreign-currency lot's gain with the cost at the
// ACQUISITION-date USD/KRW rate. cost_basis_krw on US lots is at today's rate
// (open) or the sale-date rate (realized), which is what the holdings pages
// show, so the ingest also records acquisition_cost_krw for the tax side.
// Invented figures; the repository is public.

const CSV_HEADER =
  '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"'

function ingest(krAssumptions: Record<string, unknown> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'acquisition-cost-'))
  writeSheetPayloads(dir)
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  // Newest-first, as Robinhood writes it: bought 10 on 06-12, sold 4 on 08-11.
  writeFileSync(
    path.join(dir, 'us-transactions', 'robinhood-transactions-midterm-20260811.csv'),
    [
      CSV_HEADER,
      '"8/11/2026","8/11/2026","8/12/2026","ACME","Acme Corp\nCUSIP: 000000000","Sell","4","$50.00","$200.00"',
      '"6/12/2026","6/12/2026","6/13/2026","ACME","Acme Corp\nCUSIP: 000000000","Buy","10","$40.00","($400.00)"',
    ].join('\n') + '\n',
    'utf8'
  )
  const snapshotPath = path.join(dir, 'robinhood-snapshot.json')
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      fetchedAt: '2026-10-10T02:00:00Z',
      accounts: [{
        accountNumber: '000000001',
        nickname: 'Mid-term',
        positions: [{ symbol: 'ACME', name: 'Acme Corp', quantity: '6', instrument_id: '11111111-1111-4111-8111-000000000001' }],
        lots: [{ symbol: 'ACME', lots: [{ open_lot_id: 'acme-1', quantity: '6', cost_basis: '240.00', acquired_date: '2026-06-12' }] }],
      }],
    }),
    'utf8'
  )
  const fxPath = path.join(dir, 'fx-rates.json')
  writeFileSync(fxPath, JSON.stringify({ baseCurrency: 'KRW', rates: [{ from: 'USD', to: 'KRW', rate: 1000, asOfDate: '2026-10-09', source: 'test' }] }), 'utf8')
  const historicalPath = path.join(dir, 'historical-fx-rates.json')
  writeFileSync(
    historicalPath,
    JSON.stringify({ rates: [
      { price_date: '2026-06-12', rate: 1500, source: 'test' },
      { price_date: '2026-08-11', rate: 1300, source: 'test' },
    ] }),
    'utf8'
  )
  const policyPath = path.join(dir, 'tax-policy.json')
  writeFileSync(
    policyPath,
    JSON.stringify({ jurisdictions: [
      { code: 'US', manualAssumptions: { taxInputYear: 2026 } },
      { code: 'KR', manualAssumptions: krAssumptions },
    ] }),
    'utf8'
  )
  const dbPath = runIngest(dir, {
    env: {
      STOCK_TAX_POLICY_PATH: policyPath,
      STOCK_ROBINHOOD_SNAPSHOT_PATH: snapshotPath,
      STOCK_FX_RATES_PATH: fxPath,
      STOCK_HISTORICAL_FX_RATES_PATH: historicalPath,
    },
    allowFailure: true,
  })
  const db = new Database(dbPath, { readonly: true })
  const open = db
    .prepare(`select cost_basis_krw, acquisition_cost_krw from tax_lots where ticker = 'ACME'`)
    .all() as { cost_basis_krw: number; acquisition_cost_krw: number | null }[]
  const realized = db
    .prepare(`select cost_basis_krw, acquisition_cost_krw from realized_lots where ticker = 'ACME'`)
    .all() as { cost_basis_krw: number; acquisition_cost_krw: number | null }[]
  const krYtd = JSON.parse(
    (db.prepare(`select value from meta where key = 'kr_ytd_realized_computed'`).get() as { value: string }).value
  ) as { taxYear: string; gainKrw: number; lots: number }
  const krCheck = db.prepare(`select status, detail from validation_checks where name = 'kr_ytd_realized_assumption_reviewed'`).get() as
    { status: string; detail: string }
  db.close()
  return { open, realized, krYtd, krCheck }
}

test('a US lot records its won cost at the acquisition-date rate beside the today-rate one', () => {
  const { open, realized } = ingest()
  // $240 open: today's rate on the holdings side, the 06-12 rate for Korea.
  assert.deepEqual(open, [{ cost_basis_krw: 240_000, acquisition_cost_krw: 360_000 }])
  // $160 sold: cost_basis_krw is at the sale-date rate, Korea's cost at 06-12.
  assert.equal(realized.length, 1)
  assert.equal(realized[0].cost_basis_krw, 160 * 1300)
  assert.equal(realized[0].acquisition_cost_krw, 160 * 1500)
})

test('the year-to-date gain Korea taxes is computed at acquisition-date cost and checked against the policy', () => {
  // Sold 4 for $200 on 08-11 at 1,300 (₩260,000); their $160 cost at the 06-12 rate 1,500 (₩240,000).
  const unset = ingest()
  assert.deepEqual(unset.krYtd, { taxYear: '2026', gainKrw: 20_000, lots: 1, unmeasuredLots: 0 })
  assert.equal(unset.krCheck.status, 'fail')
  assert.match(unset.krCheck.detail, /₩20,000 at acquisition-date cost; KR ytdRealizedTaxableGainKrw is ₩0/)

  const entered = ingest({ ytdRealizedTaxableGainKrw: 20_000 })
  assert.equal(entered.krCheck.status, 'pass', entered.krCheck.detail)
})
