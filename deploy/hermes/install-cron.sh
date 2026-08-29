#!/usr/bin/env bash
# install-cron.sh — declare the Observatory refresh Hermes cron job under the
# `trader` profile (iMac only). Versioned, reproducible source for the job; the
# job itself lives in the trader profile's runtime cron store once created.
#
#   observatory-refresh  14:00 weekdays — pnpm refresh (FX, prices, evidence, ingest)
#
# 14:00 local is after the 13:00 PDT US close, so the snapshot it takes reflects
# a completed session rather than mid-day prices. Market holidays are not
# special-cased: re-fetching returns the same closing prices, which is the
# correct state, not a stale one.
#
# Mirrors the briefing's tools/hermes/install-cron.sh, and shares that profile's
# TELEGRAM_BOT_TOKEN. Pass "local" to install without Telegram delivery.
#
# Idempotent: re-running refreshes the wrapper and creates the job only if it is
# missing, so a live schedule is never disturbed.
#
# NOTE: Hermes runs an INSTALLED COPY of the wrapper from the profile's scripts
# directory, not the file in this repo. `git pull` alone does not update it —
# re-run this script after changing the wrapper, or the change never executes.
#
# Usage (on iMac, as hermes-runner):
#   OBSERVATORY_REPO=~/workspace/code/core/jackhpark-stock-observatory \
#     deploy/hermes/install-cron.sh [telegram:8907907309|local]
# Then enable it:
#   ~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main \
#     --profile trader cron resume observatory-refresh
set -euo pipefail

if [[ "$(whoami)" != "hermes-runner" ]]; then
  echo "install-cron.sh is iMac-only (expects user hermes-runner); got $(whoami)." >&2
  exit 1
fi

DELIVER="${1:-telegram:8907907309}"
PROFILE="trader"

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${OBSERVATORY_REPO:-$(cd "$HERE/../.." && pwd)}"
SCRIPTS_DIR="$HOME/.hermes/profiles/$PROFILE/scripts"   # Hermes --script resolves under $HERMES_HOME

PY="$HOME/.hermes/hermes-agent/venv/bin/python"
hermes() { "$PY" -m hermes_cli.main "$@"; }

# Job table: "<name>|<schedule>|<wrapper>"
#
# observatory-health is the one that watches the OUTPUT. It reads the summary the refresh
# publishes and speaks only when the situation changes — including when the summary
# stops being written at all, which is the failure no job monitor can see.
#
# Daily, and every day rather than weekdays: the refresh runs on its own six-hourly
# interval regardless of the calendar, so a weekend failure would otherwise stay
# invisible until Monday. 09:00 puts it before the 08:00 briefing's next run, so a
# problem is known before the day's figures go out.
#
# observatory-refresh runs the refresh itself, six-hourly. It spent 2026-07-27 to
# 2026-08-29 paused while launchd owned the schedule; it is back because launchd
# delivers nothing on failure, and a refresh that failed for three days straight
# was only noticed on observatory-health's next daily pass. This wrapper reports on
# the failing run itself, and names the validation shortfall and any missing
# brokerage export with it.
#
# Only one scheduler may own this: two would write the same database and the same
# data/refresh-runs.json. If the launchd service is ever reinstalled
# (`make install-refresh-service`), pause this job in the same breath.
JOBS=(
  "observatory-health|0 9 * * *|observatory-health-cron.sh"
  "observatory-refresh|0 14 * * 1-5|observatory-refresh-cron.sh"
)

mkdir -p "$SCRIPTS_DIR"

for spec in "${JOBS[@]}"; do
  IFS='|' read -r JOB_NAME SCHEDULE WRAPPER <<<"$spec"
  [ -f "$HERE/$WRAPPER" ] || { echo "wrapper not found: $HERE/$WRAPPER" >&2; exit 1; }

  install -m 0755 "$HERE/$WRAPPER" "$SCRIPTS_DIR/$WRAPPER"
  echo "installed wrapper -> $SCRIPTS_DIR/$WRAPPER"

  if hermes --profile "$PROFILE" cron list --all 2>/dev/null | grep -q "Name:  *$JOB_NAME"; then
    echo "job '$JOB_NAME' already exists — leaving its schedule untouched"
  else
    # `schedule` is positional; there is no --schedule flag.
    hermes --profile "$PROFILE" cron create \
      --name "$JOB_NAME" \
      --no-agent \
      --script "$WRAPPER" \
      --deliver "$DELIVER" \
      "$SCHEDULE"
    echo "created job '$JOB_NAME' ($SCHEDULE, deliver=$DELIVER)"
    echo "enable it with: hermes --profile $PROFILE cron resume $JOB_NAME"
  fi
done
