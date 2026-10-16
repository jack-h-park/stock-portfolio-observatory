# Rebalancing

The rebalancer turns the portfolio's sleeve targets into lot-level sell and buy instructions with their tax effect, and records what you did about them. It is a review tool: it produces inputs to your decision, nothing more. Design and decisions: [the spec](superpowers/specs/2026-10-14-rebalancing-workflow-design.md).

## What it is, and what it is not

- It never places, transmits or schedules an order. You place every order by hand at the broker, then record the fill.
- It is not investment or tax advice. The figures are the Observatory's own estimates under the policy you configured.
- Only taxable accounts owned by you are in scope. IRP, pension savings and ISA accounts, and child accounts, are never in an allocation, a total or a plan.
- Nothing guesses a sleeve. A security without a classification is reported and left out of the totals.
- Phase status: this guide covers the deterministic engine and the review pages (P0 and P1). Every proposal today is engine-only: it holds the targets and plans trades against them. The LLM step that proposes target changes (P2) and chat notifications (P3) are later phases and are not described here as working.

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

Creating a proposal is refused when no policy is configured, when an error-severity data check is failing, or when another proposal is still open. Only one proposal is open at a time.

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
- A closed, rejected or expired proposal frees the slot for the next one.

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

- `propose`: `id`, `status`, `decision`, `instructions`, `warnings`, `llm` and `path` on success. `llm` is null for an engine-only proposal, else `{ status, reason, attempts }`; `status` `failed` with `reason` `runner_unavailable`, `runner_failed`, `timeout` or `invalid_output` means the targets were held. On refusal, `ok` is false with `reason` (`not_configured`, `health_errors` or `open_proposal_exists`), `detail` and `openId`.
- `reconcile`: `expired`, `reconciled` (per proposal: `complete`, `matched`, `missing`, `unfilled`, `unplanned`) and `failed`.
- A proposal file that cannot be read stops `propose`, `reconcile` and `status` with `reason` `error`; `detail` names the file (its basename).
- `status`: `open` is null, or the open proposal's `id`, `status`, `kind`, `instructions`, `fills`, `warnings`, `expiresAt` and `path`.

Exit codes: 0 ran (including an LLM fallback to hold and an `open_proposal_exists` refusal), 1 could not run (`not_configured`, `health_errors`, an unreadable store), a reconcile failure or an unexpected error, 2 usage.

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

## What stays open

- **Lot method per broker.** Each account defaults to `fifo`. Which method a broker actually applies on a sale (first-in-first-out, specific lot or average cost) is a fact about the broker, not something the Observatory can read. Confirm it at each broker and set it on the account before trusting which lots a sell names. Until then, treat the lot choice as a suggestion to verify at order time.
- **Pension and ISA tax treatment** stays undecided on purpose; nothing here picks a value.
- **The LLM step (P2)** that proposes target changes with reasons, and **chat notifications (P3)** that announce a proposal and ask for a decision, are later phases. The data model has room for them; they are not built.
