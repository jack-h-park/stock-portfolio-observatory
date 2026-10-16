# rebalance-lib.sh — shared setup for the rebalance-*-cron.sh wrappers. Sourced, never run.
#
# The three wrappers are Hermes cron `--no-agent --script` entrypoints like
# observatory-health-cron.sh: stdout is delivered verbatim to Telegram, silence means
# nothing to say, and the exit code is 1 only when a job could not run at all.
#
# install-cron.sh copies this file next to the wrappers in the trader profile's
# scripts directory; each wrapper sources it from its own directory.
#
# Environment (all optional). Hermes reloads ~/.hermes/profiles/trader/.env before each
# --no-agent run, so that file is where these are set on the ops host:
#   OBSERVATORY_REPO      the checkout to run in (default ~/workspace/code/core/jackhpark-stock-observatory)
#   HERMES_CONTROL_PLANE_ROOT  the control-plane checkout (the fleet's spelling); HERMES_CONTROL_PLANE is
#                         an alias that wins when set. Neither set: no Discord thread is opened. No default
#                         path is assumed.
#   HERMES_HOME_OPS       the ops profile home holding the thread ledger (default ~/.hermes/profiles/ops)
#   REBALANCE_DISCORD_ENV the env file DISCORD_BOT_TOKEN is read from (default the trader profile's .env)
#   REBALANCE_LOCK_WAIT / REBALANCE_LOCK_POLL  seconds monthly and triggers wait for the lock (120 / 5)
#   REBALANCE_SCRIPT_BUDGET_S  the Hermes script timeout the monthly run must finish within (1800)
#   REBALANCE_PNPM, REBALANCE_PYTHON, REBALANCE_LOCK_DIR, REBALANCE_DISCORD_ATTEMPTS,
#   REBALANCE_TODAY_DOW/DOM: test seams

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
# send_discord.py runs under the Hermes venv interpreter when there is one, as
# run-agent-request.sh does: a bare python3 is the system 3.9 on the ops host.
RB_PYTHON="${REBALANCE_PYTHON:-}"
if [ -z "$RB_PYTHON" ]; then
  RB_PYTHON="${HERMES_REAL_HOME:-$HOME}/.hermes/hermes-agent/venv/bin/python"
  [ -x "$RB_PYTHON" ] || RB_PYTHON="python3"
fi
export HERMES_HOME_OPS="${HERMES_HOME_OPS:-$HOME/.hermes/profiles/ops}"
RB_LEDGER="$HERMES_HOME_OPS/state/rebalance-proposal-threads.json"
# Discord delivery attempts per event id, and the ids given up on. Wrapper-owned and
# host-owned like the notify state it sits beside; the CLI never reads it.
RB_ATTEMPTS_FILE="${REBALANCE_DISCORD_ATTEMPTS:-$REPO/data/rebalance-discord-attempts.json}"
RB_MAX_ATTEMPTS=6

# One lock for all three jobs, beside the state it protects: each job ends in the
# notify flow, and two runs interleaving `--mark` writes would lose a receipt. The
# lock directory holds its owner's pid and only that owner removes it. A lock whose
# owner is still alive is held however old it is; one whose owner is gone (or that
# has no pid) and is older than 30 minutes belongs to a run that died without its
# EXIT trap, and is taken over.
RB_LOCK="${REBALANCE_LOCK_DIR:-$REPO/data/rebalance-cron.lock}"
RB_LOCK_OWNED=0
RB_TMP=""

rb_cleanup() {
  [ -n "$RB_TMP" ] && rm -rf "$RB_TMP" 2>/dev/null
  if [ "$RB_LOCK_OWNED" = 1 ] && [ "$(cat "$RB_LOCK/pid" 2>/dev/null)" = "$$" ]; then
    rm -rf "$RB_LOCK" 2>/dev/null
  fi
}
trap rb_cleanup EXIT

rb_take_lock() {
  mkdir -p "$(dirname "$RB_LOCK")" 2>/dev/null
  if ! mkdir "$RB_LOCK" 2>/dev/null; then
    local owner
    owner="$(cat "$RB_LOCK/pid" 2>/dev/null)"
    owner="${owner//[^0-9]/}"
    [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null && return 1
    [ -n "$(find "$RB_LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ] || return 1
    rm -rf "$RB_LOCK" 2>/dev/null
    mkdir "$RB_LOCK" 2>/dev/null || return 1
  fi
  echo "$$" > "$RB_LOCK/pid"
  RB_LOCK_OWNED=1
}

# `rb_lock nowait`: a held lock means another run is already delivering; exit 0.
# `rb_lock wait <job>`: monthly and triggers must not lose their run to notify,
# which fires at the same minute, so they poll; still held after the wait, they
# say so and exit 1.
rb_lock() { # nowait | wait <job>
  rb_take_lock && return 0
  [ "$1" = wait ] || exit 0
  local limit="${REBALANCE_LOCK_WAIT:-120}" poll="${REBALANCE_LOCK_POLL:-5}" waited=0 span
  while [ "$waited" -lt "$limit" ]; do
    sleep "$poll"
    waited=$((waited + poll))
    rb_take_lock && return 0
  done
  if [ "$limit" -ge 60 ]; then span="$((limit / 60)) minutes"; else span="$limit seconds"; fi
  echo "⚠️ Rebalance $2 skipped: another rebalance job held the lock for $span"
  exit 1
}

# cd into the repo so the CLI picks up .env.local (the store and state paths live there).
rb_enter_repo() { # <label>
  if [ ! -f "$REPO/package.json" ]; then
    echo "⚠️ $1: repo not found at $REPO"
    exit 1
  fi
  cd "$REPO" || { echo "⚠️ $1: cannot cd to $REPO"; exit 1; }
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
# objects as JSON). `rb_get "$json" llm.status`.
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

# The value of KEY: the environment first, then the repo's .env.local and .env (the
# order scripts/env.mjs loads them in, the environment winning). Only that one line is
# read; the files are never sourced. Prints "" when unset.
rb_env_value() { # <key>
  local key="$1" file line
  if [ -n "${!key:-}" ]; then
    printf '%s' "${!key}"
    return
  fi
  for file in "$REPO/.env.local" "$REPO/.env"; do
    [ -r "$file" ] || continue
    line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -1)"
    [ -n "$line" ] || continue
    line="${line#*=}"
    line="${line%\"}"; line="${line#\"}"
    line="${line%\'}"; line="${line#\'}"
    printf '%s' "$line"
    return
  done
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

# Parses the notify JSON once. Prints one tab-separated line per event:
#   index, id, kind, proposalId, telegram pending (0/1), discord pending (0/1), prior Discord attempts
# and writes the text fields to <dir>/<index>.{telegram,discord,title,prompt} (only the non-null ones),
# so multi-line text never has to survive a shell split.
rb_index_events() { # <json> <dir>
  RB_IN="$1" RB_DIR="$2" RB_ATT="$RB_ATTEMPTS_FILE" node -e '
    const fs = require("fs"), path = require("path")
    const events = JSON.parse(process.env.RB_IN).events || []
    let attempts = {}
    try { attempts = JSON.parse(fs.readFileSync(process.env.RB_ATT, "utf8")).attempts || {} } catch {}
    const clean = (s) => String(s).replace(/[\t\n\r]/g, " ")
    const files = { telegram: "telegram", discord: "discord", threadTitle: "title", threadPrompt: "prompt" }
    events.forEach((e, i) => {
      for (const [field, name] of Object.entries(files)) {
        if (e[field] != null) fs.writeFileSync(path.join(process.env.RB_DIR, `${i}.${name}`), String(e[field]))
      }
      const ch = Array.isArray(e.channels) ? e.channels : []
      const tg = ch.includes("telegram") && e.telegram != null ? 1 : 0
      process.stdout.write([i, clean(e.id), clean(e.kind), clean(e.proposalId), tg, ch.includes("discord") ? 1 : 0, Number(attempts[e.id]) || 0].join("\t") + "\n")
    })
  '
}

# Applies this run's Discord outcomes (lines "<id>\t<n>|ok|gaveup") to the attempts
# file, keeping counts only for events still pending; written atomically.
rb_save_attempts() { # <updates file> <index>
  RB_UPD="$1" RB_IDX="$2" RB_ATT="$RB_ATTEMPTS_FILE" node -e '
    const fs = require("fs"), path = require("path")
    const file = process.env.RB_ATT
    let s = {}
    try { s = JSON.parse(fs.readFileSync(file, "utf8")) } catch {}
    const attempts = {}, gaveUp = s.gaveUp && typeof s.gaveUp === "object" ? s.gaveUp : {}
    const pending = new Set(process.env.RB_IDX.split("\n").filter(Boolean).map((l) => l.split("\t")[1]))
    for (const [id, n] of Object.entries(s.attempts || {})) if (pending.has(id)) attempts[id] = n
    const now = new Date().toISOString()
    for (const line of fs.readFileSync(process.env.RB_UPD, "utf8").split("\n").filter(Boolean)) {
      const [id, outcome] = line.split("\t")
      if (outcome === "ok") delete attempts[id]
      else if (outcome === "gaveup") { delete attempts[id]; gaveUp[id] = now }
      else attempts[id] = Number(outcome)
    }
    const kept = Object.fromEntries(Object.entries(gaveUp).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 200))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, attempts, gaveUp: kept }, null, 2) + "\n")
    fs.renameSync(tmp, file)
  ' 2>/dev/null
}

# The notify flow: list pending events, print and mark the Telegram ones, then
# deliver the Discord ones. Returns 1 only when the notify command could not run
# or a receipt could not be recorded.
#
# Order matters for Discord: a proposal's `created` event comes before its status
# events, so the thread exists in the ledger by the time a status line looks for it.
rb_notify_flow() {
  rb_cli rebalance:notify
  if [ "$RB_RC" -ne 0 ] || ! rb_is_json "$RB_JSON" || [ "$(rb_get "$RB_JSON" ok)" != "true" ]; then
    echo "⚠️ Rebalance notify could not run (exit $RB_RC) — run: pnpm rebalance:notify"
    return 1
  fi
  RB_TMP="$(mktemp -d "${TMPDIR:-/tmp}/rb-notify.XXXXXX")" || { echo "⚠️ Rebalance notify could not run: no temp dir"; return 1; }
  local index
  index="$(rb_index_events "$RB_JSON" "$RB_TMP")" || { echo "⚠️ Rebalance notify could not run: unreadable events"; return 1; }
  [ -n "$index" ] || return 0

  local i id kind pid tg dc att
  # Telegram: stdout is the delivery, so print first and record after.
  local tg_ids="" printed_created=0
  while IFS=$'\t' read -r i id kind pid tg dc att; do
    [ "$tg" = 1 ] || continue
    printf '%s\n' "$(cat "$RB_TMP/$i.telegram")"
    tg_ids="${tg_ids:+$tg_ids,}$id"
    [ "$kind" = created ] && [ "$dc" = 1 ] && printed_created=1
  done <<<"$index"
  if ! rb_mark "$tg_ids" telegram; then
    echo "⚠️ Rebalance notify: could not record the Telegram receipts; these lines may repeat."
    return 1
  fi

  # Discord is optional at runtime. Without the control plane or the bot token the
  # events stay pending; the notice rides along with a proposal's created line, so
  # it is said once per proposal rather than every 30 minutes.
  # HERMES_CONTROL_PLANE (the alias) wins over HERMES_CONTROL_PLANE_ROOT (the fleet spelling).
  local token="" reason="" rar="" cp="${HERMES_CONTROL_PLANE:-${HERMES_CONTROL_PLANE_ROOT:-}}"
  if [ -z "$cp" ]; then
    reason="control plane not configured"
  else
    rar="$cp/gateway/scripts/run-agent-request.sh"
    token="$(rb_discord_token)"
    if [ ! -x "$rar" ]; then
      reason="control plane not found at the configured path"
    elif [ -z "$token" ]; then
      reason="trader Discord env missing"
    fi
  fi
  if [ -n "$reason" ]; then
    [ "$printed_created" = 1 ] && echo "Discord thread not opened: $reason"
    return 0
  fi
  # run-agent-request.sh finds its siblings (run-handoff.sh, the thread status helper)
  # through HERMES_ROOT; point it at the same checkout rather than at its own default.
  export HERMES_ROOT="$cp"

  # Each Discord event is tried at most RB_MAX_ATTEMPTS times across runs, then
  # marked as given up so it stops being retried, and recorded in the attempts file.
  local updates="$RB_TMP/updates" n rc thread unmarked=0
  : > "$updates"
  while IFS=$'\t' read -r i id kind pid tg dc att; do
    [ "$dc" = 1 ] || continue
    n=$((att + 1))
    if [ "$kind" = created ]; then
      if "$rar" --kind proposal --key "proposal:$pid" --title "$(cat "$RB_TMP/$i.title" 2>/dev/null)" \
        --prompt "$(cat "$RB_TMP/$i.prompt" 2>/dev/null)" --origin sweep >/dev/null 2>&1; then
        rb_mark "$id" discord || unmarked=1
        printf '%s\tok\n' "$id" >> "$updates"
      else
        rc=$?
        if [ "$n" -ge "$RB_MAX_ATTEMPTS" ]; then
          echo "⚠️ Discord thread for $pid not opened after $RB_MAX_ATTEMPTS attempts (last exit $rc); no more retries. Discuss it on /rebalance/proposals/$pid."
          rb_mark "$id" discord || unmarked=1
          printf '%s\tgaveup\n' "$id" >> "$updates"
        else
          [ "$n" -eq 1 ] && echo "Discord thread for $pid not opened (exit $rc); will retry"
          printf '%s\t%s\n' "$id" "$n" >> "$updates"
        fi
      fi
      continue
    fi
    [ -f "$RB_TMP/$i.discord" ] || continue
    # Status and reminder lines are cheap: retried silently. One with no thread yet
    # waits for `created` to open it, and counts as an attempt so it cannot wait forever.
    thread="$(rb_thread_id "$pid")"
    if [ -n "$thread" ] && "$RB_PYTHON" "$cp/gateway/scripts/send_discord.py" \
      --bot-token "$token" --channel-id "$thread" --usage-unit-key rebalance-notify <"$RB_TMP/$i.discord" >/dev/null 2>&1; then
      rb_mark "$id" discord || unmarked=1
      printf '%s\tok\n' "$id" >> "$updates"
    elif [ "$n" -ge "$RB_MAX_ATTEMPTS" ]; then
      [ -n "$thread" ] && echo "⚠️ Discord status line $id not delivered after $RB_MAX_ATTEMPTS attempts; dropped."
      rb_mark "$id" discord || unmarked=1
      printf '%s\tgaveup\n' "$id" >> "$updates"
    else
      printf '%s\t%s\n' "$id" "$n" >> "$updates"
    fi
  done <<<"$index"
  if ! rb_save_attempts "$updates" "$index"; then
    echo "⚠️ Rebalance notify: could not record Discord attempts; retries may exceed the cap."
    return 1
  fi

  if [ "$unmarked" -ne 0 ]; then
    echo "⚠️ Rebalance notify: could not record a Discord receipt; that message may repeat."
    return 1
  fi
  return 0
}
