# Supported financial scope

Status describes source-level implementation, not production freshness or acceptance. Every private installation must review its own account and document coverage.

| Capability | Status | Boundary and owning source |
| --- | --- | --- |
| KR/US investments | Implemented | Institution-specific holdings/transactions/lots; [source declarations](../../scripts/source-files.mjs), [ingest](../../scripts/ingest-stock-data.mjs) |
| Crypto | Implemented | Bithumb/Robinhood statement reconstruction with independent balance checks; [data sources](../data-sources.md) |
| Deposits/CMA | Implemented | Supported bank statements and explicit local mappings; [bank extraction](../../scripts/extract-bank-statements.mjs) |
| Pension/gold | Implemented | Supported snapshots/certificates; wrapper and underlying exposure must not be summed twice; [asset totals](../../lib/net-worth.ts) |
| Total assets | Partial | Supported asset classes and current owner filters; prices/FX and dates affect coverage; [queries](../../lib/adapters/portfolio-db.ts) |
| Complete net worth | Unsupported | No general liabilities ledger; asset totals alone are not net worth |
| Cash flow | Partial | Income/inflows/transfers from supported records; not a full budget/spending ledger; [asset events](../../lib/asset-events.ts) |
| KR/US investment tax scenarios | Implemented, bounded | Investment-incremental planning under configured policy; [planner](../../lib/tax-planning.ts), [US engine](../../lib/us-tax-engine.ts) |
| Annual total tax calculator | Planned | Existing ordinary-income assumptions contextualize investment scenarios; they do not establish complete annual return coverage |
| Saved tax/rebalance plans | Implemented | Local state with review/execution records; [tax plans](../../lib/tax-plan-store.ts), [proposals](../../lib/rebalance/proposal-store.ts) |
| Returns/assessments/payments/refunds | Planned | Versioned evidence-linked historical records; no completion inferred from file names |
| Foreign-account reporting preparation | Partial | Maximum-balance reference tables, not filed FBAR/Form 8938; [FBAR helpers](../../lib/fbar.ts) |
| PFIC and unresolved tax treatments | Partial evidence/review only | [Preparer questions](../tax-preparer-questions.md); comprehensive automated calculation is unsupported |
| Public synthetic execution | Implemented, isolation upgrade planned | [Sample seed](../../scripts/seed-sample.mjs), [CI](../../.github/workflows/ci.yml) |
| Automatic trade/tax execution | Unsupported | No order placement, tax submission, or payment authorization |

For tax comparisons, match tax unit, year, authority, currency, and calculation scope. Do not compare investment-incremental estimates with annual-total return liability as if the difference were estimation error. Published rules, projected rules, manual assumptions, and undecided treatments remain distinct.
