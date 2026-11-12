# Personal finance compatibility inventory

Baseline: `1b88e66`, inspected November 10, 2026 (America/Los_Angeles). The product definition and master plan were merged in PR #274. Existing unrelated worktrees remain untouched. The table records repository-owned interfaces; external jobs and backup coverage require operator confirmation before cutover.

November 12, 2026 update: the owner-operated installation has completed bounded history/evidence adoption and pinned recovery, while broader external-consumer and rename gates remain open. See [current operating status](../product/implementation-status.md). The baseline table retains preserved interface contracts; it is not proof that every external consumer has been reaccepted.

Owner roles: **application operator** owns the serving host and writable state; **source custodian** acquires documents and maintains the pushed mapping allowlist; **consumer operator** owns an external reader. These roles do not assert current host configuration.

| ID | Producer → consumer | Contract/path | Owner | Validation | Migration state |
| --- | --- | --- | --- | --- | --- |
| config | env/config → app, CLI, scripts, Python wrappers | `STOCK_*` plus ignored `.env.local`; [config](../../config.ts), [loader](../../scripts/env.mjs) | Application operator | Resolver parity and subprocess tests | Preserve legacy overrides |
| sources | Institution files → parsers | `STOCK_DATA_DIR`, [source declarations](../../scripts/source-files.mjs) | Source custodian | Source inventory and fingerprints | Keep archives in place |
| sync | Laptop allowlist → refresh host | [push-sources.sh](../../scripts/push-sources.sh), source dirs and three mapping files only | Source custodian | `tests/push-sources-config.test.mjs`, isolated dry-run | Never carry host-owned state |
| sync-drift | Source push → private drift report | Same push script; retained remote files are reported, never deleted | Source custodian | Stubbed rsync/ssh tests | Include report in cutover review |
| database | ingest → app/CLI | SQLite, `STOCK_DB_PATH`, legacy basename; atomic build/swap | Application operator | Existing stock/CLI tests | Preserve path and views |
| runtime | fetch/extract → ingest/app | Ignored `data/` snapshots and extracted directories | Application operator | Seed/build and source tests | Isolate sample first; inventory irreplaceable history |
| account-map | Local custodian → parsers/app | `STOCK_ACCOUNT_MAP_PATH`, `accounts.local.json` | Source custodian | Account ownership/wrapper tests | Preserve source-custodian authority |
| tax-policy | Tax settings → planner/ingest | `STOCK_TAX_POLICY_PATH`; never source-pushed | Application operator | Existing tax policy tests | Keep one writable authority |
| tax-plans | Saved plan actions → plan pages | `STOCK_TAX_PLANS_PATH`, versioned snapshots | Application operator | Existing tax-plan tests | Durable, not disposable runtime |
| rebalance | Local review actions → proposals/CLI | Allocation policy, instrument classes, proposals, trigger/notification state | Application operator | Rebalance tests | Preserve approvals/deduplication |
| CLI | Observatory commands → agents/manual readers | [CLI envelope](../../lib/cli/common.ts), schema 1, exit codes 0/1/2/3 | Consumer operator | CLI tests | Preserve envelope and locking |
| summary | [summary entry](../../scripts/summary.mjs)/[writer](../../scripts/write-briefing-summary.ts) → briefing/trading readers | `STOCK_BRIEFING_SUMMARY_PATH`, schema 1, atomic private file | Consumer operator | Summary tests; external readers unresolved | No schema/name change in brand release |
| archive | External briefing job → app | `STOCK_BRIEFING_ARCHIVE_DIR` | Consumer operator | Archive adapter tests | Retain history; not rebuildable by this app |
| sheets | DB publisher → configured sheets | `publish:kr-sheet`, `publish:us-sheet`; external writes require apply | Source custodian | Publisher dry-run/tests | Keep interface; no publication during migration tests |
| schedules | launchd/Hermes → refresh, coverage, alerts, rebalance | [deploy](../../deploy/), [Makefile](../../Makefile) | Application operator | Wrapper/plist tests | Preserve labels, paths, venvs, locks; no restart |
| UI identity | App → browser/PWA | [page names](../../lib/page-names.ts), [manifest](../../app/manifest.ts) | Application operator | Page-name tests, synthetic UI | Branding separate from routes/cookies |
| asset preference | Browser cookie → asset queries | [asset-view](../../lib/asset-view.ts) | Application operator | Asset-view tests | Preserve explicit legacy preference |
| backups | Private archive/state → recovery targets | External backup target lists are not owned by this repo | Application operator | Actual populated-state/evidence and host-data restore accepted for owner installation | Paired backup/drill whole-data targets reconciled with versioned source; other installations must verify independently |
| tax root | Private tax documents → hash-checked evidence reader | Optional configured tax root | Application operator | Per-root path/hash/relink tests | Reviewed evidence copies operating; no original archive moves |

## Configuration inventory rules

The new resolver must enumerate supported legacy path keys rather than treating every `STOCK_*` flag as a private path. Cover source/DB paths; FX, prices, historical prices/FX, bank/crypto/Toss/Robinhood snapshots; US PDF/pension/FX evidence; statement/extraction directories; manual/account/event-label mappings; tax/rebalance policies and stores; briefing archive/summary; refresh history/lock; export receipts. Follow each owning reader before assigning its default or write authority. Public example policy paths do not by themselves identify private mode.

Do not assume that a consumer can follow a GitHub redirect, a moved checkout, or a new output filename. Record its actual upgrade and parity check before deprecating an interface. A root under the source archive does not make state eligible for source synchronization.

## Cutover blockers

- Confirm external briefing/trading consumers and scheduler installations before their migration. The owner installation's bounded backup/restore gate is accepted; preserve that coverage.
- Preserve the accepted single state authority and private web read-only setting. Each newly authorized CLI import must verify current revision and backup readiness.
- Audit open PRs, active worktrees, local path references, and unique content before repository/checkout moves.
- Additional historical years or wider settlement claims require their own reviewed evidence scope; bounded adoption does not establish complete authority posting.

These block the dependent operational action, not synthetic development.
