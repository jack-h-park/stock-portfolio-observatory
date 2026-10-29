/**
 * Closed lots, in won and in dollars.
 *
 * `realized_lots` carries the won figures the rest of the app shows. A US
 * filing needs the dollar ones, and the table holds only half of them: the
 * dollar cost (`acquisition_cost_usd`, already measured at the acquisition-date
 * rate) is stored, the dollar proceeds are not. They are derived here, from the
 * proceeds at the USD/KRW rate of the sale date, for a lot priced in won; a lot
 * priced in dollars already has them in `native_proceeds`.
 *
 * Nothing here decides tax treatment. It does not assign a Form 8949 box, which
 * depends on whether the broker issued a 1099-DA or 1099-B, a fact this app does
 * not hold for every venue.
 */
export type RealizedLotRow = {
  market: string
  currency: string
  brokerage: string | null
  account: string
  ticker: string
  name: string | null
  acquired_date: string | null
  sold_date: string | null
  quantity_sold: number | null
  cost_basis_krw: number | null
  proceeds_krw: number | null
  realized_gl_krw: number | null
  acquisition_cost_usd: number | null
  native_proceeds: number | null
  holding_days: number | null
  tax_term: string | null
  basis: string | null
  asset_class: string | null
  form_8949_box: string | null
  covered_status: string | null
  superseded_by: string | null
}

export type UsdRate = { rate: number; date: string }

export type RealizedLotView = RealizedLotRow & {
  sold_year: string
  cost_usd: number | null
  proceeds_usd: number | null
  gain_usd: number | null
  /** The rate used for the proceeds was not the sale date's own. */
  rate_approximate: boolean
}

/** The sentinel for "every year": a real value, so it can sit in the URL beside the years. */
export const ALL_YEARS = 'all-years'

/** The latest rate on or before `date`; `rates` must be sorted by date ascending. */
export function rateOnOrBefore(rates: { price_date: string; rate: number }[], date: string): UsdRate | null {
  let found: UsdRate | null = null
  for (const row of rates) {
    if (row.price_date > date) break
    found = { rate: row.rate, date: row.price_date }
  }
  return found
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function toRealizedView(row: RealizedLotRow, rateAt: (date: string) => UsdRate | null): RealizedLotView {
  const soldYear = (row.sold_date ?? '').slice(0, 4)
  const cost = finite(row.acquisition_cost_usd)
  let proceeds: number | null = null
  let approximate = false
  if (row.currency === 'USD') {
    proceeds = finite(row.native_proceeds)
  } else if (row.sold_date && finite(row.proceeds_krw) != null) {
    const fx = rateAt(row.sold_date)
    if (fx && fx.rate > 0) {
      proceeds = (row.proceeds_krw as number) / fx.rate
      approximate = fx.date !== row.sold_date
    }
  }
  return {
    ...row,
    sold_year: soldYear,
    cost_usd: cost,
    proceeds_usd: proceeds,
    gain_usd: cost != null && proceeds != null ? proceeds - cost : null,
    rate_approximate: approximate,
  }
}

export type RealizedTotals = {
  count: number
  cost_krw: number
  proceeds_krw: number
  gain_krw: number
  cost_usd: number
  proceeds_usd: number
  gain_usd: number
  /** Rows left out of the dollar sums because a dollar figure was missing. */
  missing_usd: number
}

export function sumRealized(rows: RealizedLotView[]): RealizedTotals {
  const totals: RealizedTotals = {
    count: rows.length,
    cost_krw: 0,
    proceeds_krw: 0,
    gain_krw: 0,
    cost_usd: 0,
    proceeds_usd: 0,
    gain_usd: 0,
    missing_usd: 0,
  }
  for (const row of rows) {
    totals.cost_krw += row.cost_basis_krw ?? 0
    totals.proceeds_krw += row.proceeds_krw ?? 0
    totals.gain_krw += row.realized_gl_krw ?? 0
    if (row.cost_usd == null || row.proceeds_usd == null || row.gain_usd == null) {
      totals.missing_usd += 1
      continue
    }
    totals.cost_usd += row.cost_usd
    totals.proceeds_usd += row.proceeds_usd
    totals.gain_usd += row.gain_usd
  }
  return totals
}

/**
 * The year to open on: this year's sales, or the latest year that has any.
 * A year with nothing in it is an empty page, which reads as "no data" rather
 * than "nothing sold yet".
 */
export function defaultSoldYear(years: string[], currentYear: string): string {
  if (years.includes(currentYear)) return currentYear
  const latest = [...years].sort().at(-1)
  return latest ?? ALL_YEARS
}

function csvCell(value: string | number | null): string {
  if (value == null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function round(value: number | null, digits: number): string {
  return value == null ? '' : value.toFixed(digits)
}

export const FORM_8949_HEADER = [
  'Description of property',
  'Date acquired',
  'Date sold',
  'Proceeds (USD)',
  'Cost basis (USD)',
  'Gain or loss (USD)',
  'Term',
] as const

/**
 * Rows in the order Form 8949 asks for them. It is a worksheet, not a filing:
 * the box column is absent on purpose, and a lot with no dollar figure keeps its
 * row with the amounts blank so the gap is visible instead of silently dropped.
 */
export function form8949Csv(rows: RealizedLotView[]): string {
  const lines: string[] = [FORM_8949_HEADER.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(
      [
        `${trimQuantity(row.quantity_sold)} ${row.ticker}`.trim(),
        row.acquired_date ?? '',
        row.sold_date ?? '',
        round(row.proceeds_usd, 2),
        round(row.cost_usd, 2),
        round(row.gain_usd, 2),
        row.tax_term ?? '',
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return `${lines.join('\r\n')}\r\n`
}

function trimQuantity(value: number | null): string {
  if (value == null) return ''
  // Eight places covers the finest unit these venues trade; trailing zeros are noise.
  return Number(value.toFixed(8)).toString()
}
