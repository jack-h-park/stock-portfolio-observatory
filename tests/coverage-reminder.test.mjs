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
