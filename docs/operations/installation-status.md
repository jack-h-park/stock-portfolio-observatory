# Owner installation observation

Updated November 13, 2026 (America/Los_Angeles). This documentation task records the separately authorized #311 security release and a later read-only installation observation. It performs no deployment or new browser acceptance.

| Layer | Verified state | Interpretation |
| --- | --- | --- |
| Security source release | [#311](https://github.com/jack-h-park/stock-portfolio-observatory/pull/311) merged as `c1c4ffb739f62effb88b8f6791a8989bec754870` on November 13 local time | Both exact-head CI checks succeeded; package/lockfile and security assessment only |
| Security deployment | Next.js `15.5.28`, serving process `next-server (v15.5.28)`, build `4O1RLDxGA_mTDDkAc9AzY` | Installed build-manifest bytes matched through loopback and owner HTTPS; this is historical proof of that release |
| Latest repository and operating checkout | [#312](https://github.com/jack-h-park/stock-portfolio-observatory/pull/312), `cbf450cdfe798a96780e1649db051a0bdb003f0e` | Subsequent account-update action clarification is merged and present in operating source; not deployed by this documentation task |
| Latest installed build/process | Build `WuFlQ4QI-tj35gxW9OVDH`; dependency and listener both Next.js `15.5.28` | Read-only observation after #312; do not attribute the earlier #311 browser checks to this later build |
| Security-release web acceptance | Overview, total assets, tax history and a historical record verified in the browser; evidence downloads hash-matched with private/no-store caching | Overview monetary display and independently read page amounts matched the pre-release baseline; bounded verification, not every workflow or physical-device acceptance |
| Security-release preservation | Operating financial/data contents and selected original evidence hashes/mtimes matched baseline; environment, app service file and persisted/live gateway matched receipts | One transient SQLite SHM mtime-only difference was separately recorded with unchanged bytes; no financial content change |
| Current access/write observation | Listener remains loopback-only; owner-device notice setting retained; `FINANCE_STATE_WRITABLE=0` | Approved-device web access remains intentional. #311 non-allowed LAN-source and spoofed-header requests received 403; not a physical other-device test |
| Registry audit at security rollout | Zero critical/high, two remaining moderate transitive findings | Historical audit result, not a claim of universal security or current alert closure; see [assessment and rollout](next-security-patch.md) |
| Coverage source | #304–#308 period/date evidence, #310 Samsung/Chase query-period work and #312 conditional account-update actions are merged | Current fetch age and actionable update prompts do not establish an authoritative expected-account inventory or complete history |
| Backup/recovery | Expanded custodian backup and pinned separate-location restore verified; see [backup status](finance-state-backup-and-restore.md#observed-operating-acceptance-november-13-2026) | Operating-host/cross-repository/application recovery and later ordinary scheduled-run proof remain separate |

## Security release boundary

The approved #311 release used an isolated synthetic candidate, frozen dependencies and an in-memory SQLite binding check. Only the application service was restarted after replacing its build/dependencies. The usual `make redeploy` includes refresh and was not used. No refresh, ingest, collection, source sync, tax import or backup/restore was run by that release. Previous build/dependencies remain retained privately for rollback; their cleanup requires a separate retention decision.

Earlier #290 tax-summary and #283/#286 gold/coverage acceptance retain their original scope. Annual component libraries and CLI are present in installed source; neither source presence nor the #311 smoke checks establish complete annual-tax totals, comparison eligibility or Korean reported amounts.

Hometax remains held; Korean line-specific reporting quantization is unresolved. The security-release authorization was completed and does not authorize another deployment. This documentation update changes no financial record, original evidence, access rule, web-write setting or operating configuration. Recheck source/build and protections before a later authorized release. Private figures, account identifiers, paths, snapshot IDs and detailed receipts remain outside this public repository.
