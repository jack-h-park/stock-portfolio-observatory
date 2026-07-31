# Data sources

Where every figure in this dashboard comes from, and why it comes from there.

Written because the last version of this knowledge was not written down. The
Korea pipeline was populated once, by hand, on 2026-07-15; the extraction that
produced `.codex_sheet_payloads/*.tsv` left no script behind, and for fifteen
days the dashboard multiplied fortnight-old quantities by that morning's prices
while every check passed. Reconstructing what those files were took longer than
rebuilding the pipeline did.

## Current sources

| Dataset | Source | Refresh | Authority |
| --- | --- | --- | --- |
| Toss positions | Toss Open API `/api/v1/holdings` | every refresh (6h) | broker |
| 미래에셋 positions | summed from lots (below) | with the certificates | derived |
| 미래에셋 lots, transactions, dividends, realized | 거래내역증명서 PDFs → `pnpm extract:kr-statements` | manual, when new certificates arrive | broker |
| Toss lots, transactions, dividends | payload dump of 2026-07-15 | **stale — see gaps** | spreadsheet |
| US positions and lots | brokerage CSV/PDF exports | manual download → every refresh | broker |
| US realized gains | **nothing** | — | **see gaps** |
| KR/US prices, FX | Yahoo / Frankfurter | every refresh | market |

`STOCK_KR_STATEMENTS_DIR` rows replace payload rows **per account**, for whichever
accounts appear in the statements. Swapping the files wholesale would delete the
brokerages that have no parser yet — Toss is 36 of 47 Korean holdings.

## The Google Sheets

Three sheets predate the pipeline. All nine tabs across the first two were
surveyed column by column: every data column is machine-derived, and the
`Source` / `Page` / `Source File` columns are the proof — the sheets record
which PDF page each row came from. They describe themselves as copies.

| Sheet | Role now |
| --- | --- |
| 국내 주식 보유 현황 및 수익률 | **view + annotations.** Korean data no longer flows from it. |
| 미국 주식 보유 현황 및 수익률 | **view + annotations**, but still the input `reconcile-holdings.mjs` compares against the broker exports. Retiring it needs US realized gains in the database first. |
| 주식 매도 & 손익 | **still a source.** 67 hand-entered rows, 2022-08 → 2026-05, and the only structured record of US realized gains outside the 1099-B PDFs. |

What is genuinely not derivable from them is small and worth keeping:

- `Tax Lot Summary` → `Note`, 13 rows of human judgement about why two sides
  disagreed (`Resolved: 2025-09-22 Buy 1 share + 2026-07-02 SPL 3 shares = 4`).
  The ticker-mapping ones (`BRKB → BRK.B`) are configuration, not annotation,
  and belong in `data/manual-mappings.json`.
- 주식 매도 & 손익 → `비고`, which records dividends received while a position
  was held (`누적배당금: $217.4`). That is what makes its return figures total
  return rather than price return. The database holds 846 dividend rows and 215
  realized lots and never joins them, so it cannot yet say the same thing.

One hazard remains in the US sheet: its `미실현수익 정리` header carries
`USD/KRW Rate | 1423.92` as a literal. That is the same shape as the FX rate
this project left frozen at 1300 for 203 days while every won figure ran 13%
light, and nothing watches it.

## What the certificates and the API each get wrong

Findings that cost real investigation. None are guesses; each was checked
against the data.

**The Toss orders API is not a complete ledger.** Its holdings and its own order
history disagree for two symbols — <KR_TICKER_A> by 60 shares, <KR_TICKER_B> by 10 — and the
statements show purchases the orders endpoint has no record of. Collection was
verified complete first: `status=OPEN` returns 0, and the 3,474 CLOSED orders
break down as FILLED 3,440 / REJECTED 21 / CANCELED 13. Not one order in four
years carries a partial fill, which is itself implausible. An inquiry to Toss is
drafted. Until it is answered, treat the API as authoritative for *positions*
and never as the transaction ledger.

**Statement dates are settlement dates.** The API reports `orderedAt` and
`filledAt` (identical, `settlementDate` null); the certificates report T+2. Match
by symbol, quantity and unit price, never by date.

**The statement aggregates, the API enumerates.** One statement line at 89,900
covers four API orders of 10, 10, 15 and 100. A one-to-one row match produces
false discrepancies; reconcile on net quantity per symbol.

**Transfers carry their cost across, lot by lot.** Toss `타사대체입고` arrives as
one row per original lot with the acquisition price already on it — 포스코퓨처엠's
six inbound lots weight-average to 204,637.50, which equals both the 미래에셋
이체출고 unit price and the 잔고증명서's 매입단가 to the won. No cross-referencing
of the sending broker is needed. A transfer is **not** a disposal and must not
produce a realized gain.

**Certificates use a different column per currency.** A KRW trade fills 거래금액
and leaves 외화거래금액 empty; a USD trade does the reverse and names the currency
in 통화코드. Reading only the KRW column books every foreign trade at zero — 496
rows, including 247 dividends worth $1,180.96, were lost that way. Only trades
carry 환율; dividends do not, so their won figure is left **empty rather than
zero** for the ingest to convert from the historical FX table.

**Quantity × unit price is not the cost.** A Korean bond quotes 단가 per 10,000
of face value: a 700,000-face purchase at 7,116 cost ₩498,120, not ₩4.98 billion.
Prefer the booked 거래금액 wherever the certificate fills it in.

**A split needs no arithmetic.** The certificate has already restated per-lot
unit costs across the inbound rows (SCHD: 19 @ 82.31017 out, 57 in over four
lots still summing to 1,563.90). Redistributing it independently emptied the
position instead.

**Corporate actions move positions.** 출고 means it left — a matured bond is
redeemed by 채권만기상환출고. Skipping them left a US Treasury in the account a
year past maturity, which no statement contradicts; only a balance certificate
would.

**A lot held exactly 365 days is short-term.** "More than a year" is the rule and
three ISA lots sit precisely on the boundary.

## Known gaps

| Gap | Surfaced by | Status |
| --- | --- | --- |
| Toss lots still from the 2026-07-15 dump | `toss_holdings_lots_provenance` | statement parser in progress |
| US realized gains absent | `us_ytd_realized_assumption_reviewed` | E (replay) + D (1099-B) in progress |
| Two Toss fills missing from its API | — | inquiry drafted |
| US sheet still an input to reconcile | — | blocked on US realized |
| `Note` mapping rules not migrated | — | open |

Each gap that the system can see is a named check rather than a silence. That is
deliberate: the failures this project keeps rediscovering are not crashes but
plausible wrong numbers, and the only defence is a source that has to answer for
itself and a check that says when it did not.
