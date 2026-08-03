import { fmtKrw, fmtNumber } from '@/lib/format'
import type { MultiYearTaxScenario } from '@/lib/tax-planning'

export function signedKrw(value: number | null | undefined) {
  if (value == null) return 'n/a'
  return <span className={value >= 0 ? 'text-success' : 'text-danger'}>{fmtKrw(value)}</span>
}

export function pct(value: number | null | undefined) {
  return value == null ? 'n/a' : `${fmtNumber(value, 2)}%`
}

export function sameKrw(a: number | null | undefined, b: number | null | undefined) {
  return Math.round(Number(a ?? 0)) === Math.round(Number(b ?? 0))
}

export function marketAmount(row: MultiYearTaxScenario['years'][number], market: string) {
  return row.markets.find((item) => item.market === market)?.proceedsKrw ?? 0
}
