/**
 * `pnpm sources:status` — did the broker files arrive on this host?
 *
 * Downloads land on the laptop, which files and pushes them here
 * (scripts/push-sources.sh). This answers from the receiving side: when the last
 * push succeeded (its `.push-sources-last-success` heartbeat), the newest file in
 * each pushed folder, and what the weekly coverage reminder says is still owed
 * (scripts/coverage-reminder.mjs `dueItems`, read from the published summary).
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/config'
import { dueItems } from '@/scripts/coverage-reminder.mjs'
import { buildProvenance, provenanceLines, round, table, type CliContext, type Command, type ParsedFlags } from '@/lib/cli/common'

/** The folders push-sources.sh carries. Keep in step with its SOURCES list (a test pins it). */
export const SOURCE_FOLDERS = [
  'kr-statements',
  'us-transactions',
  'fx-statements',
  'us-holdings',
  'us-tax-documents',
  'crypto-bithumb',
  'crypto-robinhood',
  'bank-statements',
  'pension',
] as const

/**
 * A filename with any digit run that is not a date masked. Some exports carry
 * an account's last digits in the name, and account numbers never leave this
 * app; a year, a YYYYMM month or a YYYYMMDD date is kept, since that is what
 * says whether the right period arrived.
 */
export function maskFileName(name: string) {
  return name.replace(/\d+/g, (run) => {
    if (run.length < 4) return run
    const year = Number(run.slice(0, 4))
    const plausibleYear = year >= 1990 && year <= 2099
    const month = Number(run.slice(4, 6))
    const day = Number(run.slice(6, 8))
    if (run.length === 4 && plausibleYear) return run
    if (run.length === 6 && plausibleYear && month >= 1 && month <= 12) return run
    if (run.length === 8 && plausibleYear && month >= 1 && month <= 12 && day >= 1 && day <= 31) return run
    return '*'.repeat(run.length)
  })
}

function newestFile(dir: string): { relative: string; mtimeMs: number } | null {
  let best: { relative: string; mtimeMs: number } | null = null
  const walk = (current: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        const mtimeMs = fs.statSync(full).mtimeMs
        if (!best || mtimeMs > best.mtimeMs) best = { relative: path.relative(dir, full), mtimeMs }
      }
    }
  }
  walk(dir)
  return best
}

export function lastPush(dataDir: string, now: Date = new Date()) {
  const file = path.join(dataDir, '.push-sources-last-success')
  let at: string | null = null
  try {
    const stamp = fs.readFileSync(file, 'utf8').trim()
    const parsed = new Date(stamp)
    if (stamp && !Number.isNaN(parsed.getTime())) at = parsed.toISOString()
  } catch {
    at = null
  }
  return { at, ageHours: at ? round((now.getTime() - Date.parse(at)) / 3_600_000, 1) : null }
}

export function runSourcesStatus(_flags: ParsedFlags, ctx: CliContext) {
  const dataDir = config.stockDataDir
  const notes: string[] = []
  const sources = SOURCE_FOLDERS.map((folder) => {
    const newest = newestFile(path.join(dataDir, folder))
    return {
      folder,
      latestFile: newest ? newest.relative.split(path.sep).map(maskFileName).join('/') : null,
      latestMtime: newest ? new Date(newest.mtimeMs).toISOString() : null,
    }
  })
  let due: Record<string, unknown>[] = []
  try {
    due = dueItems(JSON.parse(fs.readFileSync(config.stockBriefingSummaryPath, 'utf8')))
  } catch (error) {
    notes.push(`Coverage could not be read from the published summary (${(error as Error).message}); "due" is empty because it is unknown, not because nothing is owed.`)
  }
  return {
    provenance: buildProvenance({ conn: ctx.conn, policyState: ctx.policyState, dbPath: ctx.dbPath }),
    lastPush: lastPush(dataDir),
    sources,
    due,
    notes,
  }
}

function textSourcesStatus(r: Record<string, any>) {
  const push = r.lastPush.at ? `${r.lastPush.at} (${r.lastPush.ageHours}h ago)` : 'no heartbeat'
  const due = r.due.length
    ? table(
        ['due', 'status', 'covered through', 'next'],
        r.due.map((d: any) =>
          d.kind === 'account'
            ? [`${d.brokerage} ${d.accounts.join(', ')}`, d.status, d.coveredThrough, d.requiredArtifact]
            : d.kind === 'supplementary'
              ? [d.label, d.status, d.latestDate, d.action]
              : [d.check, 'failing', null, null]
        )
      )
    : 'due: nothing'
  return [
    `sources:status — last push ${push}`,
    '',
    table(['folder', 'latest file', 'modified'], r.sources.map((s: any) => [s.folder, s.latestFile, s.latestMtime])),
    '',
    due,
    ...(r.notes.length ? ['', ...r.notes.map((n: string) => `note: ${n}`)] : []),
    '',
    provenanceLines(r.provenance),
  ].join('\n')
}

export const sourcesStatusCommand: Command = {
  name: 'sources:status',
  usage: 'pnpm sources:status [--json]',
  flags: {},
  run: runSourcesStatus as Command['run'],
  text: textSourcesStatus,
}
