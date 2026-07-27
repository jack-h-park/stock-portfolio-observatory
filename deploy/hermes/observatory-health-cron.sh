#!/usr/bin/env bash
# observatory-health-cron.sh — Hermes cron `--no-agent --script` entrypoint.
#
# Hermes delivers this script's STDOUT verbatim to Telegram, so stdout is the alert
# channel and silence is the success state.
#
# The refresh itself moved to launchd, which records an exit code and tells nobody.
# This is the half that speaks: it reads the summary the refresh publishes and
# reports only when the situation changes. The two are deliberately separate — a
# checker that also did the work could not report on a run that never started.
#
# WHAT IT CATCHES that watching the job would not: the refresh stopping. A dead
# scheduler leaves the last summary in place saying "success, 0 issues", and every
# consumer keeps repeating figures from days ago. Only the document's age reveals
# it, so age is checked first.
#
# Installed into ~/.hermes/profiles/trader/scripts/ by deploy/hermes/install-cron.sh.

set -uo pipefail

REPO="${OBSERVATORY_REPO:-$HOME/workspace/code/core/jackhpark-stock-observatory}"

# Hermes cron runs with a minimal PATH and does not source a login shell; node
# lives in the user prefix on this host.
for _d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
  [ -d "$_d" ] && case ":$PATH:" in *":$_d:"*) ;; *) PATH="$_d:$PATH";; esac
done
export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
unset _d

CHECK="$REPO/scripts/summary-health.mjs"
if [ ! -f "$CHECK" ]; then
  echo "⚠️ Observatory health: checker not found at $CHECK"
  exit 0
fi

# cd into the repo so the checker picks up .env.local — that is where
# STOCK_BRIEFING_SUMMARY_PATH is set, and its default would otherwise be guessed.
cd "$REPO" || { echo "⚠️ Observatory health: cannot cd to $REPO"; exit 0; }

# Everything the checker wants to say goes to stdout; it prints nothing when the
# state is unchanged. Its stderr is not forwarded — a transient read error should
# not become a Telegram message.
node "$CHECK" 2>/dev/null

exit 0
