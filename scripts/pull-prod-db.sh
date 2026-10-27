#!/usr/bin/env bash
# pull-prod-db.sh — replace this machine's database with a copy of the one the
# refresh host serves. On demand only; nothing schedules it.
#
# The laptop keeps a database because `pnpm dev` needs one. Nothing refreshes
# it: the host's refresh writes the host's copy, and a local ingest cannot
# rebuild the same thing, because the Toss holdings and the Robinhood snapshot
# are fetched on the host. So the laptop copy simply ages. On 2026-10-20 a
# planning document quoted it as "the DB" — ingested 2026-08-27 — while the
# host had loaded October's statements that same day. Nothing on the laptop
# said how old it was.
#
# This is the way to bring it up to date when development wants real numbers.
# It is deliberately not a timer: a copy that syncs itself looks current, and
# when the sync stops it goes stale silently again — the failure this exists
# to end. The dev server's "development copy" badge shows the age either way.
#
# ONE WAY, HOST TO LAPTOP, DATABASE ONLY. push-sources.sh goes the other way
# and never touches outputs/; this never writes to the host. The host side is
# read with `sqlite3 -readonly ... .backup`, which takes a consistent snapshot
# while the service and the six-hourly refresh keep the file open, instead of
# copying a database file mid-write.
#
# The replaced local copy is kept beside it as <db>.before-pull (one
# generation), so a local experiment is one `mv` away.
#
# The destination is the database the app reads: STOCK_DB_PATH, from the
# environment or .env.local, else the default in config.ts. Refuses to run on a
# machine with the web service installed — that is the host, and its database
# is the one being copied.
#
# usage: scripts/pull-prod-db.sh [--dry-run] [--host user@host]

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env.local"
# Same reading as push-sources.sh: only the named keys, and a real environment
# variable wins.
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      STOCK_DB_PATH|STOCK_PROD_HOST|STOCK_PROD_DATA_DIR)
        [ -z "${!key:-}" ] && export "$key=${value%\"}" ;;
    esac
  done < <(grep -E '^(STOCK_DB_PATH|STOCK_PROD_HOST|STOCK_PROD_DATA_DIR)=' "$ENV_FILE" || true)
fi

DB_REL="outputs/stock-portfolio-observatory/stock-portfolio-observatory.db"
LOCAL_DB="${STOCK_DB_PATH:-$REPO_DIR/private-data/$DB_REL}"
HOST="${STOCK_PROD_HOST:-ops-host}"
REMOTE_DB="${STOCK_PROD_DATA_DIR:-workspace/data/stock-management}/$DB_REL"
DRY=0
SERVICE_LABEL=com.jackpark.stock-observatory

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --host) HOST="$2"; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if launchctl list 2>/dev/null | awk '{print $3}' | grep -qx "$SERVICE_LABEL"; then
  echo "refusing: $SERVICE_LABEL is installed here, so this is the host. Its database is the source, not a copy." >&2
  exit 1
fi

# immutable=1: the host database is in WAL mode and so is the copy. A plain
# read-only open still creates -shm and -wal beside the file, which would leave
# litter next to .part and, worse, a fresh -wal beside a database about to be
# swapped. An immutable open reads the file and creates nothing.
sq() { sqlite3 "file:$1?immutable=1" "$2"; }
meta_ingested() { sq "$1" "select value from meta where key = 'ingested_at'" 2>/dev/null || echo "unknown"; }

remote_ingested=$(ssh "$HOST" sqlite3 -readonly "$REMOTE_DB" "\"select value from meta where key = 'ingested_at'\"")
local_ingested="none"
[ -f "$LOCAL_DB" ] && local_ingested=$(meta_ingested "$LOCAL_DB")

echo "host:  $HOST:$REMOTE_DB (ingested_at $remote_ingested)"
echo "local: $LOCAL_DB (ingested_at $local_ingested)"
if [ "$DRY" = 1 ]; then
  echo "dry run: nothing copied"
  exit 0
fi

# A running `pnpm dev` holds the file open; swapping it underneath leaves the
# server reading a deleted inode, and an old -wal beside a new database is
# corruption. Stop rather than guess.
# One file per lsof call: given several names, lsof exits non-zero when any
# one of them is missing (there is usually no -wal), which read as "not open".
for f in "$LOCAL_DB" "$LOCAL_DB-wal"; do
  if [ -e "$f" ] && [ -n "$(lsof -t -- "$f" 2>/dev/null)" ]; then
    echo "refusing: $f is open (stop the dev server first):" >&2
    lsof -- "$f" >&2 || true
    exit 1
  fi
done

remote_tmp=$(ssh "$HOST" mktemp -t observatory-pull)
cleanup() { ssh "$HOST" rm -f "$remote_tmp" >/dev/null 2>&1 || true; rm -f "$LOCAL_DB.part" "$LOCAL_DB.part-wal" "$LOCAL_DB.part-shm"; }
trap cleanup EXIT

ssh "$HOST" sqlite3 -readonly "$REMOTE_DB" "\".backup '$remote_tmp'\""
mkdir -p "$(dirname "$LOCAL_DB")"
scp -q "$HOST:$remote_tmp" "$LOCAL_DB.part"

check=$(sq "$LOCAL_DB.part" 'pragma quick_check')
if [ "$check" != "ok" ]; then
  echo "copied database failed quick_check: $check — local copy left unchanged" >&2
  exit 1
fi
chmod 600 "$LOCAL_DB.part"

if [ -f "$LOCAL_DB" ]; then
  mv -f "$LOCAL_DB" "$LOCAL_DB.before-pull"
fi
rm -f "$LOCAL_DB-wal" "$LOCAL_DB-shm"
mv "$LOCAL_DB.part" "$LOCAL_DB"

echo "pulled: $LOCAL_DB now ingested_at $(meta_ingested "$LOCAL_DB")"
[ "$local_ingested" != "none" ] && echo "kept:   $LOCAL_DB.before-pull (ingested_at $local_ingested)"
exit 0
