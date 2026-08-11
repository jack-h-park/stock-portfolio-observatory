import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { writeSheetPayloads } from './sheet-payloads'

// Robinhood's holdings come from a LIVE MCP snapshot; its lots come from a
// transaction CSV downloaded by hand. The two are different vintages by design,
// so they disagree routinely — and the single warning that reported it made two
// very different situations sound identical.
//
// The direction separates them:
//
//   replay BELOW holdings — shares held that the replay never saw arrive. A
//   purchase sitting in an undownloaded CSV. The snapshot still supplies the
//   position and its cost, so no figure is wrong. Warning.
//
//   replay ABOVE holdings — the replay still holds shares the broker says are
//   gone. Something disposed of them and the books do not know, so the proceeds,
//   the realized gain and the tax year are all missing, and missing DOWNWARD.
//   Error.
//
// The real case that prompted this: SPCX read replay 1 vs holdings 6 after a
// purchase on 2026-08-11 that the 2026-07-31 CSV could not contain.

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const ROBINHOOD_HEADER =
  '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"'

const buy = (date: string, qty: number) =>
  `"${date}","${date}","${date}","SPCX","SPAC and New Issue ETF","Buy","${qty}","$135.00","($${(qty * 135).toFixed(2)})"`

/** A snapshot holding `held` SPCX shares in one account, with one lot behind them. */
const snapshot = (held: number) => ({
  fetchedAt: '2026-08-11T17:13:00Z',
  accounts: [
    {
      accountNumber: 'XXXXXX1478',
      nickname: 'Mid-term',
      positions: [{ symbol: 'SPCX', name: 'SPAC and New Issue ETF', quantity: held }],
      lots: [
        {
          symbol: 'SPCX',
          lots: [
            {
              open_lot_id: 'lot-1',
              quantity: held,
              tax_cost_basis: held * 134.416,
              cost_per_share: 134.416,
              open_date: '2026-06-12',
            },
          ],
        },
      ],
    },
  ],
})

function ingest(held: number, boughtInCsv: number) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rh-direction-'))
  mkdirSync(path.join(dir, 'us-transactions'), { recursive: true })
  writeFileSync(
    path.join(dir, 'us-transactions', 'robinhood-transactions-midterm-20260731.csv'),
    [ROBINHOOD_HEADER, buy('6/12/2026', boughtInCsv)].join('\n') + '\n',
    'utf8'
  )
  writeSheetPayloads(dir)
  const repoData = mkdtempSync(path.join(tmpdir(), 'rh-direction-data-'))
  cpSync(path.join(REPO_ROOT, 'data'), repoData, { recursive: true })
  const snapshotPath = path.join(dir, 'robinhood-snapshot.json')
  writeFileSync(snapshotPath, JSON.stringify(snapshot(held)), 'utf8')

  const dbPath = path.join(dir, 'out.db')
  try {
    execFileSync(process.execPath, ['scripts/ingest-stock-data.mjs'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      env: {
        ...process.env,
        STOCK_DATA_DIR: dir,
        STOCK_DB_PATH: dbPath,
        STOCK_ROBINHOOD_SNAPSHOT_PATH: snapshotPath,
        STOCK_KR_STATEMENTS_DIR: path.join(dir, 'no-kr'),
        STOCK_US_PDF_EVIDENCE_PATH: path.join(dir, 'no-evidence.json'),
      },
    })
  } catch (err) {
    // An ERROR-severity check exits non-zero and still writes the database —
    // which is the state the disposal test below is asserting on.
    if (!(err as { status?: number }).status) throw err
  }

  const db = new Database(dbPath, { readonly: true })
  return (name: string) =>
    db.prepare('select status, severity, detail from validation_checks where name = ?').get(name) as
      | { status: string; severity: string; detail: string }
      | undefined
}

test('shares the replay has not seen arrive stay a warning, and do not read as a missing sale', () => {
  // Holdings 6, CSV knows of 1 — the SPCX case. A purchase the download missed.
  const check = ingest(6, 1)

  const arrivals = check('robinhood_holdings_replay_provenance')
  assert.equal(arrivals?.status, 'fail')
  assert.equal(arrivals?.severity, 'warning')
  assert.match(arrivals?.detail ?? '', /has not seen arrive/)

  // The loud one must stay silent here. This is the whole point of the split:
  // before it, this position spoke with the same voice as a missing disposal.
  const disposals = check('robinhood_replay_missing_disposal')
  assert.equal(disposals?.status, 'pass')
})

test('shares the broker no longer has are an error, because a disposal is missing', () => {
  // The mirror image: the CSV recorded 6 bought, the broker reports 1 left. Five
  // shares left the account and no row on the books says so, so their proceeds
  // and realized gain are absent.
  const check = ingest(1, 6)

  const disposals = check('robinhood_replay_missing_disposal')
  assert.equal(disposals?.status, 'fail')
  assert.equal(disposals?.severity, 'error')
  assert.match(disposals?.detail ?? '', /disposal is missing/)

  // And the quiet one does not also fire — one situation, one voice.
  assert.equal(check('robinhood_holdings_replay_provenance')?.status, 'pass')
})

test('a replay that agrees with the broker fires neither', () => {
  const check = ingest(6, 6)
  assert.equal(check('robinhood_holdings_replay_provenance')?.status, 'pass')
  assert.equal(check('robinhood_replay_missing_disposal')?.status, 'pass')
})
