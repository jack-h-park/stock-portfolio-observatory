# Next.js security applicability and minimum source patch

Assessed and released November 13, 2026 (America/Los_Angeles). The original source assessment and candidate checks below preceded the separately authorized #311 merge/deployment. The release outcome is recorded separately below; this documentation update performs no deployment. No production exploit probe was attempted.

## Reported advisories and observed conditions

| Advisory | Published conditions / mitigation | Observed application boundary |
| --- | --- | --- |
| [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw), critical | Upstream image-optimization memory vulnerability on glibc-based Linux. The advisory identifies sharp >=0.35.5 as a workaround and Next.js 15.5.28 as a patched release. | Observed owner host is Darwin, not glibc Linux; Next's resolved sharp is already 0.35.5 via the existing override. This does not match the published vulnerable platform, and the dependency workaround is present. No claim about every other installation or an exploit test. |
| [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r), high | App Router applications with at least one Server Action can incur excessive CPU usage from crafted requests. The published remedy is upgrade; applications without Server Actions are outside its scope. | This application uses App Router and Server Actions, including tax, tax-settings, tax-planning and rebalance actions. The existing approved-device gateway narrows reachability; disabled tax-history writes do not remove the framework request-processing condition. No live denial-of-service probe was attempted. |

The pre-patch read-only observation found installed Next.js 15.5.27. The pre-patch package/lockfile also resolved 15.5.27. The current next.config.mjs sets only the existing better-sqlite3 external-package option; this patch introduces no image/action configuration or additional access surface. Absence of custom SVG settings alone is not used as proof of immunity. Existing gateway policy and application write restrictions remain unchanged.

## Minimum candidate

Raise the existing next requirement from ^15.5.27 to ^15.5.28 and explicitly resolve 15.5.28 in the lockfile, together with its matching @next/env and platform SWC packages. Keep React, eslint-config-next, the sharp override and unrelated transitive resolutions unchanged. A generic range install initially selected a newer patch; the candidate explicitly selects the advisory's first fixed 15.x release to keep this change bounded.

The pre-patch package-registry audit reported one critical, one high and two moderate findings. The candidate audit reports zero critical/high and two remaining moderate findings. This is a branch-lockfile result, not closure of default-branch alerts or proof that operating code was upgraded. No synthetic assertion is added merely to mirror a dependency version; package resolution/audit plus the existing application regression/build checks validate this change.

The two remaining transitive moderate findings are outside this minimum Next.js patch. Classify their paths and compatible resolutions separately; do not describe the candidate as free of every dependency advisory. All audit/source evidence uses package metadata only; financial records and credentials are not test inputs.

## Verification and rollout boundary

Use only isolated synthetic roots and the existing typecheck, lint, complete tests, UI guardrails and production-build checks. Do not seed sample data against a configured private checkout or mutate a shared dependency directory. The patch worktree has its own dependency installation; the previously shared node_modules link was removed without modifying the original checkout's installed packages.

The source patch was subsequently merged and deployed under explicit owner authorization; see the release outcome below. Hometax remains held. Another release requires separate authorization. Dependency alert closure on main, source merge, installed version and serving behavior remain separate claims.

## Candidate check results

The isolated public-source fixture passed typecheck, lint, UI guardrails and the sample production build. The complete CI-equivalent Python profile ran all 1,338 existing tests with 1,324 passed, 14 optional cases skipped and zero failures; test source was unchanged. Local test execution used bounded concurrency and a short temporary-path alias for macOS IPC sockets, with actual temporary storage retained under the task artifact root.

An additional Python profile with optional openpyxl enabled produced 1,332 passed, five skipped and one notes-count assertion failure in the bank-statement workbook tests. The exact failure reproduced on unchanged base source and original Next.js 15.5.27. It is a recorded pre-existing optional-profile discrepancy, not claimed fixed or silently omitted from the validation report. No bank parsing or financial test was changed in this dependency patch.

## Authorized release outcome

[#311](https://github.com/jack-h-park/stock-portfolio-observatory/pull/311) merged as `c1c4ffb739f62effb88b8f6791a8989bec754870` after both CI checks passed. The operating dependency and listening process were verified at Next.js 15.5.28. The release build's manifest bytes matched installed, loopback and owner HTTPS responses. Browser overview/assets/tax-history/record checks and hash-matched private/no-store evidence downloads passed within their tested scope.

Operating financial/data contents, selected original evidence hashes/mtimes, environment, service file and persisted/live gateway were preserved; a transient SQLite SHM mtime-only difference had unchanged bytes. Approved-device access and disabled private web writes remained in place. Normal and spoofed-header non-allowed LAN-source requests returned 403; no physical other-device or exploit test was performed.

The operating release audit had zero critical/high and two moderate transitive findings: postcss-selector-parser through Tailwind and minimatch through ESLint tooling. Their classification/remediation is a separate maintenance increment, not part of the completed framework patch. The optional-profile discrepancy above also remains separately recorded.

The isolated candidate used synthetic inputs. Only the app restarted; no refresh, ingest, collection, source sync, tax import or backup/restore ran. Prior build/dependencies remain retained privately for rollback. The [installation observation](installation-status.md) distinguishes this release's browser proof from the later #312 source/build observation. Detailed private receipts are not public fixtures.
