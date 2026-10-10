import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coverageMessage } from '../scripts/coverage-reminder.mjs'

const row = (over) => ({
  market: 'KR',
  brokerage: '미래에셋증권',
  account: '미래에셋증권(ISA)',
  status: 'action_needed',
  coveredThrough: '2026-07-15',
  downloadFrom: '2026-07-14',
  lagDays: 86,
  maxLagDays: 35,
  overdueDays: 51,
  method: 'inbox',
  requiredArtifact: '거래내역증명서',
  destination: 'kr-statements/',
  ...over,
})

const doc = (rows) => ({ schemaVersion: 1, generatedAt: '2026-10-09T13:00:00.000Z', accountCoverage: { rows } })

test('silent when every account is current', () => {
  assert.equal(coverageMessage(doc([row({ status: 'current' })])), null)
})

test('names the account, how far it reaches, and the date to download from', () => {
  const message = coverageMessage(doc([row({})]))
  assert.match(message, /미래에셋증권\(ISA\) — 2026-07-15까지 반영 \(86일 경과, 기준 35일\)/)
  assert.match(message, /2026-07-14부터 거래내역증명서 다운로드 → kr-statements\//)
})

test('folds accounts that read the same into one line, and does not tell an MCP snapshot to be downloaded', () => {
  const rh = (account) =>
    row({ market: 'US', brokerage: 'Robinhood', account, method: 'mcp', requiredArtifact: 'Robinhood MCP snapshot + tax lots', destination: 'data/robinhood-snapshot.json' })
  const message = coverageMessage(doc([rh('Robinhood 1111'), rh('Robinhood 2222'), rh('Robinhood 3333')]))
  assert.match(message, /Robinhood \(3개 계좌\)/)
  assert.equal(message.match(/Robinhood \(/g).length, 1)
  assert.match(message, /Robinhood MCP snapshot \+ tax lots 다시 생성/)
  assert.doesNotMatch(message, /snapshot \+ tax lots 다운로드/)
})

test('lists overdue accounts before ones that are only due soon', () => {
  const message = coverageMessage(doc([row({ account: 'soon', status: 'due_soon', lagDays: 31 }), row({ account: 'late' })]))
  assert.ok(message.indexOf('late') < message.indexOf('soon'))
  assert.match(message, /받아야 할 자료 1건, 곧 받을 자료 1건/)
})

test('refuses a summary it does not understand instead of staying silent', () => {
  assert.throws(() => coverageMessage({ schemaVersion: 1 }), /no accountCoverage/)
  assert.throws(() => coverageMessage({ ...doc([]), schemaVersion: 2 }), /newer/)
})

// Robinhood is two artifacts per account: the MCP snapshot (positions and lots)
// and the hand-downloaded transaction CSVs. A fresh snapshot once marked every
// account current while the CSVs stopped two months earlier.
const rhSource = (over) => ({
  label: 'MCP',
  method: 'mcp',
  status: 'current',
  coveredThrough: '2026-10-09',
  downloadFrom: null,
  lagDays: 0,
  maxLagDays: 7,
  overdueDays: 0,
  requiredArtifact: 'Robinhood MCP snapshot + tax lots',
  destination: 'data/robinhood-snapshot.json',
  ...over,
})
const rhCsv = (token, coveredThrough, downloadFrom, lagDays, over = {}) =>
  rhSource({
    label: 'CSV',
    method: 'manual',
    status: 'action_needed',
    coveredThrough,
    downloadFrom,
    lagDays,
    maxLagDays: 14,
    overdueDays: lagDays - 14,
    requiredArtifact: 'Robinhood transactions CSV',
    destination: `us-transactions/robinhood-transactions-${token}-YYYYMMDD-YYYYMMDD.csv`,
    ...over,
  })
const rhAccount = (account, sources) => {
  const behind = sources.find((s) => s.status !== 'current') ?? sources[0]
  return row({
    market: 'US',
    brokerage: 'Robinhood',
    account,
    status: behind.status,
    coveredThrough: behind.coveredThrough,
    downloadFrom: sources.find((s) => s.method === 'inbox')?.downloadFrom ?? null,
    lagDays: behind.lagDays,
    maxLagDays: behind.maxLagDays,
    method: behind.method,
    requiredArtifact: sources.map((s) => s.requiredArtifact).join(' + '),
    destination: 'data/robinhood-snapshot.json + us-transactions/',
    sources,
  })
}

test('a fresh Robinhood snapshot does not hide transaction CSVs that stopped weeks ago', () => {
  const message = coverageMessage(
    doc([
      rhAccount('Robinhood Agentic · 1111', [rhSource({}), rhCsv('agentic', '2026-08-13', '2026-08-12', 57)]),
      rhAccount('Robinhood Mid-term · 2222', [rhSource({}), rhCsv('midterm', '2026-08-11', '2026-08-10', 59)]),
    ])
  )
  assert.ok(message, 'stale CSVs must produce a reminder even though the snapshot is current')
  assert.match(message, /Robinhood Mid-term · 2222 — 2026-08-11까지 반영 \(59일 경과, 기준 14일\)/)
  assert.match(message, /2026-08-10부터 Robinhood transactions CSV 다운로드 → 직접 저장: us-transactions\/robinhood-transactions-midterm-YYYYMMDD-YYYYMMDD\.csv/)
  assert.match(message, /2026-08-12부터 Robinhood transactions CSV 다운로드 → 직접 저장: us-transactions\/robinhood-transactions-agentic-/)
  // Nothing here goes through the inbox, so the message does not say it does.
  assert.doesNotMatch(message, /inbox에 넣으면/)
  assert.match(message, /Robinhood transactions CSV는 파일에 계좌가 적혀 있지 않아 inbox가 분류하지 않습니다/)
  // The current snapshot is not something to do.
  assert.doesNotMatch(message, /snapshot/)
  // Oldest first.
  assert.ok(message.indexOf('Mid-term') < message.indexOf('Agentic'))
})

test('a stale snapshot shared by every account is one line, beside each account’s own CSV line', () => {
  const stale = rhSource({ status: 'action_needed', coveredThrough: '2026-09-20', lagDays: 19, overdueDays: 12 })
  const message = coverageMessage(
    doc([
      rhAccount('Robinhood Agentic · 1111', [stale, rhCsv('agentic', '2026-08-13', '2026-08-12', 57)]),
      rhAccount('Robinhood Long-term · 3333', [stale, rhCsv('longterm', '2026-08-13', '2026-08-12', 57)]),
      rhAccount('Robinhood Mid-term · 2222', [stale, rhCsv('midterm', '2026-08-11', '2026-08-10', 59)]),
    ])
  )
  assert.equal(message.match(/MCP snapshot \+ tax lots 다시 생성/g).length, 1)
  assert.match(message, /Robinhood \(3개 계좌\) — 2026-09-20까지 반영/)
  // Two accounts whose CSVs stop on the same day are still two files to name.
  assert.match(message, /robinhood-transactions-agentic-/)
  assert.match(message, /robinhood-transactions-longterm-/)
  assert.match(message, /받아야 할 자료 4건/)
})

test('a message mixing inbox files and hand-saved CSVs explains both, once each', () => {
  const message = coverageMessage(
    doc([row({}), rhAccount('Robinhood Mid-term · 2222', [rhSource({}), rhCsv('midterm', '2026-08-11', '2026-08-10', 59)])])
  )
  assert.equal(message.match(/inbox에 넣으면/g).length, 1)
  assert.equal(message.match(/직접 저장하면/g).length, 1)
  assert.match(message, /전체 표: \/data-ops$/)
})

test('a summary written before sources existed still reads as before', () => {
  const message = coverageMessage(doc([row({ sources: undefined })]))
  assert.match(message, /미래에셋증권\(ISA\) — 2026-07-15까지 반영/)
})
