/**
 * Wording for the daily-briefing session panels.
 *
 * Extracted from the page so it can be exercised directly. The briefing repo
 * settled these sentences after getting them wrong in a way that mattered, and
 * a page component that only reads right under review is not evidence.
 */

import type { BriefingActivity, BriefingSessionMove } from '@/lib/adapters/briefing-archive'

const TRADE_VERB: Record<string, string> = { bought: 'Bought', sold: 'Sold', opened: 'Opened', closed: 'Closed' }

function shares(quantity: number, fmt: (n: number, digits: number) => string) {
  const n = Math.abs(quantity)
  return `${fmt(n, 4)} share${n === 1 ? '' : 's'}`
}

/**
 * What a row in "Activity since <date>" says.
 *
 * A `split` is NOT a trade. The briefing flags a share count that moved while
 * total cost stood still — a split, a bonus issue, or the sheet correcting
 * itself — and giving it a trade verb would put "Split 3 shares" exactly where
 * "Bought 3 shares" used to be: the same claim about the reader's own behaviour,
 * reworded. So it states what is known and what it implies, and names the ratio
 * only when the briefing recognised one.
 */
export function activityWording(
  a: BriefingActivity,
  fmt: (n: number, digits: number) => string,
): string {
  if (a.kind === 'split') {
    const named = a.ratioLabel ? ` ${a.ratioLabel}` : ''
    return `Share count restated${named} · now holding ${fmt(a.quantity, 4)} · cost basis unchanged, so this is not a purchase or sale.`
  }
  const verb = TRADE_VERB[a.kind] ?? a.kind
  const holding = a.kind === 'closed' ? '' : ` · now holding ${fmt(a.quantity, 4)}`
  return `${verb} ${shares(a.quantityChange, fmt)}${holding}`
}

/** Badge text. `split` reads as "restated"; a raw `split` is trade vocabulary. */
export function activityBadge(a: BriefingActivity): string {
  return a.kind === 'split' ? 'restated' : a.kind
}

/**
 * The paragraph beside a session mover.
 *
 * A move the briefing flagged as possibly a corporate action takes the caveat
 * INSTEAD of the researched note. That note was written to explain a fall; if
 * the fall may not have happened, explaining it is the wrong thing to show.
 */
export function moverNote(m: BriefingSessionMove, notes: Record<string, { why: string }>): string {
  if (m.suspectedRestatement) {
    return `A ${m.suspectedRestatement} split moves the price by exactly this factor, and the share count here has not changed. If that is what happened the loss is not real and the sheet needs the new count — the figure is left in the session total until it can be told apart from a fall.`
  }
  return notes[m.ticker]?.why ?? 'No researched note for this session move.'
}
