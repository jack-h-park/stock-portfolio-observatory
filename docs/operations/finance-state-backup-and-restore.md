# Finance state backup and restore

Durable state includes tax history and its embedded audit log, saved tax plans, rebalance proposals/fills/events, policies, account mappings, trigger state, and notification deduplication. Briefing archives and irreplaceable fetched history also need retention even when kept outside the state root.

The application host is the sole tax-history writer. Source-custodian mapping files and application-host policies retain their existing ownership until an explicit migration changes it. Source sync must not overwrite host-owned state.

## Before enabling private writes

Confirm the resolved state root is included in the host's actual backup target list. A parent records backup may already cover it; verify exclusions and restore behavior rather than inferring inclusion from the directory name. If outside existing coverage, add and verify a backup target first. This repository does not establish that any particular host's external backup is configured.

## Restore proof

1. Set the private host read-only and stop its writers under the applicable operational authorization. Confirm no active writer lock owner remains.
2. Preserve the current state, backup metadata, and configured path overrides. Do not overwrite the only recoverable copy.
3. Restore into a separate private validation destination. Validate the schema and inspect state revision, audit log, representative effective bases, and settlements.
4. Rebuild the disposable portfolio DB in isolation and confirm tax history remains unchanged. The history MVP reads durable state directly, so an unavailable or rebuilding portfolio DB does not invalidate its records.
5. Compare the restored history projection with the backup's expected record counts and reviewed example obligations. Reopening the application alone is insufficient proof.
6. Only then prepare the configured authority switch. Keep the former state read-only for rollback; never leave two active writers. Resume operations separately and record acceptance.

Synthetic automated proof is in `tests/tax-history-durability.test.ts`; it runs the actual isolated ingest and checks restoration without accessing private data. Private backup acceptance remains an operator task.
