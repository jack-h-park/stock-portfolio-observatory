# Rebalancing P3 — triggers, notifications and cron wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The recurring workflow from spec §5.
- A monthly proposal with the LLM.
- Engine-only trigger proposals after refreshes.
- One Discord thread per proposal, opened through the trader agent, with status lines appended as the proposal moves.
- Awareness notices to the trader Telegram topic.
- Everything declared as cron jobs that are created **paused**.

**Architecture:**
- All detection and decision logic is pure TypeScript in the Observatory: `lib/rebalance/triggers.ts` and `lib/rebalance/notify.ts`. Small host-owned state files hold the debounce and "already notified" state. Write CLIs print JSON.
- Thin bash cron wrappers in `deploy/hermes/` turn that JSON into:
  - Telegram lines on stdout, which Hermes delivers;
  - Discord thread calls through the control plane's `run-agent-request.sh`, using a new `proposal` kind;
  - status lines through its `send_discord.py`.
- The control-plane change (allow the `trader` profile, add the `proposal` kind) is its own task, in its own repo and branch.

**Tech Stack:** TypeScript, `node:test`, bash, Python (control plane), pytest (control plane).

**Spec:** `docs/superpowers/specs/2026-10-14-rebalancing-workflow-design.md` §5. Operator guide: `docs/rebalancing.md`.

## Global Constraints

- All P1 and P2 constraints still apply.
- Trigger proposals are engine-only and never call an LLM. Only the monthly job calls the LLM.
- **Debounce.** A trigger key fires at most once per 14 days unless its magnitude grows by ≥ 25% over the last fired magnitude. When a proposal is open, a firing trigger is appended to it (`appendTrigger`) instead of creating a new one.
- **Trigger keys and magnitudes:**
  - `band:<sleeve>`: |distance outside band| in percentage points;
  - `cap:<market>:<ticker>`: excess over `positionCapPct` in percentage points;
  - `harvest`: harvestable loss in KRW, firing when ≥ `bounds.harvestThresholdKrw` and > 0, with no wash-sale conflict on the lots counted;
  - `yearend:<YYYY>-11-15` and `yearend:<YYYY>-12-01`: fire once each, on or after that date within the same year.
- **Data guard.** When the input has health errors, no proposal is created. The CLI reports `blocked: 'health_errors'`, and the wrapper prints one Telegram line.
- **Notification events** come from comparing proposals with `data/rebalance-notify-state.json`. That file holds the last status announced per proposal id, the reminder sent per id, and the reconciliation fingerprint announced. Event kinds:
  - `created`;
  - `status_changed` (`targets_approved`, `plan_approved`, `executing`, `reconciled`, `closed`, `rejected`, `expired`);
  - `reminder` (a draft unreviewed for ≥ 3 days, once);
  - `reconcile_mismatch` (missing entries newly present);
  - `llm_failed` (a monthly proposal whose `llm.status` is `failed`, on creation).
- **Channels** (fleet rule: a decision goes to Discord, awareness to Telegram):
  - Discord thread: `created` opens the thread, with the trader agent composing the opening. `status_changed` and `reminder` append a code-built line.
  - Telegram stdout: `created`, `llm_failed`, `reconcile_mismatch`, `expired` and `blocked`.
  - Messages are English. Lines are fixed templates. The Telegram text never contains account labels or amounts. It may contain the proposal id, counts, sleeve names and the page path.
- **New host-owned files:** `data/rebalance-trigger-state.json` and `data/rebalance-notify-state.json`. Both are gitignored, with config entries `STOCK_REBALANCE_TRIGGER_STATE_PATH` and `STOCK_REBALANCE_NOTIFY_STATE_PATH`, and both are written atomically.
- **Wrappers** follow `deploy/hermes/observatory-health-cron.sh`:
  - the same PATH setup;
  - `cd` into the repo;
  - exit 1 only when the job could not run; findings exit 0;
  - stdout is the Telegram message; silence means nothing to say.
- **Jobs** are declared in `deploy/hermes/install-cron.sh`'s JOBS table, created paused. Installing is not enabling.
  - `rebalance-monthly`: `30 9 1-7 * 1`, the first Monday of the month at 09:30, after the 08:00 briefing. The wrapper exits quietly when today is not the first business day; see Task 3.
  - `rebalance-triggers`: `15 10 * * *`.
  - `rebalance-notify`: `*/30 * * * *`.
- The control-plane call is optional at runtime. If `HERMES_CONTROL_PLANE` (path) or the trader Discord env is missing, the wrapper prints one Telegram line ("Discord thread not opened: …") and continues.

## Review Focus

1. **The refresh and the trigger job run at the same time.** Triggers read the DB read-only, as the adapter already does. A refresh holding `.refresh.lock` makes the trigger job exit 0 with nothing printed, and it retries the next day. Test (Task 1).
2. **Notify-state is missing on the first run while old proposals exist.** The first run seeds the state from current statuses without emitting events, so no flood of old notices. Test (Task 2).
3. **A proposal is deleted by hand.** Its state entry is dropped silently. Test (Task 2).
4. **The Discord thread call fails, e.g. a network error.** The `created` event must not be marked as announced, so the next run retries. Telegram still gets its line once. Implement by recording the two channels separately in notify-state. Test (Task 2).
5. **The monthly job fires in a week that has the 1st on a weekend.** The schedule restricts to days 1–7 and Monday, so it runs on that week's Monday. A Monday-holiday is not handled, and the doc says so.

---

### Task 1: Trigger detection and the triggers CLI

**Files:**
- Create: `lib/rebalance/triggers.ts`, `lib/rebalance/trigger-state.ts`
- Modify: `lib/rebalance/cli.ts` (new command `triggers`), `package.json` (`"rebalance:triggers": "tsx scripts/rebalance-cli.mjs triggers"`), `config.ts`, `.gitignore`, `lib/rebalance/settings-form.ts` / `lib/ui-copy/pages/rebalanceSettings.ts` (the harvest threshold is no longer "reserved": update the copy)
- Test: `tests/rebalance-triggers.test.ts`

**Interfaces:**
```ts
export type TriggerHit = { key: string; magnitude: number; label: string }   // label: fixed English, e.g. 'us_equity 6.2pp outside band'
export function detectTriggers(args: { input: RebalanceInput; policy: AllocationPolicy; classes: InstrumentClasses; taxPolicy: TaxPolicy; today: string }): TriggerHit[]
export type TriggerState = { version: 1; fired: Record<string, { at: string; magnitude: number }> }
export function readTriggerState(path?: string): TriggerState      // missing → empty
export function writeTriggerState(s: TriggerState, path?: string): void
export function dueTriggers(hits: TriggerHit[], state: TriggerState, today: string): TriggerHit[]   // debounce rule
export function markFired(state: TriggerState, hits: TriggerHit[], today: string): TriggerState
```

**CLI behaviour of `triggers [--today]`:**
1. If `.refresh.lock` is present (see `lib/cli/common.ts` for the lock check), output `{ok:true, skipped:'refresh_in_progress'}` and exit 0.
2. Load the policy (not configured → exit 1 as `propose` does), the input, the classes and the tax policy.
3. If there are health errors, output `{ok:true, blocked:'health_errors'}` and exit 0.
4. Otherwise compute `due`. If nothing is due, output `{ok:true, due:[]}`.
5. If a proposal is open, call `appendTrigger` once per due key (the trigger text is the key plus the label) and output `{appendedTo:id}`.
6. Otherwise call `proposeEngineOnly({kind:'trigger', triggers: due keys, suffix: the first key's kind: 'band' | 'cap' | 'harvest' | 'yearend'})`. This requires `proposeEngineOnly` to accept an optional id suffix; check `proposalId` and extend it if needed. Output `{created:id}`.
7. Mark the due keys as fired only after the append or create succeeds.

- [ ] **Step 1: Write the failing tests:**
  - `band hit magnitude is distance outside band`.
  - `within band gives no band hit`.
  - `cap hit per instrument over cap`.
  - `harvest fires at threshold and not below; zero threshold disables`.
  - `harvest ignores lots with a wash-sale conflict`.
  - `yearend keys fire on/after Nov 15 and Dec 1 once per year`.
  - `debounce: refire after 14 days, or earlier on 25% growth`.
  - `CLI appends to an open proposal instead of creating`.
  - `CLI creates a trigger proposal with suffix`.
  - `refresh lock → skipped, exit 0` (Review Focus 1).
  - `health errors → blocked, no state change`.
  - `state is marked only after success`.
- [ ] **Step 2: Run and expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and expect PASS.** Also run `pnpm test` and `pnpm typecheck`.
- [ ] **Step 5: Commit:** `feat(rebalance): trigger detection with debounce, and the triggers CLI`.

### Task 2: Notification events and the notify CLI

**Files:**
- Create: `lib/rebalance/notify.ts`
- Modify: `lib/rebalance/cli.ts` (command `notify` with `--mark <eventId>[,<eventId>…] --channel telegram|discord`), `package.json` (`rebalance:notify`), `config.ts`, `.gitignore`
- Test: `tests/rebalance-notify.test.ts`

**Interfaces:**
```ts
export type NotifyEvent = {
  id: string                       // `${proposalId}:${kind}:${detail}` stable
  proposalId: string
  kind: 'created' | 'status_changed' | 'reminder' | 'reconcile_mismatch' | 'llm_failed'
  detail: string                   // status name, or count, or reason code
  channels: ('telegram' | 'discord')[]
  telegram: string | null          // fixed-template English line, no account labels/amounts
  discord: string | null           // fixed-template status line for the thread (not for 'created')
  threadTitle: string | null       // for 'created': '⏳ M/D · Rebalance <id>'
  threadPrompt: string | null      // for 'created': facts for the trader agent to compose from (see below)
}
export type NotifyState = { version: 1; seeded: boolean; announced: Record<string, { telegram?: string; discord?: string }> }   // eventId → ISO when sent per channel
export function pendingEvents(proposals: Proposal[], state: NotifyState, now: Date): NotifyEvent[]
export function seedState(proposals: Proposal[], now: Date): NotifyState
export function markSent(state: NotifyState, eventIds: string[], channel: 'telegram' | 'discord', now: Date): NotifyState
```

`threadPrompt` is all facts, with no account labels:
- the id, kind and triggers;
- the decision, with from→to per changed sleeve;
- the outlook summary (≤ 600 chars) and its confidence;
- counts of instructions by kind;
- the plan's tax effect, rounded to the nearest 10,000 KRW;
- warning counts by code;
- the page path;
- the instruction: "Write a short opening (≤ 1,200 chars) for the maintainer: what this proposal suggests and why, what to check first, and that approval happens on the page. Do not invent figures. This is not advice."

**CLI behaviour:**
- `notify` with no flags prints `{ok, events: NotifyEvent[]}` and changes nothing, except seeding on the first run (Review Focus 2).
- `notify --mark ids --channel c` records those event ids as sent on that channel.
- The wrapper calls `--mark` per channel after each successful send (Review Focus 4).

- [ ] **Step 1: Write the failing tests:**
  - `first run seeds without events`.
  - `new proposal yields created with telegram+discord`.
  - `status change yields one status_changed per transition`.
  - `reminder once after 3 days in draft`.
  - `reconcile mismatch only when missing grows`.
  - `llm_failed on a failed monthly`.
  - `marking telegram leaves discord pending`.
  - `deleted proposal entries are dropped` (Review Focus 3).
  - `telegram text has no account label or amount`: fixture with labels `Secret Broker` / `ACC-1`.
  - `threadPrompt has no account label`.
- [ ] **Step 2: Run and expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and expect PASS.** Also run `pnpm test` and `pnpm typecheck`.
- [ ] **Step 5: Commit:** `feat(rebalance): notification events with per-channel delivery state`.

### Task 3: Cron wrappers and job declarations

**Files:**
- Create: `deploy/hermes/rebalance-monthly-cron.sh`, `deploy/hermes/rebalance-triggers-cron.sh`, `deploy/hermes/rebalance-notify-cron.sh`, `deploy/hermes/rebalance-lib.sh` (shared PATH and helpers)
- Modify: `deploy/hermes/install-cron.sh` (JOBS table entries, and the header comment listing the jobs), `docs/rebalancing.md` (operations section)
- Test: `tests/rebalance-cron-wrappers.test.ts`. It runs the wrappers under `bash` with a fake `pnpm` on PATH that prints canned JSON, and with a fake `run-agent-request.sh` / `send_discord.py`, using env vars to point at them. It asserts stdout and the `--mark` calls.

**Behaviour:**
- **`rebalance-monthly-cron.sh`:**
  1. Exits 0 silently unless today (`date +%d`) is ≤ 7 and it is Monday, as the guard for the cron expression semantics.
  2. Runs `pnpm -s rebalance:propose --kind monthly`.
  3. Prints one Telegram line for `created`, or one line for `open_proposal_exists`, or exits 1 with one line for `not_configured` / errors.
  4. Then runs the notify flow below.
- **`rebalance-triggers-cron.sh`:** runs `pnpm -s rebalance:triggers` and prints at most one Telegram line, for created, appended or blocked. Then it runs the notify flow.
- **`rebalance-notify-cron.sh` (and the notify flow):**
  1. `pnpm -s rebalance:notify` → events.
  2. For each event with `telegram`, print it, then `--mark … --channel telegram`.
  3. For `created` with `discord` pending: when `HERMES_CONTROL_PLANE` and the trader Discord env are present, call `"$HERMES_CONTROL_PLANE/gateway/scripts/run-agent-request.sh" --kind proposal --key proposal:<id> --title "<threadTitle>" --prompt "<threadPrompt>" --origin sweep`. On exit 0, `--mark … --channel discord`.
  4. For status lines, read the thread id from the control-plane ledger (`rebalance-proposal-threads.json`, path from `run-agent-request.sh`'s convention) and send with `send_discord.py --channel-id <thread> --usage-unit-key rebalance-notify`. On success, mark.
  5. When the control plane is absent, print one Telegram line per run, "Discord thread not opened: control plane not configured", and leave the discord events pending.
  - Use `jq` if it exists on the host; check with `command -v jq`. Otherwise use `node -e` for JSON handling.
- **`install-cron.sh`:** add the three jobs with the schedules from the Global Constraints, created paused. Update the header comment.

Steps:
- [ ] **Step 1: Write the failing wrapper tests.** Cover each path above: weekday guard, created, open, not_configured, blocked, control plane absent, thread call failure leaves discord pending, and status line sent and marked.
- [ ] **Step 2: Run and expect FAIL.**
- [ ] **Step 3: Implement.** Run `bash -n` on every wrapper, and run `shellcheck` if it is installed.
- [ ] **Step 4: Run and expect PASS.** Also run `pnpm test`.
- [ ] **Step 5: Commit:** `feat(rebalance): cron wrappers for monthly, triggers and notifications (installed paused)`.

### Task 4: Control plane — `proposal` kind for the trader agent (repo `hermes-control-plane`)

**Repo:** `~/workspace/ai-assets/jackhpark-hermes-control-plane`. Work in a NEW worktree under its `.claude/worktrees/`, branched from `origin/main`. The main checkout carries another session's uncommitted work; never touch it.

**Files:**
- Modify: `gateway/scripts/run-handoff.sh` (profile whitelist: add `trader`), `gateway/scripts/run-agent-request.sh`
  - Add kind `proposal`: `PROFILE=trader`, `STATE_NAME=rebalance-proposal-threads.json`, keys must start with `proposal:`.
  - `--link "${OBSERVATORY_BASE_URL%/}/rebalance/proposals/${KEY#proposal:}"` when `OBSERVATORY_BASE_URL` is set.
  - Add it to the ⏳-title case.
- Modify: `gateway/env/trader.env.example` (document `DISCORD_BOT_TOKEN`, `DISCORD_HOME_CHANNEL`, `DISCORD_NOTIFY_USER_ID` as used by rebalance threads), `docs/overview/rules-of-engagement.md` (a row: "Rebalance proposal (trader) → Discord thread (decision)", and the trader channel identity), `distributions/trader/SOUL.md` (one line: rebalance proposal threads are answered in Discord; approvals happen on the Observatory page; never place rebalance orders)
- Test: extend `tests/agent_nudge/test_nudge_state_and_handoff.py` (or the closest existing test of kinds and profiles): `proposal` maps to trader with its ledger, a bad key prefix exits 2, and trader passes the run-handoff whitelist.

- [ ] Follow that repo's AGENTS.md / CLAUDE.md and its test commands (`pytest` per its README). Its docs-sync tests must pass.
- [ ] Commit on the worktree branch, `claude/rebalance-proposal-threads`. Do not push.
