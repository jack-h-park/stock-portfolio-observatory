# rebalance-lib.sh — shared setup for the rebalance-*-cron.sh wrappers. Sourced, never run.
#
# The three wrappers are Hermes cron `--no-agent --script` entrypoints like
# observatory-health-cron.sh: stdout is delivered verbatim to Telegram, silence means
# nothing to say, and the exit code is 1 only when a job could not run at all.
#
# install-cron.sh copies this file next to the wrappers in the trader profile's
# scripts directory; each wrapper sources it from its own directory.
#
# Environment (all optional):
#   OBSERVATORY_REPO      the checkout to run in (default ~/workspace/code/core/jackhpark-stock-observatory)
#   HERMES_CONTROL_PLANE  the control-plane checkout; without it no Discord thread is opened
#   HERMES_HOME_OPS       the ops profile home holding the thread ledger (default ~/.hermes/profiles/ops)
#   REBALANCE_DISCORD_ENV the env file DISCORD_BOT_TOKEN is read from (default the trader profile's .env)
#   REBALANCE_PNPM, REBALANCE_PYTHON, REBALANCE_LOCK_DIR, REBALANCE_TODAY_DOW/DOM: test seams

REPO="${OBSERVATORY_REPO:-$HOME/workspace/code/core/jackhpark-stock-observatory}"

# Same PATH rule as observatory-health-cron.sh: Hermes cron runs with a minimal PATH
# and no login shell. Each directory goes in FRONT of PATH, so the LAST one listed
# wins; the app toolchain directory is last so its node (the one the app's native
# modules are built for) beats any other node in the user prefix.
for _d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/.local/app-toolchain/bin"; do
  [ -d "$_d" ] && case ":$PATH:" in *":$_d:"*) ;; *) PATH="$_d:$PATH";; esac
done
export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
unset _d

RB_PNPM="${REBALANCE_PNPM:-pnpm}"
RB_PYTHON="${REBALANCE_PYTHON:-python3}"
export HERMES_HOME_OPS="${HERMES_HOME_OPS:-$HOME/.hermes/profiles/ops}"
RB_LEDGER="$HERMES_HOME_OPS/state/rebalance-proposal-threads.json"

# cd into the repo so the CLI picks up .env.local (the store and state paths live there).
rb_enter_repo() { # <label>
  if [ ! -f "$REPO/package.json" ]; then
    echo "⚠️ $1: repo not found at $REPO"
    exit 1
  fi
  cd "$REPO" || { echo "⚠️ $1: cannot cd to $REPO"; exit 1; }
}

# One lock for all three jobs: each of them ends in the notify flow, and two runs
# interleaving `--mark` writes against the same notify state would lose a receipt.
# A held lock means another run is doing this work, so exit 0 silently. A lock
# older than 30 minutes belongs to a run that died without its EXIT trap.
RB_LOCK="${REBALANCE_LOCK_DIR:-${TMPDIR:-/tmp}/observatory-rebalance-cron.lock}"
rb_lock() {
  if ! mkdir "$RB_LOCK" 2>/dev/null; then
    if [ -n "$(find "$RB_LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
      rm -rf "$RB_LOCK" 2>/dev/null
      mkdir "$RB_LOCK" 2>/dev/null || exit 0
    else
      exit 0
    fi
  fi
  trap 'rm -rf "$RB_LOCK" 2>/dev/null' EXIT
}

# Runs `pnpm -s <args>` and keeps the last stdout line that looks like JSON; the CLI
# prints exactly one, and stderr (warnings, stack traces) is never forwarded.
# Sets RB_JSON and RB_RC.
rb_cli() {
  local out
  out="$("$RB_PNPM" -s "$@" 2>/dev/null)"
  RB_RC=$?
  RB_JSON="$(printf '%s\n' "$out" | grep -E '^\{' | tail -1)"
}

# Reads JSON with node (always present: the CLI itself runs on it), so the host
# needs no jq. Prints the value at a dotted path ("" for null/missing; arrays and
# objects as JSON). `rb_get "$json" events.0.id`.
rb_get() { # <json> <path>
  RB_IN="$1" RB_PATH="$2" node -e '
    let v; try { v = JSON.parse(process.env.RB_IN) } catch { process.exit(3) }
    for (const k of process.env.RB_PATH.split(".")) v = v == null ? undefined : v[k]
    if (v === undefined || v === null) process.exit(0)
    process.stdout.write(typeof v === "object" ? JSON.stringify(v) : String(v))
  ' 2>/dev/null
}

# True when the JSON parses.
rb_is_json() { [ -n "$1" ] && RB_IN="$1" node -e 'JSON.parse(process.env.RB_IN)' 2>/dev/null; }

# Count of an array at a path (0 when missing).
rb_len() { # <json> <path>
  RB_IN="$1" RB_PATH="$2" node -e '
    let v; try { v = JSON.parse(process.env.RB_IN) } catch { v = null }
    for (const k of process.env.RB_PATH.split(".")) v = v == null ? undefined : v[k]
    process.stdout.write(String(Array.isArray(v) ? v.length : 0))
  ' 2>/dev/null || echo 0
}

# Marks events sent on a channel. A mark that fails means the event repeats next run.
rb_mark() { # <comma-separated ids> <channel>
  [ -n "$1" ] || return 0
  "$RB_PNPM" -s rebalance:notify --mark "$1" --channel "$2" >/dev/null 2>&1
}

# DISCORD_BOT_TOKEN from the environment, else from the trader profile's .env.
# Only that one line is read; the file is never sourced and the value never printed.
rb_discord_token() {
  if [ -n "${DISCORD_BOT_TOKEN:-}" ]; then
    printf '%s' "$DISCORD_BOT_TOKEN"
    return
  fi
  local file="${REBALANCE_DISCORD_ENV:-$HOME/.hermes/profiles/trader/.env}" line
  [ -r "$file" ] || return 0
  line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?DISCORD_BOT_TOKEN=' "$file" | tail -1)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

# The Discord thread for a proposal, from the control plane's ledger
# ({version, subjects: {"proposal:<id>": {thread_id, ...}}}). Empty when none.
rb_thread_id() { # <proposal id>
  [ -r "$RB_LEDGER" ] || return 0
  RB_FILE="$RB_LEDGER" RB_KEY="proposal:$1" node -e '
    const fs = require("fs")
    try {
      const d = JSON.parse(fs.readFileSync(process.env.RB_FILE, "utf8"))
      const t = d && d.subjects && d.subjects[process.env.RB_KEY] && d.subjects[process.env.RB_KEY].thread_id
      if (t) process.stdout.write(String(t))
    } catch {}
  ' 2>/dev/null
}

# The notify flow: list pending events, print and mark the Telegram ones, then
# deliver the Discord ones. Returns 1 only when the notify command could not run
# or a Telegram receipt could not be recorded.
#
# Order matters for Discord: a proposal's `created` event comes before its status
# events, so the thread exists in the ledger by the time a status line looks for it.
rb_notify_flow() {
  rb_cli rebalance:notify
  if [ "$RB_RC" -ne 0 ] || ! rb_is_json "$RB_JSON" || [ "$(rb_get "$RB_JSON" ok)" != "true" ]; then
    echo "⚠️ Rebalance notify could not run (exit $RB_RC) — run: pnpm rebalance:notify"
    return 1
  fi
  local events="$RB_JSON" n i channels text id
  n="$(rb_len "$events" events)"
  [ "$n" -gt 0 ] || return 0

  # Telegram: stdout is the delivery, so print first and record after.
  local tg_ids=""
  for ((i = 0; i < n; i++)); do
    channels="$(rb_get "$events" "events.$i.channels")"
    text="$(rb_get "$events" "events.$i.telegram")"
    case "$channels" in *'"telegram"'*) ;; *) continue ;; esac
    [ -n "$text" ] || continue
    id="$(rb_get "$events" "events.$i.id")"
    printf '%s\n' "$text"
    tg_ids="${tg_ids:+$tg_ids,}$id"
  done
  if ! rb_mark "$tg_ids" telegram; then
    echo "⚠️ Rebalance notify: could not record the Telegram receipts; these lines may repeat."
    return 1
  fi

  # Discord: optional at runtime. Without the control plane or the bot token, say so
  # once and leave the events pending for a run that has them.
  local token="" reason="" rar=""
  if [ -z "${HERMES_CONTROL_PLANE:-}" ]; then
    reason="control plane not configured"
  else
    rar="$HERMES_CONTROL_PLANE/gateway/scripts/run-agent-request.sh"
    token="$(rb_discord_token)"
    if [ ! -x "$rar" ]; then
      reason="control plane not found at HERMES_CONTROL_PLANE"
    elif [ -z "$token" ]; then
      reason="trader Discord env missing"
    fi
  fi

  local kind pid title prompt thread unmarked=0
  for ((i = 0; i < n; i++)); do
    channels="$(rb_get "$events" "events.$i.channels")"
    case "$channels" in *'"discord"'*) ;; *) continue ;; esac
    if [ -n "$reason" ]; then
      echo "Discord thread not opened: $reason"
      return 0
    fi
    id="$(rb_get "$events" "events.$i.id")"
    kind="$(rb_get "$events" "events.$i.kind")"
    pid="$(rb_get "$events" "events.$i.proposalId")"
    if [ "$kind" = "created" ]; then
      title="$(rb_get "$events" "events.$i.threadTitle")"
      prompt="$(rb_get "$events" "events.$i.threadPrompt")"
      if "$rar" --kind proposal --key "proposal:$pid" --title "$title" --prompt "$prompt" --origin sweep >/dev/null 2>&1; then
        rb_mark "$id" discord || unmarked=1
      fi
      continue
    fi
    text="$(rb_get "$events" "events.$i.discord")"
    [ -n "$text" ] || continue
    thread="$(rb_thread_id "$pid")"
    [ -n "$thread" ] || continue   # no thread yet: stays pending until `created` opens one
    if printf '%s\n' "$text" | "$RB_PYTHON" "$HERMES_CONTROL_PLANE/gateway/scripts/send_discord.py" \
      --bot-token "$token" --channel-id "$thread" --usage-unit-key rebalance-notify >/dev/null 2>&1; then
      rb_mark "$id" discord || unmarked=1
    fi
  done
  if [ "$unmarked" -ne 0 ]; then
    echo "⚠️ Rebalance notify: could not record a Discord receipt; that message may repeat."
    return 1
  fi
  return 0
}
