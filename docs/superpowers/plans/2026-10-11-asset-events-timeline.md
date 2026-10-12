# Asset Events Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under the total-assets trend, list in date order the large events that grew total assets, and mark them on the chart. Two kinds of event:
- money that arrived from outside, such as a home sale, an inheritance or a surrendered insurance pension;
- investment episodes: "held X from date A to date B, peak invested Y, gain Z". Z includes the unrealized gain at today's price, with the estimated tax and the after-tax figure shown separately.

**Architecture:**
- **Outside money.** The bank extractor already pairs transfers and groups the unpaired ones (`estimate_closed_accounts`). The amount `held_outside` clips at zero is exactly the money that arrived with nothing sent out first. The extractor now emits those arrivals as `externalInflows`, grouped by counterparty and a 120-day window.
- **Labels.** A gitignored labels file names the arrivals ("home sale") or hides them ("annual bonus"). The ingest joins the labels and stores `external_inflows`.
- **Investment episodes.** These are computed at read time by a pure function over `realized_lots_all`, `tax_lots_all` and `dividends_all`. An episode ends when the open cost basis of a ticker falls below 1,000,000 KRW.
- **Tax.** Estimated tax on the open part comes from `buildTaxPlan`, the same per-lot estimate `/tax-planning` uses.
- **One reader.** `getAssetEvents()` merges both kinds, applies the ±10,000,000 KRW threshold and sorts by start date. The Overview "all assets" view and `/net-worth` render it as a list, plus numbered markers on `StackedAssetChart`.

**Tech Stack:** Python 3 extractor, Node ESM ingest, better-sqlite3, Next.js 15 server components, recharts 2, TypeScript, `node --test` via tsx.

**Spec:** The maintainer's request and answers of 2026-10-11, recorded here because there is no separate spec:
- **What to list:** the large events that grew total assets, unrealized gain included, in date order. The examples given were a home sale, an inheritance received, and "held a given stock from when to when, and how much".
- **Unrealized gain:** valued as if sold now.
- **Threshold:** an event is listed when its amount or gain is at least ±10,000,000 KRW. Losses are listed too.
- **Tax:** show the gain before tax, plus the estimated tax and the after-tax figure.
- **Episode boundary:** not "the position reaches zero" but "the open position falls below 1,000,000 KRW". The maintainer often keeps a small observation lot after selling out.
- **Placement:** a list under the total-assets trend, plus a marker on the chart for each event.

## Global Constraints

- **Public repository.** No real name, counterparty, account number, balance or holding goes into code, tests, fixtures, docs, commits or PR text. Invent fixtures. The labels file holding the real counterparties is gitignored.
- **English repo text.** Korean appears only in the `ko` UI copy and as data a parser matches, such as statement memo words.
- **grep.** Use `/usr/bin/grep -a`, never bare `grep`: the Bash tool's `grep` silently skips files.
- **Node 22 for tests.** Node 22 for `pnpm test` (`PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH`, then `pnpm rebuild better-sqlite3` once); `npx tsc --noEmit -p .`; and `pnpm build` for the UI task.
- **Thresholds:** `EVENT_THRESHOLD_KRW = 10_000_000` and `EPISODE_FLOOR_KRW = 1_000_000`. Each is defined once, in `lib/asset-events.ts`.
- **Stock surfaces unchanged.** Stocks-mode figures do not change. Events appear only where the total-assets trend appears. `tests/default-view-regression.test.ts` must keep passing.
- **No production changes from this plan.** Deploying to the ops host (`ssh ops-host`) is a separate, confirmed step.

## Review Focus

1. **A ticker held in two accounts** (ISA and 종합, or two brokerages) is one episode stream per `(market, ticker)`, not two. A sale in one account while the other still holds stock must not end the episode while the combined open cost is ≥ 1,000,000 KRW. *(Task 1 test.)*
2. **The observation lot.** After selling down to a 300,000 KRW lot, the episode ends on that sale date. A rebuy a year later starts a new episode. The leftover lot's unrealized gain stays with the episode that bought it. *(Task 1 test.)*
3. **Superseded realized rows** (`superseded_by is not null`) must not double a gain. *(Task 4 test.)*
4. **The house sale arrived in several transfers.** Five arrivals from one counterparty within a few months are one event dated at its first arrival, not five events of which some fall under the threshold. *(Task 2 test.)*
5. **An event date that is not a chart point.** The chart's x axis is the list of snapshot dates. A marker at 2024-06-01 snaps to the first plotted date on or after it, and an event after the last point snaps to the last point. *(Task 5 test.)*

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/asset-events.ts` (new) | Pure: `buildInvestmentEpisodes`, `mergeAssetEvents`, `snapEventDates`, thresholds and types. |
| `scripts/extract-bank-statements.py` | `arrivals()` next to `held_outside`; `externalInflows` in the output. |
| `scripts/ingest-stock-data.mjs` | Normalise `externalInflows`, read the labels file, create and fill `external_inflows`. |
| `data/asset-event-labels.example.json` (new, tracked) | The labels file's shape, with invented entries. |
| `scripts/push-sources.sh` | Add `asset-event-labels.local.json` to the config allowlist. |
| `lib/adapters/portfolio-db.ts` | `getAssetEvents()`: reads the tables, runs the pure functions, returns `AssetEvent[]`. |
| `components/AssetEventList.tsx` (new) | The list. |
| `components/charts.tsx` | `StackedAssetChart` takes an optional `events` prop and draws numbered markers. |
| `app/page.tsx`, `app/net-worth/page.tsx` | Fetch and render events beside the trend. |
| `lib/ui-copy/pages/overview.tsx`, `lib/ui-copy/pages/netWorth.ts` | en/ko copy for the list. |
| `docs/data-sources.md` | Documents the labels file and the event rules. |

---

### Task 1: Investment episodes (pure)

**Files:**
- Create: `lib/asset-events.ts`
- Test: `tests/asset-events.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const EVENT_THRESHOLD_KRW = 10_000_000
  export const EPISODE_FLOOR_KRW = 1_000_000
  export type EpisodeLot = { id: number; market: string; ticker: string; name: string; acquiredDate: string; costKrw: number }
  export type ClosedLot = EpisodeLot & { soldDate: string; realizedKrw: number }
  export type OpenLot = EpisodeLot & { marketValueKrw: number | null; estimatedTaxKrw: number | null }
  export type DividendRow = { market: string; ticker: string; date: string; amountKrw: number }
  export type InvestmentEpisode = {
    kind: 'investment'; market: string; ticker: string; name: string
    start: string; end: string | null           // end null = still held at or above the floor
    peakCostKrw: number                         // most open cost at any time in the episode
    realizedKrw: number; unrealizedKrw: number; dividendsKrw: number
    gainKrw: number                             // realized + unrealized + dividends, before tax
    estimatedTaxKrw: number | null              // on the unrealized part only; null when no open lot was estimated
    unpricedLots: number                        // open lots with no market value (gain understated)
  }
  export function buildInvestmentEpisodes(input: { closed: ClosedLot[]; open: OpenLot[]; dividends: DividendRow[]; floorKrw?: number }): InvestmentEpisode[]
  ```

**Algorithm:**
- For each `(market, ticker)`, build a cost timeline:
  - `+costKrw` on the `acquiredDate` of every lot, closed or open;
  - `−costKrw` on the `soldDate` of every closed lot.
- Process each day as a whole: acquisitions, then sales.
- **Start:** an episode starts on the first day the running open cost rises from below the floor to at or above it.
- **End:** it ends on the first later day the running cost ends the day below the floor.
- **Lot assignment:** a lot belongs to the episode whose `[start, end]` contains its `acquiredDate`. A lot bought while the cost was below the floor, between episodes, goes to the next episode that starts. Without a next episode, it goes to the previous one.
- **Dividends:** a dividend belongs to the episode whose `[start, end ?? '9999-12-31']` contains its date.
- **Peak:** `peakCostKrw` is the highest end-of-day running cost within the episode.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInvestmentEpisodes, type ClosedLot, type OpenLot } from '../lib/asset-events'

const lot = (id: number, acquiredDate: string, costKrw: number) => ({ id, market: 'KR', ticker: 'AAA', name: 'Invented', acquiredDate, costKrw })
const closed = (id: number, acquiredDate: string, costKrw: number, soldDate: string, realizedKrw: number): ClosedLot => ({ ...lot(id, acquiredDate, costKrw), soldDate, realizedKrw })
const open = (id: number, acquiredDate: string, costKrw: number, marketValueKrw: number | null, estimatedTaxKrw: number | null = 0): OpenLot => ({ ...lot(id, acquiredDate, costKrw), marketValueKrw, estimatedTaxKrw })

test('selling down to an observation lot ends the episode; a rebuy starts a new one, and the leftover gain stays with the first', () => {
  const episodes = buildInvestmentEpisodes({
    closed: [closed(1, '2024-01-10', 30_000_000, '2024-06-01', 8_000_000)],
    open: [open(2, '2024-01-10', 300_000, 500_000), open(3, '2025-03-01', 20_000_000, 26_000_000, 1_300_000)],
    dividends: [],
  })
  assert.equal(episodes.length, 2)
  assert.deepEqual([episodes[0].start, episodes[0].end, episodes[0].peakCostKrw], ['2024-01-10', '2024-06-01', 30_300_000])
  assert.equal(episodes[0].realizedKrw, 8_000_000)
  assert.equal(episodes[0].unrealizedKrw, 200_000)
  assert.deepEqual([episodes[1].start, episodes[1].end, episodes[1].unrealizedKrw, episodes[1].estimatedTaxKrw], ['2025-03-01', null, 6_000_000, 1_300_000])
})

test('two accounts of one ticker are one stream: a sale in one does not end the episode while the other holds enough', () => {
  const episodes = buildInvestmentEpisodes({
    closed: [closed(1, '2024-01-10', 5_000_000, '2024-03-01', 1_000_000)],
    open: [open(2, '2024-02-01', 4_000_000, 5_000_000)],
    dividends: [],
  })
  assert.equal(episodes.length, 1)
  assert.equal(episodes[0].end, null)
  assert.equal(episodes[0].gainKrw, 1_000_000 + 1_000_000)
})

test('dividends inside an episode add to its gain; an unpriced open lot is counted, not valued', () => {
  const [episode] = buildInvestmentEpisodes({
    closed: [],
    open: [open(1, '2024-01-10', 12_000_000, null, null)],
    dividends: [{ market: 'KR', ticker: 'AAA', date: '2024-05-01', amountKrw: 400_000 }],
  })
  assert.equal(episode.dividendsKrw, 400_000)
  assert.equal(episode.unrealizedKrw, 0)
  assert.equal(episode.unpricedLots, 1)
  assert.equal(episode.estimatedTaxKrw, null)
})

test('a ticker that never reaches the floor makes no episode', () => {
  assert.deepEqual(buildInvestmentEpisodes({ closed: [closed(1, '2024-01-10', 500_000, '2024-02-01', 50_000)], open: [], dividends: [] }), [])
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx tsx --test tests/asset-events.test.ts`
Expected: FAIL, "Cannot find module '../lib/asset-events'".

- [ ] **Step 3: Implement**

```ts
// lib/asset-events.ts
/**
 * Large events behind the total-assets trend: money that arrived from outside,
 * and investment episodes. An episode runs while a ticker's open cost basis
 * stays at or above EPISODE_FLOOR_KRW, so a small observation lot left after
 * selling out does not keep it open.
 */
export const EVENT_THRESHOLD_KRW = 10_000_000
export const EPISODE_FLOOR_KRW = 1_000_000

export type EpisodeLot = { id: number; market: string; ticker: string; name: string; acquiredDate: string; costKrw: number }
export type ClosedLot = EpisodeLot & { soldDate: string; realizedKrw: number }
export type OpenLot = EpisodeLot & { marketValueKrw: number | null; estimatedTaxKrw: number | null }
export type DividendRow = { market: string; ticker: string; date: string; amountKrw: number }
export type InvestmentEpisode = {
  kind: 'investment'
  market: string
  ticker: string
  name: string
  start: string
  end: string | null
  peakCostKrw: number
  realizedKrw: number
  unrealizedKrw: number
  dividendsKrw: number
  gainKrw: number
  estimatedTaxKrw: number | null
  unpricedLots: number
}

export function buildInvestmentEpisodes({
  closed,
  open,
  dividends,
  floorKrw = EPISODE_FLOOR_KRW,
}: {
  closed: ClosedLot[]
  open: OpenLot[]
  dividends: DividendRow[]
  floorKrw?: number
}): InvestmentEpisode[] {
  const key = (row: { market: string; ticker: string }) => `${row.market}\t${row.ticker}`
  const keys = [...new Set([...closed, ...open].map(key))].sort()
  const out: InvestmentEpisode[] = []
  for (const k of keys) {
    const c = closed.filter((row) => key(row) === k)
    const o = open.filter((row) => key(row) === k)
    const days = new Map<string, number>()
    const bump = (date: string, delta: number) => days.set(date, (days.get(date) ?? 0) + delta)
    for (const row of [...c, ...o]) bump(row.acquiredDate, row.costKrw)
    for (const row of c) bump(row.soldDate, -row.costKrw)
    // Episodes as [start, end] spans of the running end-of-day cost.
    const spans: { start: string; end: string | null; peak: number }[] = []
    let running = 0
    let current: { start: string; end: string | null; peak: number } | null = null
    for (const date of [...days.keys()].sort()) {
      running += days.get(date)!
      if (Math.abs(running) < 0.5) running = 0
      if (!current && running >= floorKrw) current = { start: date, end: null, peak: running }
      else if (current && running >= floorKrw) current.peak = Math.max(current.peak, running)
      else if (current && running < floorKrw) {
        current.end = date
        spans.push(current)
        current = null
      }
    }
    if (current) spans.push(current)
    if (!spans.length) continue
    const spanFor = (date: string) => {
      const inside = spans.findIndex((span) => date >= span.start && date <= (span.end ?? '9999-12-31'))
      if (inside >= 0) return inside
      const next = spans.findIndex((span) => span.start > date)
      return next >= 0 ? next : spans.length - 1
    }
    const first = (c[0] ?? o[0])!
    const episodes = spans.map((span): InvestmentEpisode => ({
      kind: 'investment', market: first.market, ticker: first.ticker, name: first.name,
      start: span.start, end: span.end, peakCostKrw: span.peak,
      realizedKrw: 0, unrealizedKrw: 0, dividendsKrw: 0, gainKrw: 0, estimatedTaxKrw: null, unpricedLots: 0,
    }))
    for (const row of c) episodes[spanFor(row.acquiredDate)].realizedKrw += row.realizedKrw
    for (const row of o) {
      const episode = episodes[spanFor(row.acquiredDate)]
      if (row.marketValueKrw == null) episode.unpricedLots += 1
      else episode.unrealizedKrw += row.marketValueKrw - row.costKrw
      if (row.estimatedTaxKrw != null) episode.estimatedTaxKrw = (episode.estimatedTaxKrw ?? 0) + row.estimatedTaxKrw
    }
    for (const row of dividends.filter((d) => key(d) === k)) {
      const inside = spans.findIndex((span) => row.date >= span.start && row.date <= (span.end ?? '9999-12-31'))
      if (inside >= 0) episodes[inside].dividendsKrw += row.amountKrw
    }
    for (const episode of episodes) episode.gainKrw = episode.realizedKrw + episode.unrealizedKrw + episode.dividendsKrw
    out.push(...episodes)
  }
  return out
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx tsx --test tests/asset-events.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/asset-events.ts tests/asset-events.test.ts
git commit -m "feat(asset-events): investment episodes that end below a 1M KRW open cost"
```

---

### Task 2: Outside money in the bank extractor

**Files:**
- Modify: `scripts/extract-bank-statements.py` (next to `held_outside`, and in `estimate_closed_accounts` and `main`)
- Test: `tests/bank-statements.test.ts`

**Interfaces:**
- Consumes: the `buckets` dict built in `estimate_closed_accounts`. Each key is a bucket key like `counterparty:<memo>|<bank>`; each value is a list of `(date, outflow)`, where outflow is positive when money leaves.
- Produces:
  - `arrivals(points) -> list[(date, amount)]`: the amount the running total would have gone below zero on each date.
  - `group_arrivals(group, items, window_days=120) -> list[dict]`, where `items` is the output of `arrivals`.
  - `estimate_closed_accounts(...)` now returns `(estimated, inflows)`.
  - `bank-balances.json` gains `externalInflows: [{ "group": str, "firstDate": str, "lastDate": str, "amountKrw": float, "arrivals": int }]`. `group` is the bucket key, with the `counterparty:` prefix kept, so the labels file can match it exactly.

- [ ] **Step 1: Write the failing tests** (append to `tests/bank-statements.test.ts`)

```ts
test('arrivals are what comes in with nothing sent out first; a return of money sent out is not one', () => {
  const r = py(`
print(json.dumps(m.arrivals([("2026-01-05", 300.0), ("2026-02-10", -305.0), ("2026-03-01", -1000.0)])))`)
  // 5 over the 300 sent out (interest), then 1000 with nothing outstanding.
  assert.deepEqual(r, [['2026-02-10', 5], ['2026-03-01', 1000]])
})

test('arrivals from one group within 120 days are one inflow dated at the first', () => {
  const r = py(`
print(json.dumps(m.group_arrivals("counterparty:Buyer|Bank", [("2026-01-05", 100.0), ("2026-03-01", 200.0), ("2026-09-01", 50.0)])))`)
  assert.deepEqual(r, [
    { group: 'counterparty:Buyer|Bank', firstDate: '2026-01-05', lastDate: '2026-03-01', amountKrw: 300, arrivals: 2 },
    { group: 'counterparty:Buyer|Bank', firstDate: '2026-09-01', lastDate: '2026-09-01', amountKrw: 50, arrivals: 1 },
  ])
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx tsx --test tests/bank-statements.test.ts`
Expected: the two new tests FAIL with `AttributeError: ... 'arrivals'`.

- [ ] **Step 3: Implement**

```python
def arrivals(points):
    """Money that arrived with nothing outstanding to return: the part held_outside clips at zero."""
    running, out = 0.0, {}
    for date, outflow in points:
        if running + outflow < 0:
            out[date] = out.get(date, 0.0) + round(-(running + outflow), 2)
        running = max(0.0, running + outflow)
    return sorted(out.items())


def group_arrivals(group, items, window_days=120):
    """Arrivals of one group, joined while each falls within window_days of the previous one."""
    out = []
    for date, amount in items:
        if out and _days(out[-1]["lastDate"], date) <= window_days:
            out[-1].update(lastDate=date, amountKrw=round(out[-1]["amountKrw"] + amount, 2), arrivals=out[-1]["arrivals"] + 1)
        else:
            out.append({"group": group, "firstDate": date, "lastDate": date, "amountKrw": round(amount, 2), "arrivals": 1})
    return out
```

In `estimate_closed_accounts`, before the `return out`:

```python
    inflows = [i for key, points in sorted(buckets.items()) for i in group_arrivals(key, arrivals(points))]
    return out, inflows
```

In `main`, change the caller:

```python
    estimated, inflows = estimate_closed_accounts(krw_statements, transfers, account_map, findings)
```

Then add `"externalInflows": inflows` to `document`. Update the two existing `estimate_closed_accounts` tests to unpack `out, _ = ...`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx tsx --test tests/bank-statements.test.ts`
Expected: all pass, the 2 new ones included.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-bank-statements.py tests/bank-statements.test.ts
git commit -m "feat(bank): emit money that arrived from outside as externalInflows"
```

---

### Task 3: Labels file and the `external_inflows` table

**Files:**
- Create: `data/asset-event-labels.example.json`
- Modify: `scripts/ingest-stock-data.mjs` (`normalizeBankBalances`, the schema next to `cash_estimates`, the inserts next to `cash_estimates`)
- Modify: `scripts/push-sources.sh` (config allowlist), `.gitignore` (`data/asset-event-labels.local.json`)
- Test: `tests/cash-balances-ingest.test.ts`

**Interfaces:**
- Labels file: `STOCK_ASSET_EVENT_LABELS_PATH`, default `data/asset-event-labels.local.json`. It is missing on a fresh machine, which is fine.

  ```json
  { "labels": [
      { "group": "counterparty:Example Buyer|Example Bank", "from": "2024-06-01", "to": "2024-09-30", "label": "Home sale", "category": "asset_sale" },
      { "group": "counterparty:Example Payroll|MG새마을금고", "label": "Annual bonus", "category": "income", "hidden": true }
  ] }
  ```

  - `from`/`to` are optional and bound the inflow's `firstDate`.
  - `category` is one of `asset_sale | inheritance | insurance | income | other`.
- Table:

  ```sql
  create table external_inflows (
    id integer primary key, grp text not null, first_date text not null, last_date text not null,
    amount_krw real not null, arrivals integer not null, label text, category text, hidden integer not null default 0
  );
  ```

- [ ] **Step 1: Write the failing test**

```ts
test('external inflows land with their label; an unlabeled one keeps a null label, a hidden one is flagged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inflow-src-'))
  const balances = path.join(dir, 'bank-balances.json')
  const labels = path.join(dir, 'labels.json')
  writeFileSync(balances, JSON.stringify({ accounts: [], findings: [], externalInflows: [
    { group: 'counterparty:Buyer|Bank', firstDate: '2024-06-01', lastDate: '2024-09-04', amountKrw: 50_000_000, arrivals: 5 },
    { group: 'counterparty:Payroll|MG', firstDate: '2025-01-24', lastDate: '2025-01-24', amountKrw: 30_000_000, arrivals: 1 },
    { group: 'counterparty:Someone|Bank', firstDate: '2025-03-01', lastDate: '2025-03-01', amountKrw: 12_000_000, arrivals: 1 },
  ] }))
  writeFileSync(labels, JSON.stringify({ labels: [
    { group: 'counterparty:Buyer|Bank', label: 'Home sale', category: 'asset_sale' },
    { group: 'counterparty:Payroll|MG', label: 'Bonus', category: 'income', hidden: true },
  ] }))
  const db = ingest({ STOCK_BANK_BALANCES_PATH: balances, STOCK_ASSET_EVENT_LABELS_PATH: labels })
  assert.deepEqual(db.prepare('select grp, first_date, amount_krw, label, category, hidden from external_inflows order by first_date').all(), [
    { grp: 'counterparty:Buyer|Bank', first_date: '2024-06-01', amount_krw: 50_000_000, label: 'Home sale', category: 'asset_sale', hidden: 0 },
    { grp: 'counterparty:Payroll|MG', first_date: '2025-01-24', amount_krw: 30_000_000, label: 'Bonus', category: 'income', hidden: 1 },
    { grp: 'counterparty:Someone|Bank', first_date: '2025-03-01', amount_krw: 12_000_000, label: null, category: null, hidden: 0 },
  ])
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH npx tsx --test tests/cash-balances-ingest.test.ts`
Expected: FAIL with "no such table: external_inflows".

- [ ] **Step 3: Implement**

`normalizeBankBalances`:
- Add `externalInflows` to the returned `doc` (default `[]`).
- Keep only objects with string `group`/`firstDate`/`lastDate` and a finite `amountKrw`.
- Report each dropped element in `problems` as `externalInflows[i] ...`, the same as `estimatedAccounts`.
- Add `externalInflows: []` to the three early-return `doc` literals.

Labels:

```js
const assetEventLabelsPath = process.env.STOCK_ASSET_EVENT_LABELS_PATH || path.join(process.cwd(), 'data/asset-event-labels.local.json')
// Names for money that arrived from outside. Gitignored: the groups carry real
// counterparties. A missing or unreadable file leaves every inflow unlabeled.
const assetEventLabels = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(assetEventLabelsPath, 'utf8'))
    return Array.isArray(raw?.labels) ? raw.labels.filter((l) => l && typeof l.group === 'string' && typeof l.label === 'string') : []
  } catch {
    return []
  }
})()
const labelFor = (inflow) =>
  assetEventLabels.find((l) => l.group === inflow.group && (!l.from || inflow.firstDate >= l.from) && (!l.to || inflow.firstDate <= l.to)) ?? null
```

Add the `create table external_inflows (...)` above beside `cash_estimates`. Then insert:

```js
insertMany(
  db,
  'external_inflows',
  bankBalances.externalInflows.map((i) => {
    const l = labelFor(i)
    return { grp: i.group, first_date: i.firstDate, last_date: i.lastDate, amount_krw: i.amountKrw, arrivals: i.arrivals ?? 1, label: l?.label ?? null, category: l?.category ?? null, hidden: l?.hidden ? 1 : 0 }
  }),
  ['grp', 'first_date', 'last_date', 'amount_krw', 'arrivals', 'label', 'category', 'hidden']
)
```

Other files:
- **Example file:** create `data/asset-event-labels.example.json` with the two invented entries above.
- **push-sources:** add `asset-event-labels.local.json` to the config-file list in `scripts/push-sources.sh`, next to `accounts.local.json`. Add a comment line that says why: it is edited here and read by the refresh host.
- **.gitignore:** add `data/asset-event-labels.local.json`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH npx tsx --test tests/cash-balances-ingest.test.ts tests/push-sources-config.test.mjs`
Expected: all pass. If `push-sources-config.test.mjs` asserts the exact allowlist, update its expectation in the same commit.

- [ ] **Step 5: Commit**

```bash
git add data/asset-event-labels.example.json scripts/ingest-stock-data.mjs scripts/push-sources.sh .gitignore tests/
git commit -m "feat(ingest): external_inflows with labels from a gitignored file"
```

---

### Task 4: `getAssetEvents()` adapter

**Files:**
- Modify: `lib/asset-events.ts` (add `mergeAssetEvents`), `lib/adapters/portfolio-db.ts` (add `getAssetEvents`)
- Test: `tests/asset-events.test.ts`, `tests/total-assets.test.ts`

**Interfaces:**
- Consumes: `buildInvestmentEpisodes` (Task 1), the `external_inflows` table (Task 3), `getTaxPlanningLots` and `buildTaxPlan` (existing).
- Produces:
  ```ts
  export type InflowEvent = { kind: 'inflow'; start: string; end: string; label: string | null; category: string | null; amountKrw: number; arrivals: number }
  export type AssetEvent = InflowEvent | InvestmentEpisode
  export function mergeAssetEvents(inflows: InflowEvent[], episodes: InvestmentEpisode[], thresholdKrw?: number): AssetEvent[]
  // portfolio-db.ts
  export function getAssetEvents(): AssetEvent[]
  ```
- `mergeAssetEvents` keeps an inflow when `amountKrw >= threshold` and an episode when `|gainKrw| >= threshold`. It sorts by `start`, then by `kind` (inflow first).

**Reads in `getAssetEvents`:**
- **Closed lots:**
  ```sql
  select id, market, ticker, name, acquired_date, sold_date, cost_basis_krw, realized_gl_krw
    from realized_lots_all
   where superseded_by is null and asset_class = 'security'
  ```
  Use `allAssetsTable`. An older DB without `realized_lots_all` uses `realized_lots`, without the `asset_class` filter.
- **Open lots:** `getTaxPlanningLots(100_000)` gives cost and market value. Market value in KRW is `native_market_value * fx`, with `fx` derived the way `buildTaxPlan` does (`lot.currency === 'KRW' ? 1 : fx_rate_to_base || cost_basis_krw / native_cost_basis`). `buildTaxPlan({ lots, policy }).candidates` gives `estimatedTaxKrw` keyed by lot `id`.
- **Lots `getTaxPlanningLots` leaves out:** the ISA and pension wrappers set to non-taxable. Read the remaining open security lots from `tax_lots_all` directly. Value them with the same price join `getTaxPlanningLots` uses, and set `estimatedTaxKrw: 0`. To share that SQL, extract the `holding_prices` CTE from `getTaxPlanningLots` into a module-level string constant, and reuse it instead of copying.
- **Dividends:**
  ```sql
  select market, ticker, substr(date,1,10), amount_krw from dividends_all where ticker is not null
  ```
- **Inflows:**
  ```sql
  select first_date, last_date, label, category, amount_krw, arrivals from external_inflows where hidden = 0
  ```
  If the table is missing, there are no inflows.

- [ ] **Step 1: Write the failing tests**

In `tests/asset-events.test.ts`:

```ts
import { mergeAssetEvents, type InvestmentEpisode } from '../lib/asset-events'
test('mergeAssetEvents keeps events at or above ±10M, losses included, in date order', () => {
  const ep = (start: string, gainKrw: number) => ({ kind: 'investment', market: 'KR', ticker: 'A', name: 'A', start, end: null, peakCostKrw: 1, realizedKrw: gainKrw, unrealizedKrw: 0, dividendsKrw: 0, gainKrw, estimatedTaxKrw: null, unpricedLots: 0 }) as InvestmentEpisode
  const events = mergeAssetEvents(
    [{ kind: 'inflow', start: '2024-06-01', end: '2024-09-04', label: 'Home sale', category: 'asset_sale', amountKrw: 50_000_000, arrivals: 5 },
     { kind: 'inflow', start: '2024-01-01', end: '2024-01-01', label: null, category: null, amountKrw: 9_999_999, arrivals: 1 }],
    [ep('2025-01-01', -12_000_000), ep('2023-01-01', 4_000_000)]
  )
  assert.deepEqual(events.map((e) => e.start), ['2024-06-01', '2025-01-01'])
})
```

In `tests/total-assets.test.ts`, a new test. It ingests with the harness, then writes these rows:
- `realized_lots_all`: one row, ticker `AAA`, cost 20M, gain 15M;
- a second copy of that row with `superseded_by = 1`;
- `external_inflows`: one row, 30M, label `'Example'`.

It then asserts:
- `getAssetEvents()` returns 2 events;
- the episode's `realizedKrw` is 15M, not 30M;
- the inflow's label is `'Example'`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH npx tsx --test tests/asset-events.test.ts tests/total-assets.test.ts`
Expected: FAIL, `mergeAssetEvents` / `getAssetEvents` is not exported.

- [ ] **Step 3: Implement**

```ts
// lib/asset-events.ts
export type InflowEvent = { kind: 'inflow'; start: string; end: string; label: string | null; category: string | null; amountKrw: number; arrivals: number }
export type AssetEvent = InflowEvent | InvestmentEpisode

export function mergeAssetEvents(inflows: InflowEvent[], episodes: InvestmentEpisode[], thresholdKrw = EVENT_THRESHOLD_KRW): AssetEvent[] {
  return [
    ...inflows.filter((e) => e.amountKrw >= thresholdKrw),
    ...episodes.filter((e) => Math.abs(e.gainKrw) >= thresholdKrw),
  ].sort((a, b) => a.start.localeCompare(b.start) || (a.kind === b.kind ? 0 : a.kind === 'inflow' ? -1 : 1))
}
```

`getAssetEvents()` in `portfolio-db.ts`:
1. Open one read-only `db()` connection for the reads above. Call `getTaxPlanningLots` and `getTaxPolicyState` before or after it; they open their own.
2. Map the rows into `ClosedLot`, `OpenLot`, `DividendRow` and `InflowEvent`.
3. Return `mergeAssetEvents(inflows, buildInvestmentEpisodes({ closed, open, dividends }))`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `PATH=~/.nvm/versions/node/v22.22.3/bin:$PATH npx tsx --test tests/asset-events.test.ts tests/total-assets.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/asset-events.ts lib/adapters/portfolio-db.ts tests/
git commit -m "feat(asset-events): getAssetEvents merges outside money and investment episodes"
```

---

### Task 5: List and chart markers

**Files:**
- Create: `components/AssetEventList.tsx`
- Modify: `components/charts.tsx` (`StackedAssetChart`), `lib/asset-events.ts` (`snapEventDates`)
- Modify: `app/page.tsx` (near line 618), `app/net-worth/page.tsx` (near line 139)
- Modify: `lib/ui-copy/pages/overview.tsx`, `lib/ui-copy/pages/netWorth.ts`
- Test: `tests/asset-events.test.ts`

**Interfaces:**
- `export function snapEventDates(events: AssetEvent[], pointDates: string[]): { n: number; date: string; event: AssetEvent }[]`. It numbers events from 1 in list order. Each event's `start` snaps to the first point date `>= start`; an event after the last point snaps to the last point.
- `StackedAssetChart` gains `events?: { n: number; date: string }[]`. It draws them as `<ReferenceLine x={date} stroke="var(--text-tertiary)" strokeDasharray="2 4" label={{ value: String(n), position: 'top', fontSize: 10 }} />`. Several events on one date share one line, labelled `"3,4"`.

**List columns:**

| # | Period | Event | Invested (peak) | Gain before tax | Estimated tax | After tax |
| --- | --- | --- | --- | --- | --- | --- |

- **Inflow row:**
  - Event: the label, or the copy's "Unlabeled inflow" with the group's arrival count;
  - Invested: —;
  - Gain: the amount;
  - Tax: —.
- **Episode row:**
  - Event: name and ticker;
  - Period: "start – end", or "start – 보유 중" (en "held");
  - Gain: `gainKrw`, coloured by sign;
  - Tax: `estimatedTaxKrw` (— when null);
  - After tax: `gainKrw − (estimatedTaxKrw ?? 0)`.
  - A row with `unpricedLots > 0` carries a note that its gain is understated.
- **Placement:** above the list, one line of method copy: threshold, episode floor, "unrealized gain at today's price".

- [ ] **Step 1: Write the failing test**

```ts
import { snapEventDates } from '../lib/asset-events'
test('event markers snap to the first plotted date on or after them, and past the end to the last point', () => {
  const inflow = (start: string) => ({ kind: 'inflow', start, end: start, label: 'x', category: null, amountKrw: 1, arrivals: 1 }) as const
  assert.deepEqual(
    snapEventDates([inflow('2024-06-01'), inflow('2024-06-30'), inflow('2026-12-01')], ['2024-05-31', '2024-06-30', '2024-07-31']).map((m) => [m.n, m.date]),
    [[1, '2024-06-30'], [2, '2024-06-30'], [3, '2024-07-31']]
  )
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx tsx --test tests/asset-events.test.ts`
Expected: FAIL, `snapEventDates` is not exported.

- [ ] **Step 3: Implement `snapEventDates`, the chart prop, the list component, the copy (en and ko), and the two page calls**

```ts
export function snapEventDates(events: AssetEvent[], pointDates: string[]) {
  const dates = [...pointDates].sort()
  return events.map((event, i) => ({ n: i + 1, date: dates.find((d) => d >= event.start) ?? dates.at(-1)!, event }))
}
```

- **Pages:** each page calls `getAssetEvents()` only where the total-assets chart renders: `assetView === 'all'` on Overview, and always on `/net-worth`. It passes `snapEventDates(events, totalAssets.points.map((p) => p.date))` to both the chart and the list.
- **Copy keys**, in both `en` and `ko`:
  - `events.title` (ko "자산 변화 주요 사건");
  - `events.method`;
  - `events.columns.{n, period, event, invested, gain, tax, afterTax}`;
  - `events.held` (ko "보유 중");
  - `events.unlabeled` (ko "출처 미지정 입금");
  - `events.unpriced`;
  - `events.categories.{asset_sale, inheritance, insurance, income, other}`.

- [ ] **Step 4: Verify**

1. Run `pnpm test`, `npx tsc --noEmit -p .` and `pnpm build`. Expected: all clean.
2. Seed a throwaway DB with the sample script and a few hand-made rows (see the `worktree-lint-and-env` memory). Start the dev server against it.
3. Open `/net-worth` and `/?view=all` in the preview. Check:
   - numbered markers on the chart;
   - the list in date order;
   - an observation-lot rebuy shown as two rows;
   - phone width (375px) without horizontal page scroll.

- [ ] **Step 5: Commit**

```bash
git add components/ lib/ app/ tests/
git commit -m "feat(net-worth): list large asset events under the trend and mark them on the chart"
```

---

### Task 6: Docs, real-data check, PR

**Files:**
- Modify: `docs/data-sources.md`, under "Accounts no statement covers": add "Money that arrived from outside" and the labels file.

- [ ] **Step 1:** Document `externalInflows`, the labels file (path, shape, categories, `hidden`, `from`/`to`), and the episode rules (floor, threshold, tax source).
- [ ] **Step 2: Real-data check, locally, with no production writes.**
  1. Run the extractor into the scratchpad, the same way as the earlier session (`STOCK_BANK_BALANCES_PATH=<scratch>/bb.json`, `loadLocalEnv` for the PDF password).
  2. Print `externalInflows` sorted by amount.
  3. With the maintainer, write `data/asset-event-labels.local.json` in the main checkout (gitignored). Name the arrivals already identified — the home sale, the inheritance, the surrendered insurance pension, the car sale — and hide the yearly bonus group.
  4. Show the maintainer the resulting event list before shipping.
- [ ] **Step 3:** Open the PR. The body describes the rules and names no counterparty or amount.
- [ ] **Step 4:** Deploy only after the maintainer confirms. The labels file reaches the ops host through `push-sources`; then `ssh ops-host 'cd ~/workspace/code/core/jackhpark-stock-observatory && make redeploy'`.
