/**
 * The tax worksheet: rows, per-file account aliases, a summary and the notes file.
 *
 * Pure functions over `RealizedLotView`, so the two route handlers and the page
 * share one builder. Nothing here reads the database or decides tax treatment.
 * The stored account string never leaves this module: it is only the key that
 * assigns an alias, and the alias is per file on purpose.
 */
import { ALL_YEARS, csvCell, defaultSoldYear, type RealizedLotView } from './realized-lots'

export const TAX_EXPORT_HEADER = [
  'description',
  'date_acquired',
  'date_sold',
  'proceeds_usd',
  'cost_basis_usd',
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

function money(value: number | null): string {
  return value == null ? '' : value.toFixed(2)
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
    const cells = [
      textCell(description),
      row.acquired_date ?? '',
      row.sold_date ?? '',
      money(row.proceeds_usd),
      money(row.cost_usd),
      money(row.gain_usd),
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
  for (const row of rows) {
    if (row.superseded_by) {
      summary.superseded += 1
      continue
    }
    summary.rows += 1
    if (row.cost_usd == null || row.proceeds_usd == null || row.gain_usd == null) {
      summary.blankDollar += 1
      continue
    }
    const bucket = summary.byTerm[termOf(row.tax_term)]
    bucket.count += 1
    bucket.gain_usd += row.gain_usd
  }
  return summary
}

/** What the export does not cover: one source for the notes file and the page. */
export const NOT_COVERED_LINES: readonly string[] = [
  'This is a worksheet, not a filing. Rows marked replay are this repo\'s FIFO estimate; rows marked 1099b are the broker\'s filed figures.',
  'Wash-sale adjustments are not computed for replay rows. Adjustments are folded into the cost of 1099b rows, so the Form 8949 adjustment columns are omitted.',
  'Box codes appear only on 1099b rows. Crypto rows have no box here; 1099-DA is not parsed by this app.',
  'Korea-account lots are measured in dollars: cost at the acquisition-date rate, proceeds at the sale-date rate. This is the repo\'s reading of the IRS method, to be confirmed with the preparer.',
  'Not included: other owners\' accounts, pension wrappers, dividends and interest, FBAR, Korean-side gains and tax.',
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
