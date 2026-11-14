# Account inventory foundation

This standalone library implements the first synthetic stage of the [inventory design](../superpowers/specs/2026-11-13-account-inventory-design.md). No app, CLI, reminder, ingest or legacy map-loader caller is changed. Real mapping adoption, observation adapters and read-only UI wiring remain later work; no operating inventory is attested complete.

## Boundary and exports

[Types](../../lib/domain/assets/account-inventory/types.ts) describe `MapRead`, optional primary/binding metadata, exact review scope, dated observations, recorded evidence and `InventoryProjectionV1`. [Exports](../../lib/domain/assets/account-inventory/index.ts) provide:

- `validateInventoryMap(mapRead)`: validate an already-read value and normalize registrations, retaining unavailable/read-error reasons. It never opens a configured file or changes `loadAccountMap`'s existing fallback behavior.
- `inventoryDigest(normalizedMap, scope)`: canonical SHA-256 of the scoped semantic registration metadata. It is a review comparison value, not an owner signature or current-source-byte verification.
- `projectAccountInventory(input)`: deterministic identity grouping, scope/review assessment, required-source and history judgments with explicit `asOfDate`, UTC clock and `adapterVersion: inventory-v1`.

Callers supply parsed data, source references and provenance. The initial resolver supports exact explicit labels/bindings, the versioned provider alias table and explicitly configured bank multi-currency groups. Other provider identity bridges must be normalized by later adapters; unsupported or ambiguous references remain visible rather than being guessed from account suffixes. Existing default `self` classification does not confirm owner identity here.

The library has no filesystem, DB, environment, provider or original-document access, and no write API. `node:crypto` hashes canonical metadata only. Runtime-invalid projection envelope/observation/signal shapes throw; missing/invalid map reads produce an unavailable review and null confirmed denominator. Invalid identity metadata remains an unresolved registration with reasons rather than disappearing.

## Result interpretation

Expected, legacy-registered, observed-only and unresolved rows have distinct populations. Review exclusions stay visible. Current evidence can coexist with unreviewed inventory, missing activity, historical gaps or reconciliation issues. A reviewed scope's account denominator is not a source coverage percentage or a self-owned financial total.

Receipts apply only to their exact scope and as-of date. Historical receipt-only results cannot certify current completeness. Observation dates after the requested date are separated; undated observations cannot prove historical membership or freshness. Source states are per required kind, not a substitute for account lifecycle. Quiet/empty evidence does not close an account. Closed accounts remain visible and do not receive current refresh demands.

History requires an explicit start and an end bound plus recorded identity-bound periods. Existing bank `historyFrom` may provide the start only for an explicitly required activity kind. A different new start is a configuration conflict. Endpoint-only evidence or an absent #314 gap signal cannot establish continuous history. No original bytes are rehashed by these functions. A later adapter must validate/consolidate a statement chain before supplying its date and periods as one signal. Multiple signals of a required kind are treated conservatively as independently required artifacts: the oldest endpoint controls freshness. Their periods can jointly describe history. A source-reference string alone is not newly verified hash or identity evidence.

The versioned policy IDs retain existing cadences and restrict compatible source kinds:

| Policy ID | Days | Kinds |
| --- | --- | --- |
| us-14 | 14 | positions, activity, balance |
| kr-35 | 35 | positions, activity |
| samsung-120 | 120 | activity |
| bithumb-14 | 14 | positions, activity |
| robinhood-snapshot-7 / robinhood-csv-14 | 7 / 14 | positions / activity |
| bank-30 | 30 | activity, balance |
| pension-180 | 180 | pension_snapshot |
| gold-90 | 90 | positions, activity |

These IDs do not claim provider-reader support has been integrated. Unknown IDs or incompatible kinds return unsupported; they are not inferred download requirements. Due-soon begins four days before the cadence, retaining the existing minimum-one-day rule.

## Delivery and verification

Synthetic tests in [account-inventory.test.ts](../../tests/account-inventory.test.ts) cover the contract. An isolated public-source fixture runs the existing CI-equivalent tests/build without private configuration or inherited financial roots. This establishes library/build regression evidence only; production source/adapter parity, bilingual UI, owner inventory review, physical-device access and operational rollout are separate acceptance steps.

No actual account map, financial record, original evidence, access rule or web-write setting is changed. Hometax and additional deployment remain held. No new durable path or backup setting is introduced.
