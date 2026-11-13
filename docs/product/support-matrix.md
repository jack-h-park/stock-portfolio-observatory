# Supported financial scope

Status combines source support with the bounded operating acceptance recorded in [implementation status](implementation-status.md). It does not certify current balances or complete account coverage for every installation.

| Capability | Status | Boundary and owning source |
| --- | --- | --- |
| KR/US investments | Implemented | Institution-specific holdings/transactions/lots; [source declarations](../../scripts/source-files.mjs), [ingest](../../scripts/ingest-stock-data.mjs) |
| Crypto | Implemented | Bithumb/Robinhood statement reconstruction with independent balance checks; [data sources](../data-sources.md) |
| Deposits/CMA | Implemented | Supported bank statements and explicit local mappings; [bank extraction](../../scripts/extract-bank-statements.mjs) |
| Pension/gold | Implemented | Supported snapshots/certificates; wrapper and underlying exposure must not be summed twice; [asset totals](../../lib/net-worth.ts) |
| Total assets | Partial | Supported asset classes and self-owner scope; current arithmetic reviewed, source coverage unconfirmed, sale-aware historical gold and coverage display deployed; declared statement ends still unconfirmed; [queries](../../lib/adapters/portfolio-db.ts) |
| Complete net worth | Unsupported | No general liabilities ledger; asset totals alone are not net worth |
| Cash flow | Partial | Income/inflows/transfers from supported records; not a full budget/spending ledger; [asset events](../../lib/asset-events.ts) |
| KR/US investment tax scenarios | Implemented, bounded | Investment-incremental planning under configured policy; [planner](../../lib/tax-planning.ts), [US engine](../../lib/us-tax-engine.ts) |
| Annual recorded-tax summary | Merged and operating in #290 | Existing obligation-year amounts with separate units/authorities/currencies; no schema change or new estimate; [increment scope](next-increment.md) |
| Annual total tax calculator | [Rule/contract foundation #296](https://github.com/jack-h-park/stock-portfolio-observatory/pull/296) merged, not deployed; US ordinary/NIIT #297 merged without deployment; eligible QDCG v2 #298 merged without deployment; KR exact-reference core #299 merged without deployment with reported amounts blocked; standalone preview CLI in current PR; no annual total | Reviewed-base components and composed annual results require separate coverage/official-rule gates; current investment assumptions do not establish annual return coverage |
| Saved tax/rebalance plans | Implemented | Local state with review/execution records; [tax plans](../../lib/tax-plan-store.ts), [proposals](../../lib/rebalance/proposal-store.ts) |
| Returns/assessments/payments/refunds | Implemented; bounded private adoption verified | Versioned structured import and evidence links operating; private web history writes remain disabled; [workflow](../operations/tax-history.md); no completion inferred from file names |
| Foreign-account reporting preparation | Partial | Maximum-balance reference tables, not filed FBAR/Form 8938; [FBAR helpers](../../lib/fbar.ts) |
| PFIC and unresolved tax treatments | Partial evidence/review only | [Preparer questions](../tax-preparer-questions.md); comprehensive automated calculation is unsupported |
| Public synthetic execution | Implemented with isolated sample roots | [Sample seed](../../scripts/seed-sample.mjs), [CI](../../.github/workflows/ci.yml) |
| Automatic trade/tax execution | Unsupported | No order placement, tax submission, or payment authorization |

For tax comparisons, match tax unit, year, authority, currency, and calculation scope. Do not compare investment-incremental estimates with annual-total return liability as if the difference were estimation error. Published rules, projected rules, manual assumptions, and undecided treatments remain distinct.
