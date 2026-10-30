/**
 * The tax worksheet: rows, per-file account aliases, a summary and the notes file.
 *
 * Pure functions over `RealizedLotView`, so the two route handlers and the page
 * share one builder. Nothing here reads the database or decides tax treatment.
 * The stored account string never leaves this module: it is only the key that
 * assigns an alias, and the alias is per file on purpose.
 */
import { ALL_YEARS, csvCell, defaultSoldYear, formGainUsd, type RealizedLotView } from './realized-lots'

export const TAX_EXPORT_HEADER = [
  'description',
  'date_acquired',
  'date_sold',
  'proceeds_usd',
  'cost_basis_usd',
  'adjustment_usd',
  'gain_loss_usd',
  'term',
  'form_8949_box',
  'covered',
  'basis_source',
  'row_status',
  'asset_class',
  'market',
  'collectible',
  'proceeds_rate_note',
  'broker',
  'account_alias',
  'ticker',
] as const

export function selectTaxExportRows(rows: RealizedLotView[], opts: { year: string; audit: boolean }): RealizedLotView[] {
  return rows.filter((row) => {
    if (opts.year !== ALL_YEARS && row.sold_year !== opts.year) return false
    if (row.superseded_by && !opts.audit) return false
    return true
  })
}

/** `A`..`Z`, then `AA`, `AB`, ... */
function aliasLetters(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** A text cell that a spreadsheet would read as a formula gets a leading apostrophe. */
function textCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

/** Whole cents; a value that is not a finite number stays unknown. */
function cents(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const rounded = Math.round(value * 100)
  return rounded === 0 ? 0 : rounded
}

/** Integer cents as text, so no float arithmetic or `-0.00` reaches the file. */
function centsText(value: number | null): string {
  if (value == null) return ''
  const abs = Math.abs(value)
  return `${value < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * The dollar cells of one row, in integer cents, so the printed cells and the
 * totals are the same numbers. On a 1099-B row the gain is the broker's filed
 * gain and the adjustment is its difference from proceeds minus cost; a replay
 * row has no adjustment and a gain of proceeds minus cost.
 */
function figuresOf(row: RealizedLotView): { proceeds: number | null; cost: number | null; adjustment: number | null; gain: number | null } {
  const proceeds = cents(row.proceeds_usd)
  const cost = cents(row.cost_usd)
  if (proceeds == null || cost == null) return { proceeds, cost, adjustment: null, gain: null }
  const formGain = cents(formGainUsd(row))
  if (formGain == null) return { proceeds, cost, adjustment: null, gain: proceeds - cost }
  return { proceeds, cost, adjustment: formGain - (proceeds - cost), gain: formGain }
}

function quantityText(value: number | null): string {
  // Eight places covers the finest unit these venues trade; trailing zeros are noise.
  return value == null ? '' : Number(value.toFixed(8)).toString()
}

/** The ingest stores `Short-term` / `Long-term`, and `Undetermined` for a 1099-B section it cannot place. */
function termOf(value: string | null): 'short' | 'long' | 'unknown' {
  const text = (value ?? '').toLowerCase()
  if (text.startsWith('short')) return 'short'
  if (text.startsWith('long')) return 'long'
  return 'unknown'
}

/** The ingest stores `Covered` / `Noncovered`; anything else (including blank) stays blank. */
function coveredOf(value: string | null): string {
  const text = (value ?? '').toLowerCase()
  if (/non-?covered/.test(text)) return 'noncovered'
  if (text.includes('covered')) return 'covered'
  return ''
}

/** The ingest stores `Box A`; the worksheet column holds the letter. Never derived for a row without one. */
function boxOf(value: string | null): string {
  return (value ?? '').trim().replace(/^box\s+/i, '')
}

function assetClassOf(row: RealizedLotView): string {
  if (row.market === 'CRYPTO') return 'crypto'
  return row.asset_class || 'security'
}

export function taxExportCsv(rows: RealizedLotView[]): string {
  const aliases = new Map<string, string>()
  const perBroker = new Map<string, number>()
  const aliasFor = (broker: string, account: string): string => {
    const key = `${broker}\u0000${account}`
    const known = aliases.get(key)
    if (known) return known
    const next = perBroker.get(broker) ?? 0
    perBroker.set(broker, next + 1)
    const alias = `${broker} ${aliasLetters(next)}`
    aliases.set(key, alias)
    return alias
  }
  const lines: string[] = [TAX_EXPORT_HEADER.join(',')]
  for (const row of rows) {
    const broker = row.brokerage?.trim() || 'Unknown'
    const description = `${quantityText(row.quantity_sold)} ${row.ticker}`.trim()
    const figures = figuresOf(row)
    const cells = [
      textCell(description),
      row.acquired_date ?? '',
      row.sold_date ?? '',
      centsText(figures.proceeds),
      centsText(figures.cost),
      centsText(figures.adjustment),
      centsText(figures.gain),
      termOf(row.tax_term) === 'unknown' ? '' : termOf(row.tax_term),
      textCell(boxOf(row.form_8949_box)),
      coveredOf(row.covered_status),
      textCell(row.basis || ''),
      row.superseded_by ? 'superseded' : 'reported',
      textCell(assetClassOf(row)),
      textCell(row.market),
      row.collectible === true ? 'true' : 'false',
      row.rate_approximate ? 'approximate_fx' : '',
      textCell(broker),
      textCell(aliasFor(broker, row.account)),
      textCell(row.ticker),
    ]
    lines.push(cells.map(csvCell).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

export type TaxExportSummary = {
  rows: number
  blankDollar: number
  superseded: number
  /** Dollars, summed from whole cents so it equals the sum of the exported cells. */
  byTerm: Record<'short' | 'long' | 'unknown', { count: number; gain_usd: number }>
}

export function summarizeTaxExport(rows: RealizedLotView[]): TaxExportSummary {
  const summary: TaxExportSummary = {
    rows: 0,
    blankDollar: 0,
    superseded: 0,
    byTerm: {
      short: { count: 0, gain_usd: 0 },
      long: { count: 0, gain_usd: 0 },
      unknown: { count: 0, gain_usd: 0 },
    },
  }
  const totalCents = { short: 0, long: 0, unknown: 0 }
  for (const row of rows) {
    if (row.superseded_by) {
      summary.superseded += 1
      continue
    }
    summary.rows += 1
    const gain = figuresOf(row).gain
    if (gain == null) {
      summary.blankDollar += 1
      continue
    }
    const key = termOf(row.tax_term)
    totalCents[key] += gain
    summary.byTerm[key].count += 1
  }
  for (const key of ['short', 'long', 'unknown'] as const) summary.byTerm[key].gain_usd = totalCents[key] / 100
  return summary
}

/** What the export does not cover: one source for the notes file and the page. */
export const NOT_COVERED_LINES: readonly string[] = [
  'This is a worksheet, not a filing. Rows marked replay are this repo\'s FIFO estimate; rows marked 1099b are the broker\'s filed figures.',
  'On 1099b rows the gain is the broker\'s filed gain, and adjustment_usd is its difference from proceeds minus cost (wash-sale and basis adjustments); the adjustment code is not stored, so Form 8949 column f is omitted. Replay rows carry no adjustment, and wash sales are not computed for them.',
  'Box codes appear only on 1099b rows. Crypto rows have no box here; 1099-DA is not parsed by this app.',
  'Korea-account lots are measured in dollars: cost at the acquisition-date rate, proceeds at the sale-date rate. This is the repo\'s reading of the IRS method, to be confirmed with the preparer.',
  'Not included: physical gold sales are not exported yet; other owners\' accounts, pension wrappers, dividends and interest, FBAR, Korean-side gains and tax.',
  'Two accounts that carry an identical stored label cannot be told apart by the export, and share one alias.',
]

export function taxExportNotes(summary: TaxExportSummary, ctx: { year: string; builtAt: string | null; audit: boolean }): string {
  const fmt = (n: number) => n.toFixed(2)
  const lines: string[] = []
  lines.push(`Tax worksheet notes: ${ctx.year === ALL_YEARS ? 'all years' : `sales in ${ctx.year}`}${ctx.audit ? ' (audit)' : ''}`)
  lines.push('')
  lines.push(
    ctx.builtAt
      ? `Generated from the Observatory database built on ${ctx.builtAt}. Freshness is not a guarantee a statement has been downloaded; a sale a broker shows that is missing here is usually an un-ingested statement.`
      : 'Generated from the Observatory database; its build date is unknown. A sale a broker shows that is missing here is usually an un-ingested statement.'
  )
  lines.push('')
  lines.push(`Rows: ${summary.rows}`)
  lines.push(`Rows with a blank dollar figure: ${summary.blankDollar}. Blank means unknown, not zero, and the totals below cover the other rows only.`)
  if (ctx.audit) {
    lines.push(`Superseded replay rows (audit only, excluded from every total): ${summary.superseded}`)
  }
  lines.push('')
  lines.push('Gain or loss by term, over rows that have all three dollar figures (USD):')
  lines.push(`  short: ${summary.byTerm.short.count} rows, ${fmt(summary.byTerm.short.gain_usd)}`)
  lines.push(`  long: ${summary.byTerm.long.count} rows, ${fmt(summary.byTerm.long.gain_usd)}`)
  lines.push(`  unknown term: ${summary.byTerm.unknown.count} rows, ${fmt(summary.byTerm.unknown.gain_usd)}`)
  lines.push('')
  lines.push('What this export does not cover:')
  for (const line of NOT_COVERED_LINES) lines.push(`- ${line}`)
  return `${lines.join('\r\n')}\r\n`
}

export function readExportParams(params: URLSearchParams, years: string[], currentYear: string): { year: string; audit: boolean } {
  const asked = params.get('year')
  const year = asked === ALL_YEARS || (asked != null && years.includes(asked)) ? asked : defaultSoldYear(years, currentYear)
  return { year, audit: params.get('audit') === '1' }
}
