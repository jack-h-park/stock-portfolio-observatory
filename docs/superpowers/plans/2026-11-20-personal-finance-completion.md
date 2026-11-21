# Personal Finance Observatory product completion plan

**Date:** November 20, 2026 (America/Los_Angeles)
**Status:** Accepted in #367. Packet 1 (#369) and packet 2 (#371) are merged and deployed with [bounded operating/browser acceptance](../../operations/installation-status.md#annual-review-and-hypothetical-planning-release-acceptance-november-20-2026). Owner routine acceptance, actual financial completeness and any new real-fact adoption remain separate. Actual 2025 comparison and all current operating holds remain intact; this documentation update authorizes no further deployment.
**Governing design:** [Original product and architecture design](../specs/2026-11-10-personal-finance-observatory-design.md). This plan resets the remaining sequence, not the original purpose or accepted financial facts.

## 1. Finish the product, not the maintenance queue

The product is a personally operated, publicly reusable observatory that answers three questions: what is owned and how current is that view; what is estimated, reported and actually settled in KR/US taxes; and what evidence and unresolved assumptions support those answers. Public code and synthetic execution remain separate from private originals and durable operating state.

The target is one coherent user journey, not a perfect inventory or a universal tax engine. A person can start at the financial overview, inspect the relevant asset scope and dates, open an annual tax review, distinguish recorded filing figures from actual cash events, reach the supporting record/evidence and understand the next unresolved action. A visible unknown is an acceptable product result; an invented zero, hidden omission or unsupported confirmation is not.

Implementation will use the existing Next.js application, tax-history store, projections, sample mode and routes. No monorepo, service split, replacement framework or new database server is needed. Expenses/budgeting, automatic filing/payment, universal cross-border computation and trading remain outside this program.

## 2. Completion criteria and honest delivery levels

| User outcome | Acceptance observable | What does not count as completion |
| --- | --- | --- |
| Understand supported assets | Existing overview and total-assets views explain owner/currency scope, valuation dates and material omissions; the reader can reach relevant source/history issues without interpreting raw adapter output | A new account count, every candidate owner confirmed, or another coverage widget |
| Understand one tax year | A coherent year/tax-unit/authority view distinguishes estimate availability, reported/assessed liability, return-reported prepayments/refund requests and evidenced settlements, with the appropriate links | Calculator modules or disconnected cards alone |
| Know what was actually paid or refunded | Payment-date and tax-year views agree on included recorded events; a reported prepayment or requested refund cannot become a received/payment event by display or arithmetic | Treating a filed return, a refund request or missing receipt as cash settlement |
| Explain trust and next action | A displayed amount leads to its versioned record/evidence; unknown basis, receipt, query period or unsupported method names the missing fact without blocking unrelated known facts | Requiring every historical gap, owner decision or role assignment to be closed before anything is useful |
| Run publicly and operate privately | Synthetic examples demonstrate the whole journey with no private source dependency; private adoption preserves originals, revision/audit history, access and disabled web writes | Local tests presented as deployment, or a source PR presented as owner acceptance |

Track three delivery levels separately for each packet: source-ready (integrated synthetic behavior), operating-ready (bounded installation/read-only observation after authorization) and owner-accepted (the scoped real workflow reviewed with available facts). No percentage-complete score is assigned. Actual financial completeness is a separate claim from a usable source-ready product.

## 3. Reuse the work already completed

- Definition/branding, compatible private roots and synthetic execution are implemented. Physical archive relocation and GitHub slug changes are not prerequisites.
- Supported all-assets views, historical gold correction, date/coverage disclosures and the summary/detail distinction between source freshness and historical gaps have bounded operating evidence. Do not build another summary or redo those adapters by default.
- Tax history, revision/audit-protected import, record/evidence access, tax-year/payment-date views and recorded annual summary already exist. Reuse `TaxHistoryScreen`, `AnnualTaxSummary`, `FinanceTaxSummary` and their projections/routes.
- 2025 rule references, bounded components, federal composition, comparison adapter/CLI and synthetic tests exist. The actual 2025 comparison remains blocked; more infrastructure is not a substitute for supported real inputs.
- Backup scope expansion, first capture and scoped isolated recovery have bounded acceptance. Publication splitting and inactive producer installation are complete. No repeated backup, restore, permission audit or publication work is a default prerequisite for the next source packet.
- #365 is verified merged as `a39a054fcfef01a511ce4bfbaf9257a94992f2fb`; it reconciles the dedicated freshness tone map in source. It is no longer a pending implementation task, and its merge authorized no additional rollout.

The November 20 private account review found current investment rows alongside distinct stale, historical-gap, unknown-period and no-recorded-data bank cases. It retained prior identity/source confirmations and all unapplied owner/lifecycle decisions. The follow-up CSV inspection found no accepted explicit query-period declaration for its three target bank sources. These are bounded observations, not a complete source inventory or authority to edit/import. Private identifiers and source inventories do not belong in this plan.

## 4. Next integrated packet: annual tax review

**Priority at approval:** First integrated implementation packet. It is now merged and has bounded operating acceptance; the contract and acceptance journey below retain their original scope. Complete account inventory was not its prerequisite.

**User outcome:** For one selected year, tax unit and authority, a reader can explain what the return says, what cash settlements have evidence, what remains unknown and which evidence record supports each fact, starting from the financial overview and returning through existing navigation. The estimate area remains visibly unavailable where its supported-input gate fails; no actual 2025 estimate or comparison is calculated.

**Delivery unit:** One reviewable end-to-end source package, normally one PR containing the necessary model/validation, projection, UI, synthetic examples and documentation together. Do not ship separate public-facing foundation-only, helper-only, type-only and UI-only milestones for this bounded packet. Split only if a concrete coupling, review-size or safety constraint requires it, and state how the split still ends in the same acceptance journey.

### Contract decisions the packet must implement together

| Fact | Source of truth | Projection/display rule |
| --- | --- | --- |
| Reported liability | Existing versioned return/assessment and reviewed effective basis | Retain present reconciliation/basis semantics; do not select a new real basis automatically |
| Return-reported prepayments and requested refund | Optional structured facts attached to the exact return version, in the obligation's native currency, with supporting evidence | Missing remains unavailable. These are statement facts, never settlement events or automatic offsets in cash/outstanding reconciliation |
| Actual payment/refund | Existing reviewed settlement events and allocations | Preserve occurrence versus posting dates, unallocated/undated cases, reversals and principal/interest/penalty separation |
| Estimate/comparison | Existing scope/eligibility contracts | In this packet, expose existing availability or an explicit unavailable/blocked reason only; do not add a real-input calculation/comparison action. Any synthetic reference result stays inside the clearly labelled synthetic demonstration. Do not call the actual 2025 comparison or relax its gate |
| Unknown versus confirmed zero | Explicit optional value plus existing review/evidence state | Absence never becomes zero. A supported explicit zero remains distinguishable from missing evidence |

Before code, pin the small additive return-facts input/result shape, validation rules and backward-compatible behavior within this same packet's design. Existing `TaxReturn` has a liability/evidence contract but no structured return-reported prepayment/refund fields; `getAnnualTaxSummary` already projects reviewed settlement buckets. Extend only that missing distinction, rather than creating a parallel tax ledger. Preserve native units and integer minor-unit money; do not invent an authoritative KRW/USD global tax total.

Do not extract new facts from the accepted 2025 v5 documents or convert old free-text notes into canonical money fields during source implementation. Synthetic inputs demonstrate the extension. Existing operating records keep their available fields and unknowns until a separately reviewed, revision-checked adoption is authorized. A requested refund with no settlement receipt must still be useful to display without claiming it was received.

### Acceptance journey and tests

1. Open the financial overview and follow the existing tax entry into a selected tax year/unit/authority. Reuse the current surfaces; add navigation only if a demonstrated break prevents the journey.
2. See reported/assessed liability, reported prepayments/refund request and actual settlements as separately named facts. A synthetic filed return with a requested refund and no refund receipt shows the request and an unknown actual refund, not received cash or zero.
3. Open the exact record/evidence behind each recorded figure, then inspect the payment-date history. Synthetic same-tax-year events in another cash year, a reversal, an unallocated/undated event and a superseded/stale basis remain distinct.
4. A legacy store with no new reported facts renders unavailable fields and leaves prior reconciliation amounts, revisions and import no-op behavior unchanged. No automatic migration or write occurs on read.
5. Missing/unreadable/hash-mismatched evidence and unsupported estimate methods show bounded reasons. Known recorded facts remain visible; the actual 2025 comparison stays blocked.
6. Verify the complete synthetic journey in both languages, narrow/desktop layouts and appropriate keyboard/access states, together with meaningful domain/import regressions, full tests and sample build. Use the shared Studio UX contract before any future UI work.

**Done:** The integrated source package demonstrates all six cases and includes a concise owner-facing explanation of what the view can and cannot answer. Private adoption, merge, deployment and real browser acceptance remain separate recorded gates. An unavailable actual estimate or missing settlement receipt does not fail source readiness when correctly represented; it does remain an unresolved financial fact.

## 5. Required second packet: bounded KR/US estimate planning

This required product outcome is now implemented, merged and deployed within its bounded hypothetical scope. It followed annual review and reused the existing rule/component contracts as described in the [packet plan](2026-11-20-hypothetical-tax-planning.md). The acceptance below defines that delivered scope; further operating adoption and real scenarios remain separately held.

**User outcome:** A reader can enter or select explicitly supported hypothetical inputs, understand the rules and exclusions, obtain a reproducible bounded calculation where supported, and understand whether/how that result relates to recorded tax history. The result must never masquerade as a filed amount, actual settlement, complete cross-border liability or an approved actual 2025 comparison.

**Delivery unit:** One coherent source package containing the eligible-input contract/pure orchestration, rule/coverage explanation, existing-planning-surface integration, deterministic synthetic cases and acceptance walkthrough. Do not repeat existing calculators, add an estimate service or build an actual-data integration merely to bypass the eligibility gate.

Acceptance journey:

1. Select a supported jurisdiction/year/method and a labelled hypothetical input set. Pinned 2025 rules are the agreed calculation basis. Synthetic examples never appear as actual private financial figures; web record editing/saving stays disabled. The real 2025 filing is not loaded, reassessed or compared.
2. Before a result, see input requirements, filing/tax-unit scope, rule version, currency, included components and exclusions. Missing/unsupported inputs produce a bounded unavailable result with reasons, never an implicit zero or fallback to a special method.
3. For supported US cases, existing ordinary-income/NIIT and eligible qualified-dividend/capital-gain contracts produce their tested scoped results. For KR, distinguish the existing exact calculated-tax reference from the unverified reported-tax quantization; keep blocked reported/annual components blocked. A separately labelled reference estimate may use only its already accepted contract, never an invented Hometax rule or bypass of a blocked annual method.
4. Show reproducible inputs/rule version beside each permitted result and retain USD/KRW and authority boundaries. Do not sum them into an authoritative global tax bill or automatically apply foreign tax credits.
5. Reach relevant recorded year/authority context without generating an estimate-versus-return difference unless all existing comparison requirements and execution authorization are met. In this program's current held scope, the actual 2025 comparison remains unavailable even when a synthetic calculation succeeds.
6. Demonstrate these paths with deterministic synthetic US/KR examples, a missing-input case, unsupported method, known-zero-versus-unknown, cross-currency mismatch and unavailable actual comparison. Verify the whole bilingual responsive planning journey, not just unit arithmetic.

**Done:** The supported planning journey and its limits are understandable end to end. Any still-blocked KR reported amount remains clearly blocked, not presented as full KR filing support. The product completion review records the exact supported scenario set and remaining exclusions. Broader methods require a future explicit product decision, not silent expansion.

## 6. Operating adoption and parallel account work

| Work package | Product outcome | Dependencies / stop condition |
| --- | --- | --- |
| Owner acceptance and any further bounded adoption | Both source packets already have bounded operating acceptance; confirm the personally useful routine and scope any materially necessary real-fact adoption | Owner acceptance is separate from release proof. Any new release needs authorization and current serving-source review. New real return facts need an evidence-linked import preview at current revision; no adoption by plan or deployment alone |
| Account/source completeness improvements | Resolve specific material identity/scope or missing-period questions that change interpretation of a real total | Batch owner decisions and source actions; preserve established identity/confirmation evidence. Draft/preview first, then separately authorized acquisition/import/mapping changes. No complete-account denominator from legacy row counts |

Account/source work can progress independently when authorized, but should not displace the required annual review or estimate journey merely because a CSV date is unknown. Add a source task to the critical path only when it blocks a specific acceptance case or changes a material amount's interpretation.

## 7. Operating gates are boundaries, not an endless prerequisite queue

- Data, originals, account mappings, unresolved owner/lifecycle/curator facts and current access/web-write settings stay untouched. Existing combined classifications, actions and reminders are preserved.
- Actual 2025 comparison stays blocked. Automatic briefing stays paused; actual generation, archive writes, briefing web publication, automatic resumption, Hometax and additional deployment remain held.
- Record the observed owner-account versus former reviewed-device access-policy difference. Do not change access or notice wording from this plan; resolve the intended policy when an actual access change is separately scoped. Do not turn a global gateway-policy review into every finance packet's prerequisite.
- Inspect an ordinary scheduled backup receipt when that operational check is authorized. Do not trigger another capture or restore simply to produce planning evidence. Reopen durability validation only for changed persistent state, changed backup scope or an actual recovery acceptance need.
- Keep previous release/recovery material and active worktrees until their review/follow-up/retention conditions permit cleanup. No cleanup is authorized here.

## 8. Work management and scope control

Use one acceptance checklist for the active packet, tied to the user journey above. Report source/merge/operating/owner acceptance separately and update status when crossing those boundaries. A PR count, green tests or a merged helper is not a product milestone.

Route newly found issues into three lanes: must fix for the packet's acceptance or a concrete data/security risk; necessary later with a named outcome; optional maintenance. Keep minor copy, color, alias and metadata improvements in the active packet when they are required, otherwise park them. Do not automatically promote every discovered imperfection into the next PR or repeatedly request confirmation for choices already authorized.

Complete the active authorized package without repeated intermediate approval loops. Ask only for a consequential missing product/financial decision or an existing execution hold. Implementation planning does not authorize real-data execution; authorization once granted applies through its concrete verification boundary.

## 9. Deferred scope and completion review

Liabilities/complete net worth, broad spending/budgeting, archive migration, repository/host/job renaming, service extraction, connector economic promotion and comprehensive tax methods remain deferred. Preserve total-assets wording until liabilities have separately evidenced support. No structural rewrite is justified by the new product name.

Annual-review acceptance closes that packet only. Final bounded program acceptance reviews both required journeys against all five outcomes in section 2, together with separately authorized operating and owner walkthroughs. List unsupported calculation methods and unresolved real financial facts explicitly; do not declare full financial completeness. The authorized combined rollout now has dated operating acceptance; owner acceptance and further adoption remain separate. Do not extend that walkthrough to later builds merely from source presence. The next decision should be which product outcome to finish or adopt, not which internal helper to add.

## 10. Bounded delivery checkpoint: November 20, 2026

Both integrated packets have completed implementation, merge and the separately authorized operating walkthrough. The combined selective release, preserved financial/control boundaries, candidate suite, evidence hashes and twelve hypothetical cases are recorded in [installation status](../../operations/installation-status.md#annual-review-and-hypothetical-planning-release-acceptance-november-20-2026). A later installed-source observation is separate from that release's full acceptance.

| Completion-plan outcome | Delivered within scope | Still separate |
| --- | --- | --- |
| Supported asset scope/date visibility | Existing all-assets and source/history surfaces, with dated operating evidence | Complete inventory, liabilities and private source acceptance |
| One recorded tax-year review | Integrated version/evidence/cash navigation and explicit unavailable real estimates | Missing structured facts and settlement/authority confirmation |
| Know recorded payments/refunds | Existing tax-year/payment-date projections preserve dates, allocations and unknowns | Financial completeness; no receipt is inferred from a requested refund |
| Explain trust and next action | Exact record/evidence links, rule/input identity and unsupported/missing reasons | Owner understanding and acceptance of the routine |
| Public execution/private operation | Synthetic examples plus protected private operating walkthrough | New adoption, broader methods and wider recovery/consumer claims |

The required hypothetical journey is selection-only: reproducible invented US components and exact KR schedule references, with no full annual bill, reported KR amount or actual filing comparison. Its successful deployment does not make those excluded outputs available.

Next priorities are [owner routine acceptance, one material input/decision package, then bounded steady-state evidence](../../product/next-increment.md). Preserve unknowns and all execution holds. Do not turn this checkpoint into another helper, coverage widget, backup drill or automatic actual comparison. A future feature must serve a named material outcome or resolve an observed acceptance obstacle.
