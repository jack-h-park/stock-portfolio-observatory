import type { RebalanceInput } from '@/lib/adapters/rebalance-input'
import type { TaxPolicy } from '@/lib/tax-policy'
import type { AllocationPolicy } from './allocation-policy'
import { computeAllocation } from './allocation'
import type { InstrumentClasses } from './instrument-classes'
import { computeCapExcess, harvestableLossKrw, prepareSellContext } from './sell-selection'

/**
 * One condition that warrants a proposal. `key` identifies it across runs (the debounce state is keyed on it),
 * `magnitude` is how far past the line it is (percentage points, KRW, or 1 for a date), and `label` is fixed
 * English with no amount in it.
 */
export type TriggerHit = { key: string; magnitude: number; label: string }

/** Same tolerance as the engine's band check, so a sleeve the engine leaves alone never triggers. */
const PCT_EPS = 1e-9
const YEAREND_DATES = ['11-15', '12-01'] as const

const pp = (value: number) => `${value.toFixed(1)}pp`

/**
 * Every trigger condition true today, in a fixed order: bands (sleeve order), position caps, the loss harvest,
 * then the year-end dates. Whether one is due is the debounce's call (trigger-state.ts), not this one's.
 */
export function detectTriggers(args: {
  input: RebalanceInput
  policy: AllocationPolicy
  classes: InstrumentClasses
  taxPolicy: TaxPolicy
  today: string
}): TriggerHit[] {
  const { input, policy, classes, today } = args
  const hits: TriggerHit[] = []
  const allocation = computeAllocation(input, policy, classes)

  if (allocation.totalKrw > 0) {
    for (const row of allocation.sleeves) {
      const outside = row.pct < row.lower - PCT_EPS ? row.lower - row.pct : row.pct > row.upper + PCT_EPS ? row.pct - row.upper : 0
      if (outside > 0) hits.push({ key: `band:${row.sleeve}`, magnitude: outside, label: `${row.sleeve} ${pp(outside)} outside band` })
    }
    for (const cap of computeCapExcess(allocation, policy)) {
      const excess = (cap.excessKrw / allocation.totalKrw) * 100
      hits.push({ key: `cap:${cap.market}:${cap.ticker}`, magnitude: excess, label: `${cap.market}:${cap.ticker} ${pp(excess)} over the position cap` })
    }
  }

  const threshold = policy.bounds.harvestThresholdKrw
  if (threshold > 0) {
    const loss = harvestableLossKrw(prepareSellContext({ input, policy, classes, taxPolicy: args.taxPolicy }), today)
    if (loss > 0 && loss >= threshold) hits.push({ key: 'harvest', magnitude: loss, label: 'harvestable loss at or above the threshold' })
  }

  const year = today.slice(0, 4)
  for (const monthDay of YEAREND_DATES) {
    const date = `${year}-${monthDay}`
    if (today >= date) hits.push({ key: `yearend:${date}`, magnitude: 1, label: `year-end review from ${date}` })
  }
  return hits
}

/** The kind a trigger key names: the part before the first colon. */
export function triggerKind(key: string): string {
  const at = key.indexOf(':')
  return at >= 0 ? key.slice(0, at) : key
}
