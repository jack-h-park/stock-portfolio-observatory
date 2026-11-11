# Personal finance operational cutover

Product branding, repository slug, local checkout location, output filenames, scheduler labels, and private archives are separate migration decisions. Keep legacy paths and serialized contracts until each consumer has been checked.

## Preparation

- Use the [compatibility inventory](../architecture/compatibility-inventory.md) to identify owning hosts and actual briefing/trading, source-sync, sheet, scheduler, and backup consumers.
- Verify open PRs, worktree ownership/use, dirty state, ancestry, and unique content before a checkout move. Other agents' active worktrees are not cleanup candidates.
- Keep source archives in place. Tax-document folder names do not establish jurisdiction; evidence uses root aliases and metadata.
- List durable state, archive, and rebuildable runtime mappings with source, destination, owner, and kind. Source push uses an allowlist and must not acquire a state-sync path.

## Copy preparation

`node scripts/migrate-finance-state.mjs --mappings /private/path/mappings.json` previews a private manifest. Mappings are an array of `{ "source": "/canonical/old/file-or-directory", "destination": "/canonical/new/file-or-directory", "owner": "application-operator", "kind": "state" }` objects. Kinds are `state`, `archive`, or `runtime`.

Review and privately retain the manifest. An authorized copy uses `--apply --expected-manifest /private/path/reviewed-manifest.json`; source hashes are rechecked before any copy. Symlink paths and conflicting destinations are refused. Matching copies support resumption. Originals remain; configuration is never flipped by the command. Restore proof and consumer parity must precede a live authority switch.

## Independent gates

| Action | Required evidence |
| --- | --- |
| Enable tax-history writes | Single writing host, current state revision, confirmed backup target and restore proof |
| Change private state paths | Verified copies and one-writer authority switch with rollback paths |
| Rename GitHub repository | Authorized target slug, open PR/tool integration review, remotes and inbound consumers checked |
| Move local checkout or rename scheduled jobs | Active-worktree audit, path/venv/lock/backup updates, authorized restart and observed result |
| Change briefing/CLI schema | Explicit version, upgraded readers, backward-compatibility/parity evidence |
| Delete legacy copies or branches | Fresh ownership/unique-content audit and applicable task completion/merge evidence |

Keep a private per-host execution record. Prepared, copied, configured, restarted, owner accepted, merged, and deployed are distinct statuses. This checklist and synthetic test results do not claim that a production migration happened.
