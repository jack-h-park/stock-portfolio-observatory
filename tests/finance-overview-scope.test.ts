import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { summarizeFinanceAssets } from '../lib/domain/assets/overview'
import { getFinanceOverview } from '../lib/application/finance-overview'

test('one inclusion path per asset prevents duplicate cash and pension wrapper counting', () => {
  const base = {
    owner: 'self',
    accountId: 'example',
    assetKey: 'cash:USD',
    assetClass: 'cash' as const,
    asOf: '2026-10-01',
    valueKrw: 1300,
    method: 'market' as const,
  }
  const result = summarizeFinanceAssets([
    base,
    { ...base },
    { ...base, owner: 'child:sample', valueKrw: 99999 },
    { ...base, accountId: 'pension', assetKey: 'fund', assetClass: 'pensions', valueKrw: 2000 },
  ])
  assert.equal(result.totalKrw, 3300)
  assert.equal(result.byClass.cash, 1300)
  assert.equal(result.byClass.pensions, 2000)
  assert.equal(result.scope, 'self')
})
test('legacy net-worth reader uses the scoped current summary rather than stock-wide totals', async (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'finance-reader-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !['STOCK_', 'FINANCE_', 'SAMPLE_'].some((prefix) => key.startsWith(prefix)),
    ),
  )
  execFileSync(process.execPath, [path.resolve('scripts/seed-sample.mjs')], {
    cwd: dir,
    env: env as NodeJS.ProcessEnv,
    stdio: 'pipe',
  })
  const file = path.join(dir, 'private-data/personal-finance-sample/runtime/observatory.db'),
    db = new Database(file)
  db.exec(`insert into holdings_all(market,currency,base_currency,account,ticker,name,quantity,native_cost,total_cost_krw,base_market_value,base_cost,account_wrapper,asset_class,owner,as_of_date) values
 ('US','USD','KRW','child','CHILD','Synthetic child',1,1,1,99999,1,'taxable','security','child:sample','2026-10-01'),
 ('KR','KRW','KRW','pension','GOLD','Synthetic pension gold',1,1900,1900,2000,1900,'irp','gold','self','2026-10-01');`)
  db.close()
  const { config } = await import('../config'),
    original = config.stockDbPath
  try {
    config.stockDbPath = file
    const { getNetWorth } = await import('../lib/adapters/portfolio-db')
    assert.equal(getNetWorth().totalKrw, 14352000)
  } finally {
    config.stockDbPath = original
  }
})
test('missing prices and conflicting same-date sources stay out of a covered subtotal', () => {
  const base = {
    owner: 'self',
    accountId: 'example',
    assetKey: 'cash:USD',
    assetClass: 'cash' as const,
    asOf: '2026-10-01',
    valueKrw: null,
    method: 'unpriced' as const,
  }
  const result = summarizeFinanceAssets([
    base,
    { ...base, assetKey: 'conflict', valueKrw: 100, method: 'market' },
    { ...base, assetKey: 'conflict', valueKrw: 200, method: 'market' },
  ])
  assert.equal(result.totalKrw, 0)
  assert.equal(result.omissions.length, 2)
  assert.equal(result.complete, false)
})
test('the DB query scopes owners, classifies pension gold once, and reconciles cash sweeps', (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'finance-scope-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'portfolio.db'),
    db = new Database(file)
  db.exec(`
 create table holdings_all(id integer,brokerage text,account text,owner text,market text,ticker text,account_wrapper text,asset_class text,base_market_value real,base_cost real,quantity real,as_of_date text);
 insert into holdings_all values(1,'Example','taxable','self','US','AAA','taxable','security',1000,900,1,'2026-10-01'),(2,'Example','child','child:sample','US','BBB','taxable','security',99999,1,1,'2026-10-01'),(3,'Example','pension','self','KR','GOLD','irp','gold',2000,1900,1,'2026-10-01'),(4,'Example','cash','self','US','SPAXX','taxable','security',1300,1300,1,'2026-10-01'),(5,'Example','missing','self','US','MISS','taxable','security',null,500,1,'2026-10-01');
 create table cash_balances(id integer,institution text,account text,owner text,currency text,as_of_date text,balance real);
 insert into cash_balances values(1,'Bank','checking','self','KRW','2026-10-01',500),(2,'Bank','checking','self','KRW','2026-09-01',100),(3,'Bank','child','child:sample','KRW','2026-10-01',99999);
 create table brokerage_cash(id integer,institution text,account text,pool text,currency text,as_of_date text,balance real,account_wrapper text,asset_class text);
 insert into brokerage_cash values(1,'Example','cash','usd','USD','2026-10-01',1,'taxable','security');
 create table fx_rates(from_currency text,to_currency text,rate real,as_of_date text);
 insert into fx_rates values('USD','KRW',1300,'2026-10-01');
 `)
  db.close()
  const result = getFinanceOverview(file)
  assert.equal(result.totalKrw, 4800)
  assert.equal(result.byClass.cash, 1800)
  assert.equal(result.byClass.pensions, 2000)
  assert.equal(result.byClass.gold, 0)
  assert.equal(result.omissions.length, 1)
  assert.equal(result.liabilitiesSupported, false)
})
