// toss-orders.mjs — what counts as a fill in a Toss order, for the fetch log.
//
// Kept out of fetch-toss.mjs because that script calls the API at import time,
// so nothing in it can be tested without credentials.
//
// The rule is the ingest's (see the Toss orders bridge in ingest-stock-data.mjs):
// shares moved if any filled, whatever the order's final status. The status
// says how the order ENDED — a limit sell for 196 shares that filled 61 at the
// close and had the rest rejected reads REJECTED — so filtering on
// `status === 'FILLED'` drops a fill the books contain.

/** Shares the order actually moved; 0 when none did. */
export function filledShares(order) {
  const quantity = Number(String(order?.execution?.filledQuantity ?? '').replace(/,/g, ''))
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
}

/**
 * How many orders moved shares, how many of those ended in another status than
 * FILLED, and the first and last day shares moved.
 */
export function summarizeFills(orders) {
  const fills = orders.filter((o) => filledShares(o) > 0)
  const dates = fills
    .map((o) => String(o.execution?.filledAt || o.orderedAt || '').slice(0, 10))
    .filter(Boolean)
    .sort()
  return {
    filled: fills.length,
    partial: fills.filter((o) => o.status !== 'FILLED').length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  }
}
