#!/usr/bin/env bash
# install-cron.sh — declare the Observatory Hermes cron jobs under the `trader`
# profile (ops host only). Versioned, reproducible source for the jobs; the jobs
# themselves live in the trader profile's runtime cron store once created.
#
#   observatory-refresh  every 6 hours — pnpm refresh (FX, prices, evidence, ingest)
#   observatory-health   daily 09:00    — reads the summary the refresh publishes
#
# Mirrors the briefing's tools/hermes/install-cron.sh, and shares that profile's
# TELEGRAM_BOT_TOKEN. Pass "local" to install without Telegram delivery.
#
# The delivery target is required and has no default: the first argument, or
# TRADER_CRON_DELIVER when there is none, as `telegram:<chat_id>[:<thread_id>]`.
# This repo is public; a chat id is not a credential, but it is private
# infrastructure, and a default written into the script delivers to the wrong place
# as soon as the job moves to another host.
#
# Every job is created PAUSED: installing is not enabling. Enable each in the
# maintenance window with `cron resume`.
#
# Which host may run this is decided by the role marker ~/.hermes/role (`ops`), not
# by the account name: the ops account has a different name on different hosts.
#
# Idempotent: re-running refreshes the wrapper and creates the job only if it is
# missing, so a live schedule is never disturbed.
#
# NOTE: Hermes runs an INSTALLED COPY of the wrapper from the profile's scripts
# directory, not the file in this repo. `git pull` alone does not update it —
# re-run this script after changing the wrapper, or the change never executes.
#
# Usage (on the ops host):
#   OBSERVATORY_REPO=~/workspace/code/core/jackhpark-stock-observatory \
#     deploy/hermes/install-cron.sh telegram:<chat>[:<thread>]|local
#   (or export TRADER_CRON_DELIVER and pass no argument)
# Then enable it:
#   ~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main \
#     --profile trader cron resume observatory-refresh
set -euo pipefail

# Refuse to run anywhere but the host that declares itself the ops host. The
# declaration is ~/.hermes/role containing `ops` — the marker the control plane's
# own installers read — and not the account name. A marker cannot be created by
# cloning the repo, which is also why an account-name test was the wrong guard for
# a machine that has the repos but must not run the crons.
ROLE_FILE="${HERMES_REAL_HOME:-$HOME}/.hermes/role"
ROLE=""
[[ -r "$ROLE_FILE" ]] && ROLE="$(tr -d '[:space:]' < "$ROLE_FILE")"
if [[ "$ROLE" != "ops" ]]; then
  echo "install-cron.sh is ops-host-only: $ROLE_FILE must contain 'ops' (found '${ROLE:-<missing>}')." >&2
  echo "  Declare it once, on the host that runs operations: printf 'ops\\n' > ~/.hermes/role" >&2
  exit 1
fi

DELIVER="${1:-${TRADER_CRON_DELIVER:-}}"
if [[ -z "$DELIVER" ]]; then
  echo "no delivery target: pass one as the first argument or set TRADER_CRON_DELIVER." >&2
  echo "  telegram:<chat_id>[:<thread_id>] | local" >&2
  exit 2
fi
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
  "observatory-refresh|0 */6 * * *|observatory-refresh-cron.sh"
)

mkdir -p "$SCRIPTS_DIR"

# `cron create` and `cron pause` exit 0 even when they did nothing, so the state is
# read back rather than assumed. `cron list` hides paused jobs; --all does not.
job_state() {
  hermes --profile "$PROFILE" cron list --all 2>/dev/null \
    | awk -v n="$1" '/^ +[0-9a-f]+ \[/ {st=$2} $1 == "Name:" && $2 == n {print st; exit}' || true
}

for spec in "${JOBS[@]}"; do
  IFS='|' read -r JOB_NAME SCHEDULE WRAPPER <<<"$spec"
  [ -f "$HERE/$WRAPPER" ] || { echo "wrapper not found: $HERE/$WRAPPER" >&2; exit 1; }

  install -m 0755 "$HERE/$WRAPPER" "$SCRIPTS_DIR/$WRAPPER"
  echo "installed wrapper -> $SCRIPTS_DIR/$WRAPPER"

  if [[ -n "$(job_state "$JOB_NAME")" ]]; then
    echo "job '$JOB_NAME' already exists — leaving its schedule untouched"
  else
    # `schedule` is positional; there is no --schedule flag.
    hermes --profile "$PROFILE" cron create \
      --name "$JOB_NAME" \
      --no-agent \
      --script "$WRAPPER" \
      --deliver "$DELIVER" \
      "$SCHEDULE"
    hermes --profile "$PROFILE" cron pause "$JOB_NAME"
    STATE="$(job_state "$JOB_NAME")"
    if [[ "$STATE" != "[paused]" ]]; then
      echo "job '$JOB_NAME' is not paused after create (state: ${STATE:-<not found>})." >&2
      echo "  Check it, and pause it before a gateway starts: $PY -m hermes_cli.main --profile $PROFILE cron pause $JOB_NAME" >&2
      exit 1
    fi
    echo "created job '$JOB_NAME' ($SCHEDULE, deliver=$DELIVER) PAUSED"
    echo "enable it with: hermes --profile $PROFILE cron resume $JOB_NAME"
  fi
done
