# Rebalancing P2 — LLM judgment layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monthly proposal can carry an LLM outlook and a target change. The LLM is validated by code, retried once, and falls back to "hold". The review UI shows the result.

**Architecture:**
- The LLM only reads a sanitized JSON input and writes a strict JSON output.
- Everything numeric stays in the P1 engine.
- Five units:
  - an input builder (`lib/rebalance/llm-input.ts`);
  - an output contract and validator (`lib/rebalance/llm-contract.ts`);
  - a swappable CLI runner (`lib/rebalance/llm-runner.ts`);
  - an orchestrator (`proposeMonthly` in `lib/rebalance/propose.ts`);
  - UI rendering on the proposal page.
- Tests use a fake runner. No test calls a real model.

**Tech Stack:** TypeScript, `node:child_process` spawn, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-14-rebalancing-workflow-design.md` §4. Operator guide: `docs/rebalancing.md`.

## Global Constraints

- All P1 global constraints still apply:
  - sleeves;
  - taxable and self-owned scope;
  - host-owned gitignored files;
  - atomic writes;
  - `(brokerage, account)` identity;
  - English repo text;
  - en/ko copy;
  - no real data in tests;
  - deterministic engine;
  - nothing places an order;
  - URL redirects carry only fixed codes.
- The LLM input never contains account labels, brokerage names, account numbers or the maintainer's name. Accounts appear as aliases: `KR-taxable-1`, `US-taxable-1`, `CRYPTO-1`, numbered by sorted `accountKey`.
- The LLM is never asked for quantities or tax. Its output can change only `targetChange`, `outlook`, `ideas` and `questionsForMaintainer`.
- `hold` is the default. A `change` needs a reason per changed sleeve and at least one source with a URL and an ISO date.
- Validation rules:
  - schema-valid;
  - targets sum to 100 within ±0.05;
  - each target is within the sleeve's `bounds`;
  - each shift is ≤ `maxTargetShiftPctPerCycle` against the current policy targets;
  - only known sleeve keys;
  - bands are never changed by the LLM.
- On a validation failure, retry once with the errors appended. If the second attempt fails, or the runner throws or times out, the proposal is created with targets held and `llm.status = 'failed'` with a fixed reason code.
- Runner selection:
  - `STOCK_REBALANCE_LLM_RUNNER` = `claude` (default) | `codex`.
  - Model from `STOCK_REBALANCE_LLM_MODEL`. When unset, the CLI's own default is used.
  - Timeout from `STOCK_REBALANCE_LLM_TIMEOUT_MS`, default 600000.
  - All three get entries in `config.ts`.
- The runner exit rule matches the fleet: the CLI exits 1 only when the job could not run at all (no policy, health errors, unreadable store). A `hold` or an LLM failure that fell back still exits 0, and the JSON says what happened.
- The proposal stores `llm = { status, runner, model, attempts: [{ prompt, raw, errors }], reason }` so a judgment can be audited later.

## Review Focus

1. **The model returns prose around the JSON, or a fenced block.** The parser extracts the first balanced top-level JSON object. Test: `parseLlmJson extracts a fenced or prose-wrapped object` (Task 1).
2. **The model returns sleeves as strings ("45") or omits unchanged sleeves.** Numbers given as numeric strings are rejected; the validator does not coerce them. Omitted sleeves mean "unchanged". Test: `omitted sleeves stay at current targets; string numbers are rejected` (Task 1).
3. **The briefing archive is missing or empty on the host.** The input carries `macro: []`, the prompt says so, and the proposal is still created. Test: `missing archive yields empty macro context` (Task 2).
4. **The runner binary is missing.** Fall back to hold with reason `runner_unavailable`, and the CLI exits 0. Test (Task 4).
5. **The same month already has an open proposal (e.g. a manual one).** Behave as `proposeEngineOnly` does: refuse with `open_proposal_exists` and do not call the LLM. Test (Task 4).

---

### Task 0: P1 carryover fixes

**Files:**
- Modify: `lib/ui-copy/pages/rebalanceSettings.ts`, `lib/rebalance/engine.ts`, `lib/rebalance/buy-funding.ts`, `app/rebalance/proposals/[id]/page.tsx`, `lib/ui-copy/pages/rebalanceProposal.ts`
- Test: the existing engine and buys tests

- [ ] Fix each item, adding a test where behaviour changes:
  - **Settings copy.** Mark `harvestThresholdKrw` as "reserved: used by the loss-harvest trigger (not yet active)" in en and ko. Say that `0` disables the position cap and the turnover cap.
  - **FX pinning.** Pin the planning USD/KRW rate unconditionally before both `yearTax` calls in `engine.ts`. Use the input rate, or the fallback rate when the input has none, so plan tax and YTD tax use the same rate. Add a test with `usdKrwRate: 0`.
  - **Moves table.** Replace the "Shortfall" column with a signed "Gap" column. Copy: "Gap = what the plan does − what the band asked; a sale beyond the band move is usually the position cap". Format positive and negative gaps clearly.
  - **`no_buy_price` wording.** When the instrument is held but unpriced, the message says "has no current price". It says "not held anywhere" only when the instrument really is not held. Test both cases.
  - **Fills tab.** Number and text inputs get accessible labels: Quantity, Price, Note.
  - **Auto-refresh on proposal pages.** Disable auto-refresh on proposal detail pages so a form is never reloaded mid-entry. Follow how `components/AutoRefresh.tsx` is mounted, and opt the page out.
  - **Warning amounts.** KRW amounts in the engine's warning messages are formatted with thousands separators.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm ui:guardrails`.
- [ ] Commit: `fix(rebalance): P1 carryover — gap column, FX pin, copy, labels`.

### Task 1: LLM output contract and validator

**Files:**
- Create: `lib/rebalance/llm-contract.ts`
- Test: `tests/rebalance-llm-contract.test.ts`

**Interfaces:**
- Produces:
```ts
export type LlmSource = { url: string; title: string; date: string }
export type LlmOutlook = { summary: string; drivers: string[]; risks: string[]; whatWouldChangeMyView: string[]; sources: LlmSource[]; confidence: 'low' | 'medium' | 'high' }
export type LlmTargetChange = { decision: 'change' | 'hold'; sleeves: Partial<Record<Sleeve, { to: number; reason: string }>> }
export type LlmIdea = { ticker: string; sleeve: Sleeve; why: string }
export type LlmOutput = { outlook: LlmOutlook; targetChange: LlmTargetChange; ideas: LlmIdea[]; questionsForMaintainer: string[] }
export type LlmFailureReason = 'runner_unavailable' | 'runner_failed' | 'timeout' | 'invalid_output'
export type LlmRecord = {
  status: 'ok' | 'failed' | 'skipped'
  runner: string; model: string | null
  attempts: { prompt: string; raw: string; errors: string[] }[]
  reason: LlmFailureReason | null
}
export function parseLlmJson(raw: string): unknown | null
export function validateLlmOutput(value: unknown, policy: AllocationPolicy): { ok: true; output: LlmOutput; targets: Record<Sleeve, SleeveTarget> } | { ok: false; errors: string[] }
```
`targets` is `policy.targets` with each changed sleeve's `target` replaced by `to`, and every band unchanged. A `hold` decision returns `policy.targets` and ignores any sleeves it lists.

- [ ] **Step 1: Write the failing tests:**
  - `parseLlmJson extracts a fenced or prose-wrapped object` (Review Focus 1).
  - `a valid change passes and yields merged targets`.
  - `hold ignores listed sleeves`.
  - `rejects a sum != 100`.
  - `rejects a target outside bounds`.
  - `rejects a shift above maxTargetShiftPctPerCycle`.
  - `rejects a change with no sources or a source without an ISO date`.
  - `rejects a changed sleeve without a reason`.
  - `rejects unknown sleeve keys`.
  - `omitted sleeves stay at current targets; string numbers are rejected` (Review Focus 2).
  - `rejects confidence outside low|medium|high`.
  - `caps text fields` (each string at most 2000 chars; arrays at most 10 items; errors name the field).
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement.** Reuse `checkTargetsAgainstBounds(policy, targets, { enforceShift: true })` for the bounds and shift checks.
- [ ] **Step 4: Run them and expect PASS.** Also run `pnpm typecheck`.
- [ ] **Step 5: Commit:** `feat(rebalance): LLM output contract and validator`.

### Task 2: LLM input builder and briefing context

**Files:**
- Create: `lib/rebalance/llm-input.ts`, `lib/adapters/rebalance-context.ts`
- Test: `tests/rebalance-llm-input.test.ts`

**Interfaces:**
- Consumes: `RebalanceInput`, `computeAllocation`, `AllocationPolicy`, `Proposal`, `getArchiveStatus` and `getBriefing` (`lib/adapters/briefing-archive.ts`).
- Produces:
```ts
export type MacroNote = { date: string; macro: string }
export type BriefingContext = { macro: MacroNote[]; benchmarks: unknown | null }
export function readBriefingContext(today: string, days?: number, dir?: string): BriefingContext   // rebalance-context.ts; days default 30; benchmarks.json beside the archive, null if absent/unreadable
export type LlmInput = {
  asOf: string
  allocation: { sleeve: Sleeve; pct: number; target: number; band: number; lower: number; upper: number; status: string }[]
  bounds: AllocationPolicy['bounds']
  positions: { alias: string; market: string; ticker: string; name: string; sleeve: Sleeve; pctOfTotal: number }[]   // classified only
  tax: { krDeductionRemainingKrw: number; ytdKrTaxableGainKrw: number; ytdUsShortUsd: number; ytdUsLongUsd: number; harvestableLossKrw: number }
  context: BriefingContext
  pastDecisions: { id: string; status: string; decision: 'change' | 'hold'; sleeves: Partial<Record<Sleeve, { from: number; to: number }>>; rejectedReason: string | null; editedByMaintainer: boolean }[]
}
export function buildLlmInput(args: { input: RebalanceInput; policy: AllocationPolicy; classes: InstrumentClasses; taxPolicy: TaxPolicy; context: BriefingContext; past: Proposal[] }): LlmInput
```
Aliases follow the Global Constraints rule. `harvestableLossKrw` is the sum of negative KR-measure unrealized gains over taxable lots, using the same per-lot figures as `buildTaxPlan`. `pastDecisions` covers the 3 newest proposals that are not the current one. `rejectedReason` is taken from the `rejected` event detail.

- [ ] **Step 1: Write the failing tests:**
  - `no account label, brokerage name or account number appears anywhere in the serialized input`: fixture labels like `Secret Broker` / `ACC-123` must not appear in `JSON.stringify(output)`.
  - `aliases are stable and numbered by sorted accountKey per market`.
  - `positions are classified-only with pct of total`.
  - `pastDecisions takes the 3 newest and carries a rejection reason`.
  - `missing archive yields empty macro context` (Review Focus 3).
  - `readBriefingContext keeps only the last N days and skips unreadable days`.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and expect PASS.**
- [ ] **Step 5: Commit:** `feat(rebalance): sanitized LLM input with briefing context`.

### Task 3: Prompt and runner

**Files:**
- Create: `lib/rebalance/llm-prompt.ts`, `lib/rebalance/llm-runner.ts`
- Modify: `config.ts`
- Test: `tests/rebalance-llm-runner.test.ts`

**Interfaces:**
- Produces:
```ts
export function buildPrompt(input: LlmInput, previousErrors?: string[]): string     // llm-prompt.ts
export type LlmRunResult = { raw: string; model: string | null }
export type LlmRunner = { name: 'claude' | 'codex'; available(): boolean; run(prompt: string, opts: { model: string | null; timeoutMs: number }): Promise<LlmRunResult> }
export function claudeRunner(spawnFn?: typeof spawn): LlmRunner
export function codexRunner(spawnFn?: typeof spawn): LlmRunner
export function runnerFromConfig(): LlmRunner
export class LlmTimeoutError extends Error {}
```

**Prompt requirements.** The prompt is English and contains:
- the role: an analyst preparing input for the maintainer's own decision; not advice; the maintainer places every order;
- the input JSON;
- the output JSON shape, verbatim from Task 1's types, with field meanings;
- the rules:
  - `hold` is a normal and default outcome;
  - change only when the outlook clearly warrants it;
  - every change needs a reason and a dated source;
  - stay within bounds and the shift limit;
  - do not change bands;
  - do not compute quantities or tax;
  - `ideas` are never traded automatically;
- "use web search for current market context; cite what you used";
- "Return only the JSON object";
- on a retry, the validator errors listed under "Your previous answer was rejected for:".

**Runners:**
- `claudeRunner` spawns `claude -p --output-format json --allowedTools WebSearch WebFetch [--model M]` and writes the prompt to stdin. It reads stdout JSON and takes `.result` as `raw` and `.model` (if present) as `model`.
- `codexRunner` spawns `codex exec --skip-git-repo-check --sandbox read-only [-m M] -` with the prompt on stdin. `raw` is stdout; `model` is the requested model.
- Both kill the child on timeout and throw `LlmTimeoutError`. A non-zero exit throws an Error containing the exit code, with stderr truncated to 500 chars.
- `available()` checks that the binary resolves on PATH (`command -v`).

- [ ] **Step 1: Write the failing tests** with a fake `spawnFn` that emits scripted stdout, stderr and an exit code:
  - `claude runner reads .result`.
  - `codex runner returns stdout`.
  - `non-zero exit throws with code`.
  - `timeout kills and throws LlmTimeoutError`.
  - `prompt contains rules, schema and input, and the retry section only when errors are given`.
  - `runnerFromConfig picks by env`.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement**, and add config entries `stockRebalanceLlmRunner`, `stockRebalanceLlmModel` and `stockRebalanceLlmTimeoutMs`.
- [ ] **Step 4: Run them and expect PASS.**
- [ ] **Step 5: Commit:** `feat(rebalance): LLM prompt and swappable CLI runner`.

### Task 4: Monthly proposal with LLM

**Files:**
- Modify: `lib/rebalance/propose.ts`, `lib/rebalance/cli.ts`, `lib/rebalance/proposal-store.ts` (type `outlook: LlmOutlook | null` and `llm: LlmRecord | null`, plus `ideas` and `questionsForMaintainer` on the proposal; old files read as null/[]), `package.json` (no change if `propose --kind monthly` already routes)
- Test: `tests/rebalance-propose-llm.test.ts`

**Interfaces:**
- Produces:
```ts
export function proposeMonthly(args: { today: string; now: Date; runner: LlmRunner; model?: string | null; timeoutMs?: number; paths?: {...same as proposeEngineOnly}; contextDir?: string }): Promise<ProposeResult>
```

**Flow:**
1. Run the same preconditions as `proposeEngineOnly`: `expireStale`, policy present, no health errors, no open proposal. If any fails, return without calling the runner.
2. Take the snapshot.
3. If `runner.available()` is false, record `llm = { status: 'failed', reason: 'runner_unavailable' }` and hold.
4. Otherwise run up to 2 attempts. Each attempt does `buildPrompt` → `run` → `parseLlmJson` → `validateLlmOutput`. Attempt 2 receives attempt 1's errors.
5. On success:
   - with `change`: `targetChange.decision = 'change'`, and sleeves `{from: policy target, to, reason}` only for sleeves whose target actually moved. If none moved, record `hold`.
   - with `hold`: hold.
   - Store `outlook`, `ideas` and `questions`, and build the plan with the proposed targets.
6. On failure: hold, with reason `invalid_output`, `timeout` or `runner_failed`.

The proposal kind is `monthly` and its id is `rb-YYYY-MM`.

**CLI:**
- `propose --kind monthly` uses `proposeMonthly` with `runnerFromConfig()`.
- `--no-llm` forces `proposeEngineOnly`.
- The JSON adds `llm: { status, reason, attempts: n }`.
- The exit rule follows the Global Constraints.

- [ ] **Step 1: Write the failing tests** with a fake runner:
  - `valid change → change proposal with plan on proposed targets`.
  - `invalid then valid → ok with 2 attempts`.
  - `invalid twice → hold with invalid_output and both attempts stored`.
  - `runner throws → hold runner_failed`.
  - `timeout → hold timeout`.
  - `runner unavailable → hold runner_unavailable, exit 0 via CLI` (Review Focus 4).
  - `open proposal → refused, runner never called` (Review Focus 5).
  - `hold decision → hold, outlook stored`.
  - `change where no target moves → recorded as hold`.
- [ ] **Step 2: Run them and expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and expect PASS.** Also run `pnpm test` and `pnpm typecheck`.
- [ ] **Step 5: Commit:** `feat(rebalance): monthly proposal with validated LLM judgment`.

### Task 5: Review UI for the LLM judgment, and docs

**Files:**
- Modify: `app/rebalance/proposals/[id]/page.tsx` (or its tab components), `lib/ui-copy/pages/rebalanceProposal.ts`, `docs/rebalancing.md`
- Test: `tests/rebalance-proposal-actions.test.ts`, only if a pure helper is added

**Requirements:**
- The summary tab shows, when `outlook` is present:
  - the summary;
  - drivers, risks and "what would change this view" as lists;
  - confidence as a badge;
  - sources as links (title, date). Only `https:` links render as anchors. Other links render as text. Use `rel="noopener noreferrer"`.
- It shows an "LLM" status line: runner, model and attempt count, or a fixed-copy reason when it failed or was skipped.
- It shows `ideas` ("Ideas — never traded automatically; add to a buy list in settings if you want them") and `questionsForMaintainer`.
- The targets tab already shows reasons; it now also marks LLM-proposed values.
- The copy is natural Korean. The disclaimer stays.
- In `docs/rebalancing.md`, describe the monthly flow, env vars, fallback rules and what the LLM sees (aliases only).

- [ ] **Step 1: Implement.** Then run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm ui:guardrails`.
- [ ] **Step 2: Render check.**
  - On the dev server with temp paths, write a proposal file with a full `outlook`, `ideas`, `questions` and an `llm` record by hand.
  - Confirm the summary and targets tabs render in en and ko. Confirm a `javascript:` source URL renders as text.
- [ ] **Step 3: Commit:** `feat(rebalance): show LLM outlook, ideas and questions on proposals`.
