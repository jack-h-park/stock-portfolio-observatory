// coverage-reminder.mjs — the weekly "which statements to download next" message.
//
// Most of this app's data refreshes itself. The broker statements do not: they
// are downloaded by hand, so an account only goes stale when nobody acts, and
// nothing said so. /data-ops has had the account table for a while, but a table
// nobody opens is not a reminder, and the health alerts only ever named the
// validation checks a stale statement trips, never the account or the date to
// download from.
//
// This reads the `accountCoverage` block that `pnpm summary` publishes and prints
// one line per account that needs a download: the account, how far its data
// reaches, and the date to start the next download from. Accounts that read the
// same (Robinhood's three share one snapshot) are folded into one line. After
// them, a 보조 자산 section names the deposits, pensions and gold whose files are
// overdue, and the supplementary checks that fail, from the summary's
// `supplementaryCoverage` block. Silent when everything is current.
//
// usage: node scripts/coverage-reminder.mjs [--summary <path>]
//
// Exit 0 when it said what it had to say (including nothing). Exit 1 when it
// could not read the summary at all, so the cron that runs it records a failure
// rather than a quiet week.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The summary schema this reader understands. Newer is refused, not guessed at. */
const SCHEMA_VERSION = 1

const ATTENTION = new Set(['action_needed', 'missing', 'due_soon'])
const ORDER = { missing: 0, action_needed: 1, due_soon: 2, current: 3 }

/**
 * One item per thing to obtain. An account made of several artifacts that age
 * separately (Robinhood: an MCP snapshot and per-account transaction CSVs) is
 * split into one item per artifact, each with its own date and its own way of
 * being obtained. Read as one row, a fresh snapshot hid CSVs two months behind.
 */
function items(rows) {
  return rows.flatMap((row) =>
    Array.isArray(row.sources) && row.sources.length > 1
      ? row.sources.map((source) => ({
          ...row,
          ...source,
          account: row.account,
          brokerage: row.brokerage,
          // The row's list belongs to the source that carries it (the CSV), not to
          // every artifact of the account.
          missingDisposals: source.missingDisposals ?? [],
        }))
      : [row]
  )
}

/** Rows that read the same are one thing to do, however many accounts share them. */
function groupRows(rows) {
  const groups = new Map()
  for (const row of rows) {
    // The destination is part of what to do: two accounts' CSVs that happen to
    // stop on the same day are still two files with two names.
    const key = [row.brokerage, row.status, row.coveredThrough, row.downloadFrom, row.requiredArtifact, row.method, row.destination, disposals(row).join(',')].join('|')
    const group = groups.get(key)
    if (group) group.accounts.push(row.account)
    else groups.set(key, { ...row, accounts: [row.account] })
  }
  return [...groups.values()].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || (b.lagDays ?? 9999) - (a.lagDays ?? 9999) || a.brokerage.localeCompare(b.brokerage)
  )
}

/** Tickers sold out of the account with no sale on its books; empty for older summaries. */
function disposals(row) {
  return Array.isArray(row.missingDisposals) ? row.missingDisposals : []
}

function accountLabel(group) {
  if (group.accounts.length > 2) return `${group.brokerage} (${group.accounts.length}개 계좌)`
  return group.accounts.map((account) => (account.startsWith(group.brokerage) ? account : `${group.brokerage} ${account}`)).join(', ')
}

function line(group) {
  const reach =
    group.coveredThrough == null
      ? '반영된 자료 없음'
      : `${group.coveredThrough}까지 반영 (${group.lagDays}일 경과, 기준 ${group.maxLagDays}일)`
  // The Robinhood snapshot is regenerated through the MCP, not downloaded, so
  // "download from <date>" would send someone looking for an export that does not
  // exist.
  const from = group.downloadFrom ? `${group.downloadFrom}부터 ` : ''
  // A 'manual' file cannot be filed by the inbox (a Robinhood transactions CSV
  // names no account), so the destination is the name to save it under.
  const next =
    group.method === 'mcp'
      ? `→ ${group.requiredArtifact} 다시 생성`
      : group.method === 'manual'
        ? `→ ${from}${group.requiredArtifact} 다운로드 → 직접 저장: ${group.destination}`
        : `→ ${from}${group.requiredArtifact} 다운로드 → ${group.destination}`
  // A missing sale is why a recent CSV still has to be downloaded, and what it
  // costs until then: the gain is not on the books.
  const sold = disposals(group)
  const gap = sold.length ? `\n  ⚠️ 매도 기록 누락 ${sold.length}종목 (${sold.join(', ')}): 이 기간 CSV가 들어와야 실현손익이 잡힙니다` : ''
  return `• ${accountLabel(group)} — ${reach}\n  ${next}${gap}`
}

/**
 * How the files reach the next refresh, said only for the kinds this message
 * asks for. "Put it in the inbox" was printed under every message, including
 * ones whose only items were Robinhood CSVs the inbox reports and leaves where
 * they are, and a snapshot that is not a file anyone downloads.
 */
function footer(groups) {
  const lines = []
  if (groups.some((group) => group.method !== 'mcp' && group.method !== 'manual')) {
    lines.push('받은 파일은 inbox에 넣으면 다음 refresh에 반영됩니다.')
  }
  const manual = [...new Set(groups.filter((group) => group.method === 'manual').map((group) => group.requiredArtifact))]
  if (manual.length) {
    lines.push(`${manual.join(', ')}는 파일에 계좌가 적혀 있지 않아 inbox가 분류하지 않습니다. 위에 적힌 경로와 이름으로 직접 저장하면 다음 refresh에 반영됩니다.`)
  }
  return lines
}

/**
 * Supplementary items (deposits, pensions, physical gold, the gold price) that
 * need something filed, oldest first. A summary written before the block existed
 * has none, which reads as nothing to say rather than a refusal: the stock
 * reminder must keep working against an older refresh.
 */
function supplementaryItems(doc) {
  const block = doc.supplementaryCoverage
  const rows = Array.isArray(block?.rows) ? block.rows.filter((row) => ATTENTION.has(row.status)) : []
  const failing = Array.isArray(block?.failingChecks) ? block.failingChecks.filter(Boolean) : []
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.lagDays ?? 9999) - (a.lagDays ?? 9999) || String(a.label).localeCompare(String(b.label)))
  return { rows, failing }
}

function supplementaryLine(row) {
  const reach =
    row.latestDate == null ? '반영된 자료 없음' : `${row.latestDate}까지 반영 (${row.lagDays}일 경과, 기준 ${row.maxLagDays}일)`
  return `• ${row.label} — ${reach}\n  → ${row.action}`
}

/**
 * The message for one summary document, or null when there is nothing to say.
 * Throws when the document cannot be read as a summary this script understands.
 */
export function coverageMessage(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('summary is not a JSON object')
  if (Number(doc.schemaVersion) > SCHEMA_VERSION) {
    throw new Error(`summary schemaVersion ${doc.schemaVersion} is newer than ${SCHEMA_VERSION}; update this reader`)
  }
  const coverage = doc.accountCoverage
  if (!coverage || !Array.isArray(coverage.rows)) {
    throw new Error('summary has no accountCoverage block — the refresh that writes it predates this reader')
  }

  const groups = groupRows(items(coverage.rows).filter((row) => ATTENTION.has(row.status)))
  const supplementary = supplementaryItems(doc)
  const hasSupplementary = supplementary.rows.length > 0 || supplementary.failing.length > 0
  if (groups.length === 0 && !hasSupplementary) return null

  const urgent = groups.filter((group) => group.status !== 'due_soon')
  const soon = groups.filter((group) => group.status === 'due_soon')
  const asOf = String(doc.generatedAt ?? '').slice(0, 10) || 'unknown'
  const parts = [
    groups.length
      ? `📥 계좌 자료 업데이트 — 받아야 할 자료 ${urgent.length}건, 곧 받을 자료 ${soon.length}건 (데이터 기준 ${asOf})`
      : `📥 계좌 자료 업데이트 — 보조 자산 확인 필요 (데이터 기준 ${asOf})`,
  ]
  if (urgent.length) parts.push('', '지금 필요:', ...urgent.map(line))
  if (soon.length) parts.push('', '기한 임박:', ...soon.map(line))
  // Deposits, pensions and gold come after the statements: they feed total
  // assets only, never a stock figure.
  if (hasSupplementary) {
    parts.push('', '보조 자산:', ...supplementary.rows.map(supplementaryLine))
    if (supplementary.failing.length) parts.push(`• 실패한 보조 자산 점검: ${supplementary.failing.join(', ')}`)
  }
  const tail = groups.length ? footer(groups) : []
  parts.push('', ...tail, '전체 표: /data-ops')
  return parts.join('\n')
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

async function main() {
  const { loadLocalEnv } = await import('./env.mjs')
  loadLocalEnv()
  const summaryPath =
    arg('--summary') ||
    process.env.STOCK_BRIEFING_SUMMARY_PATH ||
    path.join(os.homedir(), 'workspace/data/stock-management/outputs/stock-portfolio-observatory/briefing-summary.json')
  let message
  try {
    message = coverageMessage(JSON.parse(fs.readFileSync(summaryPath, 'utf8')))
  } catch (error) {
    process.stdout.write(`⚠️ 계좌 자료 알림을 만들지 못했습니다 — ${summaryPath}: ${error.message}\n`)
    process.exit(1)
  }
  if (message) process.stdout.write(`${message}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
