#!/usr/bin/env bash
# rebalance-monthly-cron.sh — Hermes cron `--no-agent --script` entrypoint.
#
# Scheduled `30 9 1-7 * 1`. Cron ORs day-of-month and day-of-week when both are
# restricted, so that expression fires on every day 1-7 AND every Monday. The guard
# below narrows it to the intended run, the first Monday of the month; on every
# other firing the wrapper exits 0 without a word. REBALANCE_FORCE_MONTHLY=1 skips
# the guard for a manual run.
#
# Runs `pnpm rebalance:propose --kind monthly` (the one job that asks the LLM). Its
# own lines: another proposal is still open, or the run was held by health errors
# (exit 0); not configured, or a crash, prints one line and exits 1. Then it runs the
# notify flow, which announces a created proposal and opens its Discord thread.
#
# It waits up to 10 minutes for the shared lock (rebalance-notify fires at the same
# minute); still held, it prints one line and exits 1.
#
# Installed into ~/.hermes/profiles/trader/scripts/ by deploy/hermes/install-cron.sh,
# together with rebalance-lib.sh, which it sources.

set -uo pipefail

DOW="${REBALANCE_TODAY_DOW:-$(date +%u)}"
DOM="${REBALANCE_TODAY_DOM:-$(date +%d)}"
if [ "${REBALANCE_FORCE_MONTHLY:-}" != "1" ]; then
  # 10# so "08" and "09" are not read as octal.
  { [ "$DOW" = 1 ] && [ "$((10#$DOM))" -le 7 ]; } || exit 0
fi

# shellcheck source=rebalance-lib.sh
. "$(dirname "$0")/rebalance-lib.sh" || { echo "⚠️ Monthly rebalance: rebalance-lib.sh not found beside $0"; exit 1; }

rb_enter_repo "Monthly rebalance"
# rebalance-notify fires at the same 09:30: wait for it rather than lose the month.
rb_lock wait monthly

# Seed the notify state first. Its first-ever run marks everything that exists as
# already announced; seeding after the proposal would swallow its announcement.
rb_cli rebalance:notify

rb_cli rebalance:propose --kind monthly
if ! rb_is_json "$RB_JSON"; then
  echo "⚠️ Monthly rebalance could not run (exit $RB_RC) — run: pnpm rebalance:propose --kind monthly"
  exit 1
fi
# Created: no line here. The notify flow below prints the proposal's `created` event
# (and an `llm_failed` one when the LLM step failed).
if [ "$(rb_get "$RB_JSON" ok)" != "true" ]; then
  REASON="$(rb_get "$RB_JSON" reason)"
  case "$REASON" in
    open_proposal_exists)
      echo "🗓️ Monthly rebalance skipped: proposal $(rb_get "$RB_JSON" openId) is still open."
      ;;
    health_errors)
      echo "⚠️ Monthly rebalance held: the portfolio data has failing error checks, so no proposal was created. Details: /health. Once fixed, re-run with REBALANCE_FORCE_MONTHLY=1 rebalance-monthly-cron.sh"
      ;;
    not_configured)
      echo "⚠️ Monthly rebalance could not run: not configured (no allocation policy). See docs/rebalancing.md."
      exit 1
      ;;
    *)
      echo "⚠️ Monthly rebalance could not run: ${REASON:-unknown} — run: pnpm rebalance:propose --kind monthly"
      exit 1
      ;;
  esac
fi

rb_notify_flow || exit 1
exit 0
