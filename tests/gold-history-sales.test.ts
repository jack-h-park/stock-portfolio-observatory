import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { totalAssetsSeries, type HistoricalGoldTrade } from '../lib/net-worth'

// Synthetic trades only. Dropping SELL rows, pooling accounts, using gross
// purchase cost after sales, or borrowing a future price must break these cases.
const buy = (date: string, grams: number, costKrw: number | null, accountId = 'A', feeKrw = 0) =>
  ({ date, type: 'BUY' as const, grams, costKrw, accountId, feeKrw })
const sell = (date: string, grams: number, accountId = 'A') =>
  ({ date, type: 'SELL' as const, grams, costKrw: null, accountId })
const series = (trades: HistoricalGoldTrade[], dates: string[], prices: {date: string; price: number}[] = []) =>
  totalAssetsSeries({ dates, stocks: {}, crypto: {}, cash: {}, pensionPoints: [], gold: { trades, prices } })

test('historical gold is unknown before buying, reduced on partial sale and zero after full sale', () => {
  const r = series([buy('2025-01-02', 10, 1000), sell('2025-02-02', -4), sell('2025-03-02', 6)],
    ['2025-01-01', '2025-01-31', '2025-02-28', '2025-03-31'], [{date:'2025-01-01', price:200}])
  assert.deepEqual(r.points.map(p => p.gold), [null, 2000, 1200, 0])
  assert.deepEqual(r.points.map(p => p.total), [0, 2000, 1200, 0])
})

test('missing historical prices use remaining FIFO purchase cost including purchase fees', () => {
  const r = series([buy('2025-01-01', 10, 1000, 'A', 100), buy('2025-02-01', 5, 1000), sell('2025-03-01', 12)],
    ['2025-01-31', '2025-02-28', '2025-03-31'], [{date:'2025-04-01',price:9999}])
  assert.deepEqual(r.points.map(p => p.gold), [1100, 2100, 600])
})

test('a sale only consumes its own account, including when account costs differ', () => {
  const r = series([buy('2025-01-01',5,500,'A'), buy('2025-01-02',5,1000,'B'), sell('2025-01-03',5,'B')], ['2025-01-31'])
  assert.equal(r.points[0].gold,500)
})

test('oversold and missing quantities are unknown, never hidden by another account', () => {
  assert.equal(series([buy('2025-01-01',10,1000,'A'),sell('2025-01-02',1,'B')],['2025-01-31']).points[0].gold,null)
  assert.equal(series([{...buy('2025-01-01',1,100),grams:null}],['2025-01-31']).points[0].gold,null)
})

test('missing cost blocks only unpriced remaining lots, not a quoted position or a fully sold lot', () => {
  const trades=[buy('2025-01-01',5,null),buy('2025-01-02',5,1000),sell('2025-02-01',5)]
  assert.equal(series(trades,['2025-01-31']).points[0].gold,null)
  assert.equal(series(trades,['2025-01-31'],[{date:'2025-01-01',price:200}]).points[0].gold,2000)
  assert.equal(series(trades,['2025-02-28']).points[0].gold,1000)
  assert.equal(series([...trades,sell('2025-03-01',5)],['2025-03-31']).points[0].gold,0)
})

test('the actual reader keeps self accounts separate, excludes child trades and retains today', async t => {
  const root=mkdtempSync(path.join(tmpdir(),'gold-sales-')); t.after(()=>rmSync(root,{recursive:true,force:true}))
  const oldPath=config.stockDbPath; t.after(()=>{config.stockDbPath=oldPath})
  const file=path.join(root,'sample.db'); const db=new Database(file)
  db.exec(`create table transactions_all (id integer primary key, date text, type text, quantity real, amount_krw real, settlement_krw real, fee real, tax real, asset_class text, brokerage text, account text, owner text);
    create table gold_prices (date text, price real);`)
  const add=db.prepare("insert into transactions_all (date,type,quantity,amount_krw,fee,tax,asset_class,brokerage,account,owner) values (?,?,?,?,0,0,'gold',?,?,?)")
  add.run('2025-01-01','BUY',10,1000,'One','shared-alias','self')
  add.run('2025-01-02','SELL',-4,800,'One','shared-alias','self')
  add.run('2025-01-02','BUY',2,400,'Two','shared-alias','self')
  add.run('2025-01-03','BUY',100,10000,'One','child','child:test')
  add.run('2025-01-03','FEE',0,99999,'One','shared-alias','self')
  add.run('2025-02-01','SELL',6,1200,'One','shared-alias','self')
  db.exec("insert into gold_prices values ('2025-01-01',200),('2025-03-01',9999)");db.close()
  config.stockDbPath=file
  const {getTotalAssetsSeries}=await import('../lib/adapters/portfolio-db')
  const current={totalKrw:77,byClass:{stocks:77,crypto:0,cash:0,pensions:0,gold:0},asOfNotes:[],cash:[],unpricedCash:[]}
  const r=getTotalAssetsSeries(['2025-01-31','2025-02-28'],current)
  assert.deepEqual(r.points.slice(0,2).map(p=>p.gold),[1600,400])
  assert.equal(r.points.at(-1)?.total,77)
  assert.equal(r.points.at(-1)?.gold,0)
  // Exercise the SQL fee/tax and settlement fallback boundary without a quote.
  // Remaining cost: 6/10 of (1000 + 100 fee + 10 tax), plus the other account's 400.
  const edit=new Database(file)
  edit.exec("delete from gold_prices; update transactions_all set fee=100,tax=10 where type='BUY' and account='shared-alias' and brokerage='One'; update transactions_all set settlement_krw=amount_krw,amount_krw=null where brokerage='Two'")
  edit.close()
  assert.deepEqual(getTotalAssetsSeries(['2025-01-31','2025-02-28'],current).points.slice(0,2).map(p=>p.gold),[1066,400])
  const unknown=new Database(file)
  unknown.exec("update transactions_all set quantity=null where type='BUY' and brokerage='One' and owner='self'")
  unknown.close()
  assert.equal(getTotalAssetsSeries(['2025-01-31'],current).points[0].gold,null)
})
