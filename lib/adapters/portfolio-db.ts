import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from '@/config'
import type { TaxPlanningLot } from '@/lib/tax-planning'

export type Holding = {
  id: number
  market: string
  currency: string
  brokerage: string | null
  account: string
  ticker: string
  name: string
  quantity: number
  native_cost: number
  native_market_value: number | null
  native_unrealized_gl: number | null
  native_unrealized_gl_pct: number | null
  base_cost: number | null
  base_market_value: number | null
  base_unrealized_gl: number | null
  total_cost_krw: number
  long_term_qty: number | null
  short_term_qty: number | null
  lot_count: number | null
}

export type HealthCheck = {
  id: number
  name: string
  status: 'pass' | 'fail'
  detail: string
  severity: 'error' | 'warning'
}

export type EvidenceReport = {
  id: number
  name: string
  category: string
  filename: string
  path: string
  account_hint: string | null
  pages: number | null
  row_count: number | null
  metrics_json: string | null
}

export type PositionSourceRef = {
  source: string
  usages: string[]
  file: {
    name: string
    filename: string
    path: string
    bytes: number
    mtime_ms: number
    sha256: string
    row_count: number
  } | null
}

export type PositionDetail = {
  market: string
  ticker: string
  name: string
  currency: string
  holdings: Holding[]
  lots: any[]
  transactions: any[]
  dividends: any[]
  transactionSummary: { type: string; count: number; amount: number | null }[]
  totals: {
    account_count: number
    holding_count: number
    quantity: number
    native_cost: number
    native_market_value: number | null
    native_unrealized_gl: number | null
    base_cost: number
    base_market_value: number | null
    base_unrealized_gl: number | null
    long_term_qty: number
    short_term_qty: number
    lot_count: number
  }
  lotTotals: {
    lot_count: number
    open_quantity: number
    native_cost_basis: number
    cost_basis_krw: number
    long_term_count: number
    short_term_count: number
  }
  dividendTotals: {
    count: number
    native_amount: number
    amount_krw: number
  }
  sources: PositionSourceRef[]
}

export type FreshnessStatus = 'fresh' | 'stale' | 'drift' | 'missing'

export type FreshnessItem = {
  key: string
  label: string
  category: 'price' | 'fx' | 'source'
  status: FreshnessStatus
  observedAt: string | null
  thresholdMs: number | null
  ageMs: number | null
  detail: string
  path?: string | null
  rowCount?: number | null
}

export type OperationalHealth = {
  generatedAt: string
  items: FreshnessItem[]
  snapshots: FreshnessItem[]
  sourceDrift: FreshnessItem[]
  staleItems: FreshnessItem[]
  summary: {
    fresh: number
    stale: number
    drift: number
    missing: number
  }
}

export type RefreshStep = {
  name: string
  command: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  status: 'success' | 'failed' | 'running'
  exitCode: number | null
  signal?: string | null
  stdoutTail?: string
  stderrTail?: string
}

export type RefreshRun = {
  id: string
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  status: 'success' | 'failed' | 'running'
  steps: RefreshStep[]
}

export type SourceInventoryItem = {
  id: string
  name: string
  filename: string
  relativePath: string
  path: string
  category: string
  status: 'used' | 'unused' | 'drift' | 'missing'
  bytes: number | null
  mtimeMs: number | null
  rowCount: number | null
  sha256: string | null
  detail: string
}

export type SourceInventory = {
  dataDir: string
  tracked: SourceInventoryItem[]
  untracked: SourceInventoryItem[]
  items: SourceInventoryItem[]
  summary: {
    used: number
    unused: number
    drift: number
    missing: number
    totalBytes: number
  }
}

export type ReviewPosition = {
  market: string
  currency: string
  ticker: string
  name: string
  account_count: number
  quantity: number
  native_cost: number
  native_market_value: number | null
  native_unrealized_gl: number | null
  native_unrealized_gl_pct: number | null
  base_cost: number
  base_market_value: number | null
  base_unrealized_gl: number | null
  base_unrealized_gl_pct: number | null
  long_term_qty: number
  short_term_qty: number
  short_term_ratio: number | null
  lot_count: number
}

/**
 * One market's figures in BOTH its own currency and the base currency.
 *
 * `PortfolioReview.byMarket` reports base amounts only, which is right for the
 * review screen — every row is comparable there. Consumers outside this app want
 * the native figure too ("US +$802"), and the pair has to be grouped together:
 * a market's native sum is only meaningful alongside the currency it is denominated
 * in, so `currency` is part of the grain rather than a label bolted on after.
 */
export type MarketBreakdown = {
  market: string
  currency: string
  position_count: number
  /** How many of those rows actually carry a market value. See `native_cost`. */
  priced_position_count: number
  native_cost: number
  native_market_value: number | null
  native_unrealized_gl: number | null
  native_unrealized_gl_pct: number | null
  base_cost: number
  base_market_value: number | null
  base_unrealized_gl: number | null
}

export type PortfolioReview = {
  totals: {
    position_count: number
    market_count: number
    account_count: number
    base_cost: number
    base_market_value: number
    base_unrealized_gl: number
    positive_positions: number
    negative_positions: number
  }
  concentration: {
    top1Share: number
    top5Share: number
    top10Share: number
  }
  byMarket: {
    market: string
    position_count: number
    base_cost: number
    base_market_value: number
    base_unrealized_gl: number
  }[]
  topGainers: ReviewPosition[]
  topLosers: ReviewPosition[]
  largestPositions: ReviewPosition[]
  shortTermHeavy: ReviewPosition[]
  noMarketValue: ReviewPosition[]
}

export type IncomeReview = {
  totals: {
    row_count: number
    tickerless_count: number
    base_income: number
    dividend_base_income: number
    interest_base_income: number
    other_base_income: number
    krw_income: number
    usd_income: number
    ytd_base_income: number
    trailing_12m_base_income: number
    yield_on_market: number | null
    yield_on_cost: number | null
  }
  byMonth: {
    month: string
    base_income: number
    dividend_base_income: number
    interest_base_income: number
    other_base_income: number
    row_count: number
  }[]
  byYear: {
    year: string
    currency: string
    native_income: number
    base_income: number
    row_count: number
  }[]
  byMarket: {
    market: string
    currency: string
    native_income: number
    base_income: number
    row_count: number
  }[]
  byPosition: {
    market: string
    currency: string
    ticker: string
    name: string
    native_income: number
    base_income: number
    row_count: number
    market_value: number | null
    cost_basis: number | null
    trailing_yield: number | null
    yield_on_cost: number | null
  }[]
  tickerless: {
    market: string
    currency: string
    name: string | null
    type: string | null
    native_income: number
    base_income: number
    row_count: number
  }[]
}

export type RebalanceReview = {
  policy: {
    baseCurrency: 'KRW'
    marketTargets: { market: string; targetPct: number }[]
    positionCapPct: number
  }
  totals: {
    base_market_value: number
    base_cost: number
    position_count: number
  }
  marketGaps: {
    market: string
    currentValue: number
    currentPct: number
    targetPct: number
    targetValue: number
    gapValue: number
    gapPct: number
    action: 'Add' | 'Reduce' | 'Hold'
  }[]
  reduceCandidates: (ReviewPosition & { currentPct: number; capGapPct: number; capGapValue: number })[]
  addContext: {
    market: string
    gapValue: number
    gapPct: number
    candidateCount: number
  }[]
  watchCandidates: (ReviewPosition & { reason: string })[]
  taxSensitive: (ReviewPosition & { reason: string })[]
}

export type DataOpsReview = {
  manualMappings: {
    path: string
    version: number | null
    incomeRuleCount: number
    overrideCount: number
  }
  mappingSummary: {
    mapping_status: string
    income_category: string
    row_count: number
    base_income: number
  }[]
  tickerlessIncome: {
    market: string
    currency: string
    brokerage: string | null
    account: string
    income_category: string
    mapping_status: string
    type: string | null
    name: string | null
    source: string | null
    row_count: number
    native_income: number
    base_income: number
    suggestion: string
    suggestedRule: string
  }[]
  missingValuation: {
    market: string
    currency: string
    brokerage: string | null
    account: string
    ticker: string
    name: string
    quantity: number
    native_cost: number
    base_cost: number | null
    reason: string
    suggestion: string
  }[]
  actionQueue: {
    priority: 'high' | 'medium' | 'low'
    area: string
    count: number
    action: string
    href: string
  }[]
  mappingSuggestions: {
    id: string
    market: string
    brokerage: string | null
    source: string | null
    income_category: string
    row_count: number
    base_income: number
    rule: string
    note: string
  }[]
  valuationFixes: {
    market: string
    ticker: string
    name: string
    brokerage: string | null
    reason: string
    suggestion: string
  }[]
  sourceIssues: FreshnessItem[]
  validationIssues: HealthCheck[]
}

export type ReconciliationReview = {
  totals: {
    issue_count: number
    market_count: number
    brokerage_count: number
    position_count: number
    lot_position_count: number
    tickerless_income_count: number
    missing_valuation_count: number
    source_issue_count: number
    validation_issue_count: number
  }
  coverage: {
    market: string
    brokerage: string
    holding_positions: number
    holding_accounts: number
    holding_base_cost: number
    lot_positions: number
    lot_rows: number
    lot_base_cost: number
    transaction_rows: number
    dividend_rows: number
  }[]
  positionBreaks: {
    market: string
    brokerage: string
    ticker: string
    name: string
    holding_accounts: number
    holding_quantity: number | null
    lot_quantity: number | null
    quantity_diff: number | null
    holding_base_cost: number | null
    lot_base_cost: number | null
    base_cost_diff: number | null
    status: 'holding_only' | 'lot_only' | 'quantity_break' | 'cost_break'
  }[]
  incomeBreaks: {
    market: string
    currency: string
    brokerage: string | null
    income_category: string
    row_count: number
    base_income: number
  }[]
  valuationBreaks: {
    market: string
    currency: string
    brokerage: string | null
    ticker: string
    name: string
    native_cost: number
    base_cost: number | null
  }[]
  actionQueue: {
    priority: 'high' | 'medium' | 'low'
    area: string
    count: number
    action: string
    href: string
  }[]
}

function db() {
  return new Database(config.stockDbPath, { readonly: true, fileMustExist: true })
}

export function dbAvailable() {
  return fs.existsSync(config.stockDbPath)
}

export function getMeta() {
  const conn = db()
  try {
    return Object.fromEntries(conn.prepare('select key, value from meta').all().map((r: any) => [r.key, r.value])) as Record<
      string,
      string
    >
  } finally {
    conn.close()
  }
}

export function getOverview() {
  const conn = db()
  try {
    const totals = conn
      .prepare(
        `select
          count(*) as holding_count,
          coalesce(sum(quantity), 0) as share_count,
          coalesce(sum(case when currency = 'KRW' then native_cost else 0 end), 0) as krw_cost,
          coalesce(sum(case when currency = 'KRW' then native_market_value else 0 end), 0) as krw_market_value,
          coalesce(sum(case when currency = 'KRW' then native_unrealized_gl else 0 end), 0) as krw_unrealized_gl,
          coalesce(sum(case when currency = 'USD' then native_cost else 0 end), 0) as usd_cost,
          coalesce(sum(case when currency = 'USD' then native_market_value else 0 end), 0) as usd_market_value,
          coalesce(sum(case when currency = 'USD' then native_unrealized_gl else 0 end), 0) as usd_unrealized_gl,
          coalesce(sum(base_cost), 0) as global_base_cost,
          coalesce(sum(base_market_value), 0) as global_base_market_value,
          coalesce(sum(base_unrealized_gl), 0) as global_base_unrealized_gl,
          coalesce(sum(long_term_qty), 0) as long_term_qty,
          coalesce(sum(short_term_qty), 0) as short_term_qty
        from holdings`
      )
      .get() as any
    const dividends = conn
      .prepare(
        `select
          count(*) as count,
          coalesce(sum(case when currency = 'KRW' then native_amount else 0 end), 0) as krw_amount,
          coalesce(sum(case when currency = 'USD' then native_amount else 0 end), 0) as usd_amount
         from dividends`
      )
      .get() as any
    const realized = conn
      .prepare('select count(*) as count, coalesce(sum(realized_gl_krw), 0) as amount from realized_lots')
      .get() as any
    const tx = conn.prepare('select count(*) as count, min(date) as first_date, max(date) as last_date from transactions').get() as any
    const checks = conn.prepare("select count(*) as failed from validation_checks where status != 'pass'").get() as any
    const fxRates = conn.prepare('select * from fx_rates order by as_of_date desc, from_currency').all() as any[]
    return { totals, dividends, realized, tx, failedChecks: checks.failed as number, fxRates }
  } finally {
    conn.close()
  }
}

export function getHoldings(limit = 200): Holding[] {
  const conn = db()
  try {
    return conn
      .prepare(
        `select id, market, currency, brokerage, account, ticker, name, quantity, native_cost, native_market_value,
          native_unrealized_gl, native_unrealized_gl_pct, base_cost, base_market_value, base_unrealized_gl,
          total_cost_krw, long_term_qty, short_term_qty, lot_count
         from holdings
         order by market, currency, native_cost desc
         limit ?`
      )
      .all(limit) as Holding[]
  } finally {
    conn.close()
  }
}

function addSource(sourceMap: Map<string, Set<string>>, source: string | null | undefined, usage: string) {
  if (!source) return
  const trimmed = String(source).trim()
  if (!trimmed) return
  if (!sourceMap.has(trimmed)) sourceMap.set(trimmed, new Set())
  sourceMap.get(trimmed)!.add(usage)
}

function sourceMatchesFile(source: string, file: any) {
  return source === file.filename || source === file.name || file.filename.includes(source) || source.includes(file.filename)
}

export function positionHref(market: string, ticker: string) {
  return `/positions/${encodeURIComponent(market)}/${encodeURIComponent(ticker)}`
}

function readJson(path: string) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8')) as any
  } catch {
    return null
  }
}

function asRefreshRun(value: any): RefreshRun | null {
  if (!value || typeof value !== 'object') return null
  if (!value.id || !value.startedAt || !Array.isArray(value.steps)) return null
  const status = ['success', 'failed', 'running'].includes(value.status) ? value.status : 'failed'
  return {
    id: String(value.id),
    startedAt: String(value.startedAt),
    finishedAt: value.finishedAt ? String(value.finishedAt) : null,
    durationMs: Number.isFinite(Number(value.durationMs)) ? Number(value.durationMs) : null,
    status,
    steps: value.steps.map((step: any) => ({
      name: String(step.name ?? ''),
      command: String(step.command ?? ''),
      startedAt: String(step.startedAt ?? ''),
      finishedAt: step.finishedAt ? String(step.finishedAt) : null,
      durationMs: Number.isFinite(Number(step.durationMs)) ? Number(step.durationMs) : null,
      status: ['success', 'failed', 'running'].includes(step.status) ? step.status : 'failed',
      exitCode: Number.isFinite(Number(step.exitCode)) ? Number(step.exitCode) : null,
      signal: step.signal ? String(step.signal) : null,
      stdoutTail: step.stdoutTail ? String(step.stdoutTail) : '',
      stderrTail: step.stderrTail ? String(step.stderrTail) : '',
    })),
  }
}

function statMtimeIso(path: string) {
  try {
    return new Date(fs.statSync(path).mtimeMs).toISOString()
  } catch {
    return null
  }
}

function ageMs(observedAt: string | null) {
  if (!observedAt) return null
  const ms = Date.now() - new Date(observedAt).getTime()
  return Number.isFinite(ms) ? ms : null
}

function freshnessStatus(observedAt: string | null, thresholdMs: number): FreshnessStatus {
  const age = ageMs(observedAt)
  if (age == null) return 'missing'
  return age > thresholdMs ? 'stale' : 'fresh'
}

function snapshotFreshness({
  key,
  label,
  category,
  path,
  observedAt,
  thresholdMs,
  detail,
}: {
  key: string
  label: string
  category: 'price' | 'fx'
  path: string
  observedAt: string | null
  thresholdMs: number
  detail: string
}): FreshnessItem {
  const age = ageMs(observedAt)
  return {
    key,
    label,
    category,
    status: freshnessStatus(observedAt, thresholdMs),
    observedAt,
    thresholdMs,
    ageMs: age,
    detail,
    path,
  }
}

function sourceFreshness(source: any): FreshnessItem {
  if (!fs.existsSync(source.path)) {
    return {
      key: `source:${source.name}`,
      label: source.name,
      category: 'source',
      status: 'missing',
      observedAt: null,
      thresholdMs: null,
      ageMs: null,
      detail: 'Source file is missing from disk.',
      path: source.path,
      rowCount: source.row_count,
    }
  }
  const stat = fs.statSync(source.path)
  const recordedMtime = Number(source.mtime_ms)
  const mtimeChanged = Math.abs(stat.mtimeMs - recordedMtime) > 1000
  const sizeChanged = stat.size !== Number(source.bytes)
  const observedAt = new Date(recordedMtime).toISOString()
  return {
    key: `source:${source.name}`,
    label: source.name,
    category: 'source',
    status: mtimeChanged || sizeChanged ? 'drift' : 'fresh',
    observedAt,
    thresholdMs: null,
    ageMs: ageMs(observedAt),
    detail:
      mtimeChanged || sizeChanged
        ? `Changed since ingest. Recorded ${source.bytes} bytes; current ${stat.size} bytes.`
        : 'Matches the size and modified time captured at ingest.',
    path: source.path,
    rowCount: source.row_count,
  }
}

function fileCategory(filePath: string, relativePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (relativePath.startsWith('.codex_sheet_payloads/')) return 'kr sheet payload'
  if (relativePath.startsWith('outputs/')) return 'generated output'
  if (relativePath.startsWith('.codex_drive_pdfs/text/')) return 'extracted text'
  if (relativePath.startsWith('.codex_drive_pdfs/')) return 'drive pdf cache'
  if (ext === '.csv') return 'us csv export'
  if (ext === '.pdf') return 'pdf evidence'
  if (ext === '.tsv') return 'tsv payload'
  if (ext === '.xlsx') return 'workbook'
  if (ext === '.json') return 'json snapshot'
  if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') return 'database'
  if (ext === '.png') return 'image artifact'
  if (ext === '.txt') return 'text artifact'
  if (ext === '.md') return 'documentation'
  return ext ? `${ext.slice(1)} file` : 'file'
}

function inventoryCandidate(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  return new Set(['.csv', '.pdf', '.tsv', '.xlsx', '.json', '.db', '.sqlite', '.sqlite3', '.png', '.txt', '.md']).has(ext)
}

function walkFiles(root: string, maxFiles = 2000) {
  const out: string[] = []
  function walk(dir: string) {
    if (out.length >= maxFiles) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && inventoryCandidate(fullPath)) {
        out.push(fullPath)
      }
    }
  }
  walk(root)
  return out
}

function relativeToDataDir(dataDir: string, filePath: string) {
  const rel = path.relative(dataDir, filePath)
  return rel && !rel.startsWith('..') ? rel : filePath
}

function trackedInventoryItem(dataDir: string, source: any): SourceInventoryItem {
  const freshness = sourceFreshness(source)
  const status = freshness.status === 'fresh' || freshness.status === 'stale' ? 'used' : freshness.status
  return {
    id: `tracked:${source.name}`,
    name: source.name,
    filename: source.filename,
    relativePath: relativeToDataDir(dataDir, source.path),
    path: source.path,
    category: fileCategory(source.path, relativeToDataDir(dataDir, source.path)),
    status,
    bytes: Number(source.bytes ?? 0),
    mtimeMs: Number(source.mtime_ms ?? 0),
    rowCount: Number(source.row_count ?? 0),
    sha256: source.sha256,
    detail: freshness.detail,
  }
}

function untrackedInventoryItem(dataDir: string, filePath: string): SourceInventoryItem {
  const stat = fs.statSync(filePath)
  const relativePath = relativeToDataDir(dataDir, filePath)
  return {
    id: `untracked:${relativePath}`,
    name: path.basename(filePath),
    filename: path.basename(filePath),
    relativePath,
    path: filePath,
    category: fileCategory(filePath, relativePath),
    status: 'unused',
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
    rowCount: null,
    sha256: null,
    detail: 'Detected in STOCK_DATA_DIR but not recorded in the latest ingest source_files table.',
  }
}

export function getOperationalHealth(): OperationalHealth {
  const conn = db()
  try {
    const sourceRows = conn.prepare('select * from source_files order by name').all() as any[]
    const krPrices = readJson(config.stockKrPricesPath)
    const usPrices = readJson(config.stockUsPricesPath)
    const fxRates = readJson(config.stockFxRatesPath)
    const fxRate = fxRates?.rates?.[0]
    const priceThresholdMs = 36 * 60 * 60 * 1000
    const fxThresholdMs = 7 * 24 * 60 * 60 * 1000
    const snapshots: FreshnessItem[] = [
      snapshotFreshness({
        key: 'kr_prices',
        label: 'KR prices',
        category: 'price',
        path: config.stockKrPricesPath,
        observedAt: krPrices?.generatedAt ?? statMtimeIso(config.stockKrPricesPath),
        thresholdMs: priceThresholdMs,
        detail: `${krPrices?.prices?.length ?? 0} prices · market date ${krPrices?.prices?.[0]?.asOfDate ?? 'n/a'}`,
      }),
      snapshotFreshness({
        key: 'us_prices',
        label: 'US prices',
        category: 'price',
        path: config.stockUsPricesPath,
        observedAt: usPrices?.generatedAt ?? statMtimeIso(config.stockUsPricesPath),
        thresholdMs: priceThresholdMs,
        detail: `${usPrices?.prices?.length ?? 0} prices · market date ${usPrices?.prices?.[0]?.asOfDate ?? 'n/a'}`,
      }),
      snapshotFreshness({
        key: 'fx_rates',
        label: 'USD/KRW FX',
        category: 'fx',
        path: config.stockFxRatesPath,
        observedAt: fxRate?.asOfDate ? `${fxRate.asOfDate}T00:00:00.000Z` : statMtimeIso(config.stockFxRatesPath),
        thresholdMs: fxThresholdMs,
        detail: fxRate ? `${fxRate.rate} · ${fxRate.source}` : 'No FX rate configured.',
      }),
    ]
    const sourceDrift = sourceRows.map(sourceFreshness)
    const items = [...snapshots, ...sourceDrift]
    const summary = {
      fresh: items.filter((item) => item.status === 'fresh').length,
      stale: items.filter((item) => item.status === 'stale').length,
      drift: items.filter((item) => item.status === 'drift').length,
      missing: items.filter((item) => item.status === 'missing').length,
    }
    return {
      generatedAt: new Date().toISOString(),
      items,
      snapshots,
      sourceDrift,
      staleItems: items.filter((item) => item.status !== 'fresh'),
      summary,
    }
  } finally {
    conn.close()
  }
}

function reviewPositionSelect() {
  return `select
    market,
    currency,
    ticker,
    name,
    count(distinct account) as account_count,
    coalesce(sum(quantity), 0) as quantity,
    coalesce(sum(native_cost), 0) as native_cost,
    sum(native_market_value) as native_market_value,
    sum(native_unrealized_gl) as native_unrealized_gl,
    case
      when coalesce(sum(native_cost), 0) = 0 or sum(native_unrealized_gl) is null then null
      else sum(native_unrealized_gl) / sum(native_cost) * 100
    end as native_unrealized_gl_pct,
    coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
    sum(base_market_value) as base_market_value,
    sum(base_unrealized_gl) as base_unrealized_gl,
    case
      when coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) = 0 or sum(base_unrealized_gl) is null then null
      else sum(base_unrealized_gl) / sum(coalesce(base_cost, total_cost_krw)) * 100
    end as base_unrealized_gl_pct,
    coalesce(sum(long_term_qty), 0) as long_term_qty,
    coalesce(sum(short_term_qty), 0) as short_term_qty,
    case
      when coalesce(sum(long_term_qty), 0) + coalesce(sum(short_term_qty), 0) = 0 then null
      else coalesce(sum(short_term_qty), 0) / (coalesce(sum(long_term_qty), 0) + coalesce(sum(short_term_qty), 0)) * 100
    end as short_term_ratio,
    coalesce(sum(lot_count), 0) as lot_count
   from holdings
   group by market, currency, ticker, name`
}

export function getPortfolioReview(): PortfolioReview {
  const conn = db()
  try {
    const totals = conn
      .prepare(
        `select
          count(*) as position_count,
          count(distinct market) as market_count,
          count(distinct account) as account_count,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          coalesce(sum(base_market_value), 0) as base_market_value,
          coalesce(sum(base_unrealized_gl), 0) as base_unrealized_gl,
          sum(case when coalesce(base_unrealized_gl, 0) > 0 then 1 else 0 end) as positive_positions,
          sum(case when coalesce(base_unrealized_gl, 0) < 0 then 1 else 0 end) as negative_positions
         from holdings`
      )
      .get() as PortfolioReview['totals']

    const byMarket = conn
      .prepare(
        `select market,
          count(*) as position_count,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          coalesce(sum(base_market_value), 0) as base_market_value,
          coalesce(sum(base_unrealized_gl), 0) as base_unrealized_gl
         from holdings
         group by market
         order by base_market_value desc, base_cost desc`
      )
      .all() as PortfolioReview['byMarket']

    const baseSelect = reviewPositionSelect()
    const largestPositions = conn
      .prepare(`select * from (${baseSelect}) order by coalesce(base_market_value, base_cost) desc limit 10`)
      .all() as ReviewPosition[]
    const topGainers = conn
      .prepare(`select * from (${baseSelect}) where base_unrealized_gl is not null order by base_unrealized_gl desc limit 10`)
      .all() as ReviewPosition[]
    const topLosers = conn
      .prepare(`select * from (${baseSelect}) where base_unrealized_gl is not null order by base_unrealized_gl asc limit 10`)
      .all() as ReviewPosition[]
    const shortTermHeavy = conn
      .prepare(
        `select * from (${baseSelect})
         where short_term_ratio is not null and short_term_qty > 0
         order by short_term_ratio desc, coalesce(base_market_value, base_cost) desc
         limit 10`
      )
      .all() as ReviewPosition[]
    const noMarketValue = conn
      .prepare(
        `select * from (${baseSelect})
         where base_market_value is null or native_market_value is null
         order by base_cost desc
         limit 10`
      )
      .all() as ReviewPosition[]

    const topValue = (n: number) =>
      largestPositions.slice(0, n).reduce((sum, row) => sum + Number(row.base_market_value ?? row.base_cost ?? 0), 0)

    // Value the whole portfolio the way the numerator values its slice: market
    // value where there is one, cost where there is not. `totals.base_market_value`
    // cannot serve here — it sums the column, so a position with no price adds
    // nothing to it while still adding its cost to the numerator, and the share
    // runs past 100%. Positions without a market value are an expected state, not
    // an edge case: `noMarketValue` below exists to list them.
    //
    // Computed over the grouped select, not raw `holdings`, so the grain matches
    // too. A ticker whose lots are only partly priced sums to that partial value
    // on both sides; falling back per-row would put cost in the denominator that
    // the numerator never sees.
    const denominator = Number(
      (
        conn
          .prepare(`select coalesce(sum(coalesce(base_market_value, base_cost)), 0) as base_valuation from (${baseSelect})`)
          .get() as { base_valuation: number }
      ).base_valuation
    )
    const share = (value: number) => (denominator > 0 ? (value / denominator) * 100 : 0)

    return {
      totals,
      concentration: {
        top1Share: share(topValue(1)),
        top5Share: share(topValue(5)),
        top10Share: share(topValue(10)),
      },
      byMarket,
      topGainers,
      topLosers,
      largestPositions,
      shortTermHeavy,
      noMarketValue,
    }
  } finally {
    conn.close()
  }
}

/**
 * Per-market totals, native and base side by side.
 *
 * Grouped by market AND currency deliberately. Grouping by market alone would
 * sum native amounts across whatever currencies that market happens to hold and
 * produce a number in no currency at all; this way a market that ever holds two
 * reports two rows rather than one wrong one.
 */
export function getMarketBreakdown(): MarketBreakdown[] {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market,
          currency,
          count(*) as position_count,
          sum(case when base_market_value is not null then 1 else 0 end) as priced_position_count,
          coalesce(sum(native_cost), 0) as native_cost,
          sum(native_market_value) as native_market_value,
          sum(native_unrealized_gl) as native_unrealized_gl,
          case
            when coalesce(sum(native_cost), 0) = 0 or sum(native_unrealized_gl) is null then null
            else sum(native_unrealized_gl) / sum(native_cost) * 100
          end as native_unrealized_gl_pct,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          sum(base_market_value) as base_market_value,
          sum(base_unrealized_gl) as base_unrealized_gl
         from holdings
         group by market, currency
         order by base_market_value desc, base_cost desc`
      )
      .all() as MarketBreakdown[]
  } finally {
    conn.close()
  }
}

export function getIncomeReview(): IncomeReview {
  const conn = db()
  try {
    const currentYear = String(new Date().getFullYear())
    const trailingStart = new Date()
    trailingStart.setMonth(trailingStart.getMonth() - 12)
    const trailingStartMonth = trailingStart.toISOString().slice(0, 7)
    const portfolioTotals = conn
      .prepare(
        `select
          coalesce(sum(base_market_value), 0) as market_value,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as cost_basis
         from holdings`
      )
      .get() as { market_value: number; cost_basis: number }
    const totals = conn
      .prepare(
        `select
          count(*) as row_count,
          sum(case when ticker is null or trim(ticker) = '' then 1 else 0 end) as tickerless_count,
          coalesce(sum(amount_krw), 0) as base_income,
          coalesce(sum(case when income_category = 'dividend' then amount_krw else 0 end), 0) as dividend_base_income,
          coalesce(sum(case when income_category = 'interest' then amount_krw else 0 end), 0) as interest_base_income,
          coalesce(sum(case when income_category not in ('dividend', 'interest') then amount_krw else 0 end), 0) as other_base_income,
          coalesce(sum(case when currency = 'KRW' then native_amount else 0 end), 0) as krw_income,
          coalesce(sum(case when currency = 'USD' then native_amount else 0 end), 0) as usd_income,
          coalesce(sum(case when substr(date, 1, 4) = ? then amount_krw else 0 end), 0) as ytd_base_income,
          coalesce(sum(case when substr(date, 1, 7) >= ? then amount_krw else 0 end), 0) as trailing_12m_base_income
         from dividends`
      )
      .get(currentYear, trailingStartMonth) as Omit<IncomeReview['totals'], 'yield_on_market' | 'yield_on_cost'>
    const byMonth = conn
      .prepare(
        `select
          substr(date, 1, 7) as month,
          coalesce(sum(amount_krw), 0) as base_income,
          coalesce(sum(case when income_category = 'dividend' then amount_krw else 0 end), 0) as dividend_base_income,
          coalesce(sum(case when income_category = 'interest' then amount_krw else 0 end), 0) as interest_base_income,
          coalesce(sum(case when income_category not in ('dividend', 'interest') then amount_krw else 0 end), 0) as other_base_income,
          count(*) as row_count
         from dividends
         group by substr(date, 1, 7)
         order by month desc
         limit 24`
      )
      .all() as IncomeReview['byMonth']
    const byYear = conn
      .prepare(
        `select
          substr(date, 1, 4) as year,
          currency,
          coalesce(sum(native_amount), 0) as native_income,
          coalesce(sum(amount_krw), 0) as base_income,
          count(*) as row_count
         from dividends
         group by substr(date, 1, 4), currency
         order by year, currency`
      )
      .all() as IncomeReview['byYear']
    const byMarket = conn
      .prepare(
        `select market, currency, coalesce(sum(native_amount), 0) as native_income, coalesce(sum(amount_krw), 0) as base_income, count(*) as row_count
         from dividends
         group by market, currency
         order by base_income desc`
      )
      .all() as IncomeReview['byMarket']
    const byPosition = conn
      .prepare(
        `with income as (
           select market, currency, ticker, max(coalesce(name, ticker)) as name,
             coalesce(sum(native_amount), 0) as native_income,
             coalesce(sum(amount_krw), 0) as base_income,
             count(*) as row_count
           from dividends
           where ticker is not null and trim(ticker) != ''
           group by market, currency, ticker
         ),
         holding_values as (
           select market, ticker,
             sum(base_market_value) as market_value,
             sum(coalesce(base_cost, total_cost_krw)) as cost_basis
           from holdings
           group by market, ticker
         )
         select income.*,
           holding_values.market_value,
           holding_values.cost_basis,
           case when holding_values.market_value > 0 then income.base_income / holding_values.market_value * 100 else null end as trailing_yield,
           case when holding_values.cost_basis > 0 then income.base_income / holding_values.cost_basis * 100 else null end as yield_on_cost
         from income
         left join holding_values on holding_values.market = income.market and holding_values.ticker = income.ticker
         order by income.base_income desc
         limit 20`
      )
      .all() as IncomeReview['byPosition']
    const tickerless = conn
      .prepare(
        `select market, currency, name, type,
          coalesce(sum(native_amount), 0) as native_income,
          coalesce(sum(amount_krw), 0) as base_income,
          count(*) as row_count
         from dividends
         where ticker is null or trim(ticker) = ''
         group by market, currency, name, type
         order by base_income desc
         limit 20`
      )
      .all() as IncomeReview['tickerless']
    return {
      totals: {
        ...totals,
        yield_on_market: portfolioTotals.market_value > 0 ? (totals.trailing_12m_base_income / portfolioTotals.market_value) * 100 : null,
        yield_on_cost: portfolioTotals.cost_basis > 0 ? (totals.trailing_12m_base_income / portfolioTotals.cost_basis) * 100 : null,
      },
      byMonth: byMonth.reverse(),
      byYear,
      byMarket,
      byPosition,
      tickerless,
    }
  } finally {
    conn.close()
  }
}

export function getRebalanceReview(): RebalanceReview {
  const conn = db()
  try {
    const marketTargets = [
      { market: 'KR', targetPct: 50 },
      { market: 'US', targetPct: 50 },
    ]
    const positionCapPct = 15
    const totals = conn
      .prepare(
        `select
          coalesce(sum(base_market_value), 0) as base_market_value,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          count(*) as position_count
         from holdings`
      )
      .get() as RebalanceReview['totals']
    const baseSelect = reviewPositionSelect()
    const positions = conn
      .prepare(`select * from (${baseSelect}) order by coalesce(base_market_value, base_cost) desc`)
      .all() as ReviewPosition[]

    // Every ratio below — market gaps, position caps — divides by this, so it has
    // to value a position the same way the numerators do: market value where there
    // is one, cost where there is not. `sum(base_market_value)` cannot serve, as it
    // coalesces a missing price to zero: an unpriced position would count toward a
    // cap breach while adding nothing to the total it is measured against, pushing
    // every share up and tipping positions over the cap that are not over it.
    //
    // Derived from the grouped positions rather than a second query over holdings,
    // so the market totals and the position totals cannot drift apart at a ticker
    // whose lots are only partly priced.
    const positionValue = (row: ReviewPosition) => Number(row.base_market_value ?? row.base_cost ?? 0)
    const totalValue = positions.reduce((sum, row) => sum + positionValue(row), 0)
    const marketValue = (market: string) =>
      positions.reduce((sum, row) => (row.market === market ? sum + positionValue(row) : sum), 0)
    const marketGaps = marketTargets.map((target) => {
      const currentValue = marketValue(target.market)
      const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0
      const targetValue = totalValue * (target.targetPct / 100)
      const gapValue = targetValue - currentValue
      const gapPct = target.targetPct - currentPct
      return {
        market: target.market,
        currentValue,
        currentPct,
        targetPct: target.targetPct,
        targetValue,
        gapValue,
        gapPct,
        action: Math.abs(gapPct) < 2 ? 'Hold' : gapValue > 0 ? 'Add' : 'Reduce',
      } as RebalanceReview['marketGaps'][number]
    })

    const reduceCandidates = positions
      .map((row) => {
        const currentPct = totalValue > 0 ? (positionValue(row) / totalValue) * 100 : 0
        const capGapPct = currentPct - positionCapPct
        const capGapValue = totalValue * (capGapPct / 100)
        return { ...row, currentPct, capGapPct, capGapValue }
      })
      .filter((row) => row.capGapPct > 0)
      .slice(0, 10)
    const addContext = marketGaps
      .filter((row) => row.action === 'Add')
      .map((row) => ({
        market: row.market,
        gapValue: row.gapValue,
        gapPct: row.gapPct,
        candidateCount: positions.filter((position) => position.market === row.market).length,
      }))
    const watchCandidates = positions
      .filter((row) => row.base_market_value == null || row.native_market_value == null)
      .map((row) => ({ ...row, reason: 'Missing market value; refresh price data before sizing action.' }))
      .slice(0, 10)
    const taxSensitive = positions
      .filter((row) => Number(row.short_term_ratio ?? 0) >= 50 && Number(row.base_market_value ?? row.base_cost ?? 0) > 0)
      .map((row) => ({ ...row, reason: 'Short-term lot exposure is high; review lots before reducing.' }))
      .slice(0, 10)
    return {
      policy: {
        baseCurrency: 'KRW',
        marketTargets,
        positionCapPct,
      },
      totals,
      marketGaps,
      reduceCandidates,
      addContext,
      watchCandidates,
      taxSensitive,
    }
  } finally {
    conn.close()
  }
}

function tickerlessSuggestion(category: string | null | undefined) {
  if (category === 'interest') return 'Keep tickerless; category explains non-position cash interest.'
  if (category === 'stock_lending') return 'Keep tickerless or add source-specific ticker override only when position identity matters.'
  if (category === 'other') return 'Keep tickerless as other income unless the source row clearly belongs to a security.'
  return 'Review source/name and add dividendOverrides entry if this income belongs to a specific ticker.'
}

function compactRuleValue(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.replace(/\s+/g, ' ').slice(0, 80)
}

function mappingRuleSuggestion(row: {
  income_category: string
  mapping_status: string
  type: string | null
  name: string | null
  source: string | null
}) {
  const match: Record<string, string> = {}
  const type = compactRuleValue(row.type)
  const name = compactRuleValue(row.name)
  const source = compactRuleValue(row.source)
  if (type) match.typeIncludes = type
  if (!type && name) match.nameIncludes = name
  if (source && row.mapping_status.includes('tickerless')) match.sourceIncludes = source
  const category = row.income_category || 'dividend'
  const payload = {
    match,
    category,
    note: tickerlessSuggestion(category),
  }
  return JSON.stringify(payload)
}

function valuationReason(row: { market: string; ticker: string }) {
  const prices = readJson(row.market === 'KR' ? config.stockKrPricesPath : config.stockUsPricesPath)
  const tickers = new Set((prices?.prices ?? []).map((price: any) => String(price.ticker ?? '').toUpperCase()))
  if (!prices) return 'price_snapshot_missing'
  if (!tickers.has(String(row.ticker).toUpperCase())) return 'ticker_missing_from_price_snapshot'
  return 'source_missing_market_value'
}

function valuationSuggestion(reason: string) {
  if (reason === 'price_snapshot_missing') return 'Run pnpm refresh or restore the local price snapshot file.'
  if (reason === 'ticker_missing_from_price_snapshot') return 'Check ticker normalization and refresh the relevant price snapshot.'
  return 'Review source valuation fields; tax-lot-only sources may need external price enrichment.'
}

export function getDataOpsReview(): DataOpsReview {
  const operational = getOperationalHealth()
  const manualMappings = readJson(config.stockManualMappingsPath) ?? {}
  const conn = db()
  try {
    const mappingSummary = conn
      .prepare(
        `select
          coalesce(mapping_status, 'unknown') as mapping_status,
          coalesce(income_category, 'unknown') as income_category,
          count(*) as row_count,
          coalesce(sum(amount_krw), 0) as base_income
         from dividends
         group by coalesce(mapping_status, 'unknown'), coalesce(income_category, 'unknown')
         order by mapping_status, income_category`
      )
      .all() as DataOpsReview['mappingSummary']
    const tickerlessIncome = (
      conn
        .prepare(
          `select
            market,
            currency,
            brokerage,
            account,
            coalesce(income_category, 'unknown') as income_category,
            coalesce(mapping_status, 'unknown') as mapping_status,
            type,
            name,
            source,
            count(*) as row_count,
            coalesce(sum(native_amount), 0) as native_income,
            coalesce(sum(amount_krw), 0) as base_income
           from dividends
           where ticker is null or trim(ticker) = ''
           group by market, currency, brokerage, account, income_category, mapping_status, type, name, source
           order by base_income desc
           limit 50`
        )
        .all() as Omit<DataOpsReview['tickerlessIncome'][number], 'suggestion'>[]
    ).map((row) => ({
      ...row,
      suggestion: tickerlessSuggestion(row.income_category),
      suggestedRule: mappingRuleSuggestion(row),
    }))
    const missingValuationRows = conn
      .prepare(
        `select market, currency, brokerage, account, ticker, name, quantity, native_cost, base_cost
         from holdings
         where native_market_value is null or base_market_value is null
         order by coalesce(base_cost, total_cost_krw) desc
         limit 50`
      )
      .all() as Omit<DataOpsReview['missingValuation'][number], 'reason' | 'suggestion'>[]
    const missingValuation = missingValuationRows.map((row) => {
      const reason = valuationReason(row)
      return { ...row, reason, suggestion: valuationSuggestion(reason) }
    })
    const validationIssues = conn
      .prepare("select * from validation_checks where status != 'pass' order by severity, name")
      .all() as HealthCheck[]
    const mappingSuggestions = tickerlessIncome.slice(0, 20).map((row, index) => ({
      id: `${index}:${row.market}:${row.brokerage}:${row.source}:${row.name}:${row.type}`,
      market: row.market,
      brokerage: row.brokerage,
      source: row.source,
      income_category: row.income_category,
      row_count: row.row_count,
      base_income: row.base_income,
      rule: row.suggestedRule,
      note: row.suggestion,
    }))
    const valuationFixes = missingValuation.slice(0, 20).map((row) => ({
      market: row.market,
      ticker: row.ticker,
      name: row.name,
      brokerage: row.brokerage,
      reason: row.reason,
      suggestion: row.suggestion,
    }))
    const actionQueue: DataOpsReview['actionQueue'] = []
    if (validationIssues.length > 0) {
      actionQueue.push({
        priority: 'high',
        area: 'Validation',
        count: validationIssues.length,
        action: 'Fix failing ingest validation checks before acting on downstream triage.',
        href: '/health',
      })
    }
    if (operational.staleItems.length > 0) {
      actionQueue.push({
        priority: operational.summary.missing || operational.summary.drift ? 'high' : 'medium',
        area: 'Source freshness',
        count: operational.staleItems.length,
        action: 'Resolve stale, drifted, or missing inputs and rerun pnpm refresh.',
        href: '/health',
      })
    }
    if (mappingSuggestions.length > 0) {
      actionQueue.push({
        priority: 'medium',
        area: 'Manual mappings',
        count: mappingSuggestions.reduce((sum, row) => sum + Number(row.row_count ?? 0), 0),
        action: 'Review suggested read-only mapping rules and apply the useful ones to data/manual-mappings.json.',
        href: '/data-ops',
      })
    }
    if (valuationFixes.length > 0) {
      actionQueue.push({
        priority: 'low',
        area: 'Valuation',
        count: valuationFixes.length,
        action: 'Refresh price snapshots or resolve ticker normalization for missing valuation rows.',
        href: '/data-ops',
      })
    }
    return {
      manualMappings: {
        path: config.stockManualMappingsPath,
        version: typeof manualMappings.version === 'number' ? manualMappings.version : null,
        incomeRuleCount: manualMappings.incomeRules?.length ?? 0,
        overrideCount: manualMappings.dividendOverrides?.length ?? 0,
      },
      mappingSummary,
      tickerlessIncome,
      missingValuation,
      actionQueue,
      mappingSuggestions,
      valuationFixes,
      sourceIssues: operational.staleItems,
      validationIssues,
    }
  } finally {
    conn.close()
  }
}

function reconciliationStatus(row: any): ReconciliationReview['positionBreaks'][number]['status'] {
  if (!row.holding_present) return 'lot_only'
  if (!row.lot_present) return 'holding_only'
  if (Math.abs(Number(row.quantity_diff ?? 0)) > 0.0001) return 'quantity_break'
  return 'cost_break'
}

export function getReconciliationReview(): ReconciliationReview {
  const conn = db()
  try {
    const operational = getOperationalHealth()
    const validationIssues = conn.prepare("select count(*) as count from validation_checks where status != 'pass'").get() as { count: number }
    const coverage = conn
      .prepare(
        `with holding_summary as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage,
             count(distinct ticker) as holding_positions,
             count(distinct account) as holding_accounts,
             coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as holding_base_cost
           from holdings
           group by market, coalesce(brokerage, 'Unassigned')
         ),
         lot_summary as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage,
             count(distinct ticker) as lot_positions,
             count(*) as lot_rows,
             coalesce(sum(cost_basis_krw), 0) as lot_base_cost
           from tax_lots
           group by market, coalesce(brokerage, 'Unassigned')
         ),
         transaction_summary as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage, count(*) as transaction_rows
           from transactions
           group by market, coalesce(brokerage, 'Unassigned')
         ),
         dividend_summary as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage, count(*) as dividend_rows
           from dividends
           group by market, coalesce(brokerage, 'Unassigned')
         ),
         keys as (
           select market, brokerage from holding_summary
           union
           select market, brokerage from lot_summary
           union
           select market, brokerage from transaction_summary
           union
           select market, brokerage from dividend_summary
         )
         select keys.market, keys.brokerage,
           coalesce(holding_summary.holding_positions, 0) as holding_positions,
           coalesce(holding_summary.holding_accounts, 0) as holding_accounts,
           coalesce(holding_summary.holding_base_cost, 0) as holding_base_cost,
           coalesce(lot_summary.lot_positions, 0) as lot_positions,
           coalesce(lot_summary.lot_rows, 0) as lot_rows,
           coalesce(lot_summary.lot_base_cost, 0) as lot_base_cost,
           coalesce(transaction_summary.transaction_rows, 0) as transaction_rows,
           coalesce(dividend_summary.dividend_rows, 0) as dividend_rows
         from keys
         left join holding_summary on holding_summary.market = keys.market and holding_summary.brokerage = keys.brokerage
         left join lot_summary on lot_summary.market = keys.market and lot_summary.brokerage = keys.brokerage
         left join transaction_summary on transaction_summary.market = keys.market and transaction_summary.brokerage = keys.brokerage
         left join dividend_summary on dividend_summary.market = keys.market and dividend_summary.brokerage = keys.brokerage
         order by keys.market, keys.brokerage`
      )
      .all() as ReconciliationReview['coverage']

    const positionRows = conn
      .prepare(
        `with h as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage, ticker, max(name) as name,
             count(distinct account) as holding_accounts,
             coalesce(sum(quantity), 0) as holding_quantity,
             coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as holding_base_cost,
             1 as holding_present
           from holdings
           group by market, coalesce(brokerage, 'Unassigned'), ticker
         ),
         l as (
           select market, coalesce(brokerage, 'Unassigned') as brokerage, ticker, max(name) as name,
             coalesce(sum(open_quantity), 0) as lot_quantity,
             coalesce(sum(cost_basis_krw), 0) as lot_base_cost,
             1 as lot_present
           from tax_lots
           group by market, coalesce(brokerage, 'Unassigned'), ticker
         ),
         keys as (
           select market, brokerage, ticker from h
           union
           select market, brokerage, ticker from l
         )
         select keys.market, keys.brokerage, keys.ticker,
           coalesce(h.name, l.name, keys.ticker) as name,
           coalesce(h.holding_accounts, 0) as holding_accounts,
           h.holding_quantity,
           l.lot_quantity,
           case when h.holding_present = 1 and l.lot_present = 1 then h.holding_quantity - l.lot_quantity else null end as quantity_diff,
           h.holding_base_cost,
           l.lot_base_cost,
           case when h.holding_present = 1 and l.lot_present = 1 then h.holding_base_cost - l.lot_base_cost else null end as base_cost_diff,
           coalesce(h.holding_present, 0) as holding_present,
           coalesce(l.lot_present, 0) as lot_present
         from keys
         left join h on h.market = keys.market and h.brokerage = keys.brokerage and h.ticker = keys.ticker
         left join l on l.market = keys.market and l.brokerage = keys.brokerage and l.ticker = keys.ticker
         where h.holding_present is null
            or l.lot_present is null
            or abs(coalesce(h.holding_quantity, 0) - coalesce(l.lot_quantity, 0)) > 0.0001
            or abs(coalesce(h.holding_base_cost, 0) - coalesce(l.lot_base_cost, 0)) > 1000
         order by
           case when h.holding_present is null or l.lot_present is null then 0 else 1 end,
           abs(coalesce(h.holding_base_cost, 0) - coalesce(l.lot_base_cost, 0)) desc
         limit 100`
      )
      .all() as any[]
    const positionBreaks = positionRows.map((row) => ({
      market: row.market,
      brokerage: row.brokerage,
      ticker: row.ticker,
      name: row.name,
      holding_accounts: row.holding_accounts,
      holding_quantity: row.holding_quantity,
      lot_quantity: row.lot_quantity,
      quantity_diff: row.quantity_diff,
      holding_base_cost: row.holding_base_cost,
      lot_base_cost: row.lot_base_cost,
      base_cost_diff: row.base_cost_diff,
      status: reconciliationStatus(row),
    })) as ReconciliationReview['positionBreaks']

    const incomeBreaks = conn
      .prepare(
        `select market, currency, brokerage, income_category,
          count(*) as row_count,
          coalesce(sum(amount_krw), 0) as base_income
         from dividends
         where ticker is null or trim(ticker) = ''
         group by market, currency, brokerage, income_category
         order by row_count desc, base_income desc
         limit 20`
      )
      .all() as ReconciliationReview['incomeBreaks']
    const valuationBreaks = conn
      .prepare(
        `select market, currency, brokerage, ticker, name, native_cost, base_cost
         from holdings
         where native_market_value is null
         order by coalesce(base_cost, total_cost_krw) desc
         limit 30`
      )
      .all() as ReconciliationReview['valuationBreaks']
    const totals = conn
      .prepare(
        `select
          count(distinct market) as market_count,
          count(distinct coalesce(brokerage, 'Unassigned')) as brokerage_count,
          count(distinct market || ':' || ticker) as position_count
         from holdings`
      )
      .get() as Pick<ReconciliationReview['totals'], 'market_count' | 'brokerage_count' | 'position_count'>
    const lotTotals = conn.prepare("select count(distinct market || ':' || ticker) as count from tax_lots").get() as { count: number }

    const actionQueue: ReconciliationReview['actionQueue'] = []
    if (operational.staleItems.length > 0) {
      actionQueue.push({
        priority: operational.summary.missing || operational.summary.drift ? 'high' : 'medium',
        area: 'Source freshness',
        count: operational.staleItems.length,
        action: 'Resolve stale, drifted, or missing source inputs before trusting reconciliation deltas.',
        href: '/health',
      })
    }
    if (validationIssues.count > 0) {
      actionQueue.push({
        priority: 'high',
        area: 'Validation checks',
        count: validationIssues.count,
        action: 'Fix failing validation checks from the latest ingest.',
        href: '/health',
      })
    }
    if (positionBreaks.length > 0) {
      actionQueue.push({
        priority: 'medium',
        area: 'Holdings vs lots',
        count: positionBreaks.length,
        action: 'Review quantity and cost-basis differences by ticker and brokerage.',
        href: '/reconciliation',
      })
    }
    if (incomeBreaks.length > 0) {
      actionQueue.push({
        priority: 'medium',
        area: 'Ticker mapping',
        count: incomeBreaks.reduce((sum, row) => sum + Number(row.row_count ?? 0), 0),
        action: 'Map tickerless income groups through manual mapping rules.',
        href: '/data-ops',
      })
    }
    if (valuationBreaks.length > 0) {
      actionQueue.push({
        priority: 'low',
        area: 'Valuation',
        count: valuationBreaks.length,
        action: 'Refresh or map missing market valuation rows.',
        href: '/data-ops',
      })
    }

    const issueCount =
      positionBreaks.length +
      incomeBreaks.reduce((sum, row) => sum + Number(row.row_count ?? 0), 0) +
      valuationBreaks.length +
      operational.staleItems.length +
      validationIssues.count

    return {
      totals: {
        issue_count: issueCount,
        market_count: totals.market_count,
        brokerage_count: totals.brokerage_count,
        position_count: totals.position_count,
        lot_position_count: lotTotals.count,
        tickerless_income_count: incomeBreaks.reduce((sum, row) => sum + Number(row.row_count ?? 0), 0),
        missing_valuation_count: valuationBreaks.length,
        source_issue_count: operational.staleItems.length,
        validation_issue_count: validationIssues.count,
      },
      coverage,
      positionBreaks,
      incomeBreaks,
      valuationBreaks,
      actionQueue,
    }
  } finally {
    conn.close()
  }
}

export function getPositionDetail(market: string, ticker: string): PositionDetail | null {
  const conn = db()
  try {
    const holdings = conn
      .prepare(
        `select id, market, currency, brokerage, account, ticker, name, quantity, native_cost, native_market_value,
          native_unrealized_gl, native_unrealized_gl_pct, base_cost, base_market_value, base_unrealized_gl,
          total_cost_krw, long_term_qty, short_term_qty, lot_count
         from holdings
         where market = ? and ticker = ?
         order by coalesce(base_market_value, base_cost, total_cost_krw) desc, account`
      )
      .all(market, ticker) as Holding[]
    const lots = conn
      .prepare(
        `with holding_prices as (
           select market, brokerage, account, ticker,
             max(current_price) as current_price,
             max(case when quantity > 0 then native_market_value / quantity else null end) as implied_price
           from holdings
           group by market, brokerage, account, ticker
         )
         select tax_lots.id, tax_lots.market, tax_lots.currency, tax_lots.brokerage, tax_lots.account, tax_lots.ticker,
           tax_lots.name, tax_lots.acquired_date, tax_lots.open_quantity, tax_lots.native_cost_basis,
           coalesce(
             tax_lots.native_market_value,
             tax_lots.open_quantity * coalesce(holding_prices.current_price, holding_prices.implied_price)
           ) as native_market_value,
           coalesce(
             tax_lots.native_unrealized_gl,
             tax_lots.open_quantity * coalesce(holding_prices.current_price, holding_prices.implied_price) - tax_lots.native_cost_basis
           ) as native_unrealized_gl,
           tax_lots.cost_basis_krw, tax_lots.native_unit_cost, tax_lots.unit_cost, tax_lots.holding_days, tax_lots.tax_term, tax_lots.source
         from tax_lots
         left join holding_prices
           on holding_prices.market = tax_lots.market
          and coalesce(holding_prices.brokerage, '') = coalesce(tax_lots.brokerage, '')
          and holding_prices.account = tax_lots.account
          and holding_prices.ticker = tax_lots.ticker
         where tax_lots.market = ? and tax_lots.ticker = ?
         order by tax_lots.account, tax_lots.tax_term, tax_lots.acquired_date desc, tax_lots.native_cost_basis desc`
      )
      .all(market, ticker) as any[]
    const transactions = conn
      .prepare(
        `select market, currency, brokerage, date, account, type, raw_type, ticker, name, quantity, native_amount,
          native_settlement, native_unit_price, amount_krw, settlement_krw, unit_price, fee, tax, source, page
         from transactions
         where market = ? and ticker = ?
         order by date desc, id desc
         limit 500`
      )
      .all(market, ticker) as any[]
    const dividends = conn
      .prepare(
        `select market, currency, brokerage, date, account, ticker, name, native_amount, native_tax_withheld, amount_krw, type, source, page
         from dividends
         where market = ? and ticker = ?
         order by date desc, id desc
         limit 300`
      )
      .all(market, ticker) as any[]

    if (holdings.length === 0 && lots.length === 0 && transactions.length === 0 && dividends.length === 0) return null

    const totals = conn
      .prepare(
        `select
          count(distinct account) as account_count,
          count(*) as holding_count,
          coalesce(sum(quantity), 0) as quantity,
          coalesce(sum(native_cost), 0) as native_cost,
          sum(native_market_value) as native_market_value,
          sum(native_unrealized_gl) as native_unrealized_gl,
          coalesce(sum(coalesce(base_cost, total_cost_krw)), 0) as base_cost,
          sum(base_market_value) as base_market_value,
          sum(base_unrealized_gl) as base_unrealized_gl,
          coalesce(sum(long_term_qty), 0) as long_term_qty,
          coalesce(sum(short_term_qty), 0) as short_term_qty,
          coalesce(sum(lot_count), 0) as lot_count
         from holdings
         where market = ? and ticker = ?`
      )
      .get(market, ticker) as PositionDetail['totals']
    const lotTotals = conn
      .prepare(
        `select
          count(*) as lot_count,
          coalesce(sum(open_quantity), 0) as open_quantity,
          coalesce(sum(native_cost_basis), 0) as native_cost_basis,
          coalesce(sum(cost_basis_krw), 0) as cost_basis_krw,
          sum(case when tax_term = 'Long-term' then 1 else 0 end) as long_term_count,
          sum(case when tax_term = 'Short-term' then 1 else 0 end) as short_term_count
         from tax_lots
         where market = ? and ticker = ?`
      )
      .get(market, ticker) as PositionDetail['lotTotals']
    const dividendTotals = conn
      .prepare(
        `select count(*) as count, coalesce(sum(native_amount), 0) as native_amount, coalesce(sum(amount_krw), 0) as amount_krw
         from dividends
         where market = ? and ticker = ?`
      )
      .get(market, ticker) as PositionDetail['dividendTotals']
    const transactionSummary = conn
      .prepare(
        `select type, count(*) as count, sum(native_amount) as amount
         from transactions
         where market = ? and ticker = ?
         group by type
         order by count desc, type`
      )
      .all(market, ticker) as PositionDetail['transactionSummary']
    const files = conn.prepare('select * from source_files order by name').all() as any[]

    const sourceMap = new Map<string, Set<string>>()
    const canonicalSources = ['holdings', 'taxlots', 'transactions', 'dividends', 'fx_rates', market === 'KR' ? 'kr_prices' : 'us_prices']
    canonicalSources.forEach((source) => addSource(sourceMap, source, 'snapshot'))
    lots.forEach((row) => addSource(sourceMap, row.source, 'tax lots'))
    transactions.forEach((row) => addSource(sourceMap, row.source, 'transactions'))
    dividends.forEach((row) => addSource(sourceMap, row.source, 'dividends'))

    const sources = Array.from(sourceMap.entries())
      .map(([source, usages]) => ({
        source,
        usages: Array.from(usages).sort(),
        file: files.find((file) => sourceMatchesFile(source, file)) ?? null,
      }))
      .sort((a, b) => a.source.localeCompare(b.source))

    const first = holdings[0] ?? lots[0] ?? transactions[0] ?? dividends[0]
    return {
      market,
      ticker,
      name: first.name || ticker,
      currency: first.currency,
      holdings,
      lots,
      transactions,
      dividends,
      transactionSummary,
      totals,
      lotTotals,
      dividendTotals,
      sources,
    }
  } finally {
    conn.close()
  }
}

export function getTaxPlanningLots(limit = 500): TaxPlanningLot[] {
  const conn = db()
  try {
    return conn
      .prepare(
        `with holding_prices as (
           select market, brokerage, account, ticker,
             max(current_price) as current_price,
             max(case when quantity > 0 then native_market_value / quantity else null end) as implied_price
           from holdings
           group by market, brokerage, account, ticker
         ),
         enriched_lots as (
           select
             tax_lots.id,
             tax_lots.market,
             tax_lots.currency,
             tax_lots.brokerage,
             tax_lots.account,
             tax_lots.ticker,
             tax_lots.name,
             tax_lots.acquired_date,
             tax_lots.fx_rate_to_base,
             tax_lots.open_quantity,
             tax_lots.native_cost_basis,
             coalesce(
               tax_lots.native_market_value,
               tax_lots.open_quantity * coalesce(holding_prices.current_price, holding_prices.implied_price)
             ) as native_market_value,
             coalesce(
               tax_lots.native_unrealized_gl,
               tax_lots.open_quantity * coalesce(holding_prices.current_price, holding_prices.implied_price) - tax_lots.native_cost_basis
             ) as native_unrealized_gl,
             tax_lots.cost_basis_krw,
             tax_lots.holding_days,
             tax_lots.tax_term
           from tax_lots
           left join holding_prices
             on holding_prices.market = tax_lots.market
            and coalesce(holding_prices.brokerage, '') = coalesce(tax_lots.brokerage, '')
            and holding_prices.account = tax_lots.account
            and holding_prices.ticker = tax_lots.ticker
           where tax_lots.open_quantity > 0
         )
         select *
         from enriched_lots
         order by
           case when native_market_value is null then 1 else 0 end,
           coalesce(native_unrealized_gl, native_market_value - native_cost_basis, 0) asc,
           coalesce(native_market_value, native_cost_basis) desc
         limit ?`
      )
      .all(limit) as TaxPlanningLot[]
  } finally {
    conn.close()
  }
}

export function getTopHoldings(limit = 10) {
  const conn = db()
  try {
    return conn
      .prepare(
        `select id, market, currency, ticker, name, native_cost as value, base_cost
         from holdings
         order by base_cost desc, native_cost desc
         limit ?`
      )
      .all(limit) as { id: number; market: string; currency: string; ticker: string; name: string; value: number; base_cost: number }[]
  } finally {
    conn.close()
  }
}

export function getAccountAllocation() {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market, currency, account, coalesce(sum(native_cost), 0) as value, count(*) as count
         from holdings
         group by market, currency, account
         order by market, currency, value desc`
      )
      .all() as { market: string; currency: string; account: string; value: number; count: number }[]
  } finally {
    conn.close()
  }
}

export function getDividendByYear() {
  const conn = db()
  try {
    return conn
      .prepare(
        `select currency, substr(date, 1, 4) as year, coalesce(sum(native_amount), 0) as amount, count(*) as count
         from dividends
         group by currency, year
         order by currency, year`
      )
      .all() as { currency: string; year: string; amount: number; count: number }[]
  } finally {
    conn.close()
  }
}

export function getTransactionTypes() {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market, type, count(*) as count
         from transactions
         group by market, type
         order by count desc`
      )
      .all() as { market: string; type: string; count: number }[]
  } finally {
    conn.close()
  }
}

export function getRecentTransactions(limit = 30) {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market, currency, brokerage, date, account, type, ticker, name, quantity, native_amount, amount_krw, source, page
         from transactions
         order by date desc, id desc
         limit ?`
      )
      .all(limit) as any[]
  } finally {
    conn.close()
  }
}

export function getTaxLots(limit = 300) {
  const conn = db()
  try {
    return conn
      .prepare(
        `select market, currency, brokerage, account, ticker, name, acquired_date, open_quantity, native_cost_basis, cost_basis_krw,
          native_unit_cost, unit_cost, holding_days, tax_term, source
         from tax_lots
         order by market, holding_days desc, native_cost_basis desc
         limit ?`
      )
      .all(limit) as any[]
  } finally {
    conn.close()
  }
}

export function getSourceFiles() {
  const conn = db()
  try {
    return conn.prepare('select * from source_files order by name').all() as any[]
  } finally {
    conn.close()
  }
}

export function getSourceInventory(): SourceInventory {
  const conn = db()
  try {
    const meta = Object.fromEntries(conn.prepare('select key, value from meta').all().map((r: any) => [r.key, r.value])) as Record<
      string,
      string
    >
    const dataDir = meta.data_dir || config.stockDataDir
    const sourceRows = conn.prepare('select * from source_files order by name').all() as any[]
    const tracked = sourceRows.map((source) => trackedInventoryItem(dataDir, source))
    const trackedPaths = new Set(
      sourceRows.map((source) => {
        try {
          return path.resolve(source.path)
        } catch {
          return String(source.path)
        }
      })
    )
    const discovered = fs.existsSync(dataDir)
      ? walkFiles(dataDir)
          .filter((filePath) => !trackedPaths.has(path.resolve(filePath)))
          .map((filePath) => untrackedInventoryItem(dataDir, filePath))
      : []
    const items = [...tracked, ...discovered].sort((a, b) => {
      const statusScore = { missing: 0, drift: 1, unused: 2, used: 3 } as Record<SourceInventoryItem['status'], number>
      return statusScore[a.status] - statusScore[b.status] || a.relativePath.localeCompare(b.relativePath)
    })
    return {
      dataDir,
      tracked,
      untracked: discovered,
      items,
      summary: {
        used: items.filter((item) => item.status === 'used').length,
        unused: items.filter((item) => item.status === 'unused').length,
        drift: items.filter((item) => item.status === 'drift').length,
        missing: items.filter((item) => item.status === 'missing').length,
        totalBytes: items.reduce((sum, item) => sum + Number(item.bytes ?? 0), 0),
      },
    }
  } finally {
    conn.close()
  }
}

export function getRefreshRuns(limit = 10): RefreshRun[] {
  const history = readJson(config.stockRefreshRunsPath)
  if (!history || !Array.isArray(history.runs)) return []
  return history.runs.map(asRefreshRun).filter(Boolean).slice(0, limit) as RefreshRun[]
}

export function getEvidenceReports(): EvidenceReport[] {
  const conn = db()
  try {
    return conn.prepare('select * from evidence_reports order by category, name').all() as EvidenceReport[]
  } finally {
    conn.close()
  }
}

export function getValidationChecks(): HealthCheck[] {
  const conn = db()
  try {
    return conn.prepare('select * from validation_checks order by status desc, severity, name').all() as HealthCheck[]
  } finally {
    conn.close()
  }
}
