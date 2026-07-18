# Stock Observatory

Read-only portfolio monitoring dashboard for manually curated stock-management data.

This repository is intended to contain application code only. Real brokerage exports,
tax documents, generated databases, price snapshots, and mapping overrides should stay
outside git or in ignored local files.

## Start

```bash
pnpm install
cp .env.example .env.local

# Configure STOCK_DATA_DIR and STOCK_DB_PATH in .env.local.
# Then create local generated-data files from public examples:
cp data/fx-rates.example.json data/fx-rates.json
cp data/manual-mappings.example.json data/manual-mappings.json
cp data/us-pdf-evidence.example.json data/us-pdf-evidence.json
cp data/kr-prices.example.json data/kr-prices.json
cp data/us-prices.example.json data/us-prices.json

pnpm fetch:kr-prices
pnpm extract:us-pdf-evidence
pnpm fetch:us-prices
pnpm ingest
pnpm dev
```

Local URL: <http://localhost:3101>

## Data posture

The web app treats `.codex_sheet_payloads/*.tsv` as the current Korea source snapshot and imports supported US brokerage CSV exports into the same normalized SQLite database under `outputs/stock-observatory/`. The dashboard never writes back to the source files.

Real source files and generated artifacts are private by default:

- Source exports and PDFs live under `STOCK_DATA_DIR`.
- The generated SQLite database lives at `STOCK_DB_PATH`.
- `data/*.json` runtime snapshots are ignored by git.
- `data/*.example.json` files are synthetic public bootstrapping examples only.

The `/health` page acts as the operating control center: it shows row counts, source file fingerprints, validation checks, price/FX freshness, and source drift risk based on the ingest fingerprint.

## Operating routine

Refresh external valuation inputs before ingesting:

```bash
pnpm fetch:kr-prices
pnpm fetch:us-prices
pnpm extract:us-pdf-evidence
pnpm ingest
```

Then open `/health` and confirm that validation checks pass, price/FX snapshots are fresh, and source drift is clear.
Open `/data-ops` when `/health` or `/income` surfaces tickerless rows, missing valuation, stale inputs, or source drift.
Open `/review` after `/health` for the portfolio decision pass: concentration, top gains/losses, short-term exposure, and missing valuation rows.
Open `/rebalance` for the allocation pass: market target gaps, single-position cap checks, reduce candidates, and tax-sensitive watchlists.
Open `/income` for the cashflow pass: trailing income, YTD income, yield on market/cost, monthly trend, top income positions, and tickerless income rows.

## Freshness policy

- KR and US price snapshots are considered fresh for 36 hours from their `generatedAt` timestamp.
- FX is considered fresh for 7 days from the configured `asOfDate`.
- Source files are considered drifted when their current disk size or modified time differs from the fingerprint captured at ingest.
- Position detail pages show the relevant price snapshot and FX freshness next to the valuation numbers.

## Manual mapping policy

`data/manual-mappings.json` is the read-only override layer for operational cleanup. The ingest applies mapping rules to normalized rows and records `income_category`, `mapping_status`, and `mapping_note` in the generated database. Source spreadsheets, CSVs, and PDFs are never modified.

- `incomeRules` classify non-position cashflow such as interest, stock lending, and other income.
- `dividendOverrides` can assign ticker/name/category for source rows that need explicit correction.
- `/data-ops` shows the mapping file fingerprint, tickerless income groups, missing valuation rows, and suggested handling.

## Current coverage

- Korea: holdings, tax lots, transactions, dividends, realized lots from `.codex_sheet_payloads`.
- US: Chase holdings/tax lots, Merrill holding summary/tax-lot detail, Robinhood Gain/Loss PDF holdings/tax lots, and Chase/Fidelity/Merrill/Robinhood transactions/dividends.
- Currency: native KRW/USD amounts are preserved separately. USD is also converted to KRW using the configured FX snapshot in `data/fx-rates.json`.
- Prices: KR current prices are stored in `data/kr-prices.json` via `pnpm fetch:kr-prices`; US current prices are stored in `data/us-prices.json` via `pnpm fetch:us-prices`. Brokerage export values are preserved when supplied.
- PDF evidence: US Gain/Loss reports and 1099 PDFs are summarized into `data/us-pdf-evidence.json` via `pnpm extract:us-pdf-evidence`.

## FX policy

`data/fx-rates.json` is the explicit FX source of truth for base-currency conversion. It is a local ignored file. Copy `data/fx-rates.example.json`, update the rates, and rerun `pnpm ingest` to regenerate all `base_*` values.

## KR price policy

`data/kr-prices.json` is a read-only external price snapshot generated from the Korea holdings tickers. Run `pnpm fetch:kr-prices && pnpm ingest` to refresh KR market value and unrealized gain/loss without modifying the source spreadsheets.

## US price policy

`data/us-prices.json` is a read-only external price snapshot generated from US holdings tickers. It fills market value and unrealized gain/loss for sources that provide tax lots without current valuation, especially Robinhood Gain/Loss PDFs.

## US PDF evidence policy

`data/us-pdf-evidence.json` is an extracted evidence snapshot for US Gain/Loss and 1099 PDFs. The app fingerprints the source PDFs and shows extraction coverage in `/health`. Robinhood Gain/Loss PDFs feed read-only tax lots and aggregated holdings; 1099 tax forms remain evidence-only until an explicit reconciliation rule is added.

## Public repository hygiene

Before publishing or pushing a new branch, confirm that only code and synthetic examples are tracked:

```bash
git status --short --ignored
rg -n "/Users|BEGIN .*PRIVATE KEY|API[_-]?KEY|SECRET|TOKEN|PASSWORD|1099|Gain_Loss|account_hint" .
```

Do not commit real `data/*.json`, `.env.local`, `private-data/`, `.next/`, `node_modules/`, or generated SQLite files.
