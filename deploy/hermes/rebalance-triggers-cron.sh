#!/usr/bin/env bash
# rebalance-triggers-cron.sh — Hermes cron `--no-agent --script` entrypoint, daily 10:15.
#
# Runs `pnpm rebalance:triggers` (band, position cap, loss harvest and year-end
# triggers, debounced; engine only, never an LLM) and prints at most one line:
# a trigger proposal was created, triggers were added to the open proposal, or the
# run was held because the portfolio data has health errors. Nothing due, or a
# refresh in progress, is silence. Then it runs the notify flow, so a new proposal
# is announced and its Discord thread opened in the same run.
#
# Exit 1 only when the triggers command could not run (not configured, crashed).
# The Telegram text carries the proposal id and counts, never tickers or amounts.
#
# Installed into ~/.hermes/profiles/trader/scripts/ by deploy/hermes/install-cron.sh,
# together with rebalance-lib.sh, which it sources.

set -uo pipefail
# shellcheck source=rebalance-lib.sh
. "$(dirname "$0")/rebalance-lib.sh" || { echo "⚠️ Rebalance triggers: rebalance-lib.sh not found beside $0"; exit 1; }

rb_lock
rb_enter_repo "Rebalance triggers"

rb_cli rebalance:triggers
if ! rb_is_json "$RB_JSON"; then
  echo "⚠️ Rebalance triggers could not run (exit $RB_RC) — run: pnpm rebalance:triggers"
  exit 1
fi
if [ "$(rb_get "$RB_JSON" ok)" != "true" ]; then
  REASON="$(rb_get "$RB_JSON" reason)"
  case "$REASON" in
    not_configured) echo "⚠️ Rebalance triggers could not run: not configured (no allocation policy). See docs/rebalancing.md." ;;
    *) echo "⚠️ Rebalance triggers could not run: ${REASON:-unknown} — run: pnpm rebalance:triggers" ;;
  esac
  exit 1
fi

DUE="$(rb_len "$RB_JSON" due)"
CREATED="$(rb_get "$RB_JSON" created)"
APPENDED="$(rb_get "$RB_JSON" appendedTo)"
if [ -n "$CREATED" ]; then
  echo "🔔 Rebalance triggers: proposal $CREATED created from $DUE trigger(s); review on /rebalance/proposals/$CREATED"
elif [ -n "$APPENDED" ]; then
  echo "🔔 Rebalance triggers: $DUE trigger(s) added to open proposal $APPENDED."
elif [ "$(rb_get "$RB_JSON" blocked)" = "health_errors" ]; then
  echo "⚠️ Rebalance triggers held: the portfolio data has failing error checks, so no proposal was created. Details: /health"
fi

rb_notify_flow || exit 1
exit 0
