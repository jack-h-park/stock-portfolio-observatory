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
# Each directory is put in FRONT of PATH, so the LAST one listed wins. The app
# toolchain directory is last on purpose: where it exists it holds the node the
# app is built and tested against together with its pnpm, and it has to beat any
# other node that happens to sit in the user prefix (a newer runtime installed
# for another tool would otherwise be picked, and native modules built for the
# app's node refuse to load under it). Where the directory does not exist it is a
# no-op.
for _d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/.local/app-toolchain/bin"; do
  [ -d "$_d" ] && case ":$PATH:" in *":$_d:"*) ;; *) PATH="$_d:$PATH";; esac
done
export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
unset _d

# Exit codes: 1 when this script could not run the check at all, 0 otherwise —
# including when the check found problems, because finding them is the check
# working. Hermes delivers stdout on either exit; only a nonzero exit records
# last_status=error, which is what cron-health-watchdog reads. A checker that
# cannot start exiting 0 would look, to that watch, like a healthy day.
CHECK="$REPO/scripts/summary-health.mjs"
if [ ! -f "$CHECK" ]; then
  echo "⚠️ Observatory health: checker not found at $CHECK"
  exit 1
fi

# cd into the repo so the checker picks up .env.local — that is where
# STOCK_BRIEFING_SUMMARY_PATH is set, and its default would otherwise be guessed.
cd "$REPO" || { echo "⚠️ Observatory health: cannot cd to $REPO"; exit 1; }

# Everything the checker wants to say goes to stdout; it prints nothing when the
# state is unchanged. Its stderr is not forwarded — a transient read error should
# not become a Telegram message.
# A checker that crashes (rather than reporting) is the same "could not run" case.
node "$CHECK" 2>/dev/null || { echo "⚠️ Observatory health: the checker itself failed (node exit $?) — run: node scripts/summary-health.mjs"; exit 1; }

exit 0
