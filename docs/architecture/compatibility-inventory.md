# Personal finance compatibility inventory

Baseline: `1b88e66`, inspected November 10, 2026 (America/Los_Angeles). The product definition and master plan were merged in PR #274. Existing unrelated worktrees remain untouched. The table records repository-owned interfaces; external jobs and backup coverage require operator confirmation before cutover.

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
| backups | Private archive/state → recovery targets | External backup target lists are not owned by this repo | Application operator | Confirm targets, then isolated restore proof | Unresolved; blocks enabling private tax-history writes |
| tax root | Private tax documents → future evidence reader | No current legacy equivalent | Application operator | Per-root path/hash/relink tests | Add optional root; no archive moves |

## Configuration inventory rules

The new resolver must enumerate supported legacy path keys rather than treating every `STOCK_*` flag as a private path. Cover source/DB paths; FX, prices, historical prices/FX, bank/crypto/Toss/Robinhood snapshots; US PDF/pension/FX evidence; statement/extraction directories; manual/account/event-label mappings; tax/rebalance policies and stores; briefing archive/summary; refresh history/lock; export receipts. Follow each owning reader before assigning its default or write authority. Public example policy paths do not by themselves identify private mode.

Do not assume that a consumer can follow a GitHub redirect, a moved checkout, or a new output filename. Record its actual upgrade and parity check before deprecating an interface. A root under the source archive does not make state eligible for source synchronization.

## Cutover blockers

- Confirm external briefing/trading consumers, scheduler installations, and backup target lists on their owning hosts.
- Verify the private writing host and backup/restore coverage before enabling tax-history writes.
- Audit open PRs, active worktrees, local path references, and unique content before repository/checkout moves.
- Select the historical acceptance year and evidence scope before reconciling actual returns/payments.

These block the dependent operational action, not synthetic development.
