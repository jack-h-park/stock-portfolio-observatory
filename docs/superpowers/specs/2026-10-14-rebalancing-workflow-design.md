# Rebalancing workflow — design

Status: proposed, 2026-10-14. Owner: the Observatory maintainer.

## Goal

Rebalance the taxable portfolio on a regular cadence, for two reasons: to adjust
risk as the market outlook changes, and to reduce tax (harvest losses, use the
Korean annual capital-gains deduction, prefer long-term over short-term gains).

The workflow is human-in-the-loop end to end:

1. An LLM reads the portfolio and the market context and proposes **target
   allocation changes**, with its reasons and sources.
2. A deterministic engine turns the targets into **lot-level sell and buy
   instructions** with their tax effect.
3. The maintainer reviews both in the Observatory, edits or rejects, and
   approves.
4. The maintainer places every order by hand at the broker, records the fills,
   and the next ingest reconciles them against the actual transactions.

The LLM decides nothing on its own and computes no numbers that reach an order.
This design is a tool that produces inputs to the maintainer's decision; it is
not investment advice.

## Non-goals

- Automatic order placement. No instruction produced here is ever sent to a
  broker by software, including the agentic Robinhood account's order tools.
- Korean pension and ISA accounts (IRP, pension savings, ISA). They are out of
  scope for both allocation and tax. Their US tax treatment is undecided on
  purpose (`us_wrapper_treatment_decided`), and nothing here picks a value.
- New instruments chosen by the LLM. It may name ideas; they never enter a trade
  plan unless the maintainer adds them to the buy list.
- Backtesting or scoring LLM proposals against outcomes. Every proposal keeps its
  inputs and raw output, so this can be added later without a migration.

## Decisions taken

| Question | Decision |
| --- | --- |
| How far does the LLM's authority go? | It proposes target changes. The maintainer approves them. Hard limits (`bounds`) are maintainer-only. |
| Which assets are in scope? | KR taxable accounts, US taxable accounts, crypto, gold and cash. Pension and ISA accounts are excluded. |
| Cadence | One scheduled proposal a month, plus engine-only proposals when a trigger fires. |
| Where is state owned? | The Observatory. Approvals, edits and fills are recorded only there. |
| Chat channels | Discord for anything that needs a decision (one thread per proposal); Telegram for awareness only. This is the fleet's standing routing rule in `hermes-control-plane` `docs/overview/rules-of-engagement.md`. |
| Architecture | Engine in the Observatory, LLM as a judgment layer only (approach A below). |
| Classification | By economic exposure, not by listing market. A KR-listed S&P 500 ETF is US equity. |

### Approaches considered

- **A. Observatory engine, LLM for judgment only (chosen).** Numbers come from
  deterministic code that reuses the tax-realization planner; the LLM supplies
  the outlook and the target change. Proposals are reproducible and auditable.
  Most new code of the three.
- **B. The trader agent end to end.** The agent reads the database and writes a
  Markdown proposal with trades and tax estimates. Fastest to build, but the LLM
  would be selecting lots and estimating tax, and its errors would be silent.
- **C. Extend `stock-trading-skills`.** Reuses the review cron, but that repo is
  scoped to one small agentic account and has no tax model; the tax engine lives
  here.

## Existing pieces this builds on

- `holdings_all`, `tax_lots_all`, `realized_lots_all`, `transactions_all`,
  `cash_balances`, `brokerage_cash`, `fx_rates` (schema in
  `scripts/ingest-stock-data.mjs`).
- `lib/tax-planning.ts` (`buildTaxPlan`, lot candidates with KR and US tax) and
  `lib/us-tax-engine.ts`.
- The saved tax-plan pattern in `lib/tax-plan-store.ts`: a frozen calculation
  snapshot, per-instruction status, and drift against current data.
- `lib/rebalance-policy.ts` and the `/rebalance` page (KR/US split, 15% position
  cap, `taxSensitive`).
- `docs/robinhood-orders-bridge.md`: recent Robinhood orders reach
  `transactions_all` before the next CSV export.
- The daily briefing's archived `macro` paragraph and `benchmarks.json` (private
  companion repo), read as context.

## 1. Allocation policy

A new host-owned file, `data/allocation-policy.json`. Like `tax-policy.json`, it
is not pushed over the host's copy by `push-sources`.

Two layers:

| Layer | Who changes it | Contents |
| --- | --- | --- |
| `bounds` | The maintainer only, in `/rebalance/settings` | Per-sleeve min and max, position cap (replaces the hardcoded 15%), cash floor, maximum target shift per cycle, maximum turnover per proposal |
| `targets` | Proposed by the LLM, applied when the maintainer approves | Per-sleeve target and band |

Sleeves: `kr_equity`, `us_equity`, `bonds` (including short-term bond funds),
`gold`, `crypto`, `cash`.

```json
{
  "version": 1,
  "bounds": {
    "sleeves": { "us_equity": { "min": 30, "max": 70 }, "crypto": { "min": 0, "max": 10 }, "cash": { "min": 3, "max": 30 } },
    "positionCapPct": 15,
    "maxTargetShiftPctPerCycle": 5,
    "maxTurnoverPctPerProposal": 10
  },
  "targets": { "us_equity": { "target": 50, "band": 5 } },
  "preferredInstruments": { "us_equity": ["…"] },
  "accounts": { "<account key>": { "lotMethod": "fifo", "managedBy": null } },
  "excludedCashAccounts": ["<account key>"],
  "history": [{ "at": "2026-11-02", "by": "proposal:rb-2026-11", "changes": { "us_equity": [50, 47] } }]
}
```

- **Classification.** `data/instrument-classes.json` maps each instrument to a
  sleeve. An unmapped instrument is left out of the calculation and listed as
  "unclassified" on the proposal. Nothing guesses a sleeve.
- **Cash.** Brokerage deposits, the CMA, and KRW and USD cash, minus accounts in
  `excludedCashAccounts` (living expenses, emergency fund).
- **History.** Every applied target change appends to `history` with the
  proposal that caused it.
- **Account keys** are the existing hashed full account numbers. Last-4 digits
  are never used to identify an account.
- **Compatibility.** `usTargetPct` is derived from the `kr_equity` : `us_equity`
  ratio, so `/rebalance` keeps working. An existing `rebalance-policy.json` is
  migrated on first load.

## 2. Proposal model and engine

### Proposal

One file per proposal, `data/rebalance-proposals/<id>.json`, with ids such as
`rb-2026-11` (monthly) or `rb-2026-11-14-harvest` (trigger). The store follows
`tax-plan-store.ts` but is separate from it.

| Block | Contents | Mutable |
| --- | --- | --- |
| `inputSnapshot` | Holdings, lots, cash, FX, YTD realized gains, remaining KR deduction, policy version, per-account data-as-of date | No |
| `outlook` | LLM outlook memo and sources (section 4) | No |
| `targetChange` | Current → proposed targets, reason per sleeve, bounds check result | Editable until approved |
| `tradePlan` | Per-account sell and buy instructions: account, instrument, lot, quantity, estimated amount, tax effect | Regenerated when targets change; editable until approved |
| `taxSummary` | KR gain and deduction used/remaining, US short- and long-term estimate, losses harvested | No (recomputed per plan version) |
| `warnings` | Wash-sale, lot near long-term, unclassified, transfer required, stale account data | No |
| `llm` | Prompt, raw output, model id, validation result | No |
| `events` | Append-only log of approvals, rejections, edits and fills | Append-only |
| `status` | See below | Yes |

The proposal page shows drift between the snapshot and current data, as saved tax
plans do.

### Engine: targets → trade plan

Deterministic: the same inputs always produce the same plan, and the tests pin
that.

1. **Sleeve gaps.** Only sleeves outside their band are adjusted, and only back to
   the band edge, not to the target. This keeps turnover and tax down.
2. **Sell order of lots**, reusing `tax-planning.ts` lot evaluation:
   1. lots at a loss,
   2. gains that fit inside the remaining KR basic deduction,
   3. US long-term gains,
   4. short-term gains, last and with a warning.
3. **Lot method.** Lot choice is limited to what the account's `lotMethod` allows
   (`fifo`, `specific`, `average`). If an account is FIFO, the engine sells FIFO,
   because a specific-lot instruction the broker cannot honour would make the tax
   estimate wrong.
4. **Buys** come only from `preferredInstruments` for the sleeve.
5. **Account and currency.** Sale proceeds fund buys in the same account and
   currency. A buy that needs money from another account becomes a separate
   "transfer or FX needed" instruction.
6. **Blocks and limits**:
   - a sell is blocked, with a warning, if the same instrument was bought in the
     last 30 days in any account, including the agentic account's automatic buys
     and recent Robinhood orders;
   - a lot that turns long-term within 30 days is held, with a note;
   - instructions below a minimum trade amount are dropped;
   - the plan is scaled down to `maxTurnoverPctPerProposal`.
7. **Accounts with `managedBy` set** (the agentic account, run by its own
   strategy) count toward exposure but receive no instructions.

### YTD realized gains

YTD realized gains and the remaining KR deduction are derived from
`realized_lots_all` for the tax year, instead of being typed into
`tax-policy.json`. A manual value in the policy, if present, is shown next to the
derived one as an override, never silently preferred.

### Status

```
draft ─▶ targets_approved ─▶ plan_approved ─▶ executing ─▶ reconciled ─▶ closed
  └─▶ rejected / expired
```

- Approving targets writes them to the policy and appends to `history`.
- A proposal with `targetChange.decision = "hold"` (every trigger proposal, and a
  monthly proposal where the LLM holds) skips the first approval.
- A draft not approved within 7 days expires. The next cycle starts from a fresh
  snapshot.

## 3. GUI, fills and reconciliation

| Route | Purpose |
| --- | --- |
| `/rebalance` (extended) | Current allocation against targets and bands; open and past proposals |
| `/rebalance/proposals/[id]` | Proposal detail, four tabs |
| `/rebalance/settings` | Maintainer-only: bounds, instrument classes, buy lists, account lot methods, excluded cash accounts |

The proposal tabs:

1. **Summary**: outlook memo, key figures (turnover, estimated tax, losses
   harvested, remaining deduction), warnings.
2. **Target change**: current → proposed with reasons. Values are editable within
   bounds. Approve, or reject with a one-line reason.
3. **Trade plan**: grouped by account, lot detail per instruction. Skipping an
   instruction or changing a quantity re-runs the engine immediately. Approve.
4. **Fills**: per instruction, the filled quantity, price and date, or the reason
   it was skipped. Partial fills are allowed.

Edits are recorded in `events`. LLM text is never rewritten; an edited value is
marked as edited by the maintainer. Rejection reasons and edits from the last
three proposals are passed to the next LLM run, so a rejected idea is not simply
proposed again.

Writes go through server actions, as the tax-planning pages do. There is no HTTP
API.

### Reconciliation

- Robinhood fills are prefilled from the orders bridge; the maintainer confirms
  them. KR fills are entered by hand and confirmed by the next statement ingest.
- After each ingest, executed instructions are matched against
  `transactions_all` on hashed full account number, instrument, side, quantity,
  and date within ±3 days. Results:
  - matched;
  - marked executed but no transaction after N days (alert);
  - transaction not in any plan (listed for information only).

## 4. LLM contract

### Input

- Allocation by sleeve and instrument, targets, bands and bounds. Accounts appear
  under aliases such as `KR-taxable-1`. No account numbers or names.
- Tax state: remaining KR deduction, US YTD short- and long-term realized,
  harvestable loss (aggregates).
- Market context: the last 30 days of briefing `macro` paragraphs,
  `benchmarks.json`, and web search, each claim with a source URL and date.
- The last three proposals' decisions, edits and rejection reasons.

### Output (strict JSON)

```json
{
  "outlook": {
    "summary": "…", "drivers": ["…"], "risks": ["…"],
    "whatWouldChangeMyView": ["…"],
    "sources": [{ "url": "…", "title": "…", "date": "2026-10-30" }],
    "confidence": "low|medium|high"
  },
  "targetChange": {
    "decision": "change|hold",
    "sleeves": { "us_equity": { "from": 50, "to": 47, "reason": "…" } }
  },
  "ideas": [{ "ticker": "…", "sleeve": "…", "why": "…" }],
  "questionsForMaintainer": ["…"]
}
```

`hold` is the default. The prompt states that holding is a normal outcome and
that a change needs a reason and at least one source. The LLM is not asked for
quantities or tax.

### Validation and failure

Code checks the schema, that targets sum to 100, each sleeve is inside `bounds`,
each shift is within `maxTargetShiftPctPerCycle`, and every change cites a source.
On failure it retries once with the errors attached. If that fails too, the
proposal is created with targets held, so the engine still produces band and
harvest instructions, and both the proposal and the Telegram notice say the LLM
step failed and why.

### Runtime

It runs on the ops host under the trader profile, behind one runner interface so
that `codex exec` or `claude -p` can be swapped (the choice is made in phase P2).
It follows the existing cron rules: a model preflight; exit 1 only when the job
could not run; a judgment, including `hold`, exits 0.

## 5. Triggers, notifications, agent role

### When a proposal is created

| Kind | When | LLM |
| --- | --- | --- |
| Monthly | First business day of the month, after that day's briefing | Yes |
| Trigger | Checked after every `observatory-refresh` | No (engine only, targets held) |

Triggers:

- a sleeve outside its band, or outside `bounds`;
- a position above `positionCapPct`;
- harvestable loss above a threshold with no wash-sale conflict;
- the year-end tax review on Nov 15 and Dec 1 (unused KR deduction, US loss
  harvesting), with the year's last settlement date stated on the proposal.

If a proposal is open, a new trigger is appended to it instead of creating
another. The same trigger fires at most once in 14 days unless its size grows.

### Data guards

- Every proposal shows a data-as-of date per account. KR holdings arrive with
  monthly statements and can be weeks old. Instructions for accounts older than N
  days carry "check the quantity in the broker app before placing".
- If Observatory health has an error-severity check, no proposal is created; a
  Telegram notice says why.

### Channels

- **Discord, one thread per proposal.** An ops cron opens it using the existing
  nudge-thread pattern (`hermes-control-plane`
  `docs/design/agent-nudge-threads.md`): the trader agent composes the opening
  with `hermes -z` (summary within 1,880 characters, a link to the proposal page,
  numbered next steps). A reply from the maintainer wakes the agent's gateway,
  which answers questions using the proposal JSON and the briefing, read-only. It
  does not approve or edit; it points to the GUI. Status changes append a
  code-built line to the thread. An unreviewed draft gets one reminder after 3
  days.
- **Telegram, trader topic, awareness only**: proposal created (with the thread
  link), LLM step failed, reconciliation mismatch, proposal expired, creation
  blocked by a data guard.

The trader agent's order permissions do not change.

## Phases

| Phase | Scope | Outcome |
| --- | --- | --- |
| P0 | Verify the trader agent's Discord bot on the ops host; confirm each account's lot method at its broker; derive YTD realized gains; `allocation-policy.json` and `instrument-classes.json` with settings page | Remaining deduction is correct without manual input |
| P1 | Engine, proposal store, proposal pages, fills and reconciliation, with targets set by hand | A usable rebalancing and tax tool with no LLM |
| P2 | LLM runner, input builder, validation, monthly proposal | The LLM proposes targets |
| P3 | Cron jobs, triggers, Discord thread and Telegram notices | The full recurring workflow |

## Open questions to resolve during P0

- The lot method each broker actually applies: the cost basis rule for KR
  overseas-stock capital gains, and whether Robinhood honours specific-lot
  selection on a sale.
- Whether the trader agent's Discord bot is configured and running on the ops
  host (`trader.env.example` has the keys; the live state is unchecked).
- Thresholds: minimum trade amount, harvest threshold, data staleness N days.

## Testing

- Engine: fixture portfolios with expected plans; determinism; band-edge
  behaviour; lot order; FIFO accounts; wash-sale blocks including another
  account's buy; turnover scaling; transfer instructions.
- Policy: bounds enforcement on edit and on LLM output; migration from
  `rebalance-policy.json`.
- LLM validation: schema, sum, bounds, shift and source failures, retry, fallback
  to hold.
- Reconciliation: matched, missing and unplanned cases; full-number account
  matching.
- YTD derivation against `realized_lots_all` for a known tax year.
