# Robinhood Orders Bridge Design

Status: proposed, not implemented.

Robinhood trades come from the transaction CSVs, which someone downloads by
hand. Robinhood positions come from the MCP snapshot, which is current to the
hour it was taken. So every trade made after the newest CSV is in the positions
and nowhere in the transactions. This design fills that window from the MCP's
order history until the next CSV covers it. The Toss bridge already does the same
for Toss.

## The gap, as it shows up

The 2026-10-09 ingest on the ops host:

- `robinhood_replay_missing_disposal` failed (error). Five positions read zero in
  the snapshot and were still open in the replay. All five were sold that morning.
  The newest CSVs end on 2026-08-11 (Mid-term) and 2026-08-07 (Long-term).
- `robinhood_holdings_replay_provenance` failed (warning) on 25 positions. They
  are purchases and dividend reinvestments made in the same window.
- The realized gain on those sales was missing from `realized_lots`, so it was
  also missing from the year-to-date figure and from every tax plan built on it.
  The tax planner exists to reason about exactly these sales, and it was planning
  as if they had not happened.

The broker order history answered the question immediately. Each of the five
sales was one `get_equity_orders` call away, with its fill quantity, price and
fees. The CSVs can only answer after the next manual download.

## Why the August decision does not settle this

`docs/data-sources.md` ("Robinhood's trades stay on the CSVs") records the August
2026 decision not to ingest orders. That decision asked a different question:
**does the MCP add history the CSVs lack?** It does not. Its executions match the
CSV trade rows one for one, back to each account's first trade. It also cannot
supply dividends, lending income, interest, transfers or corporate actions, which
make up about 40% of the file. That conclusion still holds, and this design keeps
it: the CSV remains the authority for every row it covers.

The question here is **freshness**. The window after the newest CSV is covered
by nothing. Filling it from orders does not create a second source for any trade,
because once a CSV covers a day, orders no longer supply that day.

## Precedent: the Toss bridge

`scripts/ingest-stock-data.mjs`, at "Toss orders, but ONLY after the newest
statement", already does this for Toss, and its reasoning carries over unchanged:

- The cutoff is the newest statement's last transaction date. Orders supply only
  what comes after it.
- It heals itself. A newer statement moves the cutoff forward, the bridged rows
  drop out, and the statement's version replaces them. Nothing is counted twice.
- It fills gaps on a best-effort basis and is never the authority. Whatever it
  cannot see stays visible, because holdings come from a source that does see it.

The Robinhood version is simpler in one respect. Toss's lots are built from the
statements, so its bridge has to update `taxLotRows` and walk FIFO itself.
Robinhood's open lots already come from the snapshot, and its realized lots come
from the US FIFO replay over `transactionRows`. Appending the bridged trades to
`transactionRows`, ahead of the replay, is the whole integration.

## Design

### 1. Capture: orders go into the snapshot

The session that regenerates `data/robinhood-snapshot.json` also records each
account's order history, in the same pass and under the same `fetchedAt`:

```json
{
  "fetchedAt": "...",
  "accounts": [
    {
      "accountNumber": "...",
      "nickname": "Mid-term",
      "positions": [],
      "lots": [],
      "orders": { "createdAtGte": "2026-08-01", "complete": true, "items": [] }
    }
  ]
}
```

- Call `get_equity_orders(account_number, created_at_gte)` **with no `symbol`
  filter**, and follow `next` until it is empty. The `symbol` filter first looks
  up the ticker's instrument, and a 2025 Mid-term sale that is in the CSV did not
  come back through it. Its cause is not known yet; see Verification. A filter
  that can drop a fill with no error has no place in a pull whose job is
  completeness. Key executions by `instrument_id` as well as symbol.
- Use **no `state` filter**. A partially filled order that was then cancelled
  still moved shares. The bridge reads `executions[]`, not the order's state.
- `createdAtGte` is the earliest cutoff across the accounts minus 7 days. An order
  can be created days before it fills, and a GTC limit can wait much longer. The
  bridge filters on execution date, so fetching too much costs nothing, while
  fetching too little loses a fill silently.
- `complete: true` is written only once pagination finished. A pull cut short
  must say so. The lots pull already showed what an unpaged response looks like:
  a symbol with exactly fifty lots.
- Store the raw response. The modelling happens in the ingest, as it does for
  lots, so changing the shape never costs another round of calls.

No cron can write this file, so the bridge is only as current as the last
snapshot session. That limit already applies to positions and is reported by
`robinhood_snapshot_fresh`. The orders add no new staleness, and they move
together with the positions they explain.

### 2. Cutoff: one per account, from the CSVs alone

For each Robinhood account, the cutoff is the latest `date` among that account's
rows whose `source_system` is a CSV file. Both as-of and range files count. This
mirrors Toss, which takes the statement's last transaction date rather than the
download date.

- Executions **after** the cutoff day are bridged.
- Executions **on** the cutoff day are bridged only if the CSV does not already
  hold them. A download ends at an instant, not at a closing bell, so the cutoff
  day can be partial. Matching uses the seam code's multiset signature: date,
  ticker, type, quantity, amount. Two identical genuine fills survive as two.
- An account with no CSV at all is not bridged. Without a cutoff, orders would
  become the authority for the account's whole history, which the August
  measurement ruled out.

### 3. Mapping: one transaction row per execution

The CSV writes **one row per execution, not per order**. A 2025 Mid-term sale of
5.017224 shares, filled as 5 and 0.017224, appears as two CSV rows. Its amounts
match `quantity × execution price` to the cent: $503.02 and $1.73. The bridge
produces the same rows, so a later CSV replaces them one for one.

| Row field | From |
|---|---|
| `date` | execution `timestamp`, converted to **America/New_York**, date only |
| `type` | `side`, mapped to `BUY` / `SELL` |
| `ticker` | `symbol` through `normalizeTicker` and the manual-mapping renames |
| `quantity` | execution `quantity` |
| `native_unit_price` | execution `price` |
| `native_amount` | `−(qty × price + fees)` for a buy, `qty × price − fees` for a sell, rounded to cents |
| `fee` | execution `fees` |
| `placed_agent` | order `placed_agent`: `user`, `drip`, `recurring` or `agentic`, the values the CSV's description suffix was already matched against |
| `source_system` | `robinhood_mcp_orders` |
| `source` | `robinhood-snapshot.json` |
| `account`, `account_type` | the snapshot account's nickname, mapped as the CSV specs map it |

**Dates must be converted to Eastern time.** Timestamps are UTC, and the CSV's
`Activity Date` is the US trading date. An extended-hours fill at 20:30 ET is
00:30 UTC on the next day. Taking the UTC date would put it a day late, past the
cutoff check, and possibly into the wrong tax year on December 31.

### 4. What the bridge cannot see

Anything in the window that is not a trade:

- cash dividends, interest and stock lending income (`CDIV`, `INT`, `SLIP`). The
  reinvestment **purchase** a dividend funds is an order (`placed_agent: drip`)
  and is bridged. The cash payment is not, so dividend totals for the window
  stay low until the next CSV.
- transfers between accounts or brokers (`ITRF`, ACAT), splits and other
  corporate actions (`SPL`, `SPR`, `SXCH`), granted shares (`REC`), and
  account-level fees.

A transfer or split in the window changes a position with no order behind it.
The replay then disagrees with the snapshot, and
`robinhood_holdings_replay_provenance` or `robinhood_replay_missing_disposal`
names the position. The remedy is unchanged: download the CSV. The bridge
narrows what those checks report to what orders genuinely cannot explain.

Options and crypto are out of scope. Crypto has its own statement source.

### 5. Seams: bridged rows are not an export

The seam resolution groups US rows by account and source and treats the source
whose window ends later as the authority for shared days. A bridged row's source
would end after every CSV, so if it were let in, the bridge would **win** those
shared days and the CSV rows would be dropped. That inverts the design. The seam
pass must skip `source_system === 'robinhood_mcp_orders'`. The cutoff in step 2
is how the two sources meet.

### 6. Checks

- **New: `robinhood_orders_bridge_csv`** (warning), shaped like
  `toss_orders_bridge_statement`. It reports per account the cutoff, the number
  of executions bridged after it, and `complete: false` when a pull was cut
  short. It also reports separately when the snapshot holds no orders at all, so
  that "nothing traded after the cutoff" and "orders were never fetched" do not
  read the same. A sale that runs out of replay lots is named here.
- **Unchanged.** `robinhood_replay_missing_disposal` and
  `robinhood_holdings_replay_provenance` keep their meaning. Once the bridge works,
  what they report is limited to what is not an order: a transfer or a corporate
  action.
- `us_ytd_realized_assumption_reviewed` already prints the replay's per-market
  split. Its detail adds how much of the US figure is bridged, because that part
  is provisional until a CSV replaces it.

## Verification before relying on it

Run these once and record the results here:

1. **Fee netting.** The 2025 sale checked above had zero fees, so it cannot
   confirm the sell-side fee formula. Several of the 2026-10-09 sales carry
   non-zero `fees`. When the CSV covering them arrives, check that each CSV
   `Amount` equals `qty × price − fees` per execution.
2. **Eastern-date mapping.** Find an extended-hours fill in the history and
   confirm its CSV `Activity Date` is the Eastern date of its timestamp.
3. **The missing 2025 sale.** Page the unfiltered Mid-term history across
   2025-10-22 and look for the sale the `symbol` query missed. If it is there,
   the filter was the cause. If it is not, the August claim that orders match the
   CSV one for one needs to be revisited before the bridge is trusted.
4. **Supersession on a real download.** Ingest once before and once after the
   next CSV. Bridged executions on days the CSV covers must drop to zero, and
   `realized_lots` must not change except by fee rounding.

## Tests

End-to-end tests through `tests/ingest-harness.ts`, with a snapshot fixture that
carries `orders`:

- A sale after the cutoff closes the replay position, books a `realized_lots`
  row, and `robinhood_replay_missing_disposal` passes.
- An execution on the cutoff day that the CSV already holds is not counted twice,
  and one the CSV lacks is bridged.
- A newer CSV covering the window removes every bridged row.
- The seam pass ignores bridged rows, so a CSV row is never dropped in their
  favour.
- A fill at 00:30 UTC is dated the previous Eastern day.
- An account with no CSV bridges nothing, and the check says why.
- A snapshot with no `orders` key behaves exactly as today.

## Rejected alternatives

- **Replace the CSVs with orders.** This loses dividends, transfers and corporate
  actions, which is why the August decision stands.
- **Bridge into lots directly, as Toss does.** This is unnecessary, because
  Robinhood's open lots already come from the snapshot and its realized lots
  from the replay. Writing lots here would create a second lot ledger to keep in
  step with the first.
- **Remind the user to download sooner.** The weekly coverage reminder already
  does this. The gap here is the days between a trade and the next download,
  which no reminder cadence closes.

## Related

- `docs/data-sources.md`: the Robinhood transactions row and the August
  decision. Once this is implemented, both should point here.
- `docs/data-sources.md`'s open-issues table still describes Toss orders as
  "fetched every 6h and never read". That row predates the Toss bridge in the
  ingest and should be updated on its own.
