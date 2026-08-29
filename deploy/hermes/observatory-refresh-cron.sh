#!/usr/bin/env bash
# observatory-refresh-cron.sh — Hermes cron `--no-agent --script` entrypoint for
# `pnpm refresh` (FX → KR prices → US PDF evidence → US prices → ingest).
#
# Hermes delivers this script's STDOUT verbatim to Telegram, so stdout is the
# alert channel and silence is the success state.
#
# SILENT ON SUCCESS on purpose: the positive signal already exists on /health,
# which shows exactly how fresh every snapshot is. A daily "refresh ok" message
# would be noise, and noise is how a real alert gets ignored.
#
# LOUD ON FAILURE — including the failures `pnpm refresh` itself treats as
# survivable. The ingest sets a non-zero exit only for ERROR-severity checks, so
# a warning-severity one (a brokerage export pattern matching nothing, prices or
# FX missing) would exit 0 and pass unnoticed. That is precisely the silent
# under-reporting this pipeline has been fixing, so the validation line is
# parsed and any shortfall is reported.

set -uo pipefail

REPO="${OBSERVATORY_REPO:-$HOME/workspace/code/core/jackhpark-stock-observatory}"
LOG="$REPO/logs/refresh-cron.log"
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"

# Hermes cron runs with a minimal PATH and does not source a login shell; pnpm
# and node live in the user prefix on this host.
for _d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
  [ -d "$_d" ] && case ":$PATH:" in *":$_d:"*) ;; *) PATH="$_d:$PATH";; esac
done
export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
unset _d

if [ ! -f "$REPO/package.json" ]; then
  echo "⚠️ Observatory refresh: repo not found at $REPO"
  exit 1
fi
cd "$REPO" || { echo "⚠️ Observatory refresh: cannot cd to $REPO"; exit 1; }

mkdir -p "$(dirname "$LOG")"
OUT="$(pnpm refresh 2>&1)"
RC=$?

{
  echo "=== $STAMP refresh (rc=$RC) ==="
  printf '%s\n' "$OUT"
} >> "$LOG"

# "Validation: 13/13 checks passing" — the last one wins if ingest ran twice.
VALIDATION="$(printf '%s\n' "$OUT" | grep -oE 'Validation: [0-9]+/[0-9]+' | tail -1)"
PASSED="${VALIDATION##*: }"; PASSED="${PASSED%%/*}"
TOTAL="${VALIDATION##*/}"

# The most actionable warning: an expected brokerage export matched nothing.
MISSING="$(printf '%s\n' "$OUT" | grep -F '[source] MISSING' | sed 's/^\[source\] MISSING — //' | paste -sd'; ' -)"

# Decide the message first, then decide whether to say it.
#
# Every condition below persists until a person acts: three validation checks have
# been failing for weeks, and a brokerage export stays missing until the file
# arrives. Speaking on every run would put four identical messages a day in the
# channel, which is how the one that matters gets scrolled past. So the wrapper
# carries the same fingerprint/state contract as summary-health.mjs: report a state
# when it CHANGES, report the return to clean once, and otherwise stay quiet.
#
# The fingerprint deliberately excludes anything that moves on its own. Counts are
# in it because they are stable while the same checks fail — a fourth failure is a
# new fact and should speak — but no timestamps and no durations.
FINGERPRINT=""
MESSAGE=""
if [ "$RC" -ne 0 ]; then
  ERR="$(printf '%s\n' "$OUT" | grep -iE 'error|failed|refusing' | tail -1)"
  # Keyed on the failing step, not the error text: the text carries paths and
  # temp-dir names that differ every run, which would re-alert forever.
  STEP="$(printf '%s\n' "$OUT" | grep -oE '^== [a-z:-]+ ==' | tail -1 | tr -d '= ')"
  FINGERPRINT="failed:${RC}:${STEP:-unknown}"
  MESSAGE="⚠️ Observatory refresh FAILED (rc=$RC)${STEP:+ at $STEP} — ${ERR:-see logs/refresh-cron.log}
Prices stop updating here; the 08:00 briefing and 13:30 trading review publish whatever was last stored."
elif [ -n "$VALIDATION" ] && [ "$PASSED" != "$TOTAL" ]; then
  FINGERPRINT="validation:${PASSED}/${TOTAL}:${MISSING}"
  MESSAGE="⚠️ Observatory refresh completed but ${PASSED}/${TOTAL} checks passing${MISSING:+ — missing source: $MISSING}"
elif [ -n "$MISSING" ]; then
  FINGERPRINT="missing:${MISSING}"
  MESSAGE="⚠️ Observatory refresh: expected brokerage export missing — $MISSING"
else
  FINGERPRINT="clean"
fi

STATE_FILE="${OBSERVATORY_REFRESH_STATE:-$HOME/.config/stock-portfolio-observatory/refresh-cron-state}"
PREV=""
FIRST_RUN=1
if [ -r "$STATE_FILE" ]; then
  PREV="$(cat "$STATE_FILE" 2>/dev/null)"
  FIRST_RUN=0
fi

if [ "$FINGERPRINT" != "$PREV" ]; then
  if [ "$FINGERPRINT" = "clean" ]; then
    # Not on a first run: "back to clean" about a system nobody was told was broken
    # is a message that says nothing, delivered at install time.
    [ "$FIRST_RUN" -eq 0 ] && echo "✅ Observatory refresh back to clean — all checks passing."
  else
    printf '%s\n' "$MESSAGE"
  fi
fi

# A state file that cannot be written costs repeat alerts, not a missed one —
# failing here would turn a noise problem into a silence problem.
mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true
printf '%s\n' "$FINGERPRINT" > "$STATE_FILE".tmp-$$ 2>/dev/null &&
  mv -f "$STATE_FILE".tmp-$$ "$STATE_FILE" 2>/dev/null || true

exit 0
