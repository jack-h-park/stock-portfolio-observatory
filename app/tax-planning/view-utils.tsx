import type { MultiYearTaxScenario } from '@/lib/tax-planning'

export function sameKrw(a: number | null | undefined, b: number | null | undefined) {
  return Math.round(Number(a ?? 0)) === Math.round(Number(b ?? 0))
}

export function marketAmount(row: MultiYearTaxScenario['years'][number], market: string) {
  return row.markets.find((item) => item.market === market)?.proceedsKrw ?? 0
}
