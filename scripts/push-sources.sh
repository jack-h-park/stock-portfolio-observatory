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
# It files the inbox first (scripts/file-downloads.py), so the manual step is
# now "drop the download in one folder" rather than "type the name the
# convention wants". Naming by hand is where the two mistakes this repo has
# already found came from.
#
# ONE WAY, SOURCES ONLY. This is not a sync. The two sides are not mirrors of
# each other:
#
#   sources  — arrive here, are read there            → pushed
#   config   — edited here, read there                 → pushed (see CONFIG)
#   inbox/   — a staging area, filed then emptied      → never pushed
#   outputs/ — written there by every refresh          → never touched
#   briefing-archive/ — written there by the briefing  → never touched
#
# Config is a late addition and a different root: it lives in the repo's data/
# directory, not the data directory. It is here because leaving it out had a
# cost. data/manual-mappings.json held a ticker rename on one machine and not
# the other, and the difference surfaced three steps downstream as a realized-
# gain replay that would not reconcile. Nothing said "these two files differ";
# the pipeline just disagreed with itself. That file now lives in git, which
# suits it — it is symbols and classification rules. tax-policy.json cannot go
# the same way: it carries a W-2 wage base and year-to-date realized figures,
# and a git history is forever. So it travels here instead.
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
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env.local"
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      STOCK_DATA_DIR|STOCK_PROD_HOST|STOCK_PROD_DATA_DIR|STOCK_PROD_REPO_DIR|STOCK_PYTHON_BIN)
        [ -z "${!key:-}" ] && export "$key=${value%\"}" ;;
    esac
  done < <(grep -E '^(STOCK_DATA_DIR|STOCK_PROD_HOST|STOCK_PROD_DATA_DIR|STOCK_PROD_REPO_DIR|STOCK_PYTHON_BIN)=' "$ENV_FILE" || true)
fi

LOCAL_DIR="${STOCK_DATA_DIR:-$HOME/workspace/data/stock-management}"
HOST="${STOCK_PROD_HOST:-hermes-runner@imac-hermes}"
REMOTE_DIR="${STOCK_PROD_DATA_DIR:-workspace/data/stock-management}"
REMOTE_REPO_DIR="${STOCK_PROD_REPO_DIR:-workspace/code/core/jackhpark-stock-observatory}"
DRY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY="--dry-run"; shift ;;
    --host) HOST="$2"; shift 2 ;;
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,42p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Every directory the ingest and the extractors read. Keep in step with
# scripts/source-files.mjs, extract-kr-statements.py and extract-crypto-activity.py.
# `inbox` is deliberately not here: a file nothing could identify stays there,
# and pushing it would put an unnamed document beside the named ones on the
# machine that reads them.
SOURCES=(
  kr-statements
  us-transactions
  us-holdings
  us-tax-documents
  crypto-bithumb
  crypto-robinhood
)

# Config files under the repo's data/, pushed to the same path on the far side.
# An allowlist for the same reason SOURCES is one: data/ also holds the runtime
# snapshots each refresh regenerates (prices, FX, evidence), and carrying those
# would overwrite what the refresh host just computed with whatever this machine
# last built. Only files a person edits belong here.
#
# data/manual-mappings.json is deliberately absent — it is tracked in git and
# arrives by `git pull`. Listing it in both places would mean two ways to change
# one file, and the rsync would quietly win over the commit.
CONFIG=(
  tax-policy.json
)

[ -d "$LOCAL_DIR" ] || { echo "ERROR: no data directory at $LOCAL_DIR" >&2; exit 1; }

# File the inbox BEFORE pushing, so a download dropped in there reaches the
# refresh host correctly named within the hour with no step for a person at all.
# Safe to run unattended precisely because it never guesses: a file it cannot
# identify stays in the inbox, which is not one of the directories below and so
# never travels.
#
# `|| true` on purpose. Filing is a convenience; carrying the files that are
# already named correctly is the job, and a broken pdfplumber install or one
# malformed download must not stop the push that everything downstream depends
# on. Whatever it says lands in logs/push-sources.log either way.
PYTHON_BIN="${STOCK_PYTHON_BIN:-python3}"
if [ -x "$PYTHON_BIN" ] || command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  STOCK_DATA_DIR="$LOCAL_DIR" "$PYTHON_BIN" "$REPO_DIR/scripts/file-downloads.py" ${DRY:+--dry-run} || true
  echo
else
  echo "note: $PYTHON_BIN not found, skipping the inbox — set STOCK_PYTHON_BIN" >&2
fi

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

# Config, second because a failure here must not cost the source push that
# already succeeded. Same one-way rule, two differences:
#
#   --backup-dir  keeps the version being replaced, because the way this file
#                 gets lost is a copy made in a hurry over one nobody read
#                 first. One generation is enough to answer "what was there
#                 before". rsync writes it only when it actually transfers, so
#                 an unchanged file leaves no backup and no churn.
# Permissions ride along in -a rather than a --chmod flag: macOS ships openrsync,
# which advertises --chmod and rejects every value for it. tax-policy.json carries
# a W-2 wage base and realized figures, so it is 0600 on both machines — chmod it
# here and -a carries that across, which is the honest fix anyway. A 0644 local
# copy of this file was already too open before it ever left.
config=()
for file in "${CONFIG[@]}"; do
  if [ -f "$REPO_DIR/data/$file" ]; then
    config+=("$REPO_DIR/data/$file")
  else
    echo "note: data/$file is not on this machine, skipping" >&2
  fi
done

if [ ${#config[@]} -gt 0 ]; then
  echo
  echo "pushing ${#config[@]} config file(s) to $HOST:$REMOTE_REPO_DIR/data/${DRY:+  (dry run)}"
  rsync -a --human-readable --itemize-changes $DRY \
    --backup --backup-dir=.push-backup --suffix='' \
    "${config[@]}" \
    "$HOST:$REMOTE_REPO_DIR/data/"
fi

if [ -z "$DRY" ]; then
  echo
  echo "pushed. The refresh reads these on its next run; to apply them now:"
  # `make refresh`, not `pnpm refresh`: a non-interactive ssh shell does not
  # source the login profile, so bare pnpm is not on PATH; the Makefile resolves it.
  echo "  ssh $HOST 'cd ~/workspace/code/core/jackhpark-stock-observatory && make refresh'"
fi
