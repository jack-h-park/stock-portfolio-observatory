# Net worth and pension accounts — design

Status: proposed, 2026-10-09. Owner: the Observatory maintainer.

## Goal

The Observatory reports the brokerage side of the portfolio: KR, US and crypto
holdings, their lots, income and tax. Everything else is invisible. That covers
bank deposits, a CMA, a physical-gold account, and the Korean pension accounts
(a retirement IRP and a pension-savings account). The new `/accounts` page (#180)
says so in a note, because the absence was otherwise silent.

This design brings those accounts in with two aims:

- **A. The whole picture.** Total assets across stocks, pensions, deposits, gold
  and crypto; allocation by asset class; a balance per account and how it moved.
- **C. The pension view.** Pension holdings and return, contributions by year
  against the Korean tax-credit limit, and how the accounts are treated for US
  tax.

The default experience does not change. The app stays stock-centric. The new
data appears only when the viewer switches to "all assets", or on the two new
pages.

## Non-goals

- Spending categorisation or budgeting. Bank transactions are read for balances,
  not for where the money went.
- Daily NAV for mutual funds. Pension funds are valued from a dated snapshot (see
  Valuation).
- Accounts owned by other family members. Every account carries an `owner`
  field, so a later "family accounts" view can be added without a migration. Only
  the maintainer's own accounts are collected now.
- Deciding the US tax treatment of Korean pension and ISA accounts. The app
  records an explicit "undecided" policy and shows what is affected (see Tax).

## Decisions taken

| Question | Decision |
| --- | --- |
| Purpose | A (whole picture) and C (pension view) |
| Scope | The maintainer's own accounts; an `owner` field is kept for later |
| Structure | Pension holdings stay in the securities tables with an `account_wrapper`; deposits and CMA balances get their own table; physical gold is a holding priced per gram |
| Pension valuation | Dated holdings snapshot; listed ETFs re-priced daily |
| US tax treatment of IRP, pension savings and ISA | `undecided` by default; affected amounts shown as "needs review" |
| FBAR / Form 8938 | A per-account maximum-balance table by year |
| Coverage cadence | Pension snapshots 180 days; deposit, CMA and gold statements 90 days; brokerage unchanged |

## Data model

### `account_wrapper` and `owner`

New columns on `holdings`, `tax_lots`, `transactions`, `dividends` and
`realized_lots`:

- `account_wrapper`: `taxable` | `isa` | `irp` | `pension_savings`. The ingest
  derives it from the account. ISA rows, which are in the app today, become
  `isa`; everything that exists today is `taxable` or `isa`.
- `owner`: `self` for now.

Every existing query keeps its current result by filtering
`account_wrapper in ('taxable', 'isa')`. That filter lives in one adapter helper,
so the default view cannot drift (see "Default-view regression" below).

### `asset_class`

New column on `holdings`: `security` (the default for every existing row) |
`gold`. A gold holding stores grams in `quantity`, its cost in won, and is
priced per gram.

### `cash_balances` (new)

One row per account per day that a balance is known.

| column | meaning |
| --- | --- |
| `institution`, `account`, `owner` | identity; `account` is an alias, never a full account number |
| `kind` | `checking` \| `savings` \| `cma` \| `deposit` |
| `currency` | `KRW` \| `USD` |
| `as_of_date` | date |
| `balance` | balance at the end of that day |
| `source`, `derived` | the file it came from; whether it was read off the statement or reconstructed (see below) |

The existing `fx_account_balances` (the Hana USD account) folds into this table.

### `pension_flows` (new)

Contributions, withdrawals and transfers per pension account, from the
transaction certificates.

| column | meaning |
| --- | --- |
| `account`, `account_wrapper`, `owner` | identity |
| `date`, `kind` | `contribution` \| `employer_contribution` \| `withdrawal` \| `transfer_in` \| `transfer_out` |
| `amount_krw`, `source` | |

## Sources and filing

Each new file type gets a detector in `scripts/file-downloads.py` that
identifies it by its contents, and a destination directory. Account numbers and
institution aliases live in a gitignored local mapping (`data/accounts.local.json`),
never in the repository.

| Source | Detector signal | Destination | Feeds |
| --- | --- | --- | --- |
| Pension holdings snapshot (CSV in a documented column format, one per account per capture date) | header row | `pension/` | `holdings` |
| 미래에셋 IRP 거래내역증명서 | 계좌유형 퇴직연금_개인IRP | `kr-statements/` | `pension_flows`, `transactions` |
| Pension-savings transaction certificate (삼성증권) | issuer and 계좌유형 | `kr-statements/` | `pension_flows` |
| Year-end 잔고현황 / 잔고증명서 for pension accounts | issuer and title | `pension/evidence/` | validation only |
| 미래에셋 금현물 거래내역증명서 | 계좌유형 금현물 | `kr-statements/` | gold `holdings` |
| Chase checking activity CSV | header `Details,Posting Date,…,Balance` | `bank-statements/` | `cash_balances` |
| Bank of America statement CSV | summary block, then `Date,Description,Amount,Running Bal.` | `bank-statements/` | `cash_balances` |
| Robinhood checking and savings CSV | header `Date,Description,Amount`; no balance column | `bank-statements/` | `cash_balances` (derived) |
| 새마을금고 거래내역조회 (.xls) | title and 통장(상품)명 cells | `bank-statements/` | `cash_balances` |
| 토스뱅크 거래내역 (.xlsx, password-protected) | decrypted with a password from `.env.local` | `bank-statements/` | `cash_balances` |

The 미래에셋 IRP and gold certificates share the layout the 종합 and ISA
certificates already use, so they reuse `extract-kr-statements.py` with new
account types rather than a new parser.

## Valuation

- **Pension ETFs.** Quantity comes from the latest snapshot, adjusted by trades
  in later certificates. The price comes from `fetch:kr-prices` once the
  snapshot row carries a ticker.
- **Pension funds and cash-equivalents.** The `value_krw` from the latest
  snapshot, as of its capture date. The value does not move until the next
  snapshot. It is shown with its date (see UI).
- **Gold.** Grams held times the KRX gold spot price per gram, fetched by a new
  step beside the other price fetches. With no price, the holding is shown at cost
  and marked unpriced, the same as an unpriced security today.
- **Deposits and CMA.** The last balance on file.
  - **Statements with a balance column** (Chase, BoA, 새마을금고, 토스뱅크): every
    row's balance is stored.
  - **Statements without one** (Robinhood checking and savings): one anchor
    balance, entered in the local mapping with its date, is walked backwards
    through the transactions. These rows are `derived`.

## UI

### The view switch

A global "Stocks / All assets" switch, remembered in a cookie. It lives in the
sidebar (see Amendments).

- **Stocks (default).** Byte-for-byte today's figures: taxable and ISA securities
  only. Pensions, deposits and gold are in no total.
- **All assets.**
  - The overview gains total-assets figures and a stacked total-assets trend
    (see Amendments). The headline stays the stock total.
  - Holdings is unchanged; pension positions are listed on `/pension` only.

### `/net-worth` (new, under Core Workflows)

- Total assets and the allocation by asset class.
- Account balance table: institution, account, kind, as-of date, balance, KRW
  value.
- Month-end total-assets history.
- The FBAR / Form 8938 table (below).

### `/pension` (new, under Tax)

- Per account: value, cost (contributions), return, snapshot date.
- Holdings, with the ETF/fund split.
- Contributions by year against the Korean tax-credit limit. The limit comes from
  `tax-policy.json`, not from the code.
- A "needs review for US tax" block (see Tax).

### `/accounts`

Lists the new accounts with their date ranges. The note saying pensions and
deposits are not collected is removed.

### Dates are always visible

Any value that comes from a snapshot rather than a daily price shows its as-of
date next to the amount. A fund valued in June must not read as today's value
beside a stock priced this morning.

## Tax

Tax treatment is per jurisdiction and per wrapper, in `tax-policy.json`:

```json
"wrapperTreatment": {
  "KR": { "isa": "exempt_within_limit", "irp": "deferred", "pension_savings": "deferred" },
  "US": { "isa": "undecided", "irp": "undecided", "pension_savings": "undecided" }
}
```

- **`undecided`** keeps those accounts out of the jurisdiction's tax estimate. The
  tax pages show a "needs review" block per account instead: realised gains,
  dividends, and the number of positions that are likely PFICs (Korean funds and
  ETFs). Once the treatment is settled with a preparer, changing one value moves
  them into the estimate.
- **`taxable`** treats the account like any other brokerage account for that
  jurisdiction.
- **`deferred` / `exempt_within_limit`** exclude the account, with the reason
  shown.

This document makes no claim about which treatment is correct. The default is
`undecided` because the app must not assume one.

### FBAR / Form 8938 maximum balances

For a chosen calendar year, the table lists every non-US financial account
(Korean brokerage, pension, deposit, gold) with:

- its maximum balance in KRW,
- the date of that maximum,
- the USD value at the Treasury year-end reporting rate.

The maximum is computed from `cash_balances` and from daily securities values
where history exists. An account whose history has gaps in the year is marked
"maximum may be understated". The rate table is data in the repository with its
source cited, not fetched at run time.

## Coverage and reminders

`getAccountCoverage()` gains rows for the new accounts. The weekly reminder lists
them with the same "download from" logic.

| Kind | Max lag |
| --- | --- |
| Pension holdings snapshot | 180 days |
| Deposit, CMA and gold statements | 90 days |
| Brokerage | unchanged |

## Validation checks (new)

- `pension_snapshot_matches_year_end`: the snapshot value, rolled to 31 December
  through later flows, agrees with that year's 잔고증명서 total within 0.5% or
  ₩10,000, whichever is larger. Funds are priced at the certificate date, not the
  snapshot date, so an exact match is not expected.
- `cash_balance_continuity`: on statements with a balance column, the previous
  balance plus each amount equals the next balance. A gap means a missing
  transaction.
- `cash_anchor_present`: every account without a balance column has an anchor
  balance.
- `wrapper_assigned`: no row has a null `account_wrapper`.
- `us_wrapper_treatment_decided`: a warning while any wrapper is `undecided` for
  US, listing them. It does not fail the refresh.

## Default-view regression

The promise that the default view does not change is enforced by a test, not by
care. A fixture ingest is run before and after each phase. The overview total,
holdings count and every tax-page total in the Stocks view must match exactly.

## Phases

Each phase ships as its own PR and leaves the app usable.

1. **Foundation and deposits.** `account_wrapper`, `owner`, `asset_class`; the
   wrapper filter helper; `cash_balances`; the bank detectors; the view switch;
   `/net-worth` without the FBAR table.
2. **Pensions.** The snapshot format and detector; the IRP and pension-savings
   certificates; `pension_flows`; `/pension`; `wrapperTreatment` with US
   `undecided`; the needs-review block.
3. **Gold and the reporting table.** The gold certificate; the gold price step;
   the FBAR / Form 8938 table.
4. **Coverage.** New coverage rows and cadences; reminder lines.

## Testing

- **Fixtures.** Every new file type gets a fixture that reproduces its real
  structure, with invented numbers and names. The repository is public, so no
  real account number, balance or name appears.
- **Ingest tests.** These follow `tests/ingest-harness.ts`: every path is named
  and the inherited environment is stripped.
- **Unit tests.** Wrapper filtering, derived balances (anchor walk-back), the
  maximum-balance computation, and the `undecided` policy keeping amounts out of
  estimates.
- **Regression test.** The default-view test above.

## Privacy

- Account numbers, institution aliases and anchor balances live in gitignored
  local files.
- New output files sit beside the database, outside the repository.
- Nothing supplementary reaches the briefing summary except freshness metadata
  for the weekly reminder (dates, labels, status; never amounts). The briefing
  and the trading review keep reading the stock figures they read today.

## Open items

- **토스뱅크 exports are password-protected.** Phase 1 needs the password in
  `.env.local`, or an unprotected export.
- **Robinhood checking and savings need an anchor balance** (current balance and
  date) for the derived history.
- **Pension-savings holdings have no snapshot source yet.** There are only
  balance certificates and a transaction certificate. A holdings capture like the
  IRP one is needed for its positions.
- **Which account is the CMA** has to be confirmed before its detector is written.
- **The KRX gold price source** has to be chosen in phase 3. It should be a public
  daily close, cached like the other price snapshots.

## Amendments (2026-10-10)

### Principle

Deposits, pensions and gold are supplementary data. They exist to show total
assets and nothing else.

- **R1.** Stock surfaces are unaffected by supplementary data.
- **R2.** Supplementary data appears only in total-assets contexts, and total
  assets has one definition (`totalAssetsSeries` in `lib/net-worth.ts`).
- **R3.** It always shows its as-of date.
- **R4.** Upkeep stays low: long cadences, no analytics.
- **R5.** Nothing supplementary leaves the app. Sheets, the briefing and the
  trading review stay stock-only. The summary may carry freshness metadata for
  the reminder, never amounts.

### Decisions

- **No `netWorth` block in the briefing summary.** The Privacy promise of one
  additive block is withdrawn. The summary gains a `supplementaryCoverage` block
  (freshness only) for the weekly reminder.
- **The Overview headline stays the stock total** in both views. The promise of
  a total-assets headline with an allocation bar is withdrawn.
- **No pension positions in Holdings.** That promise is withdrawn; positions are
  on `/pension`.
- **Pensions and gold are in the total-assets trend.** A separate stacked chart
  on the Overview (All-assets view) and on `/net-worth` shows stocks, crypto,
  cash, pensions and gold. The existing stock trend chart is stock-only in both
  views. Before a class's data starts it contributes nothing on that date, and
  the chart notes where each class starts. Pensions step on certificate and
  snapshot dates.
- **The FBAR / Form 8938 table is built**, on `/net-worth`, from data already in
  the database plus a tracked Treasury reporting-rate file
  (`data/treasury-reporting-rates.json`). Accounts whose year has gaps are flagged
  as possibly understated; US institutions are excluded.
- **Supplementary warnings go to the weekly reminder only.** Validation checks
  carry a scope (`stock` or `supplementary`). The badge, the printed
  `Validation:` line and the daily refresh alert read the `stock` scope; the
  supplementary checks print on a separate `Supplementary:` line and surface in
  the reminder's supplementary section.
- **The switch lives in the sidebar**, not the header. An "All assets" section
  holds `/net-worth` and `/pension`, and is hidden when the database has no
  supplementary data.
