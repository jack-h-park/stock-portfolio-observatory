#!/usr/bin/env bash
# refresh-now.sh — run `pnpm refresh` once, on request, and say how it went.
#
# For an interactive request ("refresh the Observatory now"), not a schedule:
# the scheduled refresh is observatory-refresh-cron.sh, which stays silent unless
# its state changes. This one always answers, in four parts:
#
#   Validation: N/M checks passing      the ingest's own line
#   Failing checks: <ids> | none        from the database it just wrote
#   [source] MISSING — …                each expected export that matched nothing
#   rc=<n>                              pnpm's exit code, which is also this script's
#
# A refresh rebuilds the database and republishes the Google Sheets. Asking for
# one asks for both.
#
# If a refresh already holds .refresh.lock it prints `Refresh already running`
# and exits 3 without starting another; refresh.mjs would skip anyway, and
# saying so is more useful than a second run that does nothing.
#
# Same PATH and python setup as observatory-refresh-cron.sh, and the same log.

set -uo pipefail

REPO="${OBSERVATORY_REPO:-$HOME/workspace/code/core/jackhpark-stock-observatory}"
LOG="${OBSERVATORY_REFRESH_LOG:-$REPO/logs/refresh-cron.log}"
LOCK="${STOCK_REFRESH_LOCK_PATH:-$REPO/.refresh.lock}"
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"

# The app toolchain directory is listed last so its node wins (see
# observatory-refresh-cron.sh for why).
for _d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/.local/app-toolchain/bin"; do
  [ -d "$_d" ] && case ":$PATH:" in *":$_d:"*) ;; *) PATH="$_d:$PATH";; esac
done
export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
unset _d

if [ -z "${STOCK_PYTHON_BIN:-}" ] && [ -x "$HOME/.local/share/stock-observatory/venv/bin/python" ]; then
  export STOCK_PYTHON_BIN="$HOME/.local/share/stock-observatory/venv/bin/python"
fi

if [ ! -f "$REPO/package.json" ]; then
  echo "Observatory repo not found at $REPO"
  echo "rc=1"
  exit 1
fi
cd "$REPO" || { echo "cannot cd to $REPO"; echo "rc=1"; exit 1; }

# Held means: the lock directory exists and its owner is alive, or its owner is
# not written yet. A dead owner's lock is stale, and refresh.mjs reclaims it.
lock_held() {
  [ -d "$LOCK" ] || return 1
  local pid
  pid="$(cat "$LOCK/pid" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$pid" ] || return 0
  ps -p "$pid" >/dev/null 2>&1
}

if lock_held; then
  echo "Refresh already running"
  exit 3
fi

mkdir -p "$(dirname "$LOG")"
OUT="$(pnpm refresh 2>&1)"
RC=$?

{
  echo "=== $STAMP refresh-now (rc=$RC) ==="
  printf '%s\n' "$OUT"
} >> "$LOG"

# Another refresh took the lock between the check above and pnpm starting.
if printf '%s\n' "$OUT" | grep -F '[refresh] another refresh is already running' >/dev/null; then
  echo "Refresh already running"
  exit 3
fi

VALIDATION="$(printf '%s\n' "$OUT" | grep -E '^Validation: [0-9]+/[0-9]+' | tail -1)"
echo "${VALIDATION:-Validation: (no line; the ingest did not finish)}"
if [ -f "$REPO/scripts/failing-checks.mjs" ]; then
  node "$REPO/scripts/failing-checks.mjs" 2>/dev/null || true
fi
printf '%s\n' "$OUT" | grep -F '[source] MISSING' || true
echo "rc=$RC"
exit "$RC"
