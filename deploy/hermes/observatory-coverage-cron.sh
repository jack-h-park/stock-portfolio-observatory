#!/usr/bin/env bash
# observatory-coverage-cron.sh — Hermes cron `--no-agent --script` entrypoint.
#
# The weekly reminder of which broker statements to download next. Hermes
# delivers this script's STDOUT to Telegram; empty stdout is a quiet week, which
# is what every account being current looks like.
#
# Weekly, not on change, on purpose. The other two observatory crons report a
# state once and then stay quiet until it changes, because their states clear
# themselves or need a fix nobody forgets. A statement that has not been
# downloaded does not clear itself and is easy to put off, so the same list comes
# back every week until the files arrive.
#
# Exit codes follow the other wrappers: 1 only when the reminder could not be
# built at all (no checkout, no summary), 0 otherwise.
#
# Installed into ~/.hermes/profiles/trader/scripts/ by deploy/hermes/install-cron.sh.

set -uo pipefail

REPO="${OBSERVATORY_REPO:-$HOME/workspace/code/core/jackhpark-stock-observatory}"

# Same PATH rule as observatory-health-cron.sh: the app toolchain directory is
# listed last so its node wins.
for _d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/.local/app-toolchain/bin"; do
  [ -d "$_d" ] && case ":$PATH:" in *":$_d:"*) ;; *) PATH="$_d:$PATH";; esac
done
export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
unset _d

REMINDER="$REPO/scripts/coverage-reminder.mjs"
if [ ! -f "$REMINDER" ]; then
  echo "⚠️ 계좌 자료 알림: $REMINDER 가 없습니다"
  exit 1
fi

# cd into the repo so the script picks up .env.local, where the summary path is set.
cd "$REPO" || { echo "⚠️ 계좌 자료 알림: $REPO 로 이동하지 못했습니다"; exit 1; }

node "$REMINDER" 2>/dev/null
