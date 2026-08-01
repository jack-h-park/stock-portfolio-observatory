import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readUsHoldingTickers, resolveUsHoldingFiles } from '../scripts/source-files.mjs'

// Two US holdings sources arrived that the filer would not claim, and both
// failures were silent in the way this project keeps rediscovering: the Merrill
// positions export was refused as ambiguous, and the Fidelity one was not
// recognised at all — which is how Fidelity's positions stayed structurally
// absent while its trades were ingested.
//
// These fixtures are the real headers with the amounts replaced. The headers
// ARE the thing under test: every detector here reads a file's contents rather
// than its name, so a broker changing a column is exactly the regression this
// has to catch.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

// Merrill's flat positions layout: basis under `Total Client Investment`, no
// tax lots, and a `Balances` block plus a `Total` row sharing the table with
// the positions.
const MERRILL_POSITIONS = [
  'Exported on: 07/31/2026 08:48 PM ET',
  '',
  'Selected account(s):CMA-Edge 73S-98Y50',
  '',
  '',
  ',',
  '"CMA-Edge 73S-98Y50" ,"Value" ,"Day\'s Value Change" ,"Unrealized Gain/Loss" ',
  '"" ,"$38,897.21" ,"+$143.29 +0.37%" ,"+$1,714.85 +4.62%" ',
  ',',
  '"" ',
  '"Symbol " ,"Description" ,"Quantity" ,"Price" ,"Day\'s Price $ Chg % Chg" ,"Value" ,"Cumulative Investment Return $" ,"Day\'s Value Change $" ,"Total Client Investment" ,"Unrealized Gain/Loss $ Chg % Chg" ',
  '"JEPI" ,"JPMORGAN EQUITY" ,"122.5084" ,"$57.43" ,"+$0.19 +0.33%" ,"$7,035.66" ,"+$158.48" ,"+$23.28" ,"$6,877.18" ,"+$17.29 +0.25%" ',
  '"Balances" ,"" ,"" ,"" ,"" ,"" ,"" ,"" ,"" ,"" ',
  '"Money accounts" ,"ML DIRECT DEPOSIT PROGRM" ,"28" ,"$1.00" ,"$0.00 0.00%" ,"$28.00" ,"--" ,"$0.00" ,"--" ,"-- --" ',
  '"Total" ,"" ,"" ,"" ," " ,"$38,897.21" ,"+$2,535.05" ,"+$143.29" ,"" ,"+$1,714.85 +4.62%" ',
].join('\r\n')

// Merrill's other holdings layout, which the old marker (`Cost Basis`) was
// written against. Both must still file to the same doctype.
const MERRILL_TAX_LOTS = [
  'Exported on: 07/15/2026 08:53 PM ET',
  '',
  'Selected account(s):CMA-Edge 73S-98Y50',
  ',',
  '"" ,"Symbol " ,"Quantity" ,"Unit Cost" ,"Cost Basis" ,"Price" ,"Value" ,"Unrealized Gain/Loss $ Chg % Chg" ," " ',
  '"" ,"JEPI !  Executed Buy" ,"122.5084" ,"$57.29" ,"$7,018.37" ,"$56.62" ,"$6,936.42" ,"-$81.95 -1.17%" ,"" ',
].join('\r\n')

// A UTF-8 BOM, one account per row, and the download date in a month-name
// format the transactions export does not use.
const FIDELITY_POSITIONS = (accounts: string[]) =>
  '﻿' +
  [
    'Account number,Account name,Symbol,Description,Quantity,Last price,Last price change,Current value,Today\'s gain/loss dollar,Today\'s gain/loss percent,Total gain/loss dollar,Total gain/loss percent,Percent of account,Cost basis total,Average cost basis,Type',
    ...accounts.map(
      (account) =>
        `${account},[Fidelity] Individual - TOD,SCHD,SCHWAB US DIVIDEND EQUITY ETF,0.008,$33.47,+$0.06,$0.26,$0.00,+0.17%,+$0.01,+7.10%,100.00%,$0.25,$31.25,Cash,`
    ),
    '',
    '"Brokerage services are provided by Fidelity Brokerage Services LLC (FBS)."',
    '',
    '"Date downloaded Jul-31-2026 at 8:24 p.m ET"',
  ].join('\r\n')

/** Run the filer over an inbox holding `files`, and return its --dry-run plan. */
function fileDownloads(files: Record<string, string>) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'stock-inbox-'))
  mkdirSync(path.join(dataDir, 'inbox'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dataDir, 'inbox', name), body, 'utf8')
  }
  const result = spawnSync(process.env.STOCK_PYTHON_BIN || 'python3', ['scripts/file-downloads.py', '--dry-run'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, STOCK_DATA_DIR: dataDir },
  })
  assert.equal(result.status, 0, `filer exited ${result.status}: ${result.stderr}`)
  return { stdout: result.stdout, dataDir }
}

test('a Merrill positions export files as holdings even though it has no Cost Basis column', () => {
  const { stdout } = fileDownloads({ 'ExportData31072026204815.csv': MERRILL_POSITIONS })
  assert.match(stdout, /→ us-holdings\/merrill-holdings-20260731\.csv/)
  // The evidence line has to say WHICH layout arrived, because the destination
  // name cannot — both layouts are `merrill-holdings-<date>.csv`.
  assert.match(stdout, /basis under "Total Client Investment"/)
})

test("Merrill's tax-lot layout still files to the same doctype", () => {
  const { stdout } = fileDownloads({ 'ExportData15072026205300.csv': MERRILL_TAX_LOTS })
  assert.match(stdout, /→ us-holdings\/merrill-holdings-20260715\.csv/)
  assert.match(stdout, /basis under "Cost Basis"/)
})

test('a Fidelity positions export files as holdings, dated from its own footer', () => {
  const { stdout } = fileDownloads({ 'Portfolio_Positions_Jul-31-2026.csv': FIDELITY_POSITIONS(['Z37480490']) })
  assert.match(stdout, /→ us-holdings\/fidelity-holdings-20260731\.csv/)
  assert.doesNotMatch(stdout, /unidentified — left in the inbox[\s\S]*Portfolio_Positions/)
})

test('a multi-account Fidelity positions export is refused rather than filed under one account', () => {
  const { stdout } = fileDownloads({
    'Portfolio_Positions_Jul-31-2026.csv': FIDELITY_POSITIONS(['Z37480490', 'X12345678']),
  })
  assert.doesNotMatch(stdout, /→ us-holdings\/fidelity-holdings/)
  assert.match(stdout, /it holds 2 accounts \(Z37480490, X12345678\)/)
  assert.match(stdout, /re-export one account at a time/)
})

test('a Fidelity transactions export is still read as transactions, not positions', () => {
  const { stdout } = fileDownloads({
    'Accounts_History.csv':
      '﻿\r\n\r\nRun Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date\r\n' +
      '07/30/2026,DIVIDEND RECEIVED SCHD,SCHD,SCHWAB US DIVIDEND EQUITY ETF,Cash,,,,,,0.01,0.01,\r\n\r\n' +
      'Date downloaded 07/31/2026 05:22 pm\r\n',
  })
  assert.match(stdout, /→ us-transactions\/fidelity-transactions-20260731\.csv/)
})

/** Write `body` to a us-holdings file and read its tickers the way the price fetch does. */
function tickersOf(brokerage: string, name: string, body: string) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'stock-tickers-'))
  mkdirSync(path.join(dataDir, 'us-holdings'), { recursive: true })
  const filename = path.join(dataDir, 'us-holdings', name)
  writeFileSync(filename, body, 'utf8')
  return readUsHoldingTickers([{ brokerage, filename }])
}

// The price fetch used to carry its own copy of this, reading Merrill by fixed
// column offsets. On the flat layout column 1 is the DESCRIPTION, so it asked
// Yahoo for `JPMORGAN`, `SCHWAB`, `INVESCO` and `ML`; the misses exited non-zero
// and failed the whole refresh before the ingest ran. Same reader now, and these
// pin the shapes that broke it.
test('the flat Merrill layout yields tickers, not the words in its Description column', () => {
  const tickers = tickersOf('Merrill', 'merrill-holdings-20260731.csv', MERRILL_POSITIONS)
  assert.deepEqual(tickers, ['JEPI'])
  for (const notATicker of ['JPMORGAN', 'ML', 'SCHWAB', 'INVESCO']) {
    assert.ok(!tickers.includes(notATicker), `${notATicker} is a description, not a ticker`)
  }
})

test("the Merrill tax-lot layout still yields its tickers", () => {
  assert.deepEqual(tickersOf('Merrill', 'merrill-holdings-20260715.csv', MERRILL_TAX_LOTS), ['JEPI'])
})

test('Fidelity positions yield tickers from the Symbol column', () => {
  assert.deepEqual(
    tickersOf('Fidelity', 'fidelity-holdings-20260731.csv', FIDELITY_POSITIONS(['Z37480490'])),
    ['SCHD']
  )
})

test('the holdings specs resolve a filed Fidelity export', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'stock-sources-'))
  mkdirSync(path.join(dataDir, 'us-holdings'), { recursive: true })
  for (const name of ['fidelity-holdings-20260715.csv', 'fidelity-holdings-20260731.csv']) {
    writeFileSync(path.join(dataDir, 'us-holdings', name), 'x', 'utf8')
  }
  const { files, missing } = resolveUsHoldingFiles(dataDir)
  const fidelity = files.filter((f: { brokerage: string }) => f.brokerage === 'Fidelity')
  // 'latest' — a positions snapshot is superseded by the next one, never joined
  // to it, or the same shares would be counted twice.
  assert.equal(fidelity.length, 1)
  assert.equal(path.basename(fidelity[0].filename), 'fidelity-holdings-20260731.csv')
  assert.ok(!missing.some((m: string) => m.includes('fidelity')))
})
