# Private storage and configuration

Storage mode and network authorization are separate. The owner-operated private website uses an intentional approved-owner-device restriction over Tailscale, scoped to the finance hostname; normal browser access remains available without an SSH tunnel. `FINANCE_MODE=private` is not a login or access-control mechanism. See [private web access](../operations/private-web-access.md) for the policy, new-device review and enforcement boundary.

The shared resolver in [finance-paths.mjs](../../scripts/finance-paths.mjs) is used by the app, CLI, ingestion, fetchers, and Node wrappers that pass paths into Python. Operational shell jobs retain legacy names until their separately reviewed cutover. The sheet publisher, summary-health job, and coverage reminder retain their established private fallback paths unless an applicable file/runtime override is supplied; an inferred app sample default never replaces an operational fallback. Applying synthetic positions to an operational sheet is refused before credential or network access. Direct Python commands use the legacy environment interface; invoke their Node package commands for new-root resolution.

| Setting | Purpose |
| --- | --- |
| `FINANCE_MODE` | `sample` or `private`; omitted mode infers private from configured private paths, otherwise sample |
| `FINANCE_RECORDS_DIR` | Financial institution records; equivalent to legacy `STOCK_DATA_DIR` |
| `FINANCE_TAX_DIR` | Optional tax evidence root; no country inferred from its name |
| `FINANCE_STATE_DIR` | Durable local policy, review and tax-history state |
| `FINANCE_RUNTIME_DIR` | Rebuildable query DB, extraction and market snapshots |
| `FINANCE_STATE_WRITABLE` | `0` by default privately; only the designated writing host uses `1` after backup/restore verification |

Each supported `STOCK_*_PATH`/`STOCK_*_DIR` key has a `FINANCE_*` alias, except the records root mapping above. Equivalent aliases are normalized to absolute paths; conflicting nonempty aliases fail without printing their values. Public example paths and operational flags do not select private mode. The exhaustive private-path allowlist is `FINANCE_FILES` in the resolver.

Explicit file overrides win over root-derived defaults. Existing private installations keep their legacy file defaults until an audited migration changes configuration; declaring a state/runtime root opts those files into that root without moving existing files. Check the resolved paths and prepare a verified copy before changing live configuration. Records, retained briefing archives, durable state, and runtime are distinct: a runtime override does not move source documents or an archive.

Sample mode owns only `private-data/personal-finance-sample/` in its working directory, with records, tax, state and runtime subdirectories. Its DB is `runtime/observatory.db`. The seed refuses private path configuration, `.env.local`, unowned nonempty roots, and symlinks anywhere in its existing output tree. Force flags cannot bypass these guards. Use a temporary working directory for independent samples; the old arbitrary `SAMPLE_STOCK_DB_PATH` override is retired.

Tax history will be durable state, never a generated DB input that refresh can replace. Other hosts may read it, but source push does not synchronize it. Existing policies and proposals retain their ownership until a reviewed migration switches one authority. Missing tax evidence is shown as missing, never replaced with sample records.
