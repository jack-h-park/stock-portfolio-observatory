import { sumRealized, type RealizedLotView } from '@/lib/realized-lots'

/**
 * The Overview's "this month / this year" figures, each read from the page
 * that owns it. A figure is null when its source holds no records at all
 * (unavailable), and a number, possibly zero, when it does: no sale this year
 * is a real zero, an empty realized table is not.
 */
export type PeriodTiles = {
  /** Counted inflow (salary, dividends, interest, other) this month, display currency. */
  inflowMonth: number | null
  /** The monthly average over the last 12 months, for scale; null with no inflow records. */
  inflowMonthlyAverage: number | null
  /** The latest month with counted inflow, when it is before this month: a zero this month may only mean the records stop there. */
  inflowLastMonth: string | null
  /** Dividends and interest this year, display currency. */
  incomeYtd: number | null
  incomeTrailing12m: number | null
  /** Realized gain/loss on lots sold this year, KRW. */
  realizedYtdKrw: number | null
  realizedYtdCount: number
}

export function periodTiles(input: {
  currentMonth: string
  currentYear: string
  inflow: { periods: { period: string; total: number }[]; monthlyAverage: number; hasRecords: boolean }
  income: { rowCount: number; ytd: number; trailing12m: number }
  realized: RealizedLotView[]
}): PeriodTiles {
  const { inflow, income, realized } = input
  const thisYear = realized.filter((row) => row.sold_year === input.currentYear)
  return {
    inflowMonth: inflow.hasRecords ? inflow.periods.find((p) => p.period === input.currentMonth)?.total ?? 0 : null,
    inflowMonthlyAverage: inflow.hasRecords ? inflow.monthlyAverage : null,
    inflowLastMonth: (() => {
      const last = [...inflow.periods].reverse().find((p) => p.total > 0)?.period ?? null
      return last && last < input.currentMonth ? last : null
    })(),
    incomeYtd: income.rowCount > 0 ? income.ytd : null,
    incomeTrailing12m: income.rowCount > 0 ? income.trailing12m : null,
    realizedYtdKrw: realized.length > 0 ? sumRealized(thisYear).gain_krw : null,
    realizedYtdCount: thisYear.length,
  }
}
