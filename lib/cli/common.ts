/**
 * What every read-only Observatory CLI shares: the refresh-lock check, the
 * read-only database handle, the provenance block, and the JSON/exit-code
 * envelope.
 *
 * These CLIs exist so an agent can quote a figure that code computed instead of
 * rebuilding the computation in a session. That only works if a reader can tell
 * which inputs produced the figure, so every success carries `provenance`, and
 * if the command never writes anything, so the database opens read-only and no
 * code path here saves a file. The output contract is versioned
 * (`schemaVersion`) because another repo reads it.
 *
 * Exit codes: 0 ok, 1 anything else, 2 usage, 3 a refresh holds `.refresh.lock`.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { assumptionString, getTaxPolicyState, type TaxPolicyState } from '@/lib/tax-policy'

export const SCHEMA_VERSION = 1
export const DISCLAIMER = 'Estimate under the stated inputs; not tax advice.'

export const EXIT = { ok: 0, error: 1, usage: 2, refreshInProgress: 3 } as const

/** An error that carries its exit code. Anything else thrown exits 1. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.error
  ) {
    super(message)
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT.usage)
  }
}

// ---------------------------------------------------------------------------
// Arguments

export type FlagSpec = Record<string, 'string' | 'boolean'>
export type ParsedFlags = Record<string, string | boolean | undefined>

/**
 * `--name value` and `--name=value` for string flags, `--name` for booleans. A
 * bare `--` (what `pnpm <script> -- …` may pass through) is skipped. Anything
 * not in `spec` is a usage error rather than something silently ignored: a
 * misspelt `--sell-date` would otherwise produce a confident answer to a
 * different question.
 */
export function parseFlags(argv: string[], spec: FlagSpec): ParsedFlags {
  const out: ParsedFlags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') continue
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument: ${arg}`)
    const eq = arg.indexOf('=')
    const name = arg.slice(2, eq >= 0 ? eq : undefined)
    const kind = spec[name]
    if (!kind) throw new UsageError(`unknown option: --${name}`)
    if (kind === 'boolean') {
      if (eq >= 0) throw new UsageError(`--${name} takes no value`)
      out[name] = true
      continue
    }
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[i + 1]
    if (value == null || (eq < 0 && value.startsWith('--'))) throw new UsageError(`--${name} needs a value`)
    out[name] = value
    if (eq < 0) i += 1
  }
  return out
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A YYYY-MM-DD flag, validated as a real calendar date. */
export function dateFlag(flags: ParsedFlags, name: string): string | undefined {
  const value = flags[name]
  if (value == null) return undefined
  const text = String(value)
  if (!DATE_RE.test(text) || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw new UsageError(`--${name} must be a date as YYYY-MM-DD, got ${text}`)
  }
  return text
}

/** Today in America/Los_Angeles, the portfolio's day. */
export function todayLosAngeles(now: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// ---------------------------------------------------------------------------
// The refresh lock

/** Same path and override as scripts/refresh.mjs. */
export function refreshLockPath() {
  return process.env.STOCK_REFRESH_LOCK_PATH || path.join(process.cwd(), '.refresh.lock')
}

/**
 * Whether a refresh holds the lock, judged the way refresh.mjs judges it: the
 * lock directory exists and its owner is alive, or its owner cannot be read (a
 * refresh that has made the directory and not yet written its pid). A lock
 * whose owner is dead is stale, and refresh.mjs itself reclaims it.
 */
export function refreshLockHeld(lockPath = refreshLockPath()) {
  if (!fs.existsSync(lockPath)) return false
  let pid: number | null = null
  try {
    pid = Number(fs.readFileSync(path.join(lockPath, 'pid'), 'utf8').trim())
  } catch {
    return true
  }
  if (!Number.isInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

// ---------------------------------------------------------------------------
// The database and the provenance block

export function openReadonlyDb(dbPath = config.stockDbPath) {
  if (!fs.existsSync(dbPath)) throw new CliError(`no database at ${dbPath}; run pnpm refresh first`)
  return new Database(dbPath, { readonly: true, fileMustExist: true })
}

export function hasTable(conn: Database.Database, name: string) {
  return Boolean(conn.prepare("select 1 from sqlite_master where type in ('table', 'view') and name = ?").get(name))
}

export function columnsOf(conn: Database.Database, table: string) {
  return new Set((conn.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((column) => column.name))
}

function sha256File(filePath: string) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function mtimeIso(filePath: string) {
  return new Date(fs.statSync(filePath).mtimeMs).toISOString()
}

export function metaValue(conn: Database.Database, key: string): string | null {
  if (!hasTable(conn, 'meta')) return null
  const row = conn.prepare('select value from meta where key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

/** The newest USD/KRW date the database holds. */
export function latestFxDate(conn: Database.Database): string | null {
  if (!hasTable(conn, 'historical_fx_rates')) return null
  const row = conn.prepare('select max(price_date) as d from historical_fx_rates').get() as { d: string | null } | undefined
  return row?.d ?? null
}

/**
 * When the stored US prices were fetched: the `generatedAt` of the price snapshot the
 * ingest read (its path is in `meta`), else the ingest time.
 */
export function storedPricesAsOf(conn: Database.Database): string | null {
  const file = metaValue(conn, 'us_prices_path')
  if (file) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (typeof doc?.generatedAt === 'string' && doc.generatedAt) return doc.generatedAt
    } catch {
      // Fall through to the ingest time.
    }
  }
  return metaValue(conn, 'ingested_at')
}

/** The policy file actually read: the local one, or the example when there is none. */
export function policySourcePath(state: TaxPolicyState) {
  return state.source === 'local' ? state.path : state.examplePath
}

export type Provenance = {
  dbPath: string
  dbBuiltAt: string | null
  dbMtime: string
  policyPath: string
  policySha256: string
  policyMtime: string
  priceSource: string
  pricesAsOf: string | null
  fxDates: { latest: string | null } & Record<string, unknown>
  krCreditMode: string
  disclaimer: string
}

export function buildProvenance({
  conn,
  policyState,
  dbPath = config.stockDbPath,
  priceSource = 'db',
  pricesAsOf,
  fxExtra = {},
}: {
  conn: Database.Database
  policyState: TaxPolicyState
  dbPath?: string
  priceSource?: string
  pricesAsOf?: string | null
  fxExtra?: Record<string, unknown>
}): Provenance {
  const policyPath = policySourcePath(policyState)
  return {
    dbPath,
    dbBuiltAt: metaValue(conn, 'ingested_at'),
    dbMtime: mtimeIso(dbPath),
    policyPath,
    policySha256: sha256File(policyPath),
    policyMtime: mtimeIso(policyPath),
    priceSource,
    pricesAsOf: pricesAsOf === undefined ? storedPricesAsOf(conn) : pricesAsOf,
    fxDates: { latest: latestFxDate(conn), ...fxExtra },
    krCreditMode: assumptionString(policyState.policy, 'KR', 'foreignTaxCreditMode', 'manual'),
    disclaimer: DISCLAIMER,
  }
}

/** Everything a command needs to read. Opened after the lock check, closed by runCli. */
export type CliContext = {
  conn: Database.Database
  policyState: TaxPolicyState
  dbPath: string
}

export function openContext(): CliContext {
  const dbPath = config.stockDbPath
  const conn = openReadonlyDb(dbPath)
  return { conn, policyState: getTaxPolicyState(), dbPath }
}

// ---------------------------------------------------------------------------
// Output

export function round(value: number | null | undefined, digits: number): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null
  const factor = 10 ** digits
  const rounded = Math.round(Number(value) * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

export const usd = (value: number | null | undefined) => round(value, 2)
export const krw = (value: number | null | undefined) => round(value, 0)

export type Command = {
  name: string
  usage: string
  flags: FlagSpec
  /** Builds the command-specific part of the success object. */
  run: (flags: ParsedFlags, ctx: CliContext) => Record<string, unknown> & { provenance: Provenance }
  /** The plain-text rendering, for a person at a terminal. */
  text: (result: Record<string, any>) => string
}

type Io = { stdout: (text: string) => void; stderr: (text: string) => void }

const defaultIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}

/**
 * Run one command and return its exit code. Never throws: every failure becomes
 * the error envelope on stdout (with --json) or a line on stderr.
 */
export function runCli(command: Command, argv: string[], io: Io = defaultIo): number {
  const wantsJson = argv.includes('--json')
  const fail = (code: number, error: string) => {
    if (wantsJson) io.stdout(`${JSON.stringify({ ok: false, error, schemaVersion: SCHEMA_VERSION })}\n`)
    else io.stderr(`${command.name}: ${error}\n`)
    if (code === EXIT.usage) io.stderr(`usage: ${command.usage}\n`)
    return code
  }

  let flags: ParsedFlags
  try {
    flags = parseFlags(argv, { ...command.flags, json: 'boolean', help: 'boolean' })
  } catch (error) {
    return fail(EXIT.usage, (error as Error).message)
  }
  if (flags.help) {
    io.stderr(`usage: ${command.usage}\n`)
    return EXIT.ok
  }

  // Before anything is opened: during a refresh the database is being rebuilt.
  // The envelope goes to stdout with or without --json: a caller that only
  // checks the exit code and one that parses stdout both see the same answer.
  if (refreshLockHeld()) {
    io.stdout(`${JSON.stringify({ ok: false, error: 'refresh-in-progress', schemaVersion: SCHEMA_VERSION })}\n`)
    if (!wantsJson) io.stderr(`${command.name}: a refresh is in progress (${refreshLockPath()} is held); try again when it finishes\n`)
    return EXIT.refreshInProgress
  }

  let ctx: CliContext | null = null
  try {
    ctx = openContext()
    const body = command.run(flags, ctx)
    const result = { ok: true, schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), ...body }
    if (wantsJson) io.stdout(`${JSON.stringify(result, null, 2)}\n`)
    else io.stdout(`${command.text(result)}\n`)
    return EXIT.ok
  } catch (error) {
    const code = error instanceof CliError ? error.exitCode : EXIT.error
    return fail(code, (error as Error)?.message ?? String(error))
  } finally {
    ctx?.conn.close()
  }
}

/** A plain-text table: header row, then rows, columns padded to width. */
export function table(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cells = [headers, ...rows.map((row) => row.map((cell) => (cell == null ? '-' : String(cell))))]
  const widths = headers.map((_, i) => Math.max(...cells.map((row) => (row[i] ?? '').length)))
  return cells.map((row) => row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  ').trimEnd()).join('\n')
}

export function provenanceLines(p: Provenance): string {
  return [
    `db: ${p.dbPath} (built ${p.dbBuiltAt ?? 'unknown'})`,
    `policy: ${p.policyPath} sha256 ${p.policySha256.slice(0, 12)} (modified ${p.policyMtime})`,
    `prices: ${p.priceSource} as of ${p.pricesAsOf ?? 'unknown'}; fx latest ${p.fxDates.latest ?? 'none'}; KR credit mode ${p.krCreditMode}`,
    p.disclaimer,
  ].join('\n')
}
