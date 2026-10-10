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
// same (Robinhood's three share one snapshot) are folded into one line. Silent
// when every account is current.
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
      ? row.sources.map((source) => ({ ...row, ...source, account: row.account, brokerage: row.brokerage }))
      : [row]
  )
}

/** Rows that read the same are one thing to do, however many accounts share them. */
function groupRows(rows) {
  const groups = new Map()
  for (const row of rows) {
    // The destination is part of what to do: two accounts' CSVs that happen to
    // stop on the same day are still two files with two names.
    const key = [row.brokerage, row.status, row.coveredThrough, row.downloadFrom, row.requiredArtifact, row.method, row.destination].join('|')
    const group = groups.get(key)
    if (group) group.accounts.push(row.account)
    else groups.set(key, { ...row, accounts: [row.account] })
  }
  return [...groups.values()].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || (b.lagDays ?? 9999) - (a.lagDays ?? 9999) || a.brokerage.localeCompare(b.brokerage)
  )
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
  const next =
    group.method === 'mcp'
      ? `→ ${group.requiredArtifact} 다시 생성`
      : `→ ${group.downloadFrom ? `${group.downloadFrom}부터 ` : ''}${group.requiredArtifact} 다운로드 → ${group.destination}`
  return `• ${accountLabel(group)} — ${reach}\n  ${next}`
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
  if (groups.length === 0) return null

  const urgent = groups.filter((group) => group.status !== 'due_soon')
  const soon = groups.filter((group) => group.status === 'due_soon')
  const asOf = String(doc.generatedAt ?? '').slice(0, 10) || 'unknown'
  const parts = [`📥 계좌 자료 업데이트 — 받아야 할 자료 ${urgent.length}건, 곧 받을 자료 ${soon.length}건 (데이터 기준 ${asOf})`]
  if (urgent.length) parts.push('', '지금 필요:', ...urgent.map(line))
  if (soon.length) parts.push('', '기한 임박:', ...soon.map(line))
  parts.push('', '받은 파일은 inbox에 넣으면 다음 refresh에 반영됩니다. 전체 표: /data-ops')
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
