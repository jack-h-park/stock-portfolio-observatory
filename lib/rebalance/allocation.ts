import { accountKey, defaultAccountRule, SLEEVES, type AllocationPolicy, type Sleeve } from './allocation-policy'
import { classify, type InstrumentClasses } from './instrument-classes'

export type RebalancePosition = {
  brokerage: string | null
  account: string
  market: string
  currency: string
  ticker: string
  name: string
  asset_class: string
  quantity: number
  valueKrw: number | null
  costKrw: number
  dataAsOf: string | null
}
export type RebalanceCash = {
  brokerage: string | null
  account: string
  currency: string
  balance: number
  krw: number | null
  asOf: string
}
export type SleeveRow = {
  sleeve: Sleeve
  valueKrw: number
  /** Percent of totalKrw, 0-100. */
  pct: number
  target: number
  band: number
  lower: number
  upper: number
  status: 'below' | 'within' | 'above'
}
export type Allocation = {
  totalKrw: number
  sleeves: SleeveRow[]
  unclassified: RebalancePosition[]
  unpriced: RebalancePosition[]
  positionsBySleeve: Record<Sleeve, RebalancePosition[]>
}

export function computeAllocation(
  input: { positions: RebalancePosition[]; cash: RebalanceCash[] },
  policy: AllocationPolicy,
  classes: InstrumentClasses,
): Allocation {
  const values = Object.fromEntries(SLEEVES.map((s) => [s, 0])) as Record<Sleeve, number>
  const positionsBySleeve = Object.fromEntries(SLEEVES.map((s) => [s, [] as RebalancePosition[]])) as Record<
    Sleeve,
    RebalancePosition[]
  >
  const unclassified: RebalancePosition[] = []
  const unpriced: RebalancePosition[] = []

  for (const position of input.positions) {
    const sleeve = classify(position, classes)
    if (!sleeve) {
      unclassified.push(position)
      continue
    }
    if (position.valueKrw == null) unpriced.push(position)
    values[sleeve] += position.valueKrw ?? position.costKrw
    positionsBySleeve[sleeve].push(position)
  }

  for (const row of input.cash) {
    if (row.krw == null) continue
    const rule = policy.accounts[accountKey(row.brokerage, row.account)] ?? defaultAccountRule('')
    if (rule.excludedCash) continue
    values.cash += row.krw
  }

  const totalKrw = SLEEVES.reduce((sum, s) => sum + values[s], 0)
  const sleeves = SLEEVES.map((sleeve): SleeveRow => {
    const { target, band } = policy.targets[sleeve]
    const pct = totalKrw > 0 ? (values[sleeve] / totalKrw) * 100 : 0
    const lower = target - band
    const upper = target + band
    const status = pct < lower ? 'below' : pct > upper ? 'above' : 'within'
    return { sleeve, valueKrw: values[sleeve], pct, target, band, lower, upper, status }
  })
  return { totalKrw, sleeves, unclassified, unpriced, positionsBySleeve }
}
