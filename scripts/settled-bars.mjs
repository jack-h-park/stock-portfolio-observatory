// Which Yahoo bars represent a finished session.
//
// Its own module because fetch-historical-prices.mjs does its work at import
// time — it will happily decide "prices are current, skipping refetch" and exit
// before a test importing it has asserted anything. A test that passes because
// the module short-circuited is not a test, and the first draft of this one
// passed exactly that way with the rule deleted.

/**
 * Drop the bar for a session that has not closed yet.
 *
 * Yahoo returns a bar for the session in progress, carrying the last trade as
 * its `close`. Stored as-is that becomes "the day's close" in a table nothing
 * downstream re-checks, and it will move again before the bell.
 *
 * 2026-08-28 is the case that cost a whole session: the Friday briefing stored
 * MSFT at 509.71 under price_date 2026-08-28 while the day settled at 513.53.
 * Monday's document then read the same 2026-08-28 label on the prior day's
 * document, concluded prices had not advanced, and published "no new close
 * since the last briefing" — so Friday was never reported at all, on a book that
 * had moved $5,661.
 *
 * `meta` answers this directly: `regularMarketTime` is the last trade and
 * `currentTradingPeriod.regular.end` is the bell, so a last trade before the
 * bell means the session is still open. Only the final bar can be the one in
 * progress, so only it is ever dropped.
 *
 * When meta cannot answer — a shape change, a symbol Yahoo reports differently —
 * the bar is KEPT. Dropping on uncertainty would stop price updates silently,
 * trading a visible wrong number for an invisible missing one, and this table is
 * the input to both the briefing and the trading review's exit maths.
 */
function withoutUnsettledBar(rows, meta) {
  if (rows.length === 0) return rows
  const lastTrade = Number(meta?.regularMarketTime)
  const bell = Number(meta?.currentTradingPeriod?.regular?.end)
  if (!Number.isFinite(lastTrade) || !Number.isFinite(bell)) return rows
  if (lastTrade >= bell) return rows
  return rows.slice(0, -1)
}

export { withoutUnsettledBar }
