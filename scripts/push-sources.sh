#!/usr/bin/env bash
# push-sources.sh — copy broker source files from this machine to the host that
# runs the refresh.
#
# The pipeline runs on one machine and the downloads happen on another. Brokers
# want a browser session, so exports land wherever you were logged in; the
# refresh reads them wherever it runs. Nothing bridged the two, and the cost was
# real: Bithumb statements going back to 2024 sat on a laptop for months while
# the dashboard showed no crypto at all, because the extractor was looking at a
# directory that did not have them.
#
# ONE WAY, SOURCES ONLY. This is not a sync. The two sides are not mirrors of
# each other:
#
#   sources  — arrive here, are read there            → pushed
#   outputs/ — written there by every refresh          → never touched
#   briefing-archive/ — written there by the briefing  → never touched
#
# Copying the generated database back over the one being served would replace
# live data with whatever this machine last happened to build. So the directory
# list below is an allowlist rather than a set of excludes: a new source folder
# has to be named to travel, which is the failure that leaves a file behind, not
# the one that destroys data.
#
# usage: scripts/push-sources.sh [--dry-run] [--host user@host] [--remote-dir path]

set -euo pipefail

# launchd starts this with almost no environment — not a login shell, so nothing
# has read .env.local. Without this the timed run would silently use the built-in
# defaults below while a hand-run picked up the configured paths, and the two
# would push different trees to different places. Read it, but let a real
# environment variable win so `--host` and one-off overrides still behave.
ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env.local"
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      STOCK_DATA_DIR|STOCK_PROD_HOST|STOCK_PROD_DATA_DIR)
        [ -z "${!key:-}" ] && export "$key=${value%\"}" ;;
    esac
  done < <(grep -E '^(STOCK_DATA_DIR|STOCK_PROD_HOST|STOCK_PROD_DATA_DIR)=' "$ENV_FILE" || true)
fi

LOCAL_DIR="${STOCK_DATA_DIR:-$HOME/workspace/data/stock-management}"
HOST="${STOCK_PROD_HOST:-hermes-runner@imac-hermes}"
REMOTE_DIR="${STOCK_PROD_DATA_DIR:-workspace/data/stock-management}"
DRY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY="--dry-run"; shift ;;
    --host) HOST="$2"; shift 2 ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Every directory the ingest and the extractors read. Keep in step with
# scripts/source-files.mjs, extract-kr-statements.py and extract-crypto-activity.py.
SOURCES=(
  kr-statements
  us-transactions
  us-holdings
  us-tax-documents
  crypto-bithumb
  crypto-robinhood
)

[ -d "$LOCAL_DIR" ] || { echo "ERROR: no data directory at $LOCAL_DIR" >&2; exit 1; }

present=()
for dir in "${SOURCES[@]}"; do
  if [ -d "$LOCAL_DIR/$dir" ]; then
    present+=("$LOCAL_DIR/$dir")
  else
    # Not fatal — not every machine holds every brokerage — but named, because a
    # directory silently missing here is a directory silently missing there.
    echo "note: $dir is not on this machine, skipping" >&2
  fi
done
[ ${#present[@]} -gt 0 ] || { echo "ERROR: none of the source directories exist under $LOCAL_DIR" >&2; exit 1; }

echo "pushing ${#present[@]} source director(ies) to $HOST:$REMOTE_DIR/${DRY:+  (dry run)}"

# --delete is deliberately ABSENT. A rotating export (`chase-holdings-<date>.csv`)
# is resolved by pattern on the far side, and an older file left behind costs
# nothing; deleting one because it is no longer on this laptop could remove the
# only copy of a period nobody re-downloads.
rsync -a --human-readable --itemize-changes $DRY \
  --exclude '.DS_Store' \
  --exclude '~$*' \
  "${present[@]}" \
  "$HOST:$REMOTE_DIR/"

if [ -z "$DRY" ]; then
  echo
  echo "pushed. The refresh reads these on its next run; to apply them now:"
  echo "  ssh $HOST 'cd ~/workspace/code/core/jackhpark-stock-observatory && pnpm refresh'"
fi
