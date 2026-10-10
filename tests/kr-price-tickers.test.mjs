import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { krPriceTickers } from '../scripts/kr-price-tickers.mjs'

const EMPTY_MAP = { accounts: {}, bankAccounts: [], anchors: [], pensionAccounts: [] }

test('pension ETF tickers are priced; the gold code and fund rows are not', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kr-price-tickers-'))
  const pension = path.join(dir, 'pension')
  mkdirSync(pension)
  writeFileSync(
    path.join(pension, 'irp-holdings-20261008.csv'),
    'type,name,ticker,quantity,cost_krw,value_krw\nETF,Example 200 ETF,069500,10,300000,350000\nFUND,"Example fund, class C",,,1000,1100\nCASH,Example cash,,,0,5\n'
  )
  // A legacy snapshot has no ticker column, so nothing in it can be priced.
  writeFileSync(path.join(pension, 'pension-savings-holdings-20251231.csv'), 'type,name,quantity,cost_krw,value_krw\nETF,Legacy ETF,1,1,1\n')
  writeFileSync(path.join(pension, 'notes.csv'), 'type,name,ticker\nETF,Not a snapshot,999999\n')

  const tickers = krPriceTickers({
    holdingsRows: [
      { Account: '미래에셋증권(종합)', Ticker: "'005930" },
      { Account: '미래에셋증권(금현물)', Ticker: 'M04020000' },
      { Account: 'Total', Ticker: '' },
    ],
    pensionDir: pension,
    accountMap: EMPTY_MAP,
  })
  assert.deepEqual(tickers, ['005930', '069500'])
})

test('a missing pension directory is not an error', () => {
  assert.deepEqual(
    krPriceTickers({ holdingsRows: [{ Account: 'A', Ticker: '000660' }], pensionDir: '/nonexistent/pension', accountMap: EMPTY_MAP }),
    ['000660']
  )
})
