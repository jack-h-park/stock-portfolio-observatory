# Fidelity connector shadow observations

`finance-connectors` owns provider credentials and collection. This app only reads completed exports. This integration is opt-in, read-only, and shadow-only: it adds health checks without inserting holdings, cash, activities, tax rows or prices.

Configure these on the private application host after the collector has produced an accepted live run:

```dotenv
FINANCE_MODE=private
FINANCE_CONNECTOR_EXPORT_DIR=/absolute/private/finance-connectors/runtime
FINANCE_CONNECTOR_RECORDS_DIR=/absolute/private/finance-connectors/records
STOCK_CONNECTOR_ACCOUNT_MAP_PATH=/absolute/private/observatory-state/connector-accounts.local.json
FINANCE_CONNECTOR_CONNECTION=fidelity
```

The reader pins `live/latest-good/fidelity.json`, verifies the referenced immutable manifest, all current payload hashes/counts, the versioned schema, account references and raw provenance/dependency hashes and JSON pointers. Sandbox/demo/sample runs and incomplete required sections are rejected. v1 currently accepts complete snapshots only; `unchanged` requires a future section-specific lineage contract. Source dates may be older than the fetch date. Fetch age warns after 36 hours and reports an error classification after 72 hours; configured shadow checks remain warnings so they cannot replace existing accounting inputs.

`STOCK_CONNECTOR_EXPORT_DIR`, `STOCK_CONNECTOR_RECORDS_DIR` and `STOCK_CONNECTOR_CONNECTION` are supported aliases. Conflicting aliases fail closed. Private roots cause private-mode inference; explicitly selecting sample with connector roots is rejected. No SnapTrade credentials belong in this repository or app.

Account mapping uses exact collector account references and separately reviewed instrument identities. Create the local file with mode 0600, outside Git:

```json
{
  "schemaVersion": 1,
  "accounts": {
    "snaptrade:fidelity:PROVIDER_ACCOUNT_ID": {
      "account": "EXACT_EXISTING_ACCOUNT_LABEL",
      "instruments": {
        "snaptrade:PROVIDER_SECURITY_ID": "EXISTING_TICKER"
      }
    }
  }
}
```

Review the provider security ID against Fidelity evidence before adding a mapping; ticker text alone never establishes identity. A conflicting provider symbol is reported. Unknown accounts/instruments, missing positions in either direction, and exact decimal quantity differences produce warning codes. Core money-market funds remain unverified because their inclusion in cash is not established. No labels or mappings are guessed and no economic values appear in shadow warning details.

Collection health is independent from the historical last-good export. Missing, malformed or unreadable latest status stays unknown and warns; it is never treated as success. Review `connector_shadow_valid`, `connector_shadow_fresh`, `connector_last_collection`, and `connector_shadow_positions` after a separately authorized private ingest. This implementation does not run a production refresh or publish Sheets.

Before promotion or scheduling, compare selected accounts, quantities, cash/core treatment, valuation dates and representative activities against current Fidelity/CSV/statement evidence. Complete at least seven successful daily shadow collections and a statement comparison. Positions, balances, activities and tax lots require separate acceptance and cutover decisions. Retain historical CSV evidence and unknown coverage; API absence does not prove zero or deletion.

The vendored `contracts/finance-connectors/v1/run.schema.json` is copied from the private producer's v1 schema. Its SHA-256 and source repository are recorded beside it. Any contract change must update both repositories and repeat a producer-to-consumer synthetic check.
