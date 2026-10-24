# Rebalancing P0+P1 — policy, engine, proposals and review UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, tax-aware rebalancer in the Observatory. It reads an allocation policy, builds lot-level proposals, and gives the maintainer an approve → fill → reconcile loop. No LLM yet.

**Architecture:** Pure logic lives in `lib/rebalance/*`: policy, classification, allocation, engine, store and reconciliation. It takes plain inputs and returns plain outputs, so every rule is unit-tested without a database. One adapter, `lib/adapters/rebalance-input.ts`, turns the SQLite database into a `RebalanceInput`. Pages and server actions sit under `app/rebalance/`. A writing CLI, `scripts/rebalance-cli.mjs`, is the entry point that P2 and P3 crons will call.

**Tech Stack:** Next.js 15 (app router, server actions), TypeScript, better-sqlite3, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-14-rebalancing-workflow-design.md` (sections 1–3, and the parts of 5 that P1 needs: data guards and managed accounts).

## Global Constraints

- Sleeves are exactly `kr_equity`, `us_equity`, `bonds`, `gold`, `crypto`, `cash`.
- Out of scope: `account_wrapper` values `irp`, `pension_savings` and `isa`. They are never in an allocation, a total or a plan. Only `taxable` rows count. Child accounts (`owner` other than `self`) are excluded.
- Classification is by economic exposure. Nothing guesses a sleeve. The rules: `asset_class = 'gold'` → `gold`; `market = 'CRYPTO'` → `crypto`; any other security needs an entry in `instrument-classes.json`, or it is reported as unclassified and left out of the totals.
- New host-owned files are gitignored and never pushed:
  - `data/allocation-policy.json`
  - `data/instrument-classes.json`
  - `data/rebalance-proposals/`

  Each gets a `config.ts` entry with an env override:
  - `STOCK_ALLOCATION_POLICY_PATH`
  - `STOCK_INSTRUMENT_CLASSES_PATH`
  - `STOCK_REBALANCE_PROPOSALS_DIR`

  A public `*.example.json` sits beside each file.
- Files are written atomically: write a temp file, then rename (see `lib/rebalance-policy.ts:saveRebalancePolicy`).
- Accounts are identified by the `(brokerage, account)` pair as stored. That label is assigned by the ingest from the full account number. Never derive identity from the last 4 digits.
- Repo text is English. UI copy goes through `lib/ui-copy/pages/*.ts` with `en` and `ko` entries, using `defineCopy`.
- No real amounts, account numbers or tickers from the maintainer's portfolio go in tests, fixtures or examples. Use invented tickers such as `AAA` or `KRX1`.
- The engine's output is a function of its inputs, with no clock and no randomness. `today` is a parameter.
- Nothing here places or transmits an order.

## Review Focus

1. **An instrument with no price** (`native_market_value` null). The allocation counts it at cost and lists it in `warnings`. The engine never sells it, because its proceeds are unknown. Test: `engine skips unpriced lots and warns` (Task 5).
2. **An empty or missing policy file.** Pages render a "not configured" state. `rebalance:propose` exits 1 with a clear message. Nothing crashes. Test: `propose without a policy fails with not-configured` (Task 8).
3. **Targets not summing to 100 after an edit.** The save is rejected with the sum shown, and the file is left unchanged. Test: `saveAllocationPolicy rejects targets not summing to 100` (Task 1).
4. **Two proposals open at once.** `createProposal` refuses when a non-terminal proposal exists, and `rebalance:propose` reports the open id instead. Test: `createProposal refuses while another is open` (Task 7).
5. **A fill recorded for more shares than planned, or a negative price.** The action rejects it, and the event log is not appended. Test: `recordFill rejects quantity above plan or non-positive price` (Task 7).

---

### Task 1: Allocation policy module

**Files:**
- Create: `lib/rebalance/allocation-policy.ts`, `data/allocation-policy.example.json`
- Modify: `config.ts`, `.gitignore`
- Test: `tests/rebalance-allocation-policy.test.ts`

**Interfaces:**
- Produces:
```ts
export const SLEEVES = ['kr_equity', 'us_equity', 'bonds', 'gold', 'crypto', 'cash'] as const
export type Sleeve = (typeof SLEEVES)[number]
export type SleeveBounds = { min: number; max: number }
export type SleeveTarget = { target: number; band: number }
export type LotMethod = 'fifo' | 'specific' | 'average'
export type AccountRule = { lotMethod: LotMethod; fractional: boolean; managedBy: string | null; excludedCash: boolean }
export type PreferredInstrument = { market: string; ticker: string; brokerage: string | null; account: string }
export type AllocationPolicy = {
  version: 1
  bounds: {
    sleeves: Record<Sleeve, SleeveBounds>
    positionCapPct: number
    maxTargetShiftPctPerCycle: number
    maxTurnoverPctPerProposal: number
    minTradeKrw: number
    staleDataDays: number
    harvestThresholdKrw: number
  }
  targets: Record<Sleeve, SleeveTarget>
  preferredInstruments: Partial<Record<Sleeve, PreferredInstrument[]>>
  accounts: Record<string, AccountRule>   // key: accountKey(brokerage, account)
  history: { at: string; by: string; changes: Partial<Record<Sleeve, [number, number]>> }[]
}
export type AllocationPolicyState = { policy: AllocationPolicy | null; source: 'saved' | 'missing'; error: string | null }
export function accountKey(brokerage: string | null, account: string): string   // `${brokerage ?? ''}::${account}`
export function defaultAccountRule(market: string): AccountRule   // CRYPTO → fractional true; else fifo, false, null, false
export function validateAllocationPolicy(p: AllocationPolicy): string[]          // [] = valid
export function checkTargetsAgainstBounds(p: AllocationPolicy, targets: Record<Sleeve, SleeveTarget>, opts: { enforceShift: boolean }): string[]
export function getAllocationPolicy(filePath?: string): AllocationPolicyState
export function saveAllocationPolicy(p: AllocationPolicy, filePath?: string): void   // throws Error(joined errors) if invalid
export function applyTargets(p: AllocationPolicy, targets: Record<Sleeve, SleeveTarget>, by: string, at: string): AllocationPolicy  // appends history with changed sleeves only
export function deriveUsTargetPct(p: AllocationPolicy): number | null   // us/(kr+us)*100, one decimal; null if both 0
```

- [ ] **Step 1: Write the failing tests.** In `tests/rebalance-allocation-policy.test.ts`, using a temp dir as `tests/rebalance-policy.test.ts` does:
  - `getAllocationPolicy reports missing when no file`: `source === 'missing'`, `policy === null`, `error === null`.
  - `round-trips a valid policy`: save the example policy, read it back deep-equal.
  - `saveAllocationPolicy rejects targets not summing to 100`: targets sum to 98, so it throws a message containing `98`, and the file is not created.
  - `rejects a target outside its sleeve bounds`: us_equity bounds 30–70 with target 75 gives an error naming `us_equity`.
  - `rejects band <= 0 and min > max`.
  - `checkTargetsAgainstBounds enforces maxTargetShiftPctPerCycle when asked`: current us 50, proposed 44, shift limit 5. With `enforceShift: true` it returns one error; with `false` it returns `[]`.
  - `applyTargets records only changed sleeves`: only us_equity moves 50→47 (kr 30→33), so history gains one entry with `{ us_equity: [50, 47], kr_equity: [30, 33] }`.
  - `deriveUsTargetPct`: kr 30, us 45 gives `60`.
  - A corrupt JSON file reads as `source: 'saved'`, `policy: null`, with `error` set. It does not throw.
- [ ] **Step 2: Run, expect FAIL.** `pnpm exec tsx --test tests/rebalance-allocation-policy.test.ts`. It fails with "Cannot find module".
- [ ] **Step 3: Implement** the module.
  - Validation rules:
    - Targets sum to 100 within ±0.05.
    - Each target lies within its sleeve's `[min, max]`.
    - `band > 0`.
    - `min <= max`, both within 0–100.
    - Every numeric bound is ≥ 0.
    - Every sleeve key is present in `bounds.sleeves` and in `targets`.
  - Add `stockAllocationPolicyPath` to `config.ts`, next to `stockRebalancePolicyPath`, with a comment that it is host-owned and never pushed.
  - Add `data/allocation-policy.json` to `.gitignore`.
  - `data/allocation-policy.example.json`: all six sleeves.
    - Bounds 0–100.
    - Targets `kr_equity 30, us_equity 45, bonds 5, gold 5, crypto 5, cash 10`, each with band 5.
    - `positionCapPct 15`, `maxTargetShiftPctPerCycle 5`, `maxTurnoverPctPerProposal 10`, `minTradeKrw 100000`, `staleDataDays 35`, `harvestThresholdKrw 1000000`.
    - Empty `preferredInstruments`, `accounts` and `history`.
    - Its `_comment` key says these are placeholders, not a recommendation. The loader ignores keys that start with `_`.
- [ ] **Step 4: Run, expect PASS.** Run the same command, then `pnpm typecheck`.
- [ ] **Step 5: Commit.** `git commit -m "feat(rebalance): allocation policy with bounds, targets and history"`

### Task 2: Instrument classes and allocation

**Files:**
- Create: `lib/rebalance/instrument-classes.ts`, `lib/rebalance/allocation.ts`, `data/instrument-classes.example.json`
- Modify: `config.ts` (`stockInstrumentClassesPath`), `.gitignore`
- Test: `tests/rebalance-allocation.test.ts`

**Interfaces:**
- Consumes: `Sleeve`, `SLEEVES`, `AllocationPolicy`, `accountKey`, `defaultAccountRule` (Task 1).
- Produces:
```ts
// instrument-classes.ts
export type InstrumentClasses = Record<string, Sleeve>   // key: `${market}:${ticker}`
export function instrumentKey(market: string, ticker: string): string
export function getInstrumentClasses(filePath?: string): InstrumentClasses        // missing file → {}
export function saveInstrumentClasses(c: InstrumentClasses, filePath?: string): void
export function classify(row: { market: string; ticker: string; asset_class?: string | null }, classes: InstrumentClasses): Sleeve | null

// allocation.ts
export type RebalancePosition = {
  brokerage: string | null; account: string; market: string; currency: string
  ticker: string; name: string; asset_class: string
  quantity: number; valueKrw: number | null; costKrw: number; dataAsOf: string | null
}
export type RebalanceCash = { brokerage: string | null; account: string; currency: string; balance: number; krw: number | null; asOf: string }
export type SleeveRow = {
  sleeve: Sleeve; valueKrw: number; pct: number
  target: number; band: number; lower: number; upper: number
  status: 'below' | 'within' | 'above'
}
export type Allocation = {
  totalKrw: number
  sleeves: SleeveRow[]
  unclassified: RebalancePosition[]
  unpriced: RebalancePosition[]
  positionsBySleeve: Record<Sleeve, RebalancePosition[]>
}
export function computeAllocation(input: { positions: RebalancePosition[]; cash: RebalanceCash[] }, policy: AllocationPolicy, classes: InstrumentClasses): Allocation
```

- [ ] **Step 1: Write the failing tests:**
  - `gold and crypto classify without a mapping`.
  - `an unmapped security is unclassified and excluded from totals`.
  - `value uses market value, cost when unpriced, and lists unpriced`.
  - `cash in excludedCash accounts is left out`: the account rule sets `excludedCash: true`.
  - `cash with unknown krw is left out`.
  - `status uses target±band`: target 45, band 5, current 51 → `above`; current 40 → `below`; current 50 → `within`. `lower`/`upper` are 40/50.
  - `percentages sum to 100 over classified value`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - Totals use only classified positions plus counted cash.
  - Cash is always the `cash` sleeve.
  - Example mappings file: `{"US:AAA": "us_equity", "KR:KRX1": "kr_equity", "KR:KRBOND1": "bonds"}`.
- [ ] **Step 4: Run, expect PASS**, then `pnpm typecheck`.
- [ ] **Step 5: Commit.** `feat(rebalance): instrument classes and sleeve allocation`

### Task 3: YTD realized gains derived from realized lots

**Files:**
- Create: `lib/rebalance/ytd-realized.ts`
- Test: `tests/rebalance-ytd-realized.test.ts`

**Interfaces:**
- Consumes: `TaxPolicy`, `assumptionNumber` (`lib/tax-policy.ts`).
- Produces:
```ts
export type RealizedLotRow = {
  market: string; sold_date: string; tax_term: string | null
  realized_gl_krw: number | null; native_realized_gl: number | null; currency: string
  account_wrapper: string | null; superseded_by: number | null
}
export type YtdRealized = { year: number; krTaxableGainKrw: number; usShortUsd: number; usLongUsd: number; lotCount: number }
export function deriveYtdRealized(rows: RealizedLotRow[], year: number, usdKrwRate: number): YtdRealized
export type YtdComparison = { derived: YtdRealized; manual: { krTaxableGainKrw: number | null; usShortUsd: number | null; usLongUsd: number | null } }
export function compareWithPolicy(derived: YtdRealized, policy: TaxPolicy): YtdComparison
export function withDerivedYtd(policy: TaxPolicy, derived: YtdRealized): TaxPolicy
```

- [ ] **Step 1: Write the failing tests:**
  - `sums only the tax year, taxable wrapper, non-superseded rows`.
  - `KR taxable gain is the KRW gain of US-market lots`: domestic KR lots excluded, the same rule as `krTaxable` with the domestic flags off.
  - `US short and long split by tax_term, measured in USD`: a USD lot uses `native_realized_gl`; a KRW lot uses `realized_gl_krw / usdKrwRate`.
  - `withDerivedYtd overwrites the three manual assumptions and taxInputYear`:
    - KR `ytdRealizedTaxableGainKrw`
    - US `ytdRealizedShortGainLossUsd`
    - US `ytdRealizedLongGainLossUsd`
    - US `taxInputYear = year`
  - `compareWithPolicy reports manual values where present, null where absent`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - `withDerivedYtd` returns a deep copy and never mutates its input.
  - Export `krTaxable` from `lib/tax-planning.ts` (it is currently module-private) and reuse it rather than restating the rule. `RealizedLotRow` carries `market`, which is all it reads.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `feat(rebalance): derive YTD realized gains from realized lots`

### Task 4: Rebalance input adapter

**Files:**
- Create: `lib/adapters/rebalance-input.ts`
- Test: `tests/rebalance-input.test.ts`. It builds a temp SQLite file with the minimal tables, using the column lists in `scripts/ingest-stock-data.mjs`; follow an existing DB-backed test such as `tests/cash-inflow-adapter.test.ts` for setup.

**Interfaces:**
- Consumes: `RebalancePosition`, `RebalanceCash` (Task 2), `RealizedLotRow`, `deriveYtdRealized` (Task 3), `getTaxPlanningLots` and `getWashSaleReview` (`lib/adapters/portfolio-db.ts`).
- Produces:
```ts
export type RecentBuy = { market: string; ticker: string; brokerage: string | null; account: string; date: string }
export type RebalanceInput = {
  asOf: string                         // today, passed in
  usdKrwRate: number
  positions: RebalancePosition[]
  cash: RebalanceCash[]
  lots: TaxPlanningLot[]               // taxable wrapper only
  recentBuys: RecentBuy[]              // last 30 calendar days, every wrapper, market US and KR
  washSaleBlockedBuys: { ticker: string; blockedThrough: string }[]   // open US windows from getWashSaleReview
  accountDataAsOf: Record<string, string | null>   // accountKey → latest transaction/statement date
  ytd: YtdRealized
  healthErrors: string[]               // names of error-severity failing validation checks
}
export function getRebalanceInput(today: string, dbPath?: string): RebalanceInput
```

- [ ] **Step 1: Write the failing tests** against a fixture DB:
  - `positions are taxable, self-owned holdings_all rows only`: rows with irp, isa and child owner are absent.
  - `cash merges cash_balances latest-per-account with brokerage_cash latest-per-account-pool`, valued in KRW by the latest USD rate.
  - `recentBuys covers 30 days back from today`.
  - `accountDataAsOf is the max transaction date per account`.
  - `healthErrors lists failing error-severity checks`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - Open the DB read-only.
  - Positions: group `holdings_all` by `(brokerage, account, market, ticker)` over `account_wrapper = 'taxable' and coalesce(owner,'self') = 'self'`. Value is `base_market_value`, cost is `coalesce(base_cost, total_cost_krw)`.
  - Lots: `getTaxPlanningLots(5000, policy)` filtered to `account_wrapper === 'taxable'`.
  - USD rate: latest `fx_rates` USD→KRW, falling back to 1350, as `lotsUsdKrwRate` does.
  - Validation checks: read the `validation_checks` columns from the ingest schema. "Failing" is status not `pass` with severity `error`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `feat(rebalance): read a rebalance input snapshot from the database`

### Task 5: Engine — sleeve gaps and sell selection

**Files:**
- Create: `lib/rebalance/engine.ts`
- Test: `tests/rebalance-engine-sells.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4. Also `buildTaxPlan`, `krTaxable`, `longTermEligibleOn` (`lib/tax-planning.ts`) and `TaxPolicy`.
- Produces:
```ts
export type InstructionKind = 'sell' | 'buy' | 'transfer'
export type Instruction = {
  id: string                         // stable: `${kind}:${accountKey}:${market}:${ticker}:${lotId ?? 'pos'}`
  kind: InstructionKind
  sleeve: Sleeve
  brokerage: string | null; account: string; market: string; ticker: string; currency: string
  lotIds: number[]                   // sells only
  quantity: number                   // sells and buys
  estimatedKrw: number               // proceeds (sell) or cost (buy) or amount (transfer)
  gainKrw: number | null             // sells: KR measure
  usGainUsd: number | null           // sells
  holdingBucket: 'short' | 'long' | null
  tier: 'loss' | 'kr_deduction' | 'us_long' | 'short_term' | null
  notes: string[]                    // e.g. 'stale data: check quantity in the broker app'
}
export type EngineWarning = { code: 'wash_sale_block' | 'near_long_term' | 'unclassified' | 'unpriced' | 'transfer_needed' | 'stale_account' | 'turnover_capped' | 'below_min_trade' | 'cash_floor'; message: string; ticker?: string; account?: string }
export type SleeveMove = { sleeve: Sleeve; fromPct: number; toPct: number; amountKrw: number }   // amount < 0 = reduce
export type TradePlan = {
  moves: SleeveMove[]
  instructions: Instruction[]
  warnings: EngineWarning[]
  taxSummary: { krGainKrw: number; krDeductionUsedKrw: number; krDeductionRemainingKrw: number; usShortUsd: number; usLongUsd: number; harvestedLossKrw: number; estimatedTaxKrw: number; turnoverPct: number }
}
export function computeSleeveMoves(allocation: Allocation, targets: Record<Sleeve, SleeveTarget>): SleeveMove[]
export function buildTradePlan(args: {
  input: RebalanceInput; policy: AllocationPolicy; targets: Record<Sleeve, SleeveTarget>
  classes: InstrumentClasses; taxPolicy: TaxPolicy; skip?: string[]   // instruction ids to leave out
}): TradePlan
```

This task implements `computeSleeveMoves` and the sell half of `buildTradePlan`. Task 6 adds buys, funding and the summary.

**Algorithm** (the tests below pin each line):

```
moves: for each sleeve outside [lower, upper]: amount = (edge - pct)/100 * total, edge = nearest band edge.
cap:   for each position > positionCapPct: capExcess = value - cap*total; the sleeve's reduce amount becomes
       max(|sleeve reduce|, sum of capExcess in sleeve); capped positions are sold first within the sleeve, up to their excess.
pool:  sell candidates = lots in the sleeve; account not managedBy; price known; not on a near-long-term hold.
       Cash-sleeve moves produce no sells (cash is a funding source, Task 6).
units: specific → each lot; fifo → per (account,ticker) only the oldest remaining lot is eligible, the next after it is used;
       average → one unit per (account,ticker) with cost = sum(cost), proceeds = sum(value).
tiers: candidate = buildTaxPlan({ lots: [unit lots], policy: withDerivedYtd(taxPolicy, input.ytd) }).candidates
       loss         gainKrw < 0 or usGain < 0                     ordered most negative first
       kr_deduction krTaxable && gain fits remaining deduction   ordered largest gain that fits first
       us_long      holdingBucket long                            ordered gain/proceeds ascending
       short_term   the rest                                      ordered gain/proceeds ascending
take:  walk tiers until the sleeve amount is covered; the last unit may be partial;
       quantity rounds DOWN to whole shares unless account rule fractional (crypto: 8 decimals).
block: a loss unit whose ticker has a recentBuy (any account) in the last 30 days → excluded, warning wash_sale_block.
hold:  longTermEligibleOn(acquired) within 30 days after today, and currently short → excluded, warning near_long_term.
stale: account with dataAsOf older than staleDataDays → instructions carry the stale note and the warning.
```

- [ ] **Step 1: Write the failing tests** with small hand-built `RebalanceInput` fixtures and a `TaxPolicy` built from `data/tax-policy.example.json`:
  - `no move when every sleeve is within band`.
  - `move goes to the band edge, not the target`: target 45, band 5, current 55, total 1,000,000 → amount −50,000.
  - `losses are sold before gains`.
  - `KR deduction tier fills the remaining deduction before US long gains`: deduction 2.5M, ytd 2.0M; a gain of 400k is taken before a long-term gain.
  - `short-term gains come last and carry tier short_term`.
  - `fifo account sells the oldest lot first even if a newer lot is a loss`.
  - `average account treats the position as one unit`.
  - `whole-share rounding leaves the remainder unsold`: a fractional account keeps decimals.
  - `wash-sale: a loss lot with a buy 10 days ago is blocked and warned`.
  - `a short lot turning long in 20 days is held and warned`.
  - `managedBy account contributes to allocation but gets no instructions`.
  - `engine skips unpriced lots and warns` (Review Focus 1).
  - `position over cap is reduced first even if its sleeve is within band`.
  - `same input twice yields deep-equal plans`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `computeSleeveMoves` and the sell path.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `feat(rebalance): sleeve moves and tax-tiered sell selection`

### Task 6: Engine — buys, funding, turnover and tax summary

**Files:**
- Modify: `lib/rebalance/engine.ts`
- Test: `tests/rebalance-engine-buys.test.ts`

**Interfaces:**
- Consumes: Task 5 types. `estimateSaleSet` or `summarizeTaxCandidates` from `lib/tax-planning.ts`.
- Produces: the complete `buildTradePlan`. Same signature.

**Algorithm:**
```
buys:     for each sleeve with a positive move: split the amount equally over preferredInstruments[sleeve];
          price = latest position price for that ticker (positions or lots); no price or no preferred instrument
          → no buy, warning transfer_needed is NOT used; use warning 'unpriced' / message 'no buy list for <sleeve>'.
          a ticker in washSaleBlockedBuys whose blockedThrough >= today → no buy, warning wash_sale_block.
funding:  available cash per (account,currency) = that account's cash + proceeds of its sells in this plan;
          buys consume it in plan order; the unfunded part becomes one 'transfer' instruction to that account
          (estimatedKrw = shortfall) plus warning transfer_needed.
floor:    if total cash after the plan < bounds.sleeves.cash.min% of total, scale all buys down proportionally
          to keep the floor; warning cash_floor.
turnover: sells total / total * 100 > maxTurnoverPctPerProposal → scale every sleeve's reduce amount by
          cap/actual BEFORE selection (re-run Task 5 selection); warning turnover_capped.
min:      instructions with estimatedKrw < minTradeKrw are dropped; warning below_min_trade lists them.
skip:     instruction ids in `skip` are removed and the plan is recomputed without them (funding and summary too).
summary:  from the selected sell candidates via summarizeTaxCandidates with withDerivedYtd(taxPolicy, ytd);
          krDeductionUsedKrw = min(deduction, max(ytd + krGain, 0)) - min(deduction, max(ytd, 0)).
```

- [ ] **Step 1: Write the failing tests:**
  - `buy amount is split equally across preferred instruments and rounded down to shares`.
  - `a buy is funded from the same account's sale proceeds`.
  - `an unfunded buy produces a transfer instruction for the shortfall`.
  - `turnover cap scales sells and warns`.
  - `instructions below minTradeKrw are dropped and listed`.
  - `cash floor scales buys down`.
  - `a wash-sale-blocked ticker is not bought`.
  - `skip removes an instruction and re-funds the rest`.
  - `taxSummary deduction used/remaining against ytd`.
  - `no preferred instrument for an underweight sleeve warns and buys nothing`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**, together with Task 5's tests.
- [ ] **Step 5: Commit.** `feat(rebalance): buys, funding, turnover cap and tax summary`

### Task 7: Proposal store and status machine

**Files:**
- Create: `lib/rebalance/proposal-store.ts`
- Modify: `config.ts` (`stockRebalanceProposalsDir`), `.gitignore`
- Test: `tests/rebalance-proposal-store.test.ts`

**Interfaces:**
- Consumes: `TradePlan`, `Instruction` (Tasks 5–6), `RebalanceInput` (Task 4), `AllocationPolicy`, `SleeveTarget` (Task 1).
- Produces:
```ts
export type ProposalStatus = 'draft' | 'targets_approved' | 'plan_approved' | 'executing' | 'reconciled' | 'closed' | 'rejected' | 'expired'
export type ProposalKind = 'monthly' | 'trigger' | 'manual'
export type TargetChange = {
  decision: 'change' | 'hold'
  sleeves: Partial<Record<Sleeve, { from: number; to: number; reason: string; editedBy?: 'maintainer' }>>
  boundsErrors: string[]
}
export type Fill = { instructionId: string; status: 'executed' | 'skipped'; quantity: number | null; price: number | null; date: string | null; note: string }
export type ProposalEvent = { at: string; type: 'created' | 'targets_edited' | 'targets_approved' | 'plan_edited' | 'plan_approved' | 'fill' | 'reconciled' | 'rejected' | 'expired' | 'closed' | 'trigger_appended'; detail: string }
export type Proposal = {
  schemaVersion: 1; id: string; kind: ProposalKind; triggers: string[]
  status: ProposalStatus; createdAt: string; updatedAt: string; expiresAt: string
  policyAtCreation: AllocationPolicy
  inputSnapshot: RebalanceInput
  outlook: unknown | null            // P2 fills this
  llm: unknown | null                // P2 fills this
  targetChange: TargetChange
  plan: TradePlan; planSkips: string[]
  fills: Record<string, Fill>
  reconciliation: ReconciliationResult | null   // Task 8 type
  events: ProposalEvent[]
}
export function proposalId(kind: ProposalKind, today: string, suffix?: string): string  // monthly → rb-YYYY-MM; else rb-YYYY-MM-DD-<suffix|kind>
export function listProposals(dir?: string): Proposal[]                 // newest first
export function getProposal(id: string, dir?: string): Proposal | null
export function openProposal(dir?: string): Proposal | null              // status not in rejected/expired/closed
export function createProposal(p: Omit<Proposal, 'schemaVersion' | 'status' | 'createdAt' | 'updatedAt' | 'expiresAt' | 'events' | 'fills' | 'reconciliation'>, now: Date, dir?: string): Proposal
export function transition(id: string, to: ProposalStatus, detail: string, now: Date, dir?: string): Proposal
export function editTargets(id: string, sleeves: TargetChange['sleeves'], now: Date, dir?: string): Proposal
export function setPlan(id: string, plan: TradePlan, skips: string[], now: Date, dir?: string): Proposal
export function recordFill(id: string, fill: Fill, now: Date, dir?: string): Proposal
export function appendTrigger(id: string, trigger: string, now: Date, dir?: string): Proposal
export function expireStale(now: Date, dir?: string): string[]          // ids expired
```

Allowed transitions:
- `draft → targets_approved` only when `decision = 'change'`.
- `draft → plan_approved` only when `decision = 'hold'`.
- `targets_approved → plan_approved`.
- `plan_approved → executing`. This happens on the first fill.
- `executing → reconciled` (Task 8).
- `reconciled → closed`.
- From `draft`, `targets_approved` or `plan_approved`: `→ rejected`.
- From `draft`: `→ expired`.
- Every other transition throws.

- [ ] **Step 1: Write the failing tests:**
  - `proposalId formats`.
  - `createProposal refuses while another is open` (Review Focus 4).
  - `transition table: allowed ones succeed, others throw`.
  - `editTargets is allowed only in draft and marks editedBy`.
  - `recordFill rejects quantity above plan or non-positive price` (Review Focus 4). It also checks that `events.length` is unchanged after the rejection.
  - `first fill moves plan_approved to executing`.
  - `expireStale expires drafts older than 7 days only`.
  - `every mutation appends one event and bumps updatedAt`.
  - `files are written atomically`: no `.tmp` files are left in the dir.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - Storage: one JSON file per proposal, `<dir>/<id>.json`.
  - `expiresAt` is `createdAt` plus 7 days.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `feat(rebalance): proposal store with status machine and event log`

### Task 8: Reconciliation and the writing CLI

**Files:**
- Create: `lib/rebalance/reconcile.ts`, `lib/rebalance/propose.ts`, `scripts/rebalance-cli.mjs`
- Modify: `package.json` (scripts `rebalance:propose`, `rebalance:reconcile`, `rebalance:status`), `scripts/refresh.mjs` (run `rebalance:reconcile` after the summary step; a failure there is logged and never fails the refresh)
- Test: `tests/rebalance-reconcile.test.ts`, `tests/rebalance-propose.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces:
```ts
// reconcile.ts
export type TxRow = { brokerage: string | null; account: string; market: string; ticker: string; type: string; date: string; quantity: number }
export type ReconciliationResult = {
  at: string
  matched: { instructionId: string; txDate: string }[]
  missing: { instructionId: string; daysSinceFill: number }[]     // executed fill, no tx yet
  unplanned: TxRow[]                                              // tx in plan accounts since createdAt not matching any instruction
  complete: boolean                                               // every executed instruction matched
}
export function reconcile(p: Proposal, txs: TxRow[], today: string): ReconciliationResult
// propose.ts
export type ProposeResult = { ok: true; proposal: Proposal } | { ok: false; reason: 'not_configured' | 'health_errors' | 'open_proposal_exists'; detail: string; openId?: string }
export function proposeEngineOnly(args: { kind: ProposalKind; triggers: string[]; today: string; now: Date; paths?: { policy?: string; classes?: string; proposals?: string; db?: string } }): ProposeResult
```

Matching rule: same `(brokerage, account)`, same ticker, buy↔BUY or sell↔SELL, |date − fill date| ≤ 3 days, and quantity within 1% or 1 share. Each transaction matches at most one instruction.

CLI: `tsx scripts/rebalance-cli.mjs <propose|reconcile|status> [--kind manual|trigger|monthly] [--trigger <text>] [--today YYYY-MM-DD]`.
- It loads `.env.local` first, as `observatory-cli.mjs` does.
- Output is JSON on stdout: `{ schemaVersion: 1, ok, ... }`.
- Exit codes:
  - 0 when the command ran, including the "not created" outcomes;
  - 1 for an unexpected error or a missing policy;
  - 2 for a usage error.
- `status` prints the open proposal's id, status, counts and URL path `/rebalance/proposals/<id>`.
- `reconcile` runs `expireStale` and reconciles every `executing` proposal. When `complete` is true it transitions the proposal to `reconciled`.

- [ ] **Step 1: Write the failing tests:**
  - `matched within 3 days and 1%`.
  - `missing after a fill with no tx`.
  - `unplanned lists other trades in plan accounts`.
  - `one tx cannot match two instructions`.
  - `propose without a policy fails with not-configured` (Review Focus 2).
  - `propose refuses on health errors`.
  - `propose with an open proposal returns its id`.
  - `propose builds a hold proposal whose plan equals buildTradePlan of the snapshot`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, then add the package scripts and the refresh tail step. The refresh step shells out to `pnpm rebalance:reconcile`, the same way the existing summary step does (`runStep`), and is not added to the failure set.
- [ ] **Step 4: Run, expect PASS**, then `pnpm typecheck`.
- [ ] **Step 5: Commit.** `feat(rebalance): reconciliation and the rebalance CLI`

### Task 9: Settings page

**Files:**
- Create: `app/rebalance/settings/page.tsx`, `app/rebalance/settings/actions.ts`, `lib/ui-copy/pages/rebalanceSettings.ts`
- Modify: `lib/ui-copy/pages/index.ts`, `lib/page-names.ts` (add `/rebalance/settings` if routes there must be listed; follow how nested routes such as `/tax-planning/plans/[id]` are handled)
- Test: `tests/rebalance-settings-form.test.ts`, testing the pure `policyFromSettingsForm(formData, current)` parser exported from `lib/rebalance/settings-form.ts` (create)

**Interfaces:**
- Consumes: `getAllocationPolicy`, `saveAllocationPolicy`, `applyTargets` (Task 1); `getInstrumentClasses`, `saveInstrumentClasses` (Task 2); `getRebalanceInput` (Task 4), used to list accounts and unclassified tickers.
- Produces: `policyFromSettingsForm(form: FormData, current: AllocationPolicy | null): { policy: AllocationPolicy; errors: string[] }`.

**Sections**, each a `<form>` posting to its own server action:
1. Sleeve bounds and targets, one row per sleeve: min, max, target, band. Saving targets here calls `applyTargets(..., by: 'maintainer')`.
2. Limits: the 6 scalar bounds.
3. Accounts: one row per taxable account seen in the input, with lot method, fractional, managedBy and excluded-from-cash. Lot method shows the help text "Confirm at your broker how sales are matched to lots."
4. Instrument classes: every classified and unclassified security, with a sleeve `<select>`.
5. Buy lists: per sleeve, a textarea of `market:ticker@brokerage::account` lines.

A form with errors redirects with `?error=<code>` and renders the messages. The policy file is untouched.

- [ ] **Step 1: Write the failing tests** for the parser:
  - `parses all six sleeves`.
  - `returns errors and leaves policy untouched when the sum != 100`.
  - `buy-list lines parse and reject malformed lines with the line number`.
  - `missing policy starts from the example shape with every sleeve at 0 and is invalid until filled`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the parser, then the page and actions, in the style of `app/rebalance/page.tsx` and `app/tax-settings`. Use `Card`, `Field`, `SubmitButton`, `DataTable`, and the `ko`/`en` copy.
- [ ] **Step 4: Run tests, expect PASS.** Then run `pnpm typecheck`, `pnpm lint` and `pnpm ui:guardrails`.
- [ ] **Step 5: Commit.** `feat(rebalance): settings page for bounds, targets, accounts, classes and buy lists`

### Task 10: Rebalance hub and proposal pages

**Files:**
- Modify: `app/rebalance/page.tsx`, `lib/ui-copy/pages/rebalance.ts`, `lib/adapters/portfolio-db.ts` (`getRebalanceReview`: `positionCapPct` from the allocation policy when present, else 15; `usTargetPct` from `deriveUsTargetPct` when a policy exists)
- Create: `app/rebalance/proposals/[id]/page.tsx`, `app/rebalance/proposals/[id]/actions.ts`, `app/rebalance/actions.ts` (add `createManualProposal`), `lib/ui-copy/pages/rebalanceProposal.ts`
- Test: `tests/rebalance-proposal-actions.test.ts`, testing the pure helpers in `lib/rebalance/proposal-actions.ts` (create): `parseFillForm`, `parseTargetEditForm` and `parseSkipForm`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces:
```ts
export function parseFillForm(form: FormData, plan: TradePlan): { fill: Fill } | { error: string }
export function parseTargetEditForm(form: FormData, policy: AllocationPolicy, current: TargetChange): { sleeves: TargetChange['sleeves'] } | { error: string }
export function parseSkipForm(form: FormData): string[]
```

**Hub (`/rebalance`):**
- At the top: an allocation table by sleeve (current %, target, band, status badge) when the policy exists. Otherwise a "not configured" empty state that links to `/rebalance/settings`.
- The open proposal card (id, kind, status, created, expires) and a list of past proposals.
- A "Create proposal from current targets" button that calls `createManualProposal`. It uses `proposeEngineOnly({ kind: 'manual' })`, then redirects to the proposal or back with an error code.
- The existing market-gap content stays below.

**Proposal page:** tabs through `?tab=summary|targets|plan|fills`.
- **summary**
  - Shows `outlook` when present.
  - Key figures: turnover, estimated tax, harvested loss, KR deduction used and remaining, and US short- and long-term figures.
  - Per-account data-as-of dates, with a stale badge.
  - Warnings grouped by code.
  - Drift: current allocation (fresh `getRebalanceInput`) against `inputSnapshot`, per sleeve, in percentage points.
- **targets**
  - Table of from, to and reason.
  - Inputs that can be edited while the proposal is a draft. Saving runs `checkTargetsAgainstBounds` with `enforceShift: true`; errors are shown and nothing is saved.
  - "Approve targets" runs `applyTargets(policy, …, by: 'proposal:<id>')`, `saveAllocationPolicy`, then rebuilds the plan with the approved targets (`setPlan`), then `transition('targets_approved')`.
  - "Reject" with a required reason.
  - The tab is hidden when `decision = 'hold'`.
- **plan**
  - Instructions grouped by account, showing kind, ticker, lots, quantity, KRW, gain, tier and notes.
  - A "Skip" checkbox per instruction. "Recompute" calls `buildTradePlan` with the proposal's snapshot and the skips, then `setPlan`.
  - "Approve plan" calls `transition('plan_approved')`.
- **fills**
  - Per instruction: executed or skipped, quantity, price, date and note.
  - Reconciliation results, once present.
- Every action uses `revalidatePath` and redirects with a `?done=` or `?error=` code, as `app/rebalance/actions.ts` does.
- A banner shows that it is a tool output, not advice, using copy key `disclaimer`.

- [ ] **Step 1: Write the failing tests** for the three parsers:
  - Fill: valid; quantity above plan; price ≤ 0; date not ISO.
  - Target edit: out of bounds; shift too large; valid.
  - Skip: multiple ids.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the helpers, the actions and the pages.
- [ ] **Step 4: Verify.**
  - Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm ui:guardrails`.
  - Then `pnpm seed:sample`, write a sample `allocation-policy.json` and `instrument-classes.json` into a temp dir via the env overrides, and run `pnpm dev`.
  - Open `/rebalance`, `/rebalance/settings` and a created proposal, and check every tab renders, using the browser pane.
- [ ] **Step 5: Commit.** `feat(rebalance): proposal hub and review pages`

### Task 11: Documentation

**Files:**
- Create: `docs/rebalancing.md`. It covers the operator's guide: the files, the CLI, the status flow and what is out of scope. Link it from the spec's header.
- Modify: `README.md`, adding a short "Rebalancing" section that links to it.

- [ ] **Step 1: Write the doc.**
  - It names the three host-owned files and their example files.
  - It explains how to start: settings → classes → buy lists → targets → create a proposal.
  - It states the open P0 questions (lot method per broker) as checks the maintainer performs in settings.
- [ ] **Step 2: Commit.** `docs(rebalance): operator guide`
