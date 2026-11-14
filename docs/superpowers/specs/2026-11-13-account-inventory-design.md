# Expected-account inventory and evidence coverage design

Proposed November 13, 2026. **Design only; not implemented or activated.** The owner authorized a design PR using existing account mappings. The contract choices below are recommendations for review, not a completed inventory attestation or authorization to edit private records. Hometax and additional deployment remain held.

## Intent and boundaries

Make it possible to answer three different questions: which accounts are expected within a reviewed scope, which accounts have actually been observed, and which required evidence is missing or needs review. A recent file, zero balance or green update checklist cannot answer all three.

Keep the existing private account-map file as the single inventory editing authority. Preserve existing classification, aliases, archive paths, asset totals, taxes, rebalancing and CLI/briefing interfaces. The first implementation must be a read-only projection with synthetic tests. It must not fetch data, parse original documents on web requests, import records, register accounts automatically, activate web edits or introduce a second persistent registry. Existing approved-device access and evidence-download protections remain mandatory.

This design does not implement a complete net-worth model, tax-reporting account eligibility, shared/joint ownership allocation, historical ownership transfers, a new provider connector or a completeness percentage. A household or foreign-account-reporting scope needs its own explicit review; account presence is not filing eligibility.

## Current source baseline

This design starts from merged #314 (`3f25bfd`), not the earlier private audit snapshot. No new operating-version or live acceptance claim is made here.

| Existing producer/reader | Present role and limitation |
| --- | --- |
| [Account map](../../../scripts/account-map.mjs) and [source push](../../../scripts/push-sources.sh) | One gitignored configuration file, selected by `STOCK_ACCOUNT_MAP_PATH`, holds classification overrides and bank/pension/brokerage registrations. The push config allowlist carries that file; no new sync route is needed. `accounts` is not an exhaustive registry, and missing files legitimately produce an empty map for sample/new checkouts. |
| [Bank identity helpers](../../../lib/bank-accounts.ts) | Provider-specific labels, explicit multi-currency grouping and retirement markers. These are compatibility rules, not a universal reviewed identity/lifecycle contract. |
| [Portfolio adapter](../../../lib/adapters/portfolio-db.ts) | `getAccountDataRanges` lists observed historical spans; `getAccountCoverage` combines observations and selected registrations; `getSupplementaryCoverage` includes bank/pension/gold review signals. Their populations differ. #314 adds explicitly requested bank `historyFrom` gaps; reuse this evidence rather than duplicating it. |
| [Statement receipts](../../../lib/domain/assets/statement-periods.ts), [query coverage](../../../lib/domain/assets/query-coverage.ts), [source confirmations](../../../scripts/source-confirmations.mjs) | Evidence has source/account/period-specific semantics. A declared endpoint is not automatically a continuous history or current-byte verification. |
| [Coverage collection](../../../lib/application/asset-coverage.ts) and [update action](../../../components/AccountUpdateAction.tsx) | Independent signal counts and conditional actions; source review can include other owners. Preserve current totals and legacy action contracts. |

Missing map input, malformed input and a valid empty reviewed scope must become distinguishable in the new projection. Do not change `loadAccountMap`'s legacy missing-file fallback or classification behavior for existing consumers just to achieve that distinction.

## Approaches and recommendation

1. **Recommended: additive metadata on existing map entries plus a pure read projection.** Reuse one editing/sync/backup authority; retain legacy registrations and add explicit identity/review only through separately reviewed private changes. Requires a compatibility adapter and visibly unconfirmed legacy identities.
2. Separate inventory database/file. Easier greenfield schema, but creates a second mutable account authority and reconciliation/migration burden; rejected for this increment.
3. Derive the expected list solely from database/snapshot rows. No new metadata, but cannot detect an expected account with no supplied observations and would turn discovery into false completeness; rejected.

The user selected reuse of the existing mapping. The detailed fields, deterministic rules and staged compatibility below are proposed engineering choices, subject to design review. This PR does not approve or execute a private metadata migration.

## Identity and map authority

### Additive private input, not a second registry

Use an optional `inventory` property on an existing entry in `bankAccounts`, `brokerageAccounts`, `pensionAccounts`, or a value in `accounts`. Do not reinterpret every classification override as an expected account. Only an explicit primary `inventory` annotation declares an expectation. Existing entries without it remain legacy registrations or observations and stay visible.

A primary annotation has the following proposed logical shape; it is documentation, not an implemented schema:

```ts
type PrimaryInventory = {
  role: 'primary'
  accountId: string
  providerId: string
  owner: { state: 'confirmed'; ownerId: string } | { state: 'unconfirmed' }
  dimensions: { wrappers: string[]; assetClasses: string[] }
  lifecycle: {
    state: 'active' | 'closed' | 'unconfirmed'
    openedOn?: string
    closedOn?: string
    basisRef?: string
  }
  requirements: {
    kind: 'positions' | 'activity' | 'balance' | 'pension_snapshot'
    freshnessPolicyId: string
    historyFrom?: string
  }[]
}
type InventoryBinding = { role: 'binding'; accountId: string }
```

`accountId` is a custodian-assigned opaque ID, stable across rename, export format and currency series, unique within this installation. It must not encode an account number, last four digits or display label. `providerId` uses an explicit, versioned provider-alias table in the adapter; unsupported provider values remain unresolved. Compare IDs exactly, without case folding or inferred suffix matches. Identifiers and labels remain private even if their spelling looks harmless. Proposed ID syntax is 1–80 ASCII letters, digits, underscore or hyphen, starting with a letter; compare case-sensitively. Reject empty IDs and duplicate requirement kinds rather than guessing a merge.

Exactly one entry is primary for an ID. Another existing entry may bind to it using `role: binding` and that ID; it supplies an additional explicit label/section alias but cannot override owner, lifecycle or requirements. An absent primary, duplicate primary, invalid ID or contradictory provider/alias binding is an identity conflict. Never silently choose one or fall back to the default owner. Correcting a primary location later is one reviewed private-map edit, not a web action.

Synthetic example: a bank registration has a primary `accountId: acct-example-01`; a classification override under another existing label can bind to `acct-example-01`. Both labels still work for old readers, while the new projection counts one expected economic account. A security, cash sweep and several currency series do not create additional expected accounts when explicitly bound to that same ID.

### Resolving existing input

- Normalize existing section entries using the owning helpers and a versioned adapter. Record section and semantic selector (provider plus exact configured label/token), not array position. Reject duplicate selectors as ambiguous; moving an array entry must not change identity.
- Keep a deterministic legacy row key as a structured tuple of section/provider/exact label for entries without IDs. It is a display/provenance key, not a canonical account ID. No random IDs or automatically persisted backfill.
- Resolve observed account references only through explicit map bindings or an existing supported provider identity bridge, such as the Robinhood snapshot's account/strategy relationship. The bridge must be unique and retain its evidence provenance; if it cannot bind uniquely to a primary, keep the observation unresolved. Matching display suffixes alone is insufficient.
- Multi-currency folding requires the existing explicit bank grouping or an explicit binding. Wrapper/exposure/asset-class views are dimensions of an account, not additional accounts. Preserve aliases and historical rows; do not change legacy grouping or economic totals.
- Unknown providers, unmapped aliases and source-only accounts remain visible. They must not disappear because the expected-account adapter cannot support them.

### Owner and lifecycle

Ownership in this projection is explicit. Existing `ownerFor` fallback to `self` remains untouched for legacy arithmetic but supplies only an unconfirmed owner here. Existing explicit owner fields can be shown as declared provenance; a confirmed primary owner is required for membership in a confirmed owner-scoped inventory. Never infer ownership from a tax unit, file location, account number or device login.

Use existing owner IDs such as `self` or an opaque other-owner ID. Do not create new tax units; no automatic account-to-tax-unit mapping. Joint ownership or contradictory owner declarations produce `owner_unresolved` and stay outside confirmed self-only counts. Preserve their rows and evidence.

Lifecycle is independent of balance and evidence freshness. A zero/empty account can be active. Closed status requires an explicit primary declaration and `basisRef`; a closing date, when supplied, must be a real calendar date not after `asOfDate`. A bare legacy retirement flag remains declared/unverified lifecycle provenance, preserving existing reminder suppression but not proving closure in the new projection. Invalid/future dates or contradictory active/closed declarations stay unresolved. Missing pension tokens are adapter limitations, not evidence of closure.

Confirmed closed accounts remain historical rows and may have a final-history requirement through `closedOn`; without that date the final interval is unconfirmed. They do not incur current refresh demands. Opened dates alone do not authorize collection of all prior history.

## Review scope and attestation contract

Add an optional top-level `inventoryReview` metadata object in the same private map, with `schemaVersion: 1` and a list of review receipts. A future loader must expose it to the new projection while preserving all legacy return fields and callers. No second file, automatic writer, database migration or new scheduled job is proposed.

Each receipt contains:

- Stable `reviewId`, `reviewedAt` (UTC instant), `asOfDate` (real calendar date), `reviewerId` and `basis: owner-attested`.
- Explicit scope selectors: owner IDs, provider IDs and account dimensions, with an explicit `all` alternative for each axis. Within an axis multiple values are OR; axes are AND; dimensions match any declared wrapper/asset class in their corresponding sets. No absent-selector wildcard. Unresolved dimensions/owners cannot silently satisfy the selector. For unresolved legacy or observed accounts, determine potential membership conservatively: a confirmed fact that contradicts any selected axis excludes it; otherwise an unknown axis makes it potentially in scope and blocks confirmation. A default self owner, name heuristic or missing dimension is not a confirmed contradiction. Explicit exclusions must identify the candidate and reviewed reason; unresolved candidates cannot be hidden behind a guessed canonical ID.
- A sorted set of included expected account IDs, and explicit exclusions with reason and review basis. Exclusions define the claimed scope and remain visible; they do not remove observed evidence.
- `inventoryDigest` and `digestVersion`, binding the receipt to the semantic inventory projection described below, including membership, selectors, exclusions, all selected primary fields and bindings, and the bound legacy fields that affect identity, ownership, lifecycle or history requirements (provider, exact label/token, explicit owner/wrapper/asset class, multiCurrency, openedOn/retired/retiredOn/historyFrom). Receipts do not authorize writes, attest balances, establish settlement or prove historical coverage.

Digest v1 uses SHA-256 of canonical JSON: recursively lexicographic object-key order, UTF-8, no whitespace, arrays sorted only where this design defines a set (IDs, selectors, exclusions by ID, bindings by section/provider/label, requirements by kind/policy/historyFrom, dimensions). Preserve exact string values; reject duplicate set entries. Exclude review receipts themselves, map ordering, formatting, unrelated anchors/balances and generated observations. Include all explicit primaries matching the scope, not just the receipt's claimed included list: adding a matching account must invalidate the old receipt. Include referenced exclusion metadata and a deterministic declaration of unresolved legacy registrations potentially in scope. These unresolved registrations prevent confirmation rather than being hashed away.

A receipt is usable only when dates are valid and not future relative to the projection clock, the digest version is supported, the recomputed digest matches, and included/excluded IDs exactly partition known matching primaries with no overlap. An unresolved legacy/observed account potentially in scope or ambiguous binding blocks a confirmed result. Excluding an account is not a way to claim all accounts for that owner/provider; the displayed scope must name that exclusion.

Proposed review states:

| State | Meaning |
| --- | --- |
| unavailable | Map missing/unreadable, unsupported metadata version or invalid top-level shape. Observed-only rows can still be shown, but expected counts are unavailable. |
| unreviewed | Valid map, no usable review covering the requested scope; includes legacy-only maps. |
| outdated | A formerly applicable receipt no longer matches the current semantic inventory. |
| conflicted | Duplicate IDs, contradictory ownership/bindings, overlapping inconsistent receipts or unresolved in-scope registrations prevent a unique interpretation. |
| reviewed | Exact receipt scope, semantic digest and date requirements pass, with explicit exclusions and no unresolved potential members. This is an owner attestation at that scope/date, not provider verification or evidence completeness. |

Never combine two narrower receipts into an implicit larger review. Require an exact normalized scope/exclusion match for the requested review. Among valid receipts for that same scope choose latest `reviewedAt`; different content at the same latest timestamp is conflicted. Use an injected `asOfDate`/clock, never a hidden local-time interpretation. Do not invent a calendar expiry period. Instead, require temporal scope to match: a receipt applies to its own `asOfDate`, not every later requested date. For the requested projection, require receipt `asOfDate` equal to projection `asOfDate`, with `asOfDate` not after the UTC date of `reviewedAt`, and `reviewedAt` not after the injected clock. A valid older receipt remains a historical reviewed receipt but the requested later scope is `unreviewed` with `historical_receipt_only`, and its confirmed denominator stays null. A future receipt cannot certify an earlier date. This conservative first contract deliberately avoids treating a dated inventory review as ongoing completeness.

Only observations with a trustworthy observation/evidence date on or before the requested `asOfDate` can determine that date's population or freshness. Undated observations are potential members, never proof that an account existed or was current then. An observation demonstrably after a historical receipt date appears in a separate later-observation list and does not retroactively invalidate that historical receipt. The historical inventory also needs matching pinned semantic inputs: do not reconstruct an earlier inventory by subtracting current rows. Changed current metadata makes an old receipt outdated unless the matching read-only snapshot is supplied. These are pure input rules, not authorization to restore or fetch a snapshot. For current/as-of review, unresolved eligible observations can block confirmation even when the map digest is unchanged.

## Pure read-projection contract

Proposed interface, to be implemented only after separate approval:

```ts
projectAccountInventory({
  mapRead,             // available value, missing, invalid or read_error
  observations,        // existing read-only adapters; no I/O in the pure projector
  evidenceSignals,     // typed source/period/freshness/reconciliation facts
  requestedScope,
  asOfDate,
  clock,
  adapterVersion,
}): InventoryProjectionV1
```

The result carries `schemaVersion`, `asOfDate`, `adapterVersion`, map fingerprint/read state, scope/review state and reason codes, rows and counts. Rows retain canonical ID or legacy/observed key, aliases, identity/owner/lifecycle state, discovery class (`expected`, `legacy_registered`, `observed_only`, `unresolved`), scope membership (`included`, `excluded`, `unresolved`), required-source assessments, evidence references and next review action. Discovery classes partition rows after unambiguous binding; expected plus observed is one expected row with attached observations, not two rows.

Counts specify their population: known expected IDs, observed-only groups, unresolved groups and legacy registrations; confirmed scope denominators are null unless review is `reviewed`. Evidence counts are per required kind as well as per account, and never include generic price-feed health as an account. A declared empty reviewed scope can have zero expected accounts with an explicit empty-scope label; unavailable/unreviewed inventory cannot become a successful zero. Do not publish a coverage percentage.

Read failures retain their own reason codes. The pure projector cannot mutate map/DB, generate IDs, open original files, rehash originals, call a provider, refresh a cache or send a reminder. The adapter can read existing generated receipts and metadata and label those as recorded provenance, not newly verified current bytes. Evidence references use existing source IDs/relative references and existing review routes; no arbitrary-path evidence endpoint.

## Required-source and missing-evidence rules

A required kind must have an explicit supported freshness policy and semantics. Default provider-specific profiles may be proposed as review candidates, but are not silently activated requirements for legacy rows. Reuse existing policy thresholds; changing cadence requires a separately reviewed policy change. Requirements and any explicit history start are part of the inventory digest. For a bound bank activity requirement, existing `bankAccounts[].historyFrom` is the existing explicit requested start: if only it is set, reuse it with legacy provenance; if both it and `inventory.requirements[].historyFrom` are set, they must be equal. Unequal or invalid supplied starts produce `history_requirement_conflict`, no selected historical interval and a review action. Do not take the earlier/later date or change #314 reminders. Multiple bound registrations with differing starts also conflict. With neither start, history is `not_requested`. This bridge applies only when an activity requirement is explicitly present; merely having a legacy gap signal does not activate a new inventory requirement. Resolving a mismatch requires a separately reviewed private map change.

| Source assessment | Deterministic condition | Next action |
| --- | --- | --- |
| not_required | No approved requirement for this kind; never infer from absent rows. | Show scope/requirement decision if needed, no file request. |
| unsupported | Required kind or freshness policy has no supported identity-bound reader. | Explain adapter limitation; do not report as missing download. |
| conflicting | Identity-bound evidence has contradictory hashes/periods/account attribution or the existing receipt reader reports conflict. | Review conflict before requesting replacement or choosing a date. |
| missing | A supported required kind has no bound artifact or explicit empty/quiet evidence. | Name the required kind and existing intake route; history range only if explicitly known. |
| unconfirmed | An artifact/observation exists but its required period, exact account binding or date basis is not established. | Confirm existing evidence first; no automatic download demand. |
| stale | Valid evidence exists but age exceeds the referenced existing policy. | Use its supported update action and known overlap window. |
| due_soon / current | Valid evidence lies within the existing policy window. | No immediate download request. Does not imply full history. |

Keep identity/owner/lifecycle conflicts outside source assessment rather than assigning one ambiguous artifact to several candidate accounts. Such rows have unconfirmed source assessments with an identity/owner/lifecycle reason and a review action; they do not count toward confirmed source coverage. For multiple independently required artifacts, assess each independently; one current snapshot cannot hide missing activity. The account action projection gives review conflicts precedence, then missing/stale needs, then unconfirmed review, then due-soon/current, while retaining every constituent reason. Do not overwrite existing `AccountCoverageStatus` or reminder behavior in the first increment.

Historical interval coverage is a separate axis: `not_requested`, `unsupported`, `unconfirmed`, `gaps` or `covered`. Only an explicit requested interval and identity-bound period evidence can yield `covered`; endpoints, last trades and filenames without a verified period cannot. Restrict intervals to `asOfDate` or confirmed closure date; reversed/future bounds are invalid. Reuse #314 bank `historyFrom`/`historyGap` signals where present and label their bounds. An absent `historyGap` is not proof of full coverage, especially when the reader has no requested end or no periods. Endpoint-only owner confirmations cannot fill historical gaps. Crypto's contiguous-period reader and KR receipt semantics retain their existing limits.

Reconciliation (`pass`, `issues`, `unconfirmed`), valuation date and fetch date remain separate. Existing missing-disposal checks can require action even when freshness is current. Explicit empty holdings establish an empty snapshot only for that account/date/kind, never a closure or absence of transactions. Source omission, balance zero, missing price and unknown quantity must not be collapsed into missing account evidence.

## Compatibility and staged adoption

1. **Design PR (this work):** document the proposed contract and link status/next priorities. No type/schema implementation, metadata edits, test-source changes or deployment.
2. **Later synthetic contract PR:** add versioned types, validation and pure projector with injected clocks and fixtures. Wrap the existing loader with an explicit read-result boundary; retain its legacy semantics. Missing/new metadata remains visibly unreviewed. Preserve old consumers/CLI output.
3. **Later read-only adapter/display PR:** bind existing signals and read-only detail links behind an additive contract. Reuse #312 prompts and #314 historical-bank signals. Keep covered totals, grouping and existing reminder contracts unchanged. Bilingual copy distinguishes inventory review from evidence freshness; do not replace current pages' denominators silently.
4. **Separately authorized private review:** prepare a preview/diff against a pinned current map hash. The custodian reviews IDs, owners, lifecycle, requirements and scope; only an explicitly authorized private map edit records them. A source push/ingest or deployment is a separate operational action, not part of metadata review.

New inputs must not be stripped by a future loader/serializer or unrelated update. Preserve unknown fields on any later authorized rewrite, validate old/new consumers, and verify existing map backup coverage. This design introduces no new durable path or backup configuration. A code rollback ignores optional metadata and leaves records untouched; reverting a private map has separate review/revision requirements. Existing environment overrides keep precedence.

## Synthetic acceptance cases for later implementation

| Case | Required outcome |
| --- | --- |
| Legacy map, unavailable map, malformed map | Existing arithmetic unchanged; new review unreviewed or unavailable, not green empty. |
| Expected primary without any observations | One expected row; supported required kind missing; no fabricated money/holdings. |
| Observed-only account, unsupported registration provider | Visible unresolved review candidate, not auto-registered or silently excluded. |
| Label rename, two aliases, reordered arrays | Stable explicit ID, deterministic output; unresolved alias never guessed. |
| Two accounts at one provider; suffix collision; duplicate primary | No evidence borrowing; conflict remains visible. |
| Multi-currency bank, pension wrapper, gold exposure | One economic account when explicitly bound; totals and existing grouping unchanged. |
| Missing owner, legacy default self, other/joint owner | Owner unconfirmed or excluded from explicit self scope; no change to legacy arithmetic. |
| Zero balance, confirmed empty holdings, quiet statement, closed account | Separate lifecycle and source facts; historical rows retained; no false closure. |
| Missing token, malformed/future closure, retired flag without basis | Adapter/lifecycle review issue; no fabricated closure date. |
| Current positions with missing activity; missing disposal | Per-kind assessment and action remain visible even if one signal is current. |
| Fresh endpoint with earlier bank gap or unknown requested end | Freshness separate from history; reuse #314 signal, never infer covered from absent gap. |
| Conflicting receipt, invalid date, outdated hash | No arbitrary evidence selection or period confirmation. |
| Added/removed primary, edited owner/binding/requirements/scope | Digest changes; prior review outdated; private file never rewritten automatically. |
| Formatting, array order, unrelated balance/anchor changes | Semantic digest stable; evidence freshness may independently change. |
| Narrow receipts, future receipt, same-time conflicting receipts | No implicit scope union; invalid/conflicted review with reasons. |
| Historical receipt with later/undated observations or changed metadata | No current-completeness claim or retroactive population invention; eligible potential members block review, later evidence stays separate, and historical digest inputs must match. |
| Legacy and inventory history starts differ | Explicit history_requirement_conflict; no silently selected period or change to #314 reminders. |
| Valid empty attested scope versus missing map | Explicit reviewed zero versus unavailable denominator. |

Implementation acceptance requires actual fixture tests, adapter parity and English/Korean read-only presentation checks. This design PR verifies document links and source alignment only; it does not claim those tests exist or pass. Operating owner review, current-byte source checks, physical-device access and deployment retain their separate evidence requirements.

## Open owner decisions and preserved holds

No owner input blocks drafting this design. Actual account IDs, ownership, lifecycle, exclusions, required histories and attestation scope remain private decisions to review from concrete previews later. No current operating inventory is declared complete by this document. Hometax is not a prerequisite; accepted historical tax returns remain untouched. Preserve financial records, original evidence, approved-device web access and disabled web writes throughout every stage.
