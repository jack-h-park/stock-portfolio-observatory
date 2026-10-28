# Rebalancing

The rebalancer turns the portfolio's sleeve targets into lot-level sell and buy instructions with their tax effect, and records what you did about them. It is a review tool: it produces inputs to your decision, nothing more. Design and decisions: [the spec](superpowers/specs/2026-10-14-rebalancing-workflow-design.md).

## What it is, and what it is not

- It never places, transmits or schedules an order. You place every order by hand at the broker, then record the fill.
- It is not investment or tax advice. The figures are the Observatory's own estimates under the policy you configured.
- Only taxable accounts owned by you are in scope. IRP, pension savings and ISA accounts, and child accounts, are never in an allocation, a total or a plan.
- Nothing guesses a sleeve. A security without a classification is reported and left out of the totals.
- Phase status: this guide covers the deterministic engine and the review pages (P0 and P1). A manual or triggered proposal is engine-only: it holds the targets and plans trades against them. A monthly proposal adds the LLM judgment (P2), described below. Scheduled triggers and chat notifications (P3) run as Hermes cron jobs; see "Operations". They are installed paused, so nothing runs until each job is resumed.

## Sleeves

Holdings are classified by economic exposure into exactly six sleeves: `kr_equity`, `us_equity`, `bonds`, `gold`, `crypto`, `cash`.

- `asset_class = 'gold'` is `gold`, and `market = 'CRYPTO'` is `crypto`. These need no entry.
- Any other security needs an entry in the instrument classes file. A KR-listed fund that tracks US stocks is `us_equity`, not `kr_equity`.

## Host-owned files

Three paths belong to the host that serves the app. They are gitignored and never pushed, and each has an environment override. All writes are atomic (temp file, then rename).

| File | Override | Example | Holds |
|---|---|---|---|
| `data/allocation-policy.json` | `STOCK_ALLOCATION_POLICY_PATH` | `data/allocation-policy.example.json` | Sleeve targets and bands, hard bounds, limits, buy lists, per-account rules, target history |
| `data/instrument-classes.json` | `STOCK_INSTRUMENT_CLASSES_PATH` | `data/instrument-classes.example.json` | `MARKET:TICKER` mapped to a sleeve |
| `data/rebalance-proposals/` | `STOCK_REBALANCE_PROPOSALS_DIR` | none (a directory of one JSON file per proposal) | Each proposal, its input snapshot, plan, fills and event log |

The example policy holds placeholder numbers for illustration only. Do not copy them as a recommendation.

Policy fields:

- `bounds.sleeves`: the minimum and maximum each sleeve target may take. The cash minimum is also the cash floor buys must leave behind.
- `bounds.positionCapPct`: a single position above this share of the total is sold down to it. `0` disables the cap.
- `bounds.maxTargetShiftPctPerCycle`: the most one sleeve target may move in one approval.
- `bounds.maxTurnoverPctPerProposal`: sells are scaled down so they stay under this share of the total. `0` disables the cap.
- `bounds.minTradeKrw`: smaller trades are left out.
- `bounds.staleDataDays`: an account whose data is older than this is flagged. An account's data date is the later of its latest holdings date and its latest transaction date; an account with neither is flagged as unknown.
- `bounds.harvestThresholdKrw`: not read by the engine yet. It is reserved for the P3 loss-harvest trigger.
- `targets`: per sleeve, a target percentage and a band. A sleeve inside its band is left alone; one outside it moves back to the nearest band edge, not to the target. Targets must sum to 100 and sit inside their bounds.
- `preferredInstruments`: the buy list for each sleeve (market, ticker, brokerage, account).
- `investor`: optional. `usTaxPerson: true` (the checkbox under Limits) tells the LLM never to suggest a fund or ETF organized outside the US, since a US tax person holding one owes PFIC reporting. Outside the US it then suggests only operating companies. A policy without it is read as `false`.
- `accounts`: per `(brokerage, account)` rules: `lotMethod` (`fifo`, `specific` or `average`), `fractional`, `managedBy` and `excludedCash`.

Accounts are identified by the `(brokerage, account)` pair as the ingest stores it, never by the last four digits.

## First-time setup

Do these in order on the host that serves the app. Settings are at `/rebalance/settings`.

1. **Settings.** Open the settings page and save once; a first save starts from every sleeve at 0, bounds 0 to 100, band 5, and the limits from the example file. Alternatively copy `data/allocation-policy.example.json` to `data/allocation-policy.json`. Set the bounds and limits.
2. **Classes.** Map every held security that is not gold or crypto to a sleeve (the classes card on the settings page, or edit `data/instrument-classes.json`). Unmapped holdings show as `unclassified` warnings and do not count. If the file cannot be read, `/rebalance` and the proposal's drift card say so and link to the settings instead of showing an allocation.
3. **Accounts.** For each taxable account, set its lot method, whether it trades fractional units, whether another party manages it, and whether its cash is excluded. Confirm the lot method at each broker before relying on lot-level sells (see "What stays open").
4. **Buy lists.** For each sleeve you may raise, list the instruments and the account each is bought in. A sleeve that needs a buy and has no list gets a `no_buy_list` warning and no buy.
5. **Targets.** Set a target and band for each of the six sleeves. They must sum to 100 and stay inside the bounds.
6. **Create a proposal.** On `/rebalance`, create a manual proposal (or run `pnpm rebalance:propose`).

Creating a proposal is refused when no policy is configured, when an error-severity data check is failing, or when another proposal is still open. Only one proposal is open at a time: one in `draft`, `targets_approved`, `plan_approved` or `executing`. A `reconciled` proposal waiting for you to close it does not hold the slot, so a forgotten close never blocks the next monthly or trigger proposal.

## Status flow

```
draft -> targets_approved -> plan_approved -> executing -> reconciled -> closed
  |             |                  |
  +-------------+------------------+--> rejected
draft -> expired (not approved within 7 days)
```

- A proposal that holds the targets (every engine-only proposal) goes from `draft` straight to `plan_approved` when you approve the plan.
- A proposal that changes targets goes `draft`, then `targets_approved` (the new targets are written to the policy and the plan is rebuilt against them), then `plan_approved`.
- A plan with no buy or sell cannot be approved (`empty_plan`): it would have nothing to fill or reconcile. Reject the proposal, or change the targets or skips.
- The first recorded fill moves `plan_approved` to `executing`.
- `executing` becomes `reconciled` only when every buy and sell has a fill record and every executed fill has a matching transaction. You then close it.
- You may reject a proposal until the plan is approved, with a reason. Rejecting after targets were approved keeps those targets.
- A reconciled, closed, rejected or expired proposal frees the slot for the next one. A reconciled one can still be closed afterwards.

## The proposal page

Each proposal is at `/rebalance/proposals/<id>`; the status card shows the status, the next step, dates and triggers, and the reject and close controls.

- **Summary.** Allocation in the proposal's snapshot and now, the key figures (turnover, this plan's tax effect with the year total beneath it, harvested loss, Korean gain and deduction used and remaining, US short and long gains), the warnings and each account's data date.
  - *This plan's tax effect* is the plan's incremental tax: the year's estimated tax with the plan's sells minus the year's estimated tax on the gains already realized this year (YTD) alone. It is negative when the plan lowers the year's tax, for example losses sold against this year's gains, and the page marks it as a tax reduction. The *year total* is the estimated tax for YTD plus the plan.
- **Targets.** Shown only for a proposal that changes targets. Editable in `draft`; read-only afterwards.
- **Plan.** The sleeve moves, then the instructions grouped by account: sells with the lots they use, buys, and transfers where an account needs cash. In `draft` and `targets_approved` you can skip instructions and recompute the plan, then approve it.
- **Fills.** Once the plan is approved, record each instruction as executed (quantity, price, date) or skipped (a note is required). An executed quantity may not exceed the planned one. Below the form, the reconciliation shows matched fills, fills with no transaction yet, executed trades the plan did not contain, and instructions with no fill record.

Everything is stored in the proposal file with an event log. The plan is a function of its inputs; `today` is a parameter.

## Command line

`pnpm rebalance:propose`, `pnpm rebalance:reconcile` and `pnpm rebalance:status` run `scripts/rebalance-cli.mjs`. Unlike the read-only tax CLIs, these write: they create and update files under the proposals directory. They place no order and send nothing.

| Command | Does |
|---|---|
| `propose [--kind manual\|trigger\|monthly] [--trigger <text>] [--today YYYY-MM-DD] [--no-llm]` | Expires stale drafts, then creates a proposal. `--kind monthly` asks the configured LLM runner (`STOCK_REBALANCE_LLM_RUNNER`) for a validated judgment; any LLM failure still creates the proposal with targets held. Other kinds, and `--no-llm`, create an engine-only proposal. `--trigger` may repeat. |
| `reconcile [--today YYYY-MM-DD]` | Expires stale drafts, then reconciles every `executing` proposal against ingested transactions, moving it to `reconciled` when complete. |
| `status` | Reports the open proposal, if any. |

`--today` defaults to today's date in the portfolio calendar (`STOCK_TIME_ZONE`, default `America/Los_Angeles`), the same day the pages use.

Each command prints one JSON line with `schemaVersion` 1, `ok` and `command`:

- `propose`: `id`, `status`, `decision`, `instructions`, `warnings`, `llm` and `path` on success. `llm` is null for an engine-only manual or trigger proposal, else `{ status, reason, attempts }` (`status` `skipped` for `--kind monthly --no-llm`); `status` `failed` with `reason` `runner_unavailable`, `runner_failed`, `timeout` or `invalid_output` means the targets were held. On refusal, `ok` is false with `reason` (`not_configured`, `health_errors` or `open_proposal_exists`), `detail` and `openId`.
- `reconcile`: `expired`, `reconciled` (per proposal: `complete`, `matched`, `missing`, `unfilled`, `unplanned`) and `failed`.
- A proposal file that cannot be read stops `propose`, `reconcile` and `status` with `reason` `error`; `detail` names the file (its basename).
- `status`: `open` is null, or the open proposal's `id`, `status`, `kind`, `instructions`, `fills`, `warnings`, `expiresAt` and `path`.

Exit codes: 0 ran (including an LLM fallback to hold and an `open_proposal_exists` refusal), 1 could not run (`not_configured`, `health_errors`, an unreadable store), a reconcile failure or an unexpected error, 2 usage.

## Monthly proposal and the LLM judgment

`pnpm rebalance:propose --kind monthly` builds the usual engine proposal and first asks an LLM runner whether the sleeve targets should move. The engine stays deterministic: the LLM never produces a quantity, a tax figure or an order. Its output can change only the target change, the outlook, the ideas and the questions for you. `--no-llm` skips the step and creates an engine-only proposal with the targets held; on a monthly run the proposal records the LLM step as `skipped`, so the page says it was skipped on purpose.

| Variable | Meaning | Default |
|---|---|---|
| `STOCK_REBALANCE_LLM_RUNNER` | Which CLI judges: `claude` or `codex` | `claude` |
| `STOCK_REBALANCE_LLM_MODEL` | Model name passed to the CLI | unset (the CLI's own default) |
| `STOCK_REBALANCE_LLM_TIMEOUT_MS` | Time allowed for one attempt | `600000` |

Any other `STOCK_REBALANCE_LLM_RUNNER` value runs `claude` and prints a warning line to stderr; the JSON on stdout is unchanged.

**Host requirements.** The chosen CLI must be on the `PATH` the job runs with (a launchd or cron job often has a shorter `PATH` than your shell), and it must be logged in to an account on that host. There are at most two attempts of up to the timeout each, and a timeout (which ends the run at once) adds a 5 second kill grace, so the worst case is `2 × STOCK_REBALANCE_LLM_TIMEOUT_MS + 5 s` (20 min 5 s at the default). Any outer job timeout must be longer than that, or the job is killed before the fallback proposal is written. The scheduled monthly job enforces this itself; see "The monthly time budget" under "Operations".

**Runner isolation.** Each runner starts in a fresh empty temporary directory, removed afterwards, so no repository file, `CLAUDE.md` or project setting is reachable from its working directory.

- `claude` (the default, and the recommended runner) runs as `claude -p --output-format json --tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch --restricted --strict-mcp-config --no-session-persistence --permission-prompts none`: only the two web tools exist, user, project and local settings files and MCP servers are not loaded, nothing that would need a permission prompt is allowed, and no session is saved.
- `codex` runs as `codex exec --skip-git-repo-check --sandbox read-only --ephemeral --color never -C <temp dir> --output-last-message <temp dir>/last-message.txt -`, and only the final-message file is read as the answer (stdout can echo the prompt). Codex has no way to limit the model to web tools the way `claude` does: its read-only sandbox can still read files the host account can read. Prefer `claude` unless you accept that.

**Hold is the default.** A change needs a reason for every changed sleeve and at least one source with a URL and an ISO date. The answer must pass validation or it is not used:

- it is valid against the output schema and names only known sleeves;
- the targets sum to 100 within 0.05;
- each target is inside the sleeve's bounds;
- each target moves at most `maxTargetShiftPctPerCycle` from the current policy target;
- bands are never changed by the LLM.

If validation fails, the runner is asked once more with the errors appended. If the second attempt also fails, or the runner is missing, exits with an error or times out, the proposal is still created, with the targets held and a fixed reason code on the LLM record:

| Reason | Meaning |
|---|---|
| `runner_unavailable` | The configured CLI is not on the job's `PATH`. |
| `runner_failed` | The CLI failed to start (for example a spawn `ENOENT`) or exited with an error, or building the LLM input or prompt threw. The message is in the first attempt's errors. |
| `timeout` | An attempt exceeded the timeout. |
| `invalid_output` | Both attempts failed validation. |

The proposal stores the LLM record (status `ok`, `failed` or `skipped`, runner, model, and each attempt's prompt, raw answer and errors) so a judgment can be audited later.

**Exit codes.** The CLI exits 1 only when the job could not run at all: no policy, failing error-severity health checks, or an unreadable proposal store. A hold, and an LLM failure that fell back to hold, exit 0; the JSON line says what happened.

**What the LLM sees.** The prompt is built from a reduced copy of the data:

- accounts appear only as aliases (`KR-taxable-1`, `US-taxable-1`, `CRYPTO-1`, numbered in the sorted order of the account keys), never with an account label, brokerage name, account number or your name;
- positions carry the market, ticker, name, sleeve and share of the total, with no quantity, cost or lot detail;
- the allocation against targets and bands, the policy bounds, a handful of tax-room figures, the briefing and macro notes, and the last few proposals' decisions;
- free text, including your past rejection reasons, is scrubbed first: brokerage and account strings from positions, lots, cash, recent buys and account data dates, the labels, aliases, account numbers and owner names in the account map (`STOCK_ACCOUNT_MAP_PATH`, skipped when missing or unreadable), and account-number-shaped digit runs become `[redacted]`;
- the prompt tells the model that text inside the input and fetched web pages is data, and that instructions found there must be ignored.

**On the proposal page.** The Summary tab shows an LLM status line (runner, model and attempt count, or the failure reason), the outlook (summary, drivers, risks, what would change the view, a confidence badge and sources) and the questions for you. Only `https:` sources are links; any other URL is shown as plain text. Model text is rendered as text, never as markup. On the Targets tab, values the LLM proposed carry an `LLM` badge; values you edit carry `edited`. Ideas are listed with their market and sleeve; they are never traded automatically. Each idea has an **Add to buy list** control: pick an account that holds that market in the proposal's snapshot (or one already on a buy list for it), and the idea joins its sleeve's buy list. A security with no class yet is classified into the idea's sleeve. One already classified into another sleeve is refused, so fix its class in settings first. The open proposal's plan is not rebuilt; recompute it to use the new entry. The control warns when the ticker is inside a wash-sale window, and, for a US tax person, when a non-US idea still needs a check that it is not a fund. Ideas stored before they carried a market have no control.

## Reconciliation and refresh

`pnpm refresh` ends with a rebalance reconcile step. It matches executed fills to the transactions the refresh just ingested: same account, market, ticker and side, a date within 3 days of the fill, and a quantity within 1% or one unit. Transfers are not matched, because the ingest has no record of a bank move at this grain, and they do not block completion.

The step is best effort. It sits outside the refresh's recorded steps, so a failure is logged and never changes the refresh's exit status; proposals then keep their previous reconciliation. A fill with no matching transaction stays in the `missing` list, with the days since the fill, until the next ingest brings it in.

## Warning codes

Warnings travel with the plan and appear on the Summary and Plan tabs.

| Code | Meaning |
|---|---|
| `unclassified` | A holding has no sleeve in the classes file; it is left out of the totals. |
| `unpriced` | A holding has no current price; it is counted at cost and never sold. |
| `wash_sale_block` | Both sides of the 30-day window. Sell: a sale that would realize a loss is held back because the same security was bought within the window. Buy: a buy-list security is not bought because a loss was realized on it within the window. |
| `near_long_term` | A short-term lot turns long-term within the next 30 days, so it is held back. |
| `stale_account` | An account's data is older than `staleDataDays`, or its date is unknown. |
| `turnover_capped` | Sells were scaled down to the per-proposal turnover cap. |
| `below_min_trade` | Trades under `minTradeKrw`, or under one tradable unit, were left out. |
| `cash_floor` | Buys were scaled down to keep cash at its minimum. |
| `no_sellable_lots` | The lots that may be sold do not cover a needed reduction or a position-cap excess. |
| `no_buy_list` | A sleeve needs buys and has no buy list. |
| `no_buy_price` | A buy-list instrument is not held anywhere, so it has no price to buy at. |
| `managed_account` | A buy-list instrument is in an account marked as managed by someone else, so it is not bought. |
| `transfer_needed` | An account lacks the cash for its buys; the plan includes a transfer instruction, or, if you skipped it, cuts the buys to the cash on hand. |

## Operations

Three Hermes cron jobs under the `trader` profile run the rebalance workflow on the ops host. `deploy/hermes/install-cron.sh` declares them in its JOBS table and creates each one **paused**: installing is not enabling. Enable a job with `cron resume <name>`:

```
~/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main --profile trader cron resume rebalance-notify
```

Each wrapper is a `--no-agent --script` entrypoint. Hermes delivers its stdout to Telegram, silence means there is nothing to say, and the exit code is 1 only when the job could not run (not configured, the CLI crashed, the lock stayed held). Findings exit 0. The installer copies the wrappers and `rebalance-lib.sh`, which they source, into the trader profile's scripts directory; re-run it after changing either.

| Job | Schedule | Runs | Its own lines |
|---|---|---|---|
| `rebalance-monthly` | `30 9 1-7 * 1` | Seeds notify, then `pnpm -s rebalance:propose --kind monthly`, then the notify flow | Another proposal is still open; or the run was held by health errors (with `/health` and how to re-run). `not_configured` or a crash: one line, exit 1. |
| `rebalance-triggers` | `15 10 * * *` | Seeds notify, then `pnpm -s rebalance:triggers`, then the notify flow | Triggers were added to the open proposal; or the run was held by health errors. Nothing due, or a refresh in progress, is silent. |
| `rebalance-notify` | `*/30 * * * *` | The notify flow | None beyond the events' lines. |

A proposal the monthly or triggers job creates has no line of its own: the notify flow in the same run prints its `created` event, so it is announced exactly once. Both jobs run `pnpm -s rebalance:notify` before proposing, so on a fresh install the seeding run (which marks everything existing as already announced) happens before the proposal exists and cannot swallow it.

Cron ORs the day-of-month and day-of-week fields when both are set, so `30 9 1-7 * 1` fires on days 1 to 7 and on every Monday. The monthly wrapper exits 0 silently unless today is both a Monday and day 7 or earlier, so it proposes once, on the first Monday of the month, after the 08:00 briefing. `REBALANCE_FORCE_MONTHLY=1` skips that check for a manual run. The monthly job is the only one that calls an LLM; trigger proposals are engine-only.

**The notify flow.** `pnpm -s rebalance:notify` lists the events not yet sent on each channel. The very first run writes a seeded state and reports nothing.

1. Telegram: each event's fixed line is printed, then the events are marked with `pnpm -s rebalance:notify --mark <ids> --channel telegram`. The lines carry proposal ids, counts and page paths, never account labels or amounts.
2. Discord, `created`: `<control plane>/gateway/scripts/run-agent-request.sh --kind proposal --key proposal:<id> --title … --prompt … --origin sweep` opens (or reuses) the proposal's thread, and the trader agent writes the opening. The event is marked for Discord only when that call exits 0. The first failure prints `Discord thread for <id> not opened (exit <n>); will retry`; later failures are silent.
   The `created` receipt means the thread exists, not that its opening message was posted: the control plane composes the opening in the background after the call returns, and a failure there shows up only in `$HERMES_HOME_OPS/logs/handoff-bg.log`. After the first proposal thread opens, check that log (and the thread) once.
3. Discord, status and reminder lines: the thread id is read from the control plane's ledger, `$HERMES_HOME_OPS/state/rebalance-proposal-threads.json`, and the line is posted with `send_discord.py --usage-unit-key rebalance-notify`, under `~/.hermes/hermes-agent/venv/bin/python` when it exists, else `python3` (the same choice `run-agent-request.sh` makes). Failures, and a proposal with no thread yet, retry silently; a line that still fails on its sixth attempt in a thread that exists prints one `not delivered after 6 attempts; dropped` line.
4. Every Discord event is tried at most 6 times, one try per run. After the sixth failure it is marked sent on Discord so it stops retrying, recorded as given up, and a thread that never opened gets one final line. Attempt counts and give-ups live in `data/rebalance-discord-attempts.json` (override `REBALANCE_DISCORD_ATTEMPTS`), a wrapper-owned file beside the notify state; the CLI does not read it, and removing it only resets the counts.
5. Without `HERMES_CONTROL_PLANE_ROOT` (or `HERMES_CONTROL_PLANE`), or without `DISCORD_BOT_TOKEN` in the trader profile's `.env`, the Discord events stay pending. `Discord thread not opened: <reason>` is printed only in a run that printed a proposal's `created` line, so once per proposal.

A receipt that cannot be recorded (`--mark` fails) prints one line and exits 1, since the event would otherwise repeat. So does an attempts file that cannot be written (`could not record Discord attempts`), since the 6-attempt cap would otherwise never be reached.

The Discord channel is the control plane's: an ops-level `notify gate_discord` override, or `GATE_NOTIFY_DISCORD_CHAT_ID` in the trader `.env`, redirects the proposal threads along with everything else that route serves.

**The lock.** All three jobs share one lock, `data/rebalance-cron.lock/` beside the state it protects (override `REBALANCE_LOCK_DIR`), so overlapping runs never interleave notify-state writes. It holds its owner's pid and only the owner removes it. `rebalance-notify` exits 0 silently when it is held. `rebalance-monthly` and `rebalance-triggers` wait for it, polling every 5 seconds for up to 2 minutes (`REBALANCE_LOCK_POLL`, `REBALANCE_LOCK_WAIT`), because the monthly job and the notify job fire at the same 09:30 on the first Monday and notify holds it for seconds; still held after that, they print one line and exit 1. A lock whose owner pid is still alive is held however old it is, so a long monthly LLM step is never taken over. A lock older than 30 minutes whose owner is gone (or that has no pid) is treated as left by a dead run and taken over.

**The monthly time budget.** Hermes kills a `--no-agent` script after the trader profile's `cron.script_timeout_seconds`, which the control plane's `configure-live-trader.sh` sets to 1800. The monthly run can spend the lock wait plus two LLM attempts of `STOCK_REBALANCE_LLM_TIMEOUT_MS` each (default 600000), which at the defaults would leave nothing for writing the proposal and the notify flow. So before proposing, the wrapper takes `REBALANCE_SCRIPT_BUDGET_S` (default 1800, and it must match the Hermes setting), subtracts the time already spent and 180 seconds of reserve, and halves the rest. If that is shorter than the configured timeout (read from the environment, else the repo's `.env.local` or `.env`), it runs the CLI with `STOCK_REBALANCE_LLM_TIMEOUT_MS` lowered to it. If it is under 120 seconds, it runs `--kind monthly --no-llm` and prints one line saying the LLM step was skipped for time. Raising the Hermes script timeout means raising `REBALANCE_SCRIPT_BUDGET_S` with it; lowering it without that lets Hermes kill the run mid-LLM, before the fallback proposal is written.

Environment. Set these in `~/.hermes/profiles/trader/.env`: Hermes reloads that file before each `--no-agent` run, so it is the environment the wrappers see.

| Variable | Default | Used for |
|---|---|---|
| `OBSERVATORY_REPO` | `~/workspace/code/core/jackhpark-stock-observatory` | The checkout the CLI runs in. The wrapper `cd`s there so `.env.local` applies. |
| `HERMES_CONTROL_PLANE_ROOT` | none | The control-plane (`hermes-control-plane`) checkout, under the fleet's name for it. Unset means no Discord delivery; no path is assumed. The wrapper exports it as `HERMES_ROOT` to `run-agent-request.sh`. |
| `HERMES_CONTROL_PLANE` | none | An alias for `HERMES_CONTROL_PLANE_ROOT`; wins when both are set. |
| `HERMES_HOME_OPS` | `~/.hermes/profiles/ops` | The ops profile home that holds the thread ledger; passed on to `run-agent-request.sh`. |
| `STOCK_OBSERVATORY_BASE_URL` | none | Read by the control plane's `run-agent-request.sh`, not by the wrappers: it links each thread to `<url>/rebalance/proposals/<id>`. Unset means no link line. |
| `REBALANCE_SCRIPT_BUDGET_S` | `1800` | The Hermes script timeout the monthly run must fit in; see "The monthly time budget". |

Each wrapper exports `CRON_JOB_NAME` (`rebalance-monthly`, `rebalance-triggers`, `rebalance-notify`) so the control plane's helpers attribute their usage to the job.

The trigger and notify state files are host-owned like the others: `data/rebalance-trigger-state.json` (`STOCK_REBALANCE_TRIGGER_STATE_PATH`) and `data/rebalance-notify-state.json` (`STOCK_REBALANCE_NOTIFY_STATE_PATH`).

**Enablement checklist.** Before resuming anything:

1. Deploy the control plane with the `proposal` kind in `run-agent-request.sh`. Without it, every thread call fails and each proposal gives up after 6 runs.
2. Set `HERMES_CONTROL_PLANE_ROOT` (and `HERMES_HOME_OPS` if the ops profile is not at its default) in `~/.hermes/profiles/trader/.env`, with `STOCK_OBSERVATORY_BASE_URL` for the thread's page link.
3. Confirm `DISCORD_BOT_TOKEN` is in `~/.hermes/profiles/trader/.env`, and that the bot can create threads and post in them (Create Public Threads, Send Messages in Threads) in the trader channel.
4. Re-run `install-cron.sh` so the installed wrappers and `rebalance-lib.sh` match the repo.

Resume order: `rebalance-notify` first. Its first run seeds the state, so existing proposals are not announced; let it run once. Then `rebalance-triggers`, and finally `rebalance-monthly`. A dry run of the monthly job is `REBALANCE_FORCE_MONTHLY=1 ~/.hermes/profiles/trader/scripts/rebalance-monthly-cron.sh`. It creates a real proposal.

## What stays open

- **Lot method per broker.** Each account defaults to `fifo`. Which method a broker actually applies on a sale (first-in-first-out, specific lot or average cost) is a fact about the broker, not something the Observatory can read. Confirm it at each broker and set it on the account before trusting which lots a sell names. Until then, treat the lot choice as a suggestion to verify at order time.
- **Pension and ISA tax treatment** stays undecided on purpose; nothing here picks a value.
- **Enabling the jobs.** The three rebalance jobs are declared and installed paused (see "Operations"). Whether and when to resume each one is an operator decision.
