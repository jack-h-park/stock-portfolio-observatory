# Finance state backup and restore

Durable state includes tax history and its embedded audit log, saved tax plans, rebalance proposals/fills/events, policies, account mappings, trigger state, and notification deduplication. Briefing archives and irreplaceable fetched history also need retention even when kept outside the state root.

The application host is the sole tax-history writer. Source-custodian mapping files and application-host policies retain their existing ownership until an explicit migration changes it. Source sync must not overwrite host-owned state.

## Before enabling private writes

Confirm the resolved state root is included in the host's actual backup target list. A parent records backup may already cover it; verify exclusions and restore behavior rather than inferring inclusion from the directory name. If outside existing coverage, add and verify a backup target first. This repository does not establish that any particular host's external backup is configured.

## Restore proof

1. For a rehearsal, keep live paths untouched and select compatible pinned snapshots with independent capture receipts. Stop live writers only for a separately authorized authority switch; an isolated read-only rehearsal must not pause services merely to compare with moving live files.
2. Preserve the current state, backup metadata, and configured path overrides. Do not overwrite the only recoverable copy.
3. Restore into a separate private validation destination. Validate the schema and inspect state revision, audit log, representative effective bases, and settlements.
4. Rebuild the disposable portfolio DB in isolation and confirm tax history remains unchanged. The history MVP reads durable state directly, so an unavailable or rebuilding portfolio DB does not invalidate its records.
5. Compare the restored history projection with the backup's expected record counts and reviewed example obligations. Reopening the application alone is insufficient proof.
6. Only then prepare the configured authority switch. Keep the former state read-only for rollback; never leave two active writers. Resume operations separately and record acceptance.

Synthetic automated proof is in `tests/tax-history-durability.test.ts`; it runs the actual isolated ingest and checks restoration without accessing private data. Private backup acceptance remains an operator task.

## Observed operating acceptance: November 13, 2026

The owner-specific durable-state audit established three distinct encrypted scopes: custodian sources/connector records, application-host records/state and fleet configuration/delivery state. An existing source-push allowlist is not a full archive backup. Filesystem ownership alone is not a universal writer guard; keep per-module logical authority explicit.

The custodian scope was expanded through workspace-governance [#241](https://github.com/jack-h-park/workspace-governance/pull/241), which is merged. Independent password/authentication-store access was confirmed by the owner, configuration content/hashes were reviewed, and share-quota headroom was checked before activation. Only the daily backup and its shared scope helpers were installed. Original roots and the existing mapping targets were retained, full financial history and connector records/runtime/state added, and reviewed configuration files explicitly allowlisted. Authentication files remained separately held.

The first expanded snapshot's actual target listing and all captured file hashes/link texts matched its independent baseline. It was then restored into a new private destination under an acquisition process sandbox, followed by an offline, read-only check with external communication and operating-path access blocked. File integrity, required evidence-link closure, JSON readability, read-only SQLite structural checks and connector run/payload/provenance relationships passed for that snapshot. Two external generated dependency-cache links were explicitly left unrecovered; neither is original financial evidence. The accepted final return files were hash-verified without recalculating the return.

This is single-snapshot custodian recovery proof. It does not prove operating-host recovery, cross-repository atomic consistency, provider reauthentication, full application/browser acceptance or physical host-loss recovery. No restored code or production workflow was executed or promoted. Operating records/evidence, gateway/access configuration and disabled web writes were preserved; a transient live SQLite shared-memory mtime-only change was recorded separately with unchanged bytes. Private snapshots, figures, account identifiers, paths and detailed receipts are not public fixtures.

Daily attempts retain their existing schedule and skip after that day's success. Scope-version markers prevented an old success from skipping the first expanded capture. The monthly drill was not replaced or run: its new marker namespace could make it newly eligible. Its operating rollout and later application/cross-repository recovery are separate gates. The loaded registration and manually verified capture do not prove a later ordinary scheduled run.

Keep the decrypted recovery specimen private/read-only until an explicit retention decision; preserve receipts before any later cleanup. Broader shared-runtime updates must review the held drill rather than incidentally enabling it. Curated FX editing authority, the briefing producer's effective archive path, and compatible operating-state/delivery-state recovery remain bounded follow-ups. See [next priorities](../product/next-increment.md).
