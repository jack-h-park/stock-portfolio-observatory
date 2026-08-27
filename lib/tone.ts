/**
 * Meaning → tone, in one place.
 *
 * Every page used to answer this question for itself. `marketTone` was the
 * exception that proved the rule: before it existed, 27 call sites spelled the
 * market colour as `market === 'US' ? 'info' : 'success'`, so the moment a
 * third market appeared it was drawn in Korea's green. The same shape had
 * spread again — nine inline `value >= 0 ? 'success' : 'danger'` ternaries,
 * four copies of the long/short bucket rule, seven page-local `*Tone`
 * functions (two of them byte-identical), and six local `Record<_, Tone>`
 * maps. They are collected here so a status can only mean one colour.
 */
import type { Tone } from '@/components/ui'

export type { Tone }

/**
 * Badge tone for a market code.
 *
 * Moved here from components/ui.tsx, which re-exports it so existing imports
 * keep working.
 */
export function marketTone(market: string): Tone {
  if (market === 'US') return 'info'
  if (market === 'KR') return 'success'
  return 'warning'
}

/**
 * Gain or loss. Zero counts as a gain, matching every call site this replaces.
 *
 * Colour alone is not a sufficient signal — see `<Signed>` in components/ui,
 * which pairs this with an explicit + or − so the two directions are still
 * distinguishable without colour vision.
 */
export function signTone(value: number | null | undefined): Tone {
  return Number(value ?? 0) >= 0 ? 'success' : 'danger'
}

/**
 * The text colour for a gain or loss, where a full `<Signed>` does not fit —
 * a chart caption, a delta inside a sentence.
 */
export function signClass(value: number | null | undefined) {
  return signTone(value) === 'success' ? 'text-success' : 'text-danger'
}

/** A tax lot's holding period: long-term is the outcome worth having. */
export function bucketTone(bucket: string | null | undefined): Tone {
  return bucket === 'long' ? 'success' : 'warning'
}

/**
 * Whether a holding's cost basis can be relied on.
 *
 * Lived in PortfolioTables beside its label map; the labels stay with the page
 * that words them, the colour comes here with the other meaning-to-tone rules.
 */
export const COST_BASIS_STATUS_TONE: Record<string, Tone> = {
  ready: 'success',
  missing_cost: 'danger',
  estimated: 'warning',
  unpriced: 'neutral',
}

/**
 * Triage priority.
 *
 * Anything that is not high or medium reads as informational, not as a muted
 * afterthought — this keeps the two identical page-local copies' behaviour,
 * including their `info` fallback. Changing that is a design decision, not a
 * consolidation one.
 */
export function priorityTone(priority: string | null | undefined): Tone {
  if (priority === 'high') return 'danger'
  if (priority === 'medium') return 'warning'
  return 'info'
}

// Freshness, run status and the per-account coverage rules still live with the
// pages that own them. They move here in P2, when those pages are rebuilt —
// hoisting them now would add exports with no callers, which is what P0 spent
// its time deleting.
