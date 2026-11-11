# Personal Finance Observatory

A local personal finance application that connects assets, cash flow, KR/US investment tax estimates, filing history, payments, refunds, and their evidence.

Application code, schemas, and synthetic examples are public. Actual institution records, tax documents, account mappings, policies, and review history remain private. The application supports local planning/review writes while preserving original evidence; it does not place trades, file returns, or make payments.

## Run the synthetic sample

```bash
pnpm install --frozen-lockfile
pnpm seed:sample
pnpm dev
```

Open <http://localhost:3101>. A fresh checkout defaults to sample mode. The seed owns only `private-data/personal-finance-sample/`, with separate records, tax, state, and runtime subdirectories. The sample demonstrates investments, deposits, FX balances, and tax-history records without private credentials.

The seed refuses `.env.local`, configured private paths, unowned nonempty sample roots, and symlinked output paths. Force flags cannot bypass this protection. Use a separate working directory for sample experiments. The previous arbitrary `SAMPLE_STOCK_DB_PATH` override is retired.

## Product scope and screens

| Area | Key screens | Scope |
| --- | --- | --- |
| Financial position | `/`, `/net-worth`, `/accounts`, `/pension` | Supported assets by owner/account, dated values and coverage; liabilities are not implemented |
| Investments and cash flow | `/holdings`, `/transactions`, `/income`, `/cash-inflow`, `/fx`, `/crypto-premium` | Institution-specific records and reconciliation |
| Tax records | `/taxes`, `/taxes/history`, `/taxes/records/[id]` | Reviewed returns/assessments, allocated payments/refunds, revisions, evidence |
| Tax scenarios | `/tax-planning`, `/tax-settings`, `/lots`, `/realized` | Bounded investment-incremental estimates; not a complete annual tax return calculator |
| Review and data | `/rebalance`, `/review`, `/health`, `/reconciliation`, `/data-map`, `/data-ops` | Reviewable proposals, source coverage, freshness and breaks |

All assets is the default entry view; an explicit existing Stocks preference remains effective. Current asset totals use self-owned records, deduplicate account/asset observations, include supported cash/FX balances, and separate pension wrappers from underlying exposure. Missing prices and conflicting observations are excluded from a covered subtotal and reported. Historical series retain their existing source coverage, which can differ from current balances. Total assets are not complete net worth.

Tax-year history and payment-date history answer different questions. An estimate never replaces a filed record or payment. Same-scope comparison requires matching tax unit, year, authority, currency, and annual-total calculation coverage. Unknowns remain unresolved rather than becoming zero.

See the [product definition](docs/product/personal-finance-observatory.md), [support matrix](docs/product/support-matrix.md), [design](docs/superpowers/specs/2026-11-10-personal-finance-observatory-design.md), and [implementation plan](docs/superpowers/plans/2026-11-10-personal-finance-observatory.md).

## Configure private operation

```bash
cp .env.example .env.local
# Configure source/DB paths and the supported interpreter for your installation.
pnpm dev
```

Existing `STOCK_*` file overrides remain supported. New installations can configure `FINANCE_MODE=private`, `FINANCE_RECORDS_DIR`, optional `FINANCE_TAX_DIR`, `FINANCE_STATE_DIR`, and `FINANCE_RUNTIME_DIR`. Corresponding new/legacy aliases must agree; an explicit file override wins over a root-derived default. Declaring a new root does not move existing files.

Tax history lives in durable `tax-history.json` under the state root, independently of the generated portfolio SQLite database. `FINANCE_STATE_WRITABLE` defaults to `0` privately. Enable it only on the single writing host after backup/restore verification. Other hosts are read-only; source sync must not carry writable state. Keep existing source archives in place and use their configured root aliases.

Follow the [storage contract](docs/architecture/private-storage.md), [tax-history import/review guide](docs/operations/tax-history.md), [backup/restore guide](docs/operations/finance-state-backup-and-restore.md), and [cutover checklist](docs/operations/personal-finance-cutover.md). Do not run sample seeding in a private installation. Refresh, sheet publishing, and operational jobs have their own external effects; use the documented operating procedures on the owning host.

## Develop and verify

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm ui:guardrails
pnpm build
```

Run these in an isolated sample checkout. The existing CI uses Node 22 and Python `pdfplumber`; a different Node ABI requires a matching `better-sqlite3` build. Browser, mobile, and accessibility checks are available through the `ui:*` commands against a synthetic-data server.

Branding does not rename GitHub, move local checkouts, rename databases/jobs, or change CLI/briefing schema versions. Those changes follow the [compatibility inventory](docs/architecture/compatibility-inventory.md) and separately verified operational cutovers.

## What it does

See the [operating reference](docs/operations/legacy-stock-operations.md#what-it-does) for this legacy interface.

## Sample mode

See the [operating reference](docs/operations/legacy-stock-operations.md#sample-mode) for this legacy interface.

## Main screens

See the [operating reference](docs/operations/legacy-stock-operations.md#main-screens) for this legacy interface.

## Supplementary assets

See the [operating reference](docs/operations/legacy-stock-operations.md#supplementary-assets) for this legacy interface.

## Screenshots

See the [operating reference](docs/operations/legacy-stock-operations.md#screenshots) for this legacy interface.

## Private operating mode

See the [operating reference](docs/operations/legacy-stock-operations.md#private-operating-mode) for this legacy interface.

## Brokerage coverage

See the [operating reference](docs/operations/legacy-stock-operations.md#brokerage-coverage) for this legacy interface.

## Crypto

See the [operating reference](docs/operations/legacy-stock-operations.md#crypto) for this legacy interface.

## Published summary

See the [operating reference](docs/operations/legacy-stock-operations.md#published-summary) for this legacy interface.

## The holdings sheets

See the [operating reference](docs/operations/legacy-stock-operations.md#the-holdings-sheets) for this legacy interface.

## macOS launchd deployment

See the [operating reference](docs/operations/legacy-stock-operations.md#macos-launchd-deployment) for this legacy interface.

## Data posture

See the [operating reference](docs/operations/legacy-stock-operations.md#data-posture) for this legacy interface.

## Operating routine

See the [operating reference](docs/operations/legacy-stock-operations.md#operating-routine) for this legacy interface.

## Daily briefing archive

See the [operating reference](docs/operations/legacy-stock-operations.md#daily-briefing-archive) for this legacy interface.

## Freshness policy

See the [operating reference](docs/operations/legacy-stock-operations.md#freshness-policy) for this legacy interface.

## Manual mapping policy

See the [operating reference](docs/operations/legacy-stock-operations.md#manual-mapping-policy) for this legacy interface.

## Current coverage

See the [operating reference](docs/operations/legacy-stock-operations.md#current-coverage) for this legacy interface.

## FX policy

See the [operating reference](docs/operations/legacy-stock-operations.md#fx-policy) for this legacy interface.

## Tax planning

See the [operating reference](docs/operations/legacy-stock-operations.md#tax-planning) for this legacy interface.

## Rebalancing

See the [operating reference](docs/operations/legacy-stock-operations.md#rebalancing) for this legacy interface.

## KR price policy

See the [operating reference](docs/operations/legacy-stock-operations.md#kr-price-policy) for this legacy interface.

## US price policy

See the [operating reference](docs/operations/legacy-stock-operations.md#us-price-policy) for this legacy interface.

## US PDF evidence policy

See the [operating reference](docs/operations/legacy-stock-operations.md#us-pdf-evidence-policy) for this legacy interface.

## Public repository hygiene

See the [operating reference](docs/operations/legacy-stock-operations.md#public-repository-hygiene) for this legacy interface.

## CI

See the [operating reference](docs/operations/legacy-stock-operations.md#ci) for this legacy interface.

## License

See the [operating reference](docs/operations/legacy-stock-operations.md#license) for this legacy interface.
