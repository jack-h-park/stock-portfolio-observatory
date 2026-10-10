import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { contributionsAgainstLimits } from '@/lib/pension'
import type { TaxPolicy } from '@/lib/tax-policy'
import { runIngest } from './ingest-harness'
import { GOLD, IRP, SAMSUNG_PENSION, writeScenario } from './pension-fixtures'

// Invented figures throughout; the repository is public.

function ingest(withPensions: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pension-page-'))
  const env = writeScenario(dir, { withPensions })
  return runIngest(dir, { env, allowFailure: true })
}

test('getNetWorth adds pensions and gold from holdings_all and leaves stocks alone', async () => {
  const stockOnly = ingest(false)
  const withPensions = ingest(true)
  const { getNetWorth } = await import('../lib/adapters/portfolio-db')

  config.stockDbPath = stockOnly
  const before = getNetWorth()
  assert.ok(before.byClass.stocks > 0, 'the baseline must be non-zero to mean anything')
  assert.equal(before.byClass.pensions, 0)
  assert.equal(before.byClass.gold, 0)
  assert.deepEqual(before.asOfNotes, [])

  config.stockDbPath = withPensions
  const after = getNetWorth()
  assert.equal(after.byClass.stocks, before.byClass.stocks)
  assert.equal(after.byClass.crypto, before.byClass.crypto)
  // IRP: ETF 360,000 at today's price, fund 1,100,000 and cash 50,000 from the
  // 2026-10-08 snapshot. 삼성: 700,000 + 300,000 + 50,000 from the 2025-12-31 certificate.
  assert.equal(after.byClass.pensions, 360_000 + 1_100_000 + 50_000 + 700_000 + 300_000 + 50_000)
  // 10 g at 160,000 per gram.
  assert.equal(after.byClass.gold, 1_600_000)
  assert.equal(
    after.totalKrw,
    after.byClass.stocks + after.byClass.crypto + after.byClass.cash + after.byClass.pensions + after.byClass.gold
  )
  // Snapshot-valued rows carry their date; the priced gold does not.
  assert.deepEqual(after.asOfNotes, [
    { label: IRP, asOf: '2026-10-08' },
    { label: SAMSUNG_PENSION, asOf: '2025-12-31' },
  ])

  // Gold held at cost (no price) is dated too.
  const rw = new Database(withPensions)
  rw.prepare("update holdings_all set valuation_source = 'cost', as_of_date = '2026-03-31', base_market_value = base_cost where asset_class = 'gold'").run()
  rw.close()
  const atCost = getNetWorth()
  assert.equal(atCost.byClass.gold, 1_500_000)
  assert.deepEqual(atCost.asOfNotes.find((note) => note.label === GOLD), { label: GOLD, asOf: '2026-03-31' })
})

test('getPensionAccounts returns each account with its holdings split and contributions by year', async () => {
  const dbPath = ingest(true)
  config.stockDbPath = dbPath
  const { getPensionAccounts } = await import('../lib/adapters/portfolio-db')

  const accounts = getPensionAccounts()
  assert.deepEqual(accounts.map((row) => [row.account, row.wrapper]), [
    [IRP, 'irp'],
    [SAMSUNG_PENSION, 'pension_savings'],
  ])

  const irp = accounts[0]
  assert.equal(irp.valueKrw, 1_510_000)
  assert.equal(irp.costKrw, 1_300_000)
  assert.ok(Math.abs((irp.returnPct ?? 0) - (210_000 / 1_300_000) * 100) < 1e-9)
  assert.equal(irp.snapshotDate, '2026-10-08')
  assert.deepEqual(
    irp.holdings.map((row) => [row.kind, row.name, row.valueKrw, row.costKrw, row.valuationSource, row.asOf]),
    [
      ['ETF', 'Example 200 ETF', 360_000, 300_000, 'price', '2026-10-08'],
      ['FUND', 'Example TDF fund', 1_100_000, 1_000_000, 'snapshot', '2026-10-08'],
      ['CASH', 'Example cash sweep', 50_000, 0, 'snapshot', '2026-10-08'],
    ]
  )
  // No employer rows in the evidence: only own contributions, employer unknown rather than zero.
  assert.deepEqual(irp.contributionsByYear, [{ year: 2026, ownKrw: 1_000_000, employerKrw: null }])

  const samsung = accounts[1]
  assert.equal(samsung.valueKrw, 1_050_000)
  assert.equal(samsung.snapshotDate, '2025-12-31')
  assert.deepEqual(samsung.holdings.map((row) => row.kind), ['FUND', 'FUND', 'CASH'])
  assert.deepEqual(samsung.contributionsByYear, [{ year: 2026, ownKrw: 500_000, employerKrw: null }])

  // Once the evidence supplies an employer contribution, the IRP years carry it.
  const rw = new Database(dbPath)
  rw.prepare(
    `insert into pension_flows (account, account_wrapper, owner, date, kind, amount_krw, source)
     values (?, 'irp', 'self', '2025-12-20', 'employer_contribution', 300000, 'example-evidence.pdf')`
  ).run(IRP)
  rw.close()
  assert.deepEqual(getPensionAccounts()[0].contributionsByYear, [
    { year: 2025, ownKrw: 0, employerKrw: 300_000 },
    { year: 2026, ownKrw: 1_000_000, employerKrw: 0 },
  ])
})

const POLICY = {
  pensionTaxCredit: {
    byYear: [
      { fromYear: 2023, pensionSavingsLimitKrw: 6_000_000, combinedLimitKrw: 9_000_000 },
      { fromYear: 2015, pensionSavingsLimitKrw: 4_000_000, combinedLimitKrw: 7_000_000 },
    ],
  },
} as unknown as TaxPolicy

test('contributions by year are summed across accounts and set against the credit limits', () => {
  const rows = contributionsAgainstLimits(
    [
      { wrapper: 'irp', contributionsByYear: [{ year: 2026, ownKrw: 4_000_000, employerKrw: 1_000_000 }, { year: 2014, ownKrw: 100, employerKrw: null }] },
      { wrapper: 'pension_savings', contributionsByYear: [{ year: 2026, ownKrw: 7_000_000, employerKrw: null }, { year: 2022, ownKrw: 3_000_000, employerKrw: null }] },
    ],
    POLICY
  )
  assert.deepEqual(rows, [
    {
      year: 2026,
      irpOwnKrw: 4_000_000,
      pensionSavingsOwnKrw: 7_000_000,
      combinedOwnKrw: 11_000_000,
      employerKrw: 1_000_000,
      limit: { pensionSavingsLimitKrw: 6_000_000, combinedLimitKrw: 9_000_000 },
      // Pension savings counts up to 6M, then the combined 9M caps the whole.
      creditEligibleKrw: 9_000_000,
    },
    {
      year: 2022,
      irpOwnKrw: 0,
      pensionSavingsOwnKrw: 3_000_000,
      combinedOwnKrw: 3_000_000,
      employerKrw: null,
      limit: { pensionSavingsLimitKrw: 4_000_000, combinedLimitKrw: 7_000_000 },
      creditEligibleKrw: 3_000_000,
    },
    {
      year: 2014,
      irpOwnKrw: 100,
      pensionSavingsOwnKrw: 0,
      combinedOwnKrw: 100,
      employerKrw: null,
      limit: null,
      creditEligibleKrw: null,
    },
  ])
})
