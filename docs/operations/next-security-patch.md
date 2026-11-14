# Next.js security applicability and minimum source patch

Assessed November 13, 2026 (America/Los_Angeles). This is a source-only patch and read-only applicability assessment. No production exploit request, deployment, restart, access change or financial-data operation was performed. Operating acceptance is separate from a passing source build or registry audit.

## Reported advisories and observed conditions

| Advisory | Published conditions / mitigation | Observed application boundary |
| --- | --- | --- |
| [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw), critical | Upstream image-optimization memory vulnerability on glibc-based Linux. The advisory identifies sharp >=0.35.5 as a workaround and Next.js 15.5.28 as a patched release. | Observed owner host is Darwin, not glibc Linux; Next's resolved sharp is already 0.35.5 via the existing override. This does not match the published vulnerable platform, and the dependency workaround is present. No claim about every other installation or an exploit test. |
| [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r), high | App Router applications with at least one Server Action can incur excessive CPU usage from crafted requests. The published remedy is upgrade; applications without Server Actions are outside its scope. | This application uses App Router and Server Actions, including tax, tax-settings, tax-planning and rebalance actions. The existing approved-device gateway narrows reachability; disabled tax-history writes do not remove the framework request-processing condition. No live denial-of-service probe was attempted. |

Read-only observation found installed Next.js 15.5.27. The package/lockfile also resolved 15.5.27. The current next.config.mjs sets only the existing better-sqlite3 external-package option; this patch introduces no image/action configuration or additional access surface. Absence of custom SVG settings alone is not used as proof of immunity. Existing gateway policy and application write restrictions remain unchanged.

## Minimum candidate

Raise the existing next requirement from ^15.5.27 to ^15.5.28 and explicitly resolve 15.5.28 in the lockfile, together with its matching @next/env and platform SWC packages. Keep React, eslint-config-next, the sharp override and unrelated transitive resolutions unchanged. A generic range install initially selected a newer patch; the candidate explicitly selects the advisory's first fixed 15.x release to keep this change bounded.

The pre-patch package-registry audit reported one critical, one high and two moderate findings. The candidate audit reports zero critical/high and two remaining moderate findings. This is a branch-lockfile result, not closure of default-branch alerts or proof that operating code was upgraded. No synthetic assertion is added merely to mirror a dependency version; package resolution/audit plus the existing application regression/build checks validate this change.

The two remaining transitive moderate findings are outside this minimum Next.js patch. Classify their paths and compatible resolutions separately; do not describe the candidate as free of every dependency advisory. All audit/source evidence uses package metadata only; financial records and credentials are not test inputs.

## Verification and rollout boundary

Use only isolated synthetic roots and the existing typecheck, lint, complete tests, UI guardrails and production-build checks. Do not seed sample data against a configured private checkout or mutate a shared dependency directory. The patch worktree has its own dependency installation; the previously shared node_modules link was removed without modifying the original checkout's installed packages.

The source patch is prepared for review only. Hometax and deployment remain held. Operating Next.js remains at the separately observed version until an explicitly authorized installation/restart and live validation. Dependency alert closure on main, source merge, installed version and serving behavior must be reported separately.

## Candidate check results

The isolated public-source fixture passed typecheck, lint, UI guardrails and the sample production build. The complete CI-equivalent Python profile ran all 1,338 existing tests with 1,324 passed, 14 optional cases skipped and zero failures; test source was unchanged. Local test execution used bounded concurrency and a short temporary-path alias for macOS IPC sockets, with actual temporary storage retained under the task artifact root.

An additional Python profile with optional openpyxl enabled produced 1,332 passed, five skipped and one notes-count assertion failure in the bank-statement workbook tests. The exact failure reproduced on unchanged base source and original Next.js 15.5.27. It is a recorded pre-existing optional-profile discrepancy, not claimed fixed or silently omitted from the validation report. No bank parsing or financial test was changed in this dependency patch.
