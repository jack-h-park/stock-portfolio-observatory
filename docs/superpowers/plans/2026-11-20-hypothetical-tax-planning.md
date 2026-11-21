# Hypothetical annual tax planning implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans and one final whole-branch review. Keep this complete journey in one PR.

**Status:** Merged in #371 and deployed with #369; [bounded operating acceptance](../../operations/installation-status.md#annual-review-and-hypothetical-planning-release-acceptance-november-20-2026) is recorded separately from the local source checks below. Further deployment and real-input adoption remain held.

**Goal:** Finish the selection-to-result-to-recorded-context journey for explicitly invented 2025 US/KR inputs.

**Architecture:** Reuse the accepted [completion plan section 5](2026-11-20-personal-finance-completion.md#5-required-second-packet-bounded-krus-estimate-planning), existing pure calculators and pinned packs. A server-only pure application module selects bundled hypothetical inputs, validates them and calls component/reference calculators. A read-only planning subroute uses GET selection, with an entry on the current planning screen. No stored policy, DB, tax history, evidence reader, importer, composition approval or comparison is consulted by the new preview.

**Tech stack:** Existing Next.js, TypeScript, shared UI/copy and node:test; no new dependencies.

## Scope and decisions

The accepted design permits entering or selecting hypothetical sets. Choose bundled selection in this MVP: exact inputs, assumptions and identity remain reproducible without suggesting a real profile was reviewed. Editable custom inputs require a later explicit input/provenance design; they are not necessary for this packet. Rebuilding calculators or integrating private inputs would add unsupported scope. Existing investment planning is preserved and labelled separately.

US scope: single/joint ordinary method, existing eligible QDCG Schedule D and distributions-only branches, plus NIIT. Results remain components-only, never a complete annual total. KR scope: national/local exact rational schedule references, including fractional KRW; reported quantization, annual components and actual comparison remain blocked. No implicit deductions, foreign credits, currency conversion or global total. Year is pinned to 2025; unsupported selection never defaults to a valid scenario.

## Work and acceptance

- [x] Add pure selection/orchestration and tests: ordinary/QDCG/zero/KR national/local/fraction, missing base, unsupported method/year and currency mismatch. Preserve input/result hashes, provenance, component traces, annualTotal=null and comparisonEligible=false. Unknown never becomes zero; selection mutation cannot change bundled examples.
- [x] Integrate `/tax-planning/annual` and current planning entry with typed bilingual copy, native units, requirements/assumptions/exclusions before results, technical trace/input details, unavailable explanations and scoped recorded-context links. GET only; no save, import, upload or comparison action.
- [x] Test static bilingual output and navigation plus full suite/typecheck/lint/UI guardrails/sample build. Walk the built synthetic app on desktop/narrow, keyboard and both languages; inspect settled screenshots. Obtain whole-branch source review and fix blockers inside this packet. Published #371 with passing CI; merge and combined operating acceptance are now recorded separately.

## Review focus and preserved gates

Malformed/array/unknown example parameters have bounded unavailable output, never fallback. KR exact fractional values cannot be rounded or formatted as filed money. A zero component is distinguishable from a missing input. Synthetic unit IDs never select an operating taxpayer. Recorded-context navigation is separate from numerical comparison. Tests cover each boundary.

Actual 2025 comparison remains blocked; all real facts/originals/mappings/unresolved decisions, classifications/reminders, access and disabled web writes stay untouched. Automatic briefing remains paused; generation, publication, Hometax and further deployment remain held. #369/#371 are verified merged with bounded operating rollout; owner routine acceptance remains separate.

## Local source acceptance, November 20, 2026

The final isolated synthetic checkout passed 2,083 tests, with 14 skipped and zero failures (2,097 total), TypeScript, lint, UI guardrails and production build. Seven integrated tests cover selected input/result identity, inherited arithmetic, two QDCG branches, single/joint profiles, explicit zero, missing/unsupported/currency/year rejection, exact KR fractions, context links and visible bilingual blocker reasons. Existing calculator and rule-pack code is unchanged. An independent review's missing-visible-reason finding was reproduced with a failing bilingual test, fixed inside this packet and re-reviewed with no remaining blocker.

The built localhost walkthrough used only seeded invented private-mode roots with web writes disabled. The existing planning entry opened the preview; all twelve named sets were selected and submitted with keyboard Enter, with expected results/unavailable states. Repeated selection was rejected. English desktop (1280 px), Korean narrow (375 px), and light/dark screenshots were inspected. The recorded-context link carried only year/authority, reached read-only history and never supplied the invented tax unit. No non-GET/HEAD request occurred; synthetic history and DB hashes were unchanged through that journey. No operating service, private input or original was accessed. Local browser proof is not deployment, physical-device or assistive-technology acceptance.

The delivered source scope is a selectable, reproducible component/reference planner, not editable custom input, a full annual return or actual financial adoption. The actual comparison gate and all operating holds remain intact. The later #371 merge and bounded combined release are complete; owner acceptance and any reviewed real-fact adoption remain separate decisions; broader tax methods and full financial completeness are not claimed.
