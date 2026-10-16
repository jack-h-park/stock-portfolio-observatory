#!/usr/bin/env bash
# rebalance-monthly-cron.sh — Hermes cron `--no-agent --script` entrypoint.
#
# Scheduled `30 9 1-7 * 1`. Cron ORs day-of-month and day-of-week when both are
# restricted, so that expression fires on every day 1-7 AND every Monday. The guard
# below narrows it to the intended run, the first Monday of the month; on every
# other firing the wrapper exits 0 without a word. REBALANCE_FORCE_MONTHLY=1 skips
# the guard for a manual run.
#
# Runs `pnpm rebalance:propose --kind monthly` (the one job that asks the LLM) and
# prints one line: the proposal was created, or another proposal is still open.
# Not configured, or a crash, prints one line and exits 1. Then it runs the notify
# flow, so the new proposal is announced and its Discord thread opened in the same run.
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

rb_lock
rb_enter_repo "Monthly rebalance"

rb_cli rebalance:propose --kind monthly
if ! rb_is_json "$RB_JSON"; then
  echo "⚠️ Monthly rebalance could not run (exit $RB_RC) — run: pnpm rebalance:propose --kind monthly"
  exit 1
fi
if [ "$(rb_get "$RB_JSON" ok)" = "true" ]; then
  ID="$(rb_get "$RB_JSON" id)"
  LLM="$(rb_get "$RB_JSON" llm.status)"
  echo "🗓️ Monthly rebalance: proposal $ID created — decision $(rb_get "$RB_JSON" decision), $(rb_get "$RB_JSON" instructions) instructions, LLM ${LLM:-none}."
else
  REASON="$(rb_get "$RB_JSON" reason)"
  case "$REASON" in
    open_proposal_exists)
      echo "🗓️ Monthly rebalance skipped: proposal $(rb_get "$RB_JSON" openId) is still open."
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
