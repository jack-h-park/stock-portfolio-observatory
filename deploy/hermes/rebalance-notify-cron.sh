#!/usr/bin/env bash
# rebalance-notify-cron.sh — Hermes cron `--no-agent --script` entrypoint, every 30 minutes.
#
# Delivers the rebalance notification events `pnpm rebalance:notify` lists:
#   - Telegram (awareness): each event's fixed line goes to stdout, which Hermes
#     delivers verbatim, and is then marked sent.
#   - Discord (decisions): a `created` event opens the proposal's thread through the
#     control plane's run-agent-request.sh (the trader agent writes the opening);
#     status and reminder lines are posted into that thread with send_discord.py.
#     Each is marked only after the control plane accepted it, so a failure retries
#     on the next run.
# Without HERMES_CONTROL_PLANE_ROOT (or HERMES_CONTROL_PLANE) or the trader profile's DISCORD_BOT_TOKEN it leaves the
# Discord side pending, and says "Discord thread not opened: …" with the proposal's
# created line, so once per proposal. A thread that will not open is reported on its
# first failure and given up after 6 attempts; status lines retry silently, same cap.
#
# A held lock means another rebalance job is already delivering: exit 0 silently.
#
# Silence means nothing new. Exit 1 only when the notify command could not run or a
# receipt could not be recorded.
#
# Installed into ~/.hermes/profiles/trader/scripts/ by deploy/hermes/install-cron.sh,
# together with rebalance-lib.sh, which it sources.

set -uo pipefail
export CRON_JOB_NAME=rebalance-notify
# shellcheck source=rebalance-lib.sh
. "$(dirname "$0")/rebalance-lib.sh" || { echo "⚠️ Rebalance notify: rebalance-lib.sh not found beside $0"; exit 1; }

rb_enter_repo "Rebalance notify"
rb_lock nowait
rb_notify_flow || exit 1
exit 0
