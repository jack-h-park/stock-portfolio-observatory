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
  const openBell = Number(meta?.currentTradingPeriod?.regular?.start)
  if (!Number.isFinite(lastTrade) || !Number.isFinite(bell) || !Number.isFinite(openBell)) return rows
  if (lastTrade >= bell) return rows

  // The session named by currentTradingPeriod is open — but that does NOT make
  // the last bar its bar. Before the opening bell there is no bar for today yet,
  // so the last bar is YESTERDAY, already settled, and dropping it throws away a
  // real close.
  //
  // That is not hypothetical: the first version of this checked only
  // `lastTrade < bell`, and the 2026-09-02 06:07 PT refresh — 09:07 ET, twenty
  // minutes before the open — dropped the settled 2026-09-01 close on every
  // symbol. The table then had no 09-01 row at all, which the trading review's
  // shadow check reported the same afternoon as "no settled close stored".
  //
  // So drop the last bar only when it IS the open session's bar. Bar timestamps
  // and the session start are both the opening bell, so their UTC dates agree
  // for US (13:30Z) and KR (00:00Z) alike.
  const openSessionDate = new Date(openBell * 1000).toISOString().slice(0, 10)
  if (rows[rows.length - 1].price_date !== openSessionDate) return rows
  return rows.slice(0, -1)
}

/**
 * The newest session that could possibly have a settled close, as a UTC date.
 *
 * Used to decide whether a stored price file is still current. The check it
 * replaced asked how recently the file had been WRITTEN — under 20 hours meant
 * skip — which on a six-hourly refresh skipped three runs in four and made
 * coverage depend on which run happened to fall outside the window. On
 * 2026-09-02 the one run that refetched fired pre-open and produced a file
 * ending 08-31; the next three skipped it as current, and that afternoon's
 * trading review had no 09-01 close to work from.
 *
 * Before the US close (20:00 UTC) nothing today has settled, so the answer is
 * the previous session. Weekends walk back to Friday, which is what makes a
 * Saturday run correctly decide it has nothing to do.
 */
function newestSettledSession(now = new Date()) {
  const d = new Date(now.getTime())
  if (d.getUTCHours() < 20) d.setUTCDate(d.getUTCDate() - 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export { withoutUnsettledBar, newestSettledSession }
