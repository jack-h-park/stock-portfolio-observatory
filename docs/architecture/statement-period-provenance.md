# Statement periods in asset coverage

The all-assets coverage disclosure separates valuation/FX dates, balance observations, account freshness, file freshness and declared statement periods. A recent transaction or API observation does not establish a statement's period. The first provenance connection is bounded to the existing Korean brokerage extractor; other source types remain unconfirmed here.

## Producer and compatibility

`scripts/extract-kr-statements.py` already records account-matched page-1 periods in its `declared` map. Its generated `as-of.json` now optionally includes `statementPeriods: { schemaVersion: 1, accounts: ... }`. Each original PDF is read from a byte snapshot: its hash and its own page-1 period come from those same bytes, including every multipart sibling. The main extraction records source digests before parsing and leaves a changed source unconfirmed. Unsupported text transcriptions are not original PDF page evidence. Each account entry has `state: declared | conflicting | unconfirmed` and `sources`, whose receipts contain the source basename, SHA-256 at extraction, page 1, start and end dates. Source order is deterministic by end then name. Original document bytes, balances and account identifiers are not committed as fixtures.

The existing `accounts` map, including `STOCK_KR_AS_OF` pins and transaction fallbacks, remains unchanged. The new receipts use the original parsed periods, never that map. Missing dates or an unavailable hash leave an account unconfirmed; reversed periods or a transaction from that same account/source outside the printed interval leave it conflicting. Conflict wins over other available receipts. Multiple periods in an account do not by themselves establish continuity or full source coverage.

This is additive generated metadata, not a database migration or a change to lots, realized gains, cash coverage or valuations. Old readers can ignore it. Existing generated files without the field stay unconfirmed; no operational extraction or ingest is performed by this PR. A later authorized regeneration is required before an old installation can show new receipts.

## Reader and display

The pure `readStatementPeriodEvidence` validates version, exact account binding, safe basename, hash, page and real calendar intervals. Duplicate source names with inconsistent hashes/periods are conflicting and their disputed receipts are withheld, independent of input order. Malformed metadata remains unconfirmed, with no fallback to older evidence or legacy as-of dates. The account adapter reads only generated metadata, not original PDFs, and passes the receipt state separately from its existing statement/account freshness dates.

The overview keeps its statement-end range, separates declared/conflicting/unconfirmed account counts, and adds bilingual read-only account/source/page/period details. Conflicting or unconfirmed evidence supplies no date to that range. Declared periods from different accounts can appear in the same range; it is not a single continuous covered interval, a percentage or a self-only account inventory. Source-review scope may include other owners and accounts outside current covered totals. Existing review links and all covered-total arithmetic remain unchanged.

Receipts identify what the extractor recorded. The web request does not rehash originals, verify current evidence bytes, resolve reconciliation or prove that an account's entire history was supplied. No new evidence-download route, automatic relink, finance write, refresh, network acquisition or source access is added.

## Validation and limits

Synthetic tests exercise the Python producer/write path, pinned-versus-declared independence, exact source hashes, unknown/malformed/conflicting periods, missing files, deterministic binding, actual SQLite adapter wiring and bilingual disclosure. Existing valuation, account and tax contracts remain separate regression targets. The operating installation, permissions and original evidence are preserved; Hometax verification, deployment and private web-write activation remain on hold.
