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

if [ "$RC" -ne 0 ]; then
  ERR="$(printf '%s\n' "$OUT" | grep -iE 'error|failed|refusing' | tail -1)"
  echo "⚠️ Observatory refresh FAILED (rc=$RC) — ${ERR:-see logs/refresh-cron.log}"
elif [ -n "$VALIDATION" ] && [ "$PASSED" != "$TOTAL" ]; then
  echo "⚠️ Observatory refresh completed but ${PASSED}/${TOTAL} checks passing${MISSING:+ — missing source: $MISSING}"
elif [ -n "$MISSING" ]; then
  echo "⚠️ Observatory refresh: expected brokerage export missing — $MISSING"
fi

exit 0
