/**
 * `pnpm tax:scenario` — tax on a set of US sales, from the Observatory's own engine.
 *
 * The figures come from summarizeTaxCandidates and estimateUsCapitalGainTax via
 * estimateSaleSet (lib/tax-planning.ts), with the policy the app reads. Nothing
 * here computes a tax rate. What this file adds is the sale set and its date:
 * which lots, sold when, valued at which price and which dollar/won rate.
 *
 * Currency rule: the US gain is in dollars (proceeds less the dollar basis). The
 * Korea gain is in won: proceeds at the SALE-date rate (historical_fx_rates, the
 * latest available on or before that day; for a future day, the latest there is)
 * less `acquisition_cost_krw`, the cost at the ACQUISITION-date rate. The
 * planner's single-rate shortcuts (lotsUsdKrwRate, candidateUsdKrwRate) are not
 * used for that: repriceForSaleDate builds the won gain per lot and
 * estimateSaleSet pins the conversion rate to the sale date.
 *
 * Scope: US-market dollar lots in wrappers the policy taxes in the US. Korean
 * and crypto lots are not in any sale set here.
 */
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { getTaxPlanningLots } from '@/lib/adapters/portfolio-db'
import {
  estimateSaleSet,
  harvestFrontier,
  longTermEligibleOn,
  repriceForSaleDate,
  type SaleSetEstimate,
  type TaxPlanCandidate,
  type TaxPlanningLot,
} from '@/lib/tax-planning'
import { annualProfileForYear, scenarioFromTaxYearProfile, type FilingScenario, type TaxPolicy } from '@/lib/tax-policy'
import {
  buildProvenance,
  CliError,
  dateFlag,
  hasTable,
  krw,
  provenanceLines,
  round,
  table,
  todayLosAngeles,
  UsageError,
  usd,
  type CliContext,
  type Command,
  type ParsedFlags,
} from '@/lib/cli/common'

export const SCENARIOS = ['lt-now', 'wait-lt', 'sell-all', 'harvest', 'filing-compare', 'date-shift'] as const
export type ScenarioName = (typeof SCENARIOS)[number]
type Filing = 'us-only' | 'us-kr'

const LOWEST_NOTE = 'lowest estimated tax under the stated inputs'

// ---------------------------------------------------------------------------
// Inputs

type PriceFile = { asOf: string; quotes: Record<string, number>; basename: string }

function readPriceFile(file: string): PriceFile {
  let doc: any
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new UsageError(`--prices ${file}: ${(error as Error).message}`)
  }
  if (!doc || typeof doc !== 'object' || typeof doc.asOf !== 'string' || !doc.quotes || typeof doc.quotes !== 'object') {
    throw new UsageError(`--prices ${file}: expected {"asOf": "<ISO>", "quotes": {"TICKER": <lastPriceUsd>}}`)
  }
  const quotes: Record<string, number> = {}
  for (const [ticker, price] of Object.entries(doc.quotes)) {
    const value = Number(price)
    if (!Number.isFinite(value) || value <= 0) throw new UsageError(`--prices ${file}: quote for ${ticker} is not a positive number`)
    quotes[ticker.toUpperCase()] = value
  }
  return { asOf: doc.asOf, quotes, basename: path.basename(file) }
}

type FxPoint = { rate: number; rateDate: string; latest: string; future: boolean }

/** USD/KRW for a sale on `date`: the latest rate on or before it, or the latest of all for a future day. */
export function fxLookup(conn: Database.Database) {
  if (!hasTable(conn, 'historical_fx_rates')) return () => null
  const latestRow = conn.prepare('select price_date, rate from historical_fx_rates order by price_date desc limit 1').get() as
    | { price_date: string; rate: number }
    | undefined
  const before = conn.prepare('select price_date, rate from historical_fx_rates where price_date <= ? order by price_date desc limit 1')
  return (date: string): FxPoint | null => {
    if (!latestRow) return null
    const row = (before.get(date) as { price_date: string; rate: number } | undefined) ?? null
    if (!row) return null
    return { rate: Number(row.rate), rateDate: row.price_date, latest: latestRow.price_date, future: date > latestRow.price_date }
  }
}

function scenarioForFiling(filing: Filing): FilingScenario {
  return filing === 'us-only' ? 'US_ONLY' : 'US_AND_KR'
}

function filingFromPolicy(policy: TaxPolicy, year: number): Filing {
  const scenario = scenarioFromTaxYearProfile(annualProfileForYear(policy, year))
  if (scenario === 'US_ONLY') return 'us-only'
  if (scenario === 'US_AND_KR') return 'us-kr'
  throw new CliError(`the policy's filing profile for ${year} is ${scenario}; pass --filing us-only or --filing us-kr`)
}

// ---------------------------------------------------------------------------
// Output shapes

export type SaleRow = {
  ticker: string
  account: string
  acquiredDate: string
  quantity: number | null
  basisUsd: number | null
  proceedsUsd: number | null
  gainUsd: number | null
  term: 'short' | 'long'
  becomesLongTermOn: string | null
  gainKrw: number | null
  saleDate: string
}

function saleRow(candidate: TaxPlanCandidate, saleDate: string): SaleRow {
  return {
    ticker: candidate.ticker,
    account: candidate.account,
    acquiredDate: candidate.acquired_date.slice(0, 10),
    quantity: round(candidate.open_quantity, 6),
    basisUsd: usd(candidate.native_cost_basis),
    proceedsUsd: usd(candidate.proceedsNative),
    gainUsd: usd(candidate.gainNative),
    term: candidate.holdingBucket,
    becomesLongTermOn: candidate.holdingBucket === 'short' ? longTermEligibleOn(candidate.acquired_date) : null,
    // Only the acquisition-date measure is reported; the fallback the engine uses without it is not.
    gainKrw: candidate.acquisition_cost_krw == null ? null : krw(candidate.gainKrw),
    saleDate,
  }
}

function roundEstimate(e: SaleSetEstimate) {
  return {
    federalUsd: usd(e.federalUsd),
    niitUsd: usd(e.niitUsd),
    stateUsd: usd(e.stateUsd),
    usTotalUsd: usd(e.usTotalUsd),
    krTaxKrw: krw(e.krTaxKrw),
    krCreditUsd: usd(e.krCreditUsd),
    totalUsd: usd(e.totalUsd),
  }
}

function addEstimates(a: SaleSetEstimate, b: SaleSetEstimate): SaleSetEstimate {
  return {
    federalUsd: a.federalUsd + b.federalUsd,
    niitUsd: a.niitUsd + b.niitUsd,
    stateUsd: a.stateUsd + b.stateUsd,
    usTotalUsd: a.usTotalUsd + b.usTotalUsd,
    krTaxKrw: a.krTaxKrw + b.krTaxKrw,
    krCreditUsd: a.krCreditUsd + b.krCreditUsd,
    totalUsd: a.totalUsd + b.totalUsd,
  }
}

const ZERO: SaleSetEstimate = { federalUsd: 0, niitUsd: 0, stateUsd: 0, usTotalUsd: 0, krTaxKrw: 0, krCreditUsd: 0, totalUsd: 0 }

// ---------------------------------------------------------------------------
// The scenario run

type Priced = { candidate: TaxPlanCandidate; saleDate: string }

export function runTaxScenario(flags: ParsedFlags, ctx: CliContext) {
  const scenario = String(flags.scenario ?? '') as ScenarioName
  if (!SCENARIOS.includes(scenario)) throw new UsageError(`--scenario must be one of ${SCENARIOS.join(', ')}`)
  const asOf = dateFlag(flags, 'as-of') ?? todayLosAngeles()
  const sellDate = dateFlag(flags, 'sell-date')
  if (scenario === 'date-shift' && !sellDate) throw new UsageError('--scenario date-shift needs --sell-date YYYY-MM-DD')
  if (scenario !== 'date-shift' && sellDate) throw new UsageError('--sell-date applies to --scenario date-shift only')
  const filingFlag = flags.filing == null ? null : String(flags.filing)
  if (filingFlag != null && filingFlag !== 'us-only' && filingFlag !== 'us-kr') throw new UsageError('--filing must be us-only or us-kr')
  const tickers =
    flags.tickers == null
      ? null
      : String(flags.tickers)
          .split(',')
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean)
  if (tickers && !tickers.length) throw new UsageError('--tickers needs at least one ticker')
  const priceFile = flags.prices == null ? null : readPriceFile(String(flags.prices))

  const policy = ctx.policyState.policy
  const notes: string[] = [
    'Sale set: US-market dollar lots in wrappers the policy taxes in the US. Korean and crypto lots are not included.',
    'Every lot is sold whole. A price is the stored or quoted price applied to every sale date; no price is forecast.',
  ]
  if (ctx.policyState.source === 'example') notes.push('No local tax policy: the example policy was read.')

  let lots: TaxPlanningLot[] = getTaxPlanningLots(100_000, policy).filter((lot) => lot.market === 'US' && lot.currency === 'USD')
  if (tickers) {
    const held = new Set(lots.map((lot) => lot.ticker.toUpperCase()))
    const absent = tickers.filter((t) => !held.has(t))
    if (absent.length) notes.push(`Not held in any lot: ${absent.join(', ')}.`)
    lots = lots.filter((lot) => tickers.includes(lot.ticker.toUpperCase()))
  }

  const fx = fxLookup(ctx.conn)
  const fxUsed: Record<string, string> = {}
  const rateFor = (date: string) => {
    const point = fx(date)
    if (!point) throw new CliError(`no USD/KRW rate on or before ${date} in historical_fx_rates; the won side cannot be valued`)
    fxUsed[date] = point.rateDate
    if (point.future) {
      const note = `Sale date ${date} is after the latest USD/KRW rate (${point.latest}); that latest rate is used.`
      if (!notes.includes(note)) notes.push(note)
    }
    return point.rate
  }

  const quotes = priceFile?.quotes ?? {}
  const reprice = (rows: TaxPlanningLot[], date: string) =>
    repriceForSaleDate(rows, { saleDate: date, usdKrwRate: rateFor(date), pricesUsd: quotes })

  // Lots without any price cannot be sold in a scenario; name them once.
  const unpriced = [...new Set(reprice(lots, asOf).filter((c) => c.proceedsNative == null).map((c) => c.ticker))].sort()
  if (unpriced.length) notes.push(`No price for ${unpriced.join(', ')}; those lots are left out.`)
  if (priceFile) {
    const fromDb = [...new Set(lots.filter((lot) => quotes[lot.ticker.toUpperCase()] == null).map((lot) => lot.ticker))].sort()
    if (fromDb.length) notes.push(`--prices has no quote for ${fromDb.join(', ')}; the stored price is used for those.`)
  }
  const priced = (rows: TaxPlanCandidate[]) => rows.filter((c) => c.proceedsNative != null)

  const filingFor = (year: number): Filing => (filingFlag as Filing | null) ?? filingFromPolicy(policy, year)

  /** One estimate over sales that may span tax years: each year on its own profile, then summed. */
  const estimate = (sales: Priced[], filingOverride?: Filing): SaleSetEstimate => {
    const byYear = new Map<number, Priced[]>()
    for (const sale of sales) {
      const year = Number(sale.saleDate.slice(0, 4))
      const group = byYear.get(year)
      if (group) group.push(sale)
      else byYear.set(year, [sale])
    }
    if (!byYear.size) byYear.set(Number(asOf.slice(0, 4)), [])
    let total = ZERO
    for (const [year, group] of byYear) {
      // The conversion rate for the year's tax amounts: the rate of its last sale date.
      const lastDate = group.map((s) => s.saleDate).sort().at(-1) ?? asOf
      total = addEstimates(
        total,
        estimateSaleSet({
          candidates: group.map((s) => s.candidate),
          policy,
          scenario: scenarioForFiling(filingOverride ?? filingFor(year)),
          year,
          usdKrwRate: rateFor(lastDate),
        })
      )
    }
    return total
  }

  const soldOn = (rows: TaxPlanningLot[], date: string): Priced[] =>
    priced(reprice(rows, date)).map((candidate) => ({ candidate, saleDate: date }))

  let sales: Priced[] = []
  let headline: SaleSetEstimate = ZERO
  let comparison: { label: string; estimate: SaleSetEstimate }[] = []
  let frontier: ReturnType<typeof harvestFrontier> | null = null
  let lowestFromComparison = false
  let inputSellDate: string | null = asOf
  let taxYear = Number(asOf.slice(0, 4))

  if (scenario === 'sell-all') {
    sales = soldOn(lots, asOf)
    headline = estimate(sales)
  } else if (scenario === 'lt-now') {
    sales = soldOn(lots, asOf).filter((s) => s.candidate.holdingBucket === 'long')
    headline = estimate(sales)
  } else if (scenario === 'wait-lt') {
    inputSellDate = null
    sales = lots.flatMap((lot) => {
      const eligible = longTermEligibleOn(lot.acquired_date)
      return soldOn([lot], eligible > asOf ? eligible : asOf)
    })
    headline = estimate(sales)
    const now = soldOn(
      lots.filter((lot) => sales.some((s) => s.candidate.id === lot.id)),
      asOf
    )
    comparison = [
      { label: 'wait-lt: each lot on its long-term date', estimate: headline },
      { label: `sell the same lots on ${asOf}`, estimate: estimate(now) },
    ]
    const years = [...new Set(sales.map((s) => Number(s.saleDate.slice(0, 4))))].sort()
    if (years.length > 1) {
      for (const year of years) {
        comparison.push({
          label: `wait-lt: tax year ${year} part`,
          estimate: estimate(sales.filter((s) => s.saleDate.startsWith(String(year)))),
        })
      }
      notes.push(`wait-lt sales span tax years ${years.join(', ')}; each year is estimated on its own filing profile and summed.`)
    }
    lowestFromComparison = true
  } else if (scenario === 'harvest') {
    const all = priced(reprice(lots, asOf))
    const year = taxYear
    const usdKrwRate = rateFor(asOf)
    const scenarioFor = scenarioForFiling(filingFor(year))
    const totalFor = (rows: TaxPlanCandidate[]) => estimateSaleSet({ candidates: rows, policy, scenario: scenarioFor, year, usdKrwRate }).totalUsd
    frontier = harvestFrontier({ candidates: all, estimateTotalUsd: totalFor })
    const harvested = new Set(frontier.flatMap((step) => step.lotIds))
    sales = all.filter((c) => harvested.has(c.id)).map((candidate) => ({ candidate, saleDate: asOf }))
    headline = estimate(sales)
    comparison = [
      { label: 'no sales (year-to-date inputs only)', estimate: estimate([]) },
      { label: 'harvest every loss on the frontier', estimate: headline },
    ]
    notes.push(
      'Harvest losses are dollar losses on lots priced today. Wash-sale windows are not applied here; read pnpm tax:calendar before acting.',
      'The engine nets losses against gains; the ordinary-income deduction of a net loss is not priced as a saving.'
    )
  } else if (scenario === 'filing-compare') {
    sales = soldOn(lots, asOf)
    headline = estimate(sales)
    comparison = [
      { label: 'us-only', estimate: estimate(sales, 'us-only') },
      { label: 'us-kr', estimate: estimate(sales, 'us-kr') },
    ]
    lowestFromComparison = true
  } else if (scenario === 'date-shift') {
    const shifted = sellDate as string
    inputSellDate = shifted
    taxYear = Number(shifted.slice(0, 4))
    sales = soldOn(lots, shifted)
    headline = estimate(sales)
    comparison = [
      { label: `sell on ${asOf}`, estimate: estimate(soldOn(lots, asOf)) },
      { label: `sell on ${shifted}`, estimate: headline },
    ]
    lowestFromComparison = true
  }

  let lowestEstimate: { label: string; note: string } | null = null
  if (lowestFromComparison) {
    const ranked = comparison
      .filter((item) => !item.label.includes('tax year'))
      .slice()
      .sort((a, b) => a.estimate.totalUsd - b.estimate.totalUsd)
    if (ranked.length) lowestEstimate = { label: ranked[0].label, note: LOWEST_NOTE }
  }

  const saleRows = sales
    .map((s) => saleRow(s.candidate, s.saleDate))
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.account.localeCompare(b.account) || a.acquiredDate.localeCompare(b.acquiredDate))

  const result: Record<string, unknown> & { provenance: ReturnType<typeof buildProvenance> } = {
    provenance: buildProvenance({
      conn: ctx.conn,
      policyState: ctx.policyState,
      dbPath: ctx.dbPath,
      priceSource: priceFile ? `file:${priceFile.basename}` : 'db',
      pricesAsOf: priceFile ? priceFile.asOf : undefined,
      fxExtra: { used: fxUsed },
    }),
    scenario,
    inputs: { asOf, sellDate: inputSellDate, tickers, filing: filingFlag ?? filingFor(taxYear), taxYear },
    sales: saleRows,
    estimate: roundEstimate(headline),
    comparison: comparison.map((item) => ({ label: item.label, estimate: roundEstimate(item.estimate) })),
    lowestEstimate,
    notes,
  }
  if (frontier) {
    result.frontier = frontier.map((step) => ({
      ticker: step.ticker,
      lossUsd: usd(step.lossUsd),
      taxSavedUsd: usd(step.taxSavedUsd),
      savingPerDollar: round(step.savingPerDollar, 4),
      cumulativeLossUsd: usd(step.cumulativeLossUsd),
      cumulativeSavedUsd: usd(step.cumulativeSavedUsd),
    }))
  }
  return result
}

function estimateLine(e: Record<string, number | null>) {
  return `total $${e.totalUsd} = US $${e.usTotalUsd} (federal $${e.federalUsd}, NIIT $${e.niitUsd}, state $${e.stateUsd}) + KR ₩${e.krTaxKrw} − credit $${e.krCreditUsd}`
}

function textTaxScenario(r: Record<string, any>) {
  const parts = [
    `tax:scenario ${r.scenario} — as of ${r.inputs.asOf}, filing ${r.inputs.filing}, tax year ${r.inputs.taxYear}`,
    estimateLine(r.estimate),
  ]
  if (r.lowestEstimate) parts.push(`${r.lowestEstimate.note}: ${r.lowestEstimate.label}`)
  if (r.comparison?.length) {
    parts.push('', table(['comparison', 'total USD', 'US USD', 'KR KRW', 'credit USD'], r.comparison.map((c: any) => [c.label, c.estimate.totalUsd, c.estimate.usTotalUsd, c.estimate.krTaxKrw, c.estimate.krCreditUsd])))
  }
  if (r.frontier?.length) {
    parts.push('', table(['ticker', 'loss USD', 'saved USD', 'per $', 'cum loss', 'cum saved'], r.frontier.map((f: any) => [f.ticker, f.lossUsd, f.taxSavedUsd, f.savingPerDollar, f.cumulativeLossUsd, f.cumulativeSavedUsd])))
  }
  parts.push(
    '',
    table(
      ['ticker', 'account', 'acquired', 'sold', 'qty', 'basis USD', 'proceeds USD', 'gain USD', 'term', 'LT on', 'gain KRW'],
      r.sales.map((s: SaleRow) => [s.ticker, s.account, s.acquiredDate, s.saleDate, s.quantity, s.basisUsd, s.proceedsUsd, s.gainUsd, s.term, s.becomesLongTermOn, s.gainKrw])
    )
  )
  if (r.notes?.length) parts.push('', ...r.notes.map((n: string) => `note: ${n}`))
  parts.push('', provenanceLines(r.provenance))
  return parts.join('\n')
}

export const taxScenarioCommand: Command = {
  name: 'tax:scenario',
  usage:
    'pnpm tax:scenario --scenario lt-now|wait-lt|sell-all|harvest|filing-compare|date-shift [--as-of YYYY-MM-DD] [--sell-date YYYY-MM-DD] [--tickers A,B] [--filing us-only|us-kr] [--prices file.json] [--json]',
  flags: { scenario: 'string', 'as-of': 'string', 'sell-date': 'string', tickers: 'string', filing: 'string', prices: 'string' },
  run: runTaxScenario as Command['run'],
  text: textTaxScenario,
}
