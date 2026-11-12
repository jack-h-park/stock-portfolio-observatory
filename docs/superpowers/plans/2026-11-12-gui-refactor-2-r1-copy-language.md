# GUI Refactor 2, R1: Copy and Language Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sentence a reader sees comes from `lib/ui-copy/` in both languages, the data layer stops composing interface sentences, and dates, numbers, signs and empty values are formatted by one set of helpers that know the language.

**Architecture:** Four pull requests, each a self-contained slice: (1) the `/fx` page and the shell components, (2) the position detail, daily briefing and crypto premium pages, (3) the adapter layer returning codes instead of sentences plus the data-ops coverage table, (4) formatting helpers and terminology. Each task moves inline text into the page's `defineCopy({ en, ko })` module, keeps the English output byte-identical unless a step says otherwise, and lowers the guardrail baseline for the files it cleans. The counted checks from R0 (`scripts/ui-guardrails.mjs`, `scripts/ui-guardrails.baseline.json`) are the measure of done: G1, G2 and G3 reach zero for the files in scope, and no check rises anywhere.

**Tech Stack:** Next.js 15 app router (async server components), React 19, TypeScript, `node:test` through `tsx --test`, the R0 guardrail script. No new dependencies.

**Spec:** The second GUI refactoring plan (Claude Docs, 2026-10-30), section "R1 — copy and language closure" and the consistency diagnosis, as re-read on 2026-11-12. Decisions 1–3 from its decisions table are applied as recommended: the Korean tax-lot term is 세금 단위 (English stays "Tax lot"), the Korean market-value term is 평가금액, the English position column is "Position". The R0 plan (`docs/superpowers/plans/2026-11-11-gui-refactor-2-r0-guardrails.md`) defines the checks this plan drives to zero.

## Global Constraints

- Repo text (code comments, docs, commit messages, PR titles and bodies) is English only. Korean appears only as copy values in `lib/ui-copy/`, as data the code matches, or as a test fixture.
- No real account names, numbers, amounts, rates or dates from the maintainer's data in any file, comment, fixture, commit or PR text. A sentence that embeds such a figure is deleted, not translated (Task 1 names the one case).
- No new npm dependencies.
- Copy rule: every reader-visible string lives in `lib/ui-copy/common.ts` or `lib/ui-copy/pages/<page>.ts` inside `defineCopy({ en, ko })`. A sentence is built in the copy module as a function of its raw values, never assembled from fragments in JSX (`docs/ui-guide.md`, "Copy"). Both languages must have the same shape; `defineCopy` enforces it.
- Lookup keys stay: a string compared with `===`, used as an object key, a row key or a CSS hook is data, not copy. Translate it at render time through a copy map keyed by the raw value; never replace the literal itself.
- English output is byte-identical before and after a move unless the task step says "wording change". The reviewer checks every removed literal against the `en` value that replaced it.
- The guardrail baseline only goes down. After each task, run `node scripts/ui-guardrails.mjs`; for every file it reports under baseline, run `node scripts/ui-guardrails.mjs --update-baseline` and confirm with `git diff scripts/ui-guardrails.baseline.json` that no count increased. A count that would increase means a Korean value kept an English word (G12) or a sentence moved into a template literal the checks cannot see; fix the value, never the baseline. The one allowed script change is in Task 6 (the G12 finder gains `MCP` and `XLSX` in its allow-list and skips path-shaped tokens), and it is tested before it is made.
- Korean tone follows the existing modules: 합니다체 for sentences, noun phrases for labels, 하세요 for instructions. Terms: 세금 단위 (tax lot), 평가금액 (market value), 평가손익 (unrealized gain/loss), 실현 손익 (realized), 취득원가 (cost basis), 증권사 (broker), 갱신 (refresh), 보유종목 (holdings), 현금 (cash), 거래소 (venue), 스냅샷 (snapshot).
- Product and institution names are not translated in English and keep their established Korean forms (하나은행, 토스증권, 미래에셋, 빗썸). The product name "Personal Finance Observatory" is not translated in either language.
- `tests/copy-registry.test.ts` requires every new top-level copy key to be read by a page; nested keys are not checked, so the implementer confirms by hand that every nested key added is read.
- Gates after every task: `pnpm typecheck && pnpm lint && pnpm test && pnpm ui:guardrails && pnpm build`. If `pnpm lint` fails with `Plugin "@next/next" was conflicted` in this worktree, run `pnpm exec eslint --no-eslintrc -c .eslintrc.json --ext .ts,.tsx app lib components` instead and say so in the report.
- Commit after each task with a conventional subject (`fix(ui): …`, `refactor(ui): …`, `test(ui): …`) and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- A Korean reader of `/fx`, `/data-ops`, `/positions/[market]/[ticker]`, `/daily-briefing` and `/crypto-premium` sees no English sentence except product and institution names, ticker symbols and currency codes (Tasks 1, 3, 4, 5, 6).
- An English reader of the same pages sees the same words as before, except the deletions and wording changes each task names (every task).
- A row whose raw status or kind is not in a copy map still renders the raw value instead of crashing or rendering `undefined` (Tasks 1, 3, 4, 6).
- `tests/briefing-copy.test.ts` keeps asserting that a restated share count is never worded as a trade, in both languages (Task 4).
- A page that reads `fmtDateTime` or `fmtDateShort` without a language no longer compiles (Task 8).
- The tax-settings "updated" date is a calendar date in both languages, not a locale string cut at ten characters (Task 8).
- A saved tax plan from before this change shows a localized month heading, because the heading is formatted from `yearMonth` at render, not read from the stored label (Task 8).
- A zero tax credit reads `₩0`, never `-₩0`, and a zero change reads `0`, never `+0` (Task 9).
- The briefing summary JSON that leaves the machine still carries English freshness sentences after the adapter returns codes (Task 6).

## Delivery

Four pull requests, stacked on the R0 branch until it merges, each from its own branch and each with an English body that describes the mechanism and the deletions, never a figure from the data:

| PR | Tasks | Branch |
|---|---|---|
| R1-1 fx and shell copy | 1, 2 | `worktree-gui-refactor-2-r1` |
| R1-2 positions, briefing, crypto copy | 3, 4, 5 | `worktree-gui-refactor-2-r1b` (from R1-1) |
| R1-3 adapter codes and coverage table | 6, 7 | `worktree-gui-refactor-2-r1c` (from R1-2) |
| R1-4 formatting and terminology | 8, 9, 10 | `worktree-gui-refactor-2-r1d` (from R1-3) |

The controller creates each branch when the previous PR's tasks are complete. The exhaustive line-by-line inventories the tasks were written from are in the SDD workspace (`.superpowers/sdd/<plan>/inventory-*.md`); they are aids, not requirements, and their line numbers go stale as tasks land.

---

### Task 1: The `/fx` page reads every word from `lib/ui-copy/pages/fx.ts`

**Files:**
- Modify: `app/fx/page.tsx`
- Modify: `lib/ui-copy/pages/fx.ts`
- Modify: `scripts/ui-guardrails.baseline.json` (lower only)

**Interfaces:**
- Consumes: `getPageCopy('fx', language)`, `FxDashboard` from `lib/adapters/portfolio-db.ts` (read its type; `summary` has no count of known Mirae rows).
- Produces: new nested copy blocks on `fx`: `eventTypes`, `rateStatus`, `institutionNames`, `exchangeSource`, `outbound`, and top-level `rateUnit`, `actualHint`, `estimatedHint`, `noUnmatchedTransfers`, `unknownCounterparty`, `needsMiraeLedger`. Nothing later depends on them by name.

**Steps:**

- [ ] Read `app/fx/page.tsx` and `lib/ui-copy/pages/fx.ts` in full. Run `node scripts/ui-guardrails.mjs` and note the fx line: G1 30, G2 32, G3 3.
- [ ] Add these keys to `fx` in both languages. English values are the current literals verbatim unless marked (wording change). Korean values are the current Korean literals where one exists; new Korean is given here.

  | key | en | ko |
  |---|---|---|
  | `eventTypes.transferIn` | Transfer in | 이체 입금 |
  | `eventTypes.transferOut` | Transfer out | 이체 출금 |
  | `eventTypes.cancellation` | Cancellation | 환전 취소 |
  | `eventTypes.buyUsd` | Buy USD | 달러 매수 |
  | `rateStatus.actual` | Actual | 실제 |
  | `rateStatus.estimated` | Estimated | 추정 |
  | `institutionNames` (`Record<string, string>`) | `{ 'Hana Bank': 'Hana Bank', 'Toss Securities': 'Toss Securities' }` | `{ 'Hana Bank': '하나은행', 'Toss Securities': '토스증권' }` |
  | `rateUnit` | KRW per USD | 달러당 원 |
  | `actualHint` (wording change: drop the file count) | Toss statement rates and confirmed Hana rates | 토스 명세서 환율과 확인된 하나은행 환율 |
  | `estimatedHint` | Hana historical rows | 하나은행 과거 내역 행 |
  | `exchangeSource.title` | Unrealized FX by exchange source | 환전 주체별 미실현 손익 |
  | `exchangeSource.info` | Separates direct Hana exchanges from Toss exchanges so they are not confused with the full remittance result. | 하나은행 직접 환전과 토스증권 환전을 분리한 화면입니다. 전체 송금 손익과 혼동하지 않도록 원화 원가와 평균환율을 함께 표시합니다. |
  | `exchangeSource.separateNote` | The full remittance result below is a separate calculation. | 전체 송금 기준 손익은 아래 별도 카드에서 계산합니다. |
  | `exchangeSource.rows.tossUnmatchedInbound` | Toss → Hana unmatched inbound | 토스→하나 미매칭 입금 |
  | `exchangeSource.rows.otherInbound` | Mirae Asset / other inbound | 미래에셋·기타 계좌 입금 |
  | `exchangeSource.rows.total` | Exchange total | 환전 합계 |
  | `exchangeSource.inboundEstimated` | Inbound · estimated | 입금·추정 |
  | `exchangeSource.includedInRemittance` | Included in estimated remittance P/L | 전체 송금 손익에 추정 반영 |
  | `exchangeSource.columns.source` | Exchange source | 환전기관 |
  | `exchangeSource.columns.rateBasis` | Rate basis | 환율 근거 |
  | `exchangeSource.columns.rows` | Rows | 건수 |
  | `exchangeSource.columns.usdExchanged` | USD exchanged | 환전 USD |
  | `exchangeSource.columns.krwCost` | KRW cost / USD equivalent | 원화 원가 / USD 환산 |
  | `exchangeSource.columns.avgRate` | Avg. rate | 평균 환율 |
  | `exchangeSource.columns.unrealized` | Unrealized P/L (₩ / $) | 현재 환율 기준 손익 (₩ / $) |
  | `outbound.total` | Hana outbound USD total | 하나은행 USD 출금 합계 |
  | `outbound.rowCount(count: string)` | `${count} rows` | `${count}건` |
  | `outbound.knownMiraeHint` (wording change: drop the count) | Rows marked Mirae Asset | 미래에셋으로 표시된 행 |
  | `outbound.destinationUnknownHint` | Requires later US-account reconciliation | 미국 계좌 입금과 후속 대조 필요 |
  | `outbound.remittanceGlHint` | KRW / USD; includes deposit-date assumptions | 원화 / 달러 병행, 입금일 환율 가정 포함 |
  | `outbound.confirmedGlHint` | Only rows with an actual applied rate | 실제 적용환율이 기록된 원가만 |
  | `outbound.estimatedGlHint` | Direct estimates plus deposit-date assumptions for unmatched Toss and other inbound USD | 직접 환전 추정분 + 토스 미매칭·기타 계좌 입금의 입금일 환율 가정 |
  | `outbound.tossUnmatched(amount: string)` | `${amount} unmatched` | `미매칭 ${amount}` |
  | `outbound.otherInbound` | Other inbound USD | 기타 계좌에서 받은 USD |
  | `outbound.otherInboundHint` | Mirae Asset and unidentified inbound; included in estimated cost | 미래에셋 및 목적지 미표시 입금; 추정 원가에 포함 |
  | `noUnmatchedTransfers` | No unmatched owned-account transfers. | 미연결 이체가 없습니다. |
  | `unknownCounterparty` | Unknown | 미확인 |
  | `needsMiraeLedger` | Needs the Mirae USD-account ledger | 미래에셋 외화 계좌 원장 필요 |

- [ ] Rewrite the page so every `language === 'ko' ? … : …` and every inline English or Korean literal reads the keys above. Specifically: `eventLabel` reads `copy.eventTypes.*`; `rateBadge` reads `copy.rateStatus.*`; the hint `"KRW per USD"` and the chart `axisLabel` both read `copy.rateUnit`; the exchange-source table's column labels, badges and the inbound cell read `copy.exchangeSource.*`; the Hana outbound card reads `copy.outbound.*`; the transfer-review `emptyMessage`, the counterparty fallback and the match badge read the three top-level keys.
- [ ] Give the exchange-source rows a stable identity instead of display text in `institution`: add `rowId?: 'toss-unmatched' | 'other-inbound' | 'total'` to the synthetic rows, keep `institution` for real rows only, render the first column as `row.rowId ? copy.exchangeSource.rows[<camelCase of rowId>] : (copy.institutionNames[row.institution] ?? row.institution)`, and build `getRowKey` from `row.rowId ?? row.institution` plus `rateStatus`. Delete the dead `'Total' / '전체 합계'` placeholder on the accumulator (it is always overwritten). Keep the `=== 'Hana Bank'` match on line 24; it is a database value.
- [ ] Apply `copy.institutionNames[r.institution] ?? r.institution` to the institution column of the by-institution, transfer-review and recent-ledger tables too, so the Korean page names an institution the same way in every table (wording change on the Korean page only; English is the identity map).
- [ ] Delete the example paragraph under the exchange-source table (the one that quotes specific rates and a loss). Replace it with `<p className="mt-3 text-label leading-relaxed text-ink-3">{copy.exchangeSource.separateNote}</p>` (wording change: the numeric sentence is gone in both languages).
- [ ] Leave as they are: `eyebrow="KRW → USD"`, the `'n/a'` and `'—'` cell fallbacks (Task 9 owns empty values), `name: 'KRW/USD'` on the chart series, `valuePrefix="₩"`, currency codes passed to `money(…, 'USD')`, and every status or event-type literal used as a lookup.
- [ ] Run `node scripts/ui-guardrails.mjs`. Expected: `app/fx/page.tsx` reports G1 0, G2 0, G3 0 (all under baseline). Run `--update-baseline`, then `git diff scripts/ui-guardrails.baseline.json` must show only decreases; `lib/ui-copy/pages/fx.ts` must not appear with a higher G12 count (the allow-list covers USD, KRW, FX, API).
- [ ] Run the gates. Commit: `fix(ui): read every /fx sentence from the fx copy module`.

### Task 2: Shell and shared components read copy; the brand has one source

**Files:**
- Modify: `app/layout.tsx`, `app/manifest.ts`, `app/health/page.tsx`, `app/page.tsx`, `app/net-worth/page.tsx`
- Modify: `components/Sidebar.tsx`, `components/PrivateAccessNotice.tsx`, `components/AssetCoverageNote.tsx`
- Modify: `lib/page-names.ts`, `lib/ui-copy/common.ts`, `lib/ui-copy/pages/netWorth.ts`, `lib/ui-copy/pages/overview.tsx`, `lib/ui-copy/pages/health.ts`
- Modify: `tests/page-names.test.ts`, `tests/private-access-notice.test.ts` (only if an import changes)
- Modify: `scripts/ui-guardrails.baseline.json` (lower only)

**Interfaces:**
- Consumes: `APP_NAME` in `lib/page-names.ts`; `getUiCopy(language).common`; `getPageCopy('netWorth' | 'overview' | 'health', language)`.
- Produces: `export const BRAND = { eyebrow: 'Personal', wordmark: 'Finance Observatory', short: 'Personal Finance' } as const` in `lib/page-names.ts`; `common.skipToContent`, `common.appDescription`, `common.privateAccess.{title, description}`; `netWorth.coverageNote(count: number)`, `netWorth.children.toggleAria(included: boolean)`; `overview.returnOnPricedCostInfo`; `health.usdKrw`.

**Steps:**

- [ ] Write the failing test in `tests/page-names.test.ts`:

  ```ts
  test('the brand parts spell the product name', () => {
    assert.equal(`${BRAND.eyebrow} ${BRAND.wordmark}`, APP_NAME)
    assert.ok(APP_NAME.startsWith(BRAND.short))
  })
  ```

- [ ] Run `pnpm exec tsx --test tests/page-names.test.ts`. Expected: FAIL, `BRAND` is not exported.
- [ ] Add `BRAND` to `lib/page-names.ts` beside `APP_NAME` with a two-line comment saying the sidebar wordmark and the manifest read it so the name cannot drift. Run the test again. Expected: PASS.
- [ ] `components/Sidebar.tsx`: replace the two `Personal` eyebrows, the two `Finance Observatory` wordmarks and the `Personal Finance` short form with `{BRAND.eyebrow}`, `{BRAND.wordmark}`, `{BRAND.short}`. The `PF` monogram stays.
- [ ] `app/manifest.ts`: `name: APP_NAME`, `description` from `UI_COPY_BY_LANG.en.common.appDescription` (see next step); `short_name: 'Finance'` stays.
- [ ] `lib/ui-copy/common.ts`: add to `common` in both languages `skipToContent` (en `Skip to main content`, ko `본문으로 바로가기`) and `appDescription` (en `Assets, cash flow and KR/US tax history with private local evidence.`, ko `자산, 현금 흐름, 한·미 세금 이력을 비공개 로컬 증빙과 함께 봅니다.`). Add a sibling block `privateAccess` with `title` and `description` carrying the exact current strings of `components/PrivateAccessNotice.tsx` in both languages (`tests/private-access-notice.test.ts` asserts substrings of them; they must not change).
- [ ] `app/layout.tsx`: the skip link reads `getUiCopy(language).common.skipToContent`; the static `metadata.description` reads `UI_COPY_BY_LANG.en.common.appDescription` (static metadata has no request, so it stays English by design; say so in a one-line comment).
- [ ] `components/PrivateAccessNotice.tsx`: read `getUiCopy(language).common.privateAccess`; the `aria-label` keeps using the title. Run `pnpm exec tsx --test tests/private-access-notice.test.ts`. Expected: PASS without editing the test.
- [ ] `lib/ui-copy/pages/netWorth.ts`: add `coverageNote: (count: number) => string` at top level with the two current sentences from `components/AssetCoverageNote.tsx` (verbatim; `count` interpolated), and `children.toggleAria: (included: boolean) => string` returning the two current aria-label sentences built at `app/net-worth/page.tsx:251` and `app/page.tsx:602` (read both sites; they are identical; the words are `included`/`excluded` and `포함됨`/`제외됨`).
- [ ] `components/AssetCoverageNote.tsx` reads `getPageCopy('netWorth', language).coverageNote(count)`. Both toggle sites read `childCopy.toggleAria(on)`.
- [ ] `lib/ui-copy/pages/overview.tsx`: add `returnOnPricedCostInfo` (en `This percentage is measured against priced cost basis.`, ko `이 비율은 가격이 있는 취득원가를 기준으로 계산합니다.`) and read it at the `info` template on `app/page.tsx` line ~279 in place of the inline English suffix.
- [ ] `lib/ui-copy/pages/health.ts`: add `usdKrw` (en `USD/KRW`, ko `USD/KRW`) and read it for the bare JSX text on `app/health/page.tsx` line ~248.
- [ ] Leave as they are: `app/holdings/page.tsx` `GROUPS` labels (fallbacks that never render; `tests/holdings-columns.test.ts` reads that source), `components/AutoRefresh.tsx` and `components/TaxPlanTimeline.tsx` locale ternaries (Task 8 owns them).
- [ ] Run `node scripts/ui-guardrails.mjs`. Expected under baseline: `app/layout.tsx` G1/G2/G3 0, `app/manifest.ts` G3 0, `app/health/page.tsx` G3 0, `components/Sidebar.tsx` G3 0, `components/AssetCoverageNote.tsx` 0, `components/PrivateAccessNotice.tsx` 0, `app/net-worth/page.tsx` G1 0 G2 0, `app/page.tsx` G1 0 G2 0. Run `--update-baseline`; the diff shows only decreases.
- [ ] Run the gates. Commit: `fix(ui): shell and shared components read their copy from the registry`.

### Task 3: The position detail page reads every word from `positionDetail`

**Files:**
- Modify: `app/positions/[market]/[ticker]/page.tsx`
- Modify: `lib/ui-copy/pages/positionDetail.ts`
- Modify: `scripts/ui-guardrails.baseline.json` (lower only)

**Interfaces:**
- Consumes: `getPageCopy('positionDetail', language)`; the existing unused keys `subtitle(accounts, lots, transactions)`, `columns.broker`, `columns.account`, `columns.acquired`, `columns.date`.
- Produces: `eventKinds` re-keyed by slug (`dividend`, `taxLot`, `buy`, `sell`, `transaction`); new keys listed below.

**Steps:**

- [ ] Read the page and the module in full. Run `node scripts/ui-guardrails.mjs`; note G3 2 for this file (the real inline count is far higher; G3 cannot see single words or templates).
- [ ] Rename the internal event kinds to slugs. The page builds events with `kind: 'Buy' | 'Sell' | 'Dividend' | 'Tax lot'` and reads `eventTone(kind)` and `copy.eventKinds[kind]`; change the four producers, `eventTone` and both `eventKinds` maps to `buy`, `sell`, `dividend`, `taxLot`, and add `transaction` (en `Transaction`, ko `거래`) for the fallback kind. Type `eventKinds` as `Record<'dividend' | 'taxLot' | 'buy' | 'sell' | 'transaction', string>`. The rendered English is unchanged.
- [ ] Add these keys to `positionDetail` in both languages (English verbatim from the page):

  | key | en | ko |
  |---|---|---|
  | `eventDetail.income` | income | 수익 |
  | `eventDetail.openLot` | open lot | 미결제 세금 단위 |
  | `reconDetail(quantity: string, cost: string)` | `Quantity difference ${quantity} · base cost difference ${cost}` | `수량 차이 ${quantity} · 원화 취득원가 차이 ${cost}` |
  | `evidenceDetail(linked: string, unresolved: string)` | `${linked} source files linked · ${unresolved} unresolved references` | `연결된 원본 파일 ${linked}개 · 확인되지 않은 참조 ${unresolved}개` |
  | `activityDetail(transactions: string, dividends: string, lots: string)` | `${transactions} transactions · ${dividends} dividends · ${lots} open tax lots` | `거래 ${transactions}건 · 배당 ${dividends}건 · 미결제 세금 단위 ${lots}개` |
  | `quantityHint(quantity: string)` | `${quantity} shares or units` | `${quantity}주(또는 단위)` |
  | `holdingRowsHint(count: string)` (wording change: drop `(s)`) | `${count} account holding rows` | `계좌별 보유 행 ${count}개` |
  | `rowCount(count: string)` | `${count} rows` | `${count}행` |
  | `readOrderNote` | Read order: value first, then cost and gain/loss, then reconciliation and lot details. | 평가금액을 먼저 보고, 그다음 취득원가와 평가손익, 마지막으로 정합성과 세금 단위 세부 내역을 확인하세요. |
  | `linkStatus` (`Record<'linked' \| 'unlinked', string>`) | linked / unlinked | 연결됨 / 연결 안 됨 |
  | `buckets` (`Record<'long' \| 'short', string>`) | long / short | 장기 / 단기 |
  | `terms` (`Record<string, string>`) | `{ 'Long-term': 'Long-term', 'Short-term': 'Short-term' }` | `{ 'Long-term': '장기', 'Short-term': '단기' }` |
  | `transactionTypes` (`Record<string, string>`) | `{ BUY: 'BUY', SELL: 'SELL', DIVIDEND: 'DIVIDEND' }` | `{ BUY: '매수', SELL: '매도', DIVIDEND: '배당' }` |
  | `columns.paidDate` | Date | 지급일 |

- [ ] Wire the page: the subtitle reads `copy.subtitle(fmtNumber(accounts), fmtNumber(lots), fmtNumber(transactions))` with the same three counts the inline template used; the three first-check details read `reconDetail`, `evidenceDetail`, `activityDetail`; the hints read `quantityHint`, `holdingRowsHint`, `rowCount` (both the hint and the JSX `{…} rows`); the note reads `readOrderNote`; every `'Broker'`, `'Account'`, `'Acquired'`, `'Term'`, `'Usage'`, `'Source'` header reads the matching `columns.*` key; the transactions table date header reads `columns.date` and the dividends table date header reads `columns.paidDate`; the link-status badge renders `copy.linkStatus[r.status] ?? r.status`; the bucket badge renders `copy.buckets[row.holdingBucket] ?? row.holdingBucket`; the term column renders `copy.terms[row.tax_term] ?? row.tax_term`; the type badges render `copy.transactionTypes[row.type] ?? row.type`. Comparisons on the raw values (`=== 'linked'`, `=== 'long'`, `=== 'SELL'`, `tax_term === 'Long-term'`) stay as they are.
- [ ] Leave `'n/a'` fallbacks and the `fmtDateTime` calls without language alone (Tasks 8 and 9).
- [ ] Run `node scripts/ui-guardrails.mjs`; expected G3 0 for the page. Search the page for any remaining quoted Latin word that a reader would see (`command grep -n -a "'[A-Z][a-z]" "app/positions/[market]/[ticker]/page.tsx"`) and account for each hit as a lookup or a currency code in the report. Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `fix(ui): position detail reads every label and sentence from its copy module`.

### Task 4: The daily briefing absorbs `lib/briefing-copy.ts` and reads every word from `dailyBriefing`

**Files:**
- Modify: `app/daily-briefing/page.tsx`
- Modify: `lib/ui-copy/pages/dailyBriefing.ts`
- Delete: `lib/briefing-copy.ts`
- Modify: `tests/briefing-copy.test.ts`
- Modify: `scripts/ui-guardrails.baseline.json` (lower only)

**Interfaces:**
- Consumes: `BriefingActivity`, `BriefingSessionMove` from `lib/adapters/briefing-archive`; `getPageCopy('dailyBriefing', language)`; `getUiCopy(language).common.noValue`.
- Produces: on `dailyBriefing` in both languages, `activityWording(a: BriefingActivity, fmt: (n: number, digits: number) => string): string`, `activityBadge(a: BriefingActivity): string`, `moverNote(m: BriefingSessionMove, notes: Record<string, { why: string }>): string`, plus the keys below.

**Steps:**

- [ ] Rewrite `tests/briefing-copy.test.ts` first: import `getPageCopy` from `@/lib/ui-copy`, take `const en = getPageCopy('dailyBriefing', 'en')` and `const ko = getPageCopy('dailyBriefing', 'ko')`, call `en.activityWording(…)`, `en.activityBadge(…)`, `en.moverNote(…)` with the same fixtures and the same byte-identical English assertions. Add, for `ko`: the split line contains `정정` and not `매수`, and does not contain the delta `3` as a standalone number; `activityBadge` of a split is `정정`; a bought row's wording contains `매수`; `moverNote` with a suspected restatement does not contain the researched note's text.
- [ ] Run `pnpm exec tsx --test tests/briefing-copy.test.ts`. Expected: FAIL, the functions do not exist on the copy object.
- [ ] Move the three functions into `dailyBriefing.ts`, one implementation per language. English bodies are the current ones from `lib/briefing-copy.ts` (verbatim output, including `·` and the `share`/`shares` plural). Korean bodies: trade rows read `${fmt(|quantityChange|, 4)}주 매수 · 현재 ${fmt(quantity, 4)}주 보유` (sold: 매도; opened: 신규 매수; closed: `${n}주 전량 매도` with no holding clause); a split reads `보유 수량 정정${ratio ? ` (${ratio})` : ''} · 현재 ${fmt(quantity, 4)}주 보유 · 취득원가가 그대로이므로 매수나 매도가 아닙니다.`; badges are 매수 / 매도 / 신규 / 청산 / 정정 (unknown kinds fall back to the raw slug); `moverNote` with a suspected restatement returns `${ratio} 분할이면 가격이 정확히 이 비율만큼 움직이는데, 여기서는 보유 수량이 바뀌지 않았습니다. 그런 경우라면 이 손실은 실제가 아니며 시트에 새 수량을 반영해야 합니다 — 하락과 구분할 수 있을 때까지 이 수치는 당일 합계에 남겨 둡니다.` and otherwise `notes[m.ticker]?.why ?? '이 세션 변동에 대한 조사 메모가 없습니다.'` (English fallback stays `No researched note for this session move.`). Keep the explanatory comments from `lib/briefing-copy.ts` above the English implementations. Delete `lib/briefing-copy.ts` and fix the page import. Run the test. Expected: PASS.
- [ ] Add these keys to `dailyBriefing` in both languages (English verbatim from the page):

  | key | en | ko |
  |---|---|---|
  | `fyi` | FYI | 참고 |
  | `noSessionMovesUp` / `noSessionMovesDown` | No material moves up this session / No material moves down this session | 이번 세션에 눈에 띄게 오른 종목이 없습니다 / 이번 세션에 눈에 띄게 내린 종목이 없습니다 |
  | `olderBriefing(date)` / `newerBriefing(date)` | `Older briefing, ${date}` / `Newer briefing, ${date}` | `이전 브리핑, ${date}` / `다음 브리핑, ${date}` |
  | `briefingRange(count: number, from, to)` | `${count} briefing${count === 1 ? '' : 's'} · ${from} → ${to}` | `브리핑 ${count}건 · ${from} → ${to}` |
  | `archiveUnreadableHint(dir)` | `Archive directory ${dir} contains no readable briefing documents.` | `보관 디렉터리 ${dir}에 읽을 수 있는 브리핑 문서가 없습니다.` |
  | `archiveMissingHint(dir)` | `Set STOCK_BRIEFING_ARCHIVE_DIR to the briefing archive path (currently ${dir}, which does not exist).` | `STOCK_BRIEFING_ARCHIVE_DIR를 브리핑 보관 경로로 설정하세요. 현재 값 ${dir}은(는) 존재하지 않습니다.` |
  | `docSubtitle(dateLabel, built)` | `${dateLabel} · built ${built}` | `${dateLabel} · ${built} 생성` |
  | `openPublished` | Open published page ↗ | 발행된 페이지 열기 ↗ |
  | `narrativeOnlyHint` | Holdings snapshots were only retained from the archive rollout onward; earlier days kept the narrative alone. | 보유 스냅샷은 보관 기능을 도입한 이후부터만 남아 있습니다. 그 이전 날짜는 서술만 보관했습니다. |
  | `narrativeOnly(date)` | `No portfolio numbers for ${date} — this briefing was archived narrative-only.` | `${date}의 포트폴리오 수치가 없습니다 — 이 브리핑은 서술만 보관되었습니다.` |
  | `bandSince(date)` | `price moves since ${date}` | `${date} 이후 가격 변동` |
  | `bandDayOverDay` | day-over-day comparison | 전일 대비 비교 |
  | `marketClosed(market, date)` | `Every tracked ${market} price matches ${date} — the market was closed, or the sheet has not re-priced.` | `추적 중인 ${market} 가격이 모두 ${date}와 같습니다 — 휴장했거나 시트의 가격이 갱신되지 않았습니다.` |
  | `noComparison(market)` | `No day-over-day comparison for ${market} in this briefing.` | `이 브리핑에는 ${market}의 전일 대비 비교가 없습니다.` |
  | `pricedHint(covered: string, uncovered: number)` | `${covered} priced` + (uncovered ? `, ${uncovered} without prices` : ``) | `가격 반영 ${covered}개` + (uncovered ? `, 가격 없음 ${uncovered}개` : ``) |
  | `positionCount(count)` | `${count} positions` | `보유종목 ${count}개` |
  | `priorValueHint(amount)` | `on ${amount} prior value` | `직전 평가금액 ${amount} 기준` |
  | `unrealizedHint(pct, cost)` | `${pct} vs ${cost} cost` | `취득원가 ${cost} 대비 ${pct}` |
  | `reportingCurrency(currency)` | `${currency} reporting currency` | `보고 통화 ${currency}` |
  | `readOrderNote` | Session figures answer today; portfolio value and unrealized P/L answer current standing. | 당일 수치는 오늘의 변동을, 포트폴리오 평가금액과 평가손익은 현재 상태를 보여줍니다. |
  | `sessionMoversInfo(minAmount)` | `Ranked by price change since the previous snapshot, among positions worth at least ${minAmount}.` | `평가금액 ${minAmount} 이상 종목 중, 직전 스냅샷 이후 가격 변동 순으로 정렬했습니다.` |
  | `activitySince(date)` | `Activity since ${date}` | `${date} 이후 활동` |
  | `activityNote` | Detected from share-count changes between snapshots — no trade feed is involved. Excluded from Session P/L, which measures price movement on the shares already held. | 스냅샷 사이의 보유 수량 변화로 감지했으며, 거래 내역은 사용하지 않습니다. 이미 보유한 주식의 가격 변동만 측정하는 당일 손익에서는 제외됩니다. |
  | `standingBand(flag, market)` | `${flag} ${market} — standing vs cost` | `${flag} ${market} — 취득원가 대비 현황` |
  | `bestVsCostInfo(minAmount)` | `Ranked by unrealized gain versus cost basis, among positions of at least ${minAmount}. Cumulative since purchase — not a one-day move.` | `${minAmount} 이상 종목 중 취득원가 대비 평가이익 순으로 정렬했습니다. 매수 이후 누적이며 하루 변동이 아닙니다.` |
  | `worstVsCostInfo(minAmount)` | same with `unrealized loss` | `${minAmount} 이상 종목 중 취득원가 대비 평가손실 순으로 정렬했습니다. 매수 이후 누적이며 하루 변동이 아닙니다.` |
  | `largestInfo` | Ranked by market value, not cost — a position down 60% is no longer a large exposure whatever was paid for it. | 취득원가가 아니라 평가금액 순입니다 — 60% 하락한 종목은 얼마에 샀든 더 이상 큰 노출이 아닙니다. |
  | `columns.quantity` | Qty | 수량 |
  | `actionsLead` | Ordered by how soon each item deserves attention: | 얼마나 빨리 살펴봐야 하는지에 따라 정렬했습니다: |
  | `actNowMeaning` | means a dated catalyst makes deciding today materially better than waiting (at most one per briefing), | 는 날짜가 정해진 계기 때문에 오늘 결정하는 편이 기다리는 것보다 확실히 나은 경우(브리핑당 최대 1개), |
  | `thisWeekMeaning` | a decision due before a near-term event, | 는 가까운 이벤트 전에 내려야 할 결정, |
  | `fyiMeaning` | context with no action implied. | 은(는) 조치가 필요 없는 참고 맥락입니다. |
  | `disclaimer` | Generated commentary, informational only — not investment advice. | 자동 생성된 해설로 정보 제공용이며, 투자 조언이 아닙니다. |
  | `noMarkets` | none | 없음 |
  | `footer` | the current three-line footer verbatim | 일일 브리핑 예약 작업이 작성한 브리핑 보관함을 읽기 전용으로 보여줍니다. 같은 문서가 공개 브리핑 페이지에도 발행되므로 두 화면은 같은 날짜에 항상 같은 수치를 보여줍니다. 수치는 브리핑 날짜에 찍은 스냅샷이라 갱신되지 않으며, 각 시장은 자체 통화로 표시하고 합산하지 않습니다. |

  Read the exact English for `actionsLead` through `disclaimer` and `footer` from the page before copying; the table shortens them. The actions footnote keeps its `<b>` labels in JSX, reading `copy.actNow`, `copy.thisWeek`, `copy.fyi` between the five new fragments. Delete `columns.costBasis` (unused; the header reads `costShort`).
- [ ] Wire the page. `SessionMoverList` gains a `copy` prop. `priorityLabels(copy)` reads `copy.fyi`. The `'not available'` fallback reads `getUiCopy(language).common.noValue` (pass it in or read it where `language` is in scope). The date-picker aria-labels, the range line, the band titles, the card `info` and `title` templates, the hints and the footer read the keys above. Data values stay raw: `a.kind` in `TRADE_TONE`, `m.label`, `m.flag`, `doc.dateLabel`, `doc.narrative`, `a.head`, `a.body`, the priority slugs.
- [ ] Leave `toLocaleString('en-US', …)` in `amount()` and the `'—'` literal alone (Tasks 8 and 9).
- [ ] Run `node scripts/ui-guardrails.mjs`; expected G3 0 for the page and `lib/ui-copy/pages/dailyBriefing.ts` absent from G12 (its baseline is 0; any Latin word in a Korean value such as `FYI`, `KST`, `UTC`, `cron`, a hostname or a ratio literal fails the run, so keep ratios as arguments and use 참고 / 한국 시간 / 협정 세계시 / 예약 작업 / 공개 브리핑 페이지). Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `fix(ui): the daily briefing reads every sentence from its copy module, in both languages`.

### Task 5: The crypto premium page reads every word from `cryptoPremium`, and `subtitleWithData` is wired

**Files:**
- Modify: `app/crypto-premium/page.tsx`
- Modify: `lib/ui-copy/pages/cryptoPremium.ts`
- Modify: `tests/copy-registry.test.ts` (remove the `PENDING_WIRING` entry)
- Modify: `scripts/ui-guardrails.baseline.json` (lower only)

**Interfaces:**
- Consumes: `getPageCopy('cryptoPremium', language)`; `fmtDateTime(value, language)` from `lib/format.ts` (pass `language`; Task 8 makes it required).
- Produces: `subtitleWithData(rate: string, fxDate: string, snapshot: string)` with a new signature; keys below.

**Steps:**

- [ ] Change `subtitleWithData` in both languages to `(rate: string, fxDate: string, snapshot: string) => string`: en `` `Won order book against the dollar order book converted at USD/KRW ${rate} (${fxDate}). Snapshot ${snapshot}.` `` (the current inline sentence), ko `` `원화 호가를 USD/KRW ${rate}(${fxDate})로 환산한 달러 호가와 비교합니다. 스냅샷 ${snapshot}.` ``. The page calls it with `fmtNumber(premium.fx.rate, 2)`, `premium.fx.asOfDate`, `fmtDateTime(premium.generatedAt, language)`. In the same commit remove `cryptoPremium: ['subtitleWithData']` from `PENDING_WIRING` in `tests/copy-registry.test.ts`, leaving `{}` and a comment that says the list is empty today.
- [ ] Add these keys in both languages (English verbatim from the page; the risk paragraph is split so the styled span stays in JSX):

  | key | en | ko |
  |---|---|---|
  | `notableBadge(count: string, pct: string)` | `${count} coin(s) beyond ±${pct}%` | `±${pct}% 초과 코인 ${count}개` |
  | `withHistoryHint(count)` | `${count} with history` | `이력 있음 ${count}개` |
  | `readOrderNote` | Portfolio totals use each venue price; this page isolates the hidden venue premium risk. | 포트폴리오 합계는 거래소별 가격을 쓰고, 이 페이지는 그 안에 숨은 거래소 프리미엄 위험만 따로 보여줍니다. |
  | `notHeldBadge` | not held in KRW | 원화 거래소 미보유 |
  | `tableFootnote` | Implied KRW is the dollar price at the FX snapshot above. A coin quoted on only one of the two books cannot be compared and is absent rather than shown at zero. | 환산 원화는 위 환율 스냅샷으로 달러 가격을 환산한 값입니다. 두 호가 중 한쪽에만 있는 코인은 비교할 수 없으므로 0으로 표시하지 않고 제외합니다. |
  | `measures.valuation` | the current first paragraph verbatim (unescape `&apos;` to `'`) | 각 거래소의 보유분은 그 거래소 자체 호가로 평가하므로 프리미엄이 포트폴리오 합계를 왜곡하지 않습니다. 대신 그 노출은 다른 화면에서는 보이지 않으며, 이 페이지에서만 드러납니다. |
  | `measures.riskLead` | It is a second way to lose money on a Bithumb position: the coin can be flat in dollars and still fall in won if the premium compresses. | 빗썸 포지션에서 돈을 잃는 두 번째 경로입니다. 코인 가격이 달러 기준으로 그대로여도 프리미엄이 줄면 원화 기준으로는 떨어질 수 있습니다. |
  | `measures.riskTail` | is what that would cost at today's prices. | 은(는) 오늘 가격 기준으로 그 경우 잃게 될 금액입니다. |
  | `measures.timing` | the current third paragraph verbatim | 두 가격은 같은 시점에 읽습니다 — 빗썸 일봉은 한국 시간 0시에 마감하고, 달러 종가도 같은 시각(협정 세계시 15시)에 잡으며 협정 세계시 하루 끝에 잡지 않습니다. 두 일봉 종가를 그대로 비교하면 밤사이 변동이 모두 프리미엄으로 잡힙니다. |
  | `historyInfo(start, end)` | `${start} to ${end} — the window is limited by how far Bithumb's candlestick endpoint reaches, not by choice.` | `${start}부터 ${end}까지 — 이 기간은 임의로 정한 것이 아니라 빗썸 캔들 데이터가 제공하는 범위에 따른 것입니다.` |

- [ ] Wire the page: the badge, hint, note, table footnote, the three "what this measures" paragraphs (`{copy.measures.riskLead} <span …>{copy.valueFromPremium}</span> {copy.measures.riskTail}`) and the history `info`. Leave chart series names (ticker symbols), `valueSuffix="%"`, the `±` and `→` formatting templates, and the `'n/a'` / `'—'` fallbacks.
- [ ] Run `pnpm exec tsx --test tests/copy-registry.test.ts`. Expected: PASS (the pending key is now read and off the list).
- [ ] Run `node scripts/ui-guardrails.mjs`; expected G3 0 and G9 0 for the page, `cryptoPremium.ts` G12 unchanged at 2. Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `fix(ui): the crypto premium page reads every sentence from its copy module`.

### Task 6: Freshness and the two action queues return codes; the pages say the sentences

**Files:**
- Modify: `lib/adapters/portfolio-db.ts` (types `FreshnessItem`, `DataOpsReview`, `ReconciliationReview`; functions `getOperationalHealth`, `snapshotFreshness`, `sourceFreshness`, `getDataOpsReview`, `getReconciliationReview`, `tickerlessSuggestion`, `valuationSuggestion`, `valuationReason`)
- Create: `lib/freshness-text.ts`
- Modify: `components/Freshness.tsx`, `app/data-ops/page.tsx`, `app/reconciliation/page.tsx`, `app/page.tsx`, `app/positions/[market]/[ticker]/page.tsx`
- Modify: `lib/ui-copy/common.ts`, `lib/ui-copy/pages/dataOps.ts`, `lib/ui-copy/pages/reconciliation.ts`
- Modify: `scripts/write-briefing-summary.ts`
- Create: `tests/freshness-text.test.ts`
- Modify: `tests/supplementary-coverage.test.ts` only if its `items[]` reads break
- Modify: `scripts/ui-guardrails.mjs` (`findEnglishInKoreanCopy` and `KO_LATIN_ALLOW`), `tests/ui-guardrails.test.ts`

**Interfaces:**
- Consumes: `getUiCopy(language)`; the existing `FreshnessItem` consumers (six pages through `FreshnessRows` / `FreshnessInline`, the briefing summary script).
- Produces, in `lib/adapters/portfolio-db.ts`:

  ```ts
  export type FreshnessDetail =
    | { code: 'PRICE_SNAPSHOT'; count: number; marketDate: string | null }
    | { code: 'CRYPTO_SNAPSHOT'; count: number; quotes: string[] }
    | { code: 'FX_RATE'; rate: number; source: string }
    | { code: 'FX_RATE_MISSING' }
    | { code: 'SOURCE_MISSING' }
    | { code: 'SOURCE_CHANGED'; recordedBytes: number; currentBytes: number }
    | { code: 'SOURCE_MTIME_ONLY' }
    | { code: 'SOURCE_MATCHES' }
  export type FreshnessSnapshotKey = 'kr_prices' | 'us_prices' | 'crypto_prices' | 'fx_rates'
  // FreshnessItem.detail: FreshnessDetail (was string). FreshnessItem.label stays a string: for snapshots it is now the key
  // (`kr_prices` …) and the reader-visible name comes from copy; for source-drift rows it stays the file name (data).
  export type ActionPriority = 'high' | 'medium' | 'low'
  export type DataOpsQueueKind = 'validation' | 'source_freshness' | 'manual_mappings' | 'valuation'
  export type ReconciliationQueueKind = 'source_freshness' | 'validation' | 'position_breaks' | 'valuation'
  export type ActionQueueItem<K extends string> = { kind: K; priority: ActionPriority; count: number; href: string }
  export type TickerlessSuggestion = 'keep_interest' | 'keep_stock_lending' | 'keep_other' | 'review_override'
  export type ValuationReason = 'price_snapshot_missing' | 'ticker_missing_from_price_snapshot' | 'source_missing_market_value'
  export type PositionBreakStatus = 'holding_only' | 'lot_only' | 'quantity_break' | 'cost_break'
  ```

  In `lib/freshness-text.ts`: `export function freshnessLabel(item: FreshnessItem, language: Language): string` and `export function freshnessDetailText(detail: FreshnessDetail, language: Language): string`, both reading `getUiCopy(language).freshness`.
  In copy: `common.freshness.snapshotLabels: Record<FreshnessSnapshotKey, string>`, `common.freshness.detail: { [code]: (params) => string }`; `dataOps.queue: Record<DataOpsQueueKind, { area: string; action: string }>`, `dataOps.tickerlessSuggestion: Record<TickerlessSuggestion, string>`, `dataOps.valuationReason: Record<ValuationReason, string>`, `dataOps.valuationSuggestion: Record<ValuationReason, string>`; `reconciliation.queue: Record<ReconciliationQueueKind, { area: string; action: string }>`, `reconciliation.breakStatus: Record<PositionBreakStatus, string>`.

**Steps:**

- [ ] Extend `tests/ui-guardrails.test.ts` for G12 first: a planted ko value `'받은 자료를 us-transactions/에 넣으세요'` is not a hit, `'/lots'` is not a hit, `'MCP 스냅샷'` and `'PDF + XLSX'` are not hits, and `'inbox에 넣으세요'` still is. Run; expected FAIL. Then change `findEnglishInKoreanCopy` in `scripts/ui-guardrails.mjs`: add `MCP` and `XLSX` to `KO_LATIN_ALLOW`, and skip any Latin run that is part of a whitespace-delimited token containing `/` (a path or route). Run; expected PASS. Run `node scripts/ui-guardrails.mjs`: `lib/ui-copy/pages/sidebar.ts` drops from 24 to 0 and is reported under baseline; lower the baseline at the end of this task with the rest.
- [ ] Leave `lib/rebalance/propose.ts` alone: its `detail` strings go to the server log and the CLI's JSON line, never to a page (the page maps the reason code through `rebalanceProposal.errors`), so they stay English.
- [ ] Write `tests/freshness-text.test.ts` first: `freshnessDetailText({ code: 'PRICE_SNAPSHOT', count: 3, marketDate: '2020-01-02' }, 'en')` equals `3 prices · market date 2020-01-02`; with `marketDate: null` it equals `3 prices · market date unknown`; `{ code: 'CRYPTO_SNAPSHOT', count: 0, quotes: [] }` in `en` equals `0 prices · none`; `{ code: 'FX_RATE_MISSING' }` in `en` equals `No FX rate configured.`; `freshnessLabel` of a `kr_prices` snapshot item in `ko` equals `한국 주식 시세`; a source-drift item's label is returned unchanged in both languages; every `FreshnessDetail` code has a Korean sentence whose Latin letters are limited to `FX`, `SHA`, `USD`, `KRW` (iterate the codes with representative params). Run it; expected FAIL (module missing).
- [ ] Add the copy. `common.freshness.snapshotLabels`: en `{ kr_prices: 'KR prices', us_prices: 'US prices', crypto_prices: 'Crypto prices', fx_rates: 'USD/KRW FX' }`, ko `{ kr_prices: '한국 주식 시세', us_prices: '미국 주식 시세', crypto_prices: '가상자산 시세', fx_rates: 'USD/KRW 환율' }`. `common.freshness.detail` en sentences are the current adapter strings verbatim with their interpolations; the one wording change is that the inline `n/a` for a missing market date becomes `unknown`: `${count} prices · market date ${marketDate ?? 'unknown'}`, `${count} prices · ${quotes.join(', ') || 'none'}`, `${rate} · ${source}`, `No FX rate configured.`, `Source file is missing from disk.`, `Changed since ingest. Recorded ${recordedBytes} bytes; current ${currentBytes} bytes.`, `Content matches the SHA-256 captured at ingest; only modified time changed.`, `Matches the content fingerprint captured at ingest.` Korean: `시세 ${count}건 · 시장 기준일 ${marketDate ?? '미확인'}`, `시세 ${count}건 · ${quotes.join(', ') || '없음'}`, `${rate} · ${source}`, `환율이 설정되지 않았습니다.`, `원본 파일이 디스크에 없습니다.`, `적재 이후 변경되었습니다. 기록된 크기 ${recordedBytes}바이트, 현재 ${currentBytes}바이트.`, `내용은 적재 시 기록한 SHA-256과 일치하며 수정 시각만 바뀌었습니다.`, `적재 시 기록한 내용 지문과 일치합니다.`
- [ ] Change the adapter: `FreshnessItem.detail` becomes `FreshnessDetail`; the four snapshot builders pass structured params and set `label` to the key; `sourceFreshness` passes the four source codes. Fix every TypeScript error this raises by making the consumer read `freshnessLabel` / `freshnessDetailText` with its `language`: `components/Freshness.tsx` (`FreshnessInline` gains a required `language` prop; both callers already have one), the label render sites in `app/page.tsx` and the positions page, and `scripts/write-briefing-summary.ts` (writes `freshnessLabel(item, 'en')` and `freshnessDetailText(item.detail, 'en')` so the published JSON stays English and unchanged). Run the new test; expected PASS. Run `pnpm exec tsx --test tests/supplementary-coverage.test.ts`; expected PASS unchanged.
- [ ] Introduce `ActionQueueItem<K>` and replace the two anonymous queue item types; `getDataOpsReview` pushes `{ kind, priority, count, href }` and `getReconciliationReview` the same with its kinds. Delete the `area` and `action` strings from the adapter. Add `dataOps.queue` and `reconciliation.queue` with each page's current English sentences verbatim (they differ per page on purpose; keep them separate) and this Korean. Data-ops: `validation` area 검증, action 다운스트림 분류에 앞서 실패한 적재 검증 검사를 고치세요.; `source_freshness` area 원본 최신성, action 오래되었거나 변경되었거나 누락된 입력을 해결하고 갱신을 다시 실행하세요.; `manual_mappings` area 수동 매핑, action 제안된 읽기 전용 매핑 규칙을 검토하고 유용한 것을 data/manual-mappings.json에 적용하세요.; `valuation` area 평가, action 가격 스냅샷을 갱신하거나 평가금액이 없는 행의 종목 코드 정규화를 해결하세요. Reconciliation: `source_freshness` area 원본 최신성, action 정합성 차이를 신뢰하기 전에 오래되었거나 변경되었거나 누락된 원본 입력을 해결하세요.; `validation` area 검증 검사, action 최근 적재의 실패한 검증 검사를 고치세요.; `position_breaks` area 보유 ↔ 세금 단위, action 종목·증권사별 수량과 취득원가 차이를 검토하세요.; `valuation` area 평가, action 누락된 평가금액 행을 갱신하거나 매핑하세요. (`data/manual-mappings.json` is a path token, which the G12 change above skips; the Korean never names the `pnpm refresh` command because `pnpm` and `refresh` would count as English words.)
- [ ] Both pages render the queue's area and action columns through `copy.queue[r.kind].area` / `.action` (`render`, not `key` lookups). The priority column keeps `getUiCopy(language).priority[r.priority]` and loses its cast now that `priority` is a union.
- [ ] `getDataOpsReview`: `tickerlessIncome[].suggestion` and `mappingSuggestions[].note` become `TickerlessSuggestion` codes; `missingValuation[].reason` and `valuationFixes[].reason` are typed `ValuationReason`; drop the `suggestion` string fields that were derived from the reason. The JSON rule string inside `mappingRuleSuggestion` keeps its English `note` (it is file content the operator pastes). Add `dataOps.tickerlessSuggestion`, `dataOps.valuationReason` and `dataOps.valuationSuggestion`: English suggestions verbatim from the adapter; reason labels en `{ price_snapshot_missing: 'Price snapshot missing', ticker_missing_from_price_snapshot: 'Ticker missing from price snapshot', source_missing_market_value: 'Source has no market value' }` (wording change: these codes rendered raw before); Korean suggestions `{ keep_interest: '종목 없이 두세요. 범주가 포지션 외 현금 이자를 설명합니다.', keep_stock_lending: '종목 없이 두거나, 포지션 식별이 중요할 때만 원본별 종목 코드 재지정을 추가하세요.', keep_other: '원본 행이 분명히 특정 증권에 속하지 않는 한 종목 없는 기타 수입으로 두세요.', review_override: '원본과 이름을 검토하고, 이 수입이 특정 종목에 속하면 배당 재지정 항목을 추가하세요.' }`, reasons `{ price_snapshot_missing: '가격 스냅샷 없음', ticker_missing_from_price_snapshot: '가격 스냅샷에 종목 코드 없음', source_missing_market_value: '원본에 평가금액 없음' }`, valuation suggestions `{ price_snapshot_missing: '갱신을 실행하거나 로컬 가격 스냅샷 파일을 복원하세요.', ticker_missing_from_price_snapshot: '종목 코드 정규화를 확인하고 해당 가격 스냅샷을 갱신하세요.', source_missing_market_value: '원본의 평가 필드를 검토하세요. 세금 단위만 있는 원본은 외부 가격 보강이 필요할 수 있습니다.' }`. The page renders the suggestion, reason and valuation-suggestion columns through these maps with a raw fallback.
- [ ] `getReconciliationReview`: type `positionBreaks[].status` as `PositionBreakStatus`; add `reconciliation.breakStatus` en `{ holding_only: 'Holding only', lot_only: 'Lot only', quantity_break: 'Quantity break', cost_break: 'Cost break' }` (wording change: rendered raw before), ko `{ holding_only: '보유만 있음', lot_only: '세금 단위만 있음', quantity_break: '수량 불일치', cost_break: '취득원가 불일치' }`, and render the badge through it. Sorting stays on the code.
- [ ] Run `node scripts/ui-guardrails.mjs`; `lib/` is not scanned, so expect only the consumers to move (`app/data-ops/page.tsx` loses its two G3 hits). Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): freshness and action queues return codes; pages render the sentences`.

### Task 7: Account coverage returns codes, and the coverage table's copy moves into `dataOps.coverage`

**Files:**
- Modify: `lib/adapters/portfolio-db.ts` (types `AccountCoverageSource`, `AccountCoverage`; function `getAccountCoverage`)
- Modify: `app/data-ops/page.tsx`, `lib/ui-copy/pages/dataOps.ts`
- Modify: `tests/account-coverage.test.ts`
- Modify: `scripts/ui-guardrails.baseline.json` (lower only)

**Interfaces:**
- Consumes: `maskAccountLabel` from `lib/account-label.ts`; `AccountCoverageStatus`; the row fields the page reads today.
- Produces:

  ```ts
  export type CoverageArtifact =
    | { code: 'KR_STATEMENT' } | { code: 'KR_CERTIFICATE'; brokerage: string; account: string }
    | { code: 'TOSS_STATEMENT_WITH_API' } | { code: 'SAMSUNG_STOCK_COMP_STATEMENT' }
    | { code: 'US_HOLDINGS_AND_TRANSACTIONS_CSV'; brokerage: string }
    | { code: 'ROBINHOOD_MCP_SNAPSHOT' } | { code: 'ROBINHOOD_TRANSACTIONS_CSV' }
    | { code: 'BITHUMB_PDF_AND_XLSX' } | { code: 'ROBINHOOD_CRYPTO_STATEMENT' }
  export type CoverageAction =
    | { code: 'DOWNLOAD_TO_INBOX' } | { code: 'KR_CERTIFICATE'; brokerage: string; account: string }
    | { code: 'TOSS_API_OR_STATEMENT' } | { code: 'SAMSUNG_STOCK_COMP' }
    | { code: 'US_HOLDINGS_AND_TRANSACTIONS'; brokerage: string }
    | { code: 'ROBINHOOD_SNAPSHOT' } | { code: 'ROBINHOOD_SNAPSHOT_AND_CSV' }
    | { code: 'BITHUMB_SAME_PERIOD' } | { code: 'CRYPTO_MONTHLY_STATEMENT' }
  export type CoverageDetail =
    | { code: 'STATEMENT_PERIOD_END'; checkDetail?: string } | { code: 'ROBINHOOD_OLDER_OF_TWO' }
    | { code: 'ROBINHOOD_SNAPSHOT_FETCHED_AT'; checkDetail?: string } | { code: 'OLDER_OF_TWO_CSVS' }
    | { code: 'BITHUMB_PDF_IS_LEDGER' } | { code: 'MONTHLY_STATEMENT_CONTINUITY' }
    | { code: 'TOSS_STATEMENT_AND_API'; checkDetail?: string }
  // AccountCoverage gains artifacts: CoverageArtifact[]; action: CoverageAction; detail: CoverageDetail.
  // AccountCoverageSource gains artifact: CoverageArtifact. requiredArtifact: string stays on both, with today's exact text,
  // because scripts/write-briefing-summary.ts, scripts/coverage-reminder.mjs and lib/cli/sources-status.ts print it; the page stops reading it.
  // sources[].label ('MCP' | 'CSV') stays: two tests look sources up by it.
  ```

  Copy: `dataOps.coverage = { title, info, viewAll, actionNeeded, dueSoon, current, none, downloadRange, last, noCutoff, daysAgo(n), noExistingCutoff, downloadFrom(date), mixed(api, statement), status: Record<AccountCoverageStatus, string>, methodLabel: Record<AccountCoverage['method'], string>, columns: { account, coverage, lag, artifact, method, destination }, artifact: { [code]: string | (params) => string }, action: { … }, detail: { … }, missingDisposals(count, tickers) }`.

**Steps:**

- [ ] Update `tests/account-coverage.test.ts` for the new shape: the two `requiredArtifact` regex assertions stay (the string field is kept); the `action` regex assertion becomes `assert.equal(longterm.action.code, 'ROBINHOOD_SNAPSHOT_AND_CSV')` plus a `deepEqual` on `longterm.missingDisposals` against the fixture's two tickers; add `assert.equal(midterm.detail.code, 'ROBINHOOD_OLDER_OF_TWO')` and `assert.deepEqual(midterm.artifacts.map((a) => a.code), ['ROBINHOOD_MCP_SNAPSHOT', 'ROBINHOOD_TRANSACTIONS_CSV'])`. Run; expected FAIL on the new fields.
- [ ] Change `getAccountCoverage`: every branch sets `artifacts`, `action` and `detail` codes beside the existing strings (`requiredArtifact`, and the `format` / `destination` paths stay literal). The `checkDetail` fields carry the validation-check text the branch reads from the database today. Run the test; expected PASS. Run `pnpm exec tsx --test tests/robinhood-csv-coverage.test.ts`; expected PASS unchanged.
- [ ] Move the page's `coverageCopy` object into `dataOps.coverage` with its current en/ko values, and add the keys the three module-level helpers need: `noCutoff` (No cutoff / 기준일 없음), `daysAgo(n)` (`${n}d ago` / `${n}일 전`), `noExistingCutoff` (No existing cutoff — download the full available period / 기존 기준일 없음 — 가능한 전체 기간), `downloadFrom(date)` (`From ${date} (1-day overlap)` / `${date}부터 (기존 자료와 1일 겹침)`), `mixed(api, statement)` (`API ${api} · statement ${statement}` / `API ${api} · 명세서 ${statement}`), `viewAll` (View all / 전체 보기), `downloadRange` (Download range / 추가 다운로드), `last` (last: / 최근 파일:), `missingDisposals(count, tickers)` (`Missing sale records for ${count} ticker(s) (${tickers}): realized gains for this account appear only once its transactions CSV arrives.` / `매도 기록 누락 ${count}종목(${tickers}): 이 계좌의 거래내역 CSV가 들어와야 실현 손익이 잡힙니다.`). Korean wording changes inside the moved block: `info` loses the parenthetical `(Fresh)`, `methodLabel.inbox` becomes 인박스. Drop the dead `detail` and `days` keys. `status` is typed `Record<AccountCoverageStatus, string>` and `methodLabel` `Record<AccountCoverage['method'], string>`.
- [ ] Add the `coverage.artifact`, `coverage.action` and `coverage.detail` maps. English for the KR branches is new (they were Korean-only); Korean for the US branches is the current text with English words replaced:

  | code | en | ko |
  |---|---|---|
  | artifact `KR_STATEMENT` | Latest transaction statement | 최근 거래내역서 |
  | artifact `KR_CERTIFICATE(b, a)` | `${b} ${a} transaction certificate` | `${b} ${a} 거래내역증명서` |
  | artifact `TOSS_STATEMENT_WITH_API` | Toss Securities statement PDF (supplements the Open API) | 토스증권 거래내역서 PDF (오픈 API 보완) |
  | artifact `SAMSUNG_STOCK_COMP_STATEMENT` | Samsung Securities stock-compensation account statement | 삼성증권 주식보상 계좌거래내역서 |
  | artifact `US_HOLDINGS_AND_TRANSACTIONS_CSV(b)` | `${b} holdings CSV + transactions CSV` | `${b} 보유 CSV + 거래 CSV` |
  | artifact `ROBINHOOD_MCP_SNAPSHOT` | Robinhood MCP snapshot + tax lots | 로빈후드 MCP 스냅샷 + 세금 단위 |
  | artifact `ROBINHOOD_TRANSACTIONS_CSV` | Robinhood transactions CSV | 로빈후드 거래 CSV |
  | artifact `BITHUMB_PDF_AND_XLSX` | Bithumb transaction confirmation PDF + period transaction XLSX | 빗썸 거래내역확인서 PDF + 기간별 거래내역 XLSX |
  | artifact `ROBINHOOD_CRYPTO_STATEMENT` | Robinhood Crypto monthly statement | 로빈후드 크립토 월간 명세서 |
  | action `DOWNLOAD_TO_INBOX` | Download a statement whose period runs through today and drop it in the inbox. | 최근 조회기간이 오늘까지 포함된 자료를 다운로드해 인박스 폴더에 넣으세요. |
  | action `KR_CERTIFICATE(b, a)` | `Download the latest transaction certificate for ${b} ${a} and drop it in the inbox.` | `${b} ${a}의 최신 거래내역증명서를 다운로드해 인박스 폴더에 넣으세요.` |
  | action `TOSS_API_OR_STATEMENT` | No action is needed while the Open API is current. Download a new statement when the statement cutoff falls behind. | 오픈 API가 최신이면 조치하지 않아도 됩니다. 명세서 기준일이 뒤처지면 새 거래내역서를 다운로드하세요. |
  | action `SAMSUNG_STOCK_COMP` | Download the latest statement for the stock-compensation account and drop it in the inbox. | 주식보상 계좌의 최신 계좌거래내역서를 다운로드해 인박스 폴더에 넣으세요. |
  | action `US_HOLDINGS_AND_TRANSACTIONS(b)` | `Download ${b} holdings/positions and the latest transactions CSV as of the same date and drop them in the inbox.` | `${b}의 보유/포지션과 최신 거래 CSV를 같은 기준일로 다운로드해 인박스 폴더에 넣으세요.` |
  | action `ROBINHOOD_SNAPSHOT` | Regenerate the account snapshot and lots from the Robinhood MCP. This is not a broker CSV for the inbox. | 로빈후드 MCP에서 계좌 스냅샷과 세금 단위를 다시 생성하세요. 증권사 CSV를 인박스 폴더에 넣는 작업이 아닙니다. |
  | action `ROBINHOOD_SNAPSHOT_AND_CSV` | Regenerate the snapshot from the Robinhood MCP, and download each account's transactions CSV, name it and drop it in us-transactions/. The older of the two is the account cutoff. | 스냅샷은 로빈후드 MCP에서 다시 생성하고, 거래 CSV는 계좌별로 다운로드해 이름을 붙여 us-transactions/에 넣으세요. 둘 중 오래된 쪽이 계좌 기준일입니다. |
  | action `BITHUMB_SAME_PERIOD` | Download both the PDF and the XLSX for the same period and drop them in the inbox. | 같은 조회기간의 PDF와 XLSX를 모두 다운로드해 인박스 폴더에 넣으세요. |
  | action `CRYPTO_MONTHLY_STATEMENT` | Download the missing latest monthly crypto statement PDF and drop it in the inbox. | 누락된 최신 월의 크립토 명세서 PDF를 다운로드해 인박스 폴더에 넣으세요. |
  | detail `STATEMENT_PERIOD_END` | Computed from the last day of the period the document declares. | 문서가 선언한 조회기간의 마지막 날짜를 기준으로 계산합니다. |
  | detail `ROBINHOOD_OLDER_OF_TWO` | Computed from the older of the MCP snapshot fetch time and the last day the transactions CSV covers (the period end in the file name, or a later trade date). | MCP 스냅샷을 가져온 시각과 거래 CSV가 다루는 마지막 날(파일 이름의 기간 끝, 또는 그보다 늦은 거래일) 중 오래된 쪽을 기준으로 계산합니다. |
  | detail `ROBINHOOD_SNAPSHOT_FETCHED_AT` | Computed from the MCP snapshot fetch time. | MCP 스냅샷을 가져온 시각을 기준으로 계산합니다. |
  | detail `OLDER_OF_TWO_CSVS` | The older cutoff of the two CSVs is the account coverage. | 두 CSV 중 더 오래된 기준일을 계좌 반영 기준일로 사용합니다. |
  | detail `BITHUMB_PDF_IS_LEDGER` | The PDF is the trade ledger; the XLSX supplements deposit and withdrawal reasons. | PDF가 거래 원장이고 XLSX는 입출금 사유 보강용입니다. |
  | detail `MONTHLY_STATEMENT_CONTINUITY` | Checks that the monthly statements run without a gap. | 월별 명세서가 끊기지 않는지 기준일을 계산합니다. |
  | detail `TOSS_STATEMENT_AND_API` | Shows the statement and the Open API snapshot together. | 명세서와 오픈 API 스냅샷을 함께 표시합니다. |

- [ ] Rewrite the page: `coverageDateLabel(row, c)`, `coverageLagLabel(row, c)` and `coverageDownloadLabel(row, c)` take the `dataOps.coverage` copy object instead of `language: string`; the artifact cell joins the row's `artifacts` rendered through `copy.coverage.artifact[code]` with ` + ` (calling the `KR_CERTIFICATE` function with `maskAccountLabel(account)`); the action cell renders the missing-disposals prefix from `row.missingDisposals` when it is non-empty, then the action sentence (account masked the same way); the detail cell renders the detail sentence and puts `checkDetail`, when present, in the cell's `title` attribute. Every `language === 'ko'` branch and inline literal in this file is gone after this step.
- [ ] Run `node scripts/ui-guardrails.mjs`: `app/data-ops/page.tsx` G1 0, G2 0, G3 0; `lib/ui-copy/pages/dataOps.ts` G12 at or below 6 (translate any flagged word rather than touching the baseline). Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): account coverage returns codes and the coverage table reads dataOps.coverage`.

### Task 8: Date, month and duration formatters require a language

**Files:**
- Modify: `lib/format.ts`, `lib/tax-planning.ts` (the `label` field of a plan month), `components/TaxPlanTimeline.tsx`, `components/AutoRefresh.tsx`, `components/Freshness.tsx`, `components/AssetEventList.tsx`, `components/DevCopyBadge.tsx`
- Modify: every caller tsc lists (expected: `app/page.tsx`, `app/crypto-premium/page.tsx`, `app/data-map/page.tsx`, `app/health/page.tsx`, `app/positions/[market]/[ticker]/page.tsx`, `app/tax-planning/components.tsx`, `app/tax-planning/page.tsx`, `app/tax-planning/plans/[id]/page.tsx`, `app/tax-settings/page.tsx`, `app/pension/page.tsx`, `app/net-worth/page.tsx`, `app/accounts/page.tsx`, `app/data-ops/page.tsx`)
- Modify: `tests/format-date.test.ts`; create `tests/format-language.test.ts`
- Modify: `scripts/ui-guardrails.baseline.json` (lower only)

**Interfaces:**
- Produces, in `lib/format.ts`: `export const EMPTY_VALUE = '—'`; `export function localeFor(language: Language): 'ko-KR' | 'en-US'`; `fmtDateTime(value, language: Language)`, `fmtDateShort(value, language: Language)`, `fmtDate(value, language: Language)` (ISO `YYYY-MM-DD` output in both languages; `language` decides only the null text today and is required for signature uniformity, say so in its comment), `fmtDurationDays(days, language: Language)`, `fmtDuration(ms, language: Language)` (ko units 분 / 시간 / 일), `fmtMonth(yearMonth: string, language: Language, options?: { year?: boolean })` (en `Nov 2026` / `Nov`, ko `2026년 11월` / `11월`). Every null result of these helpers is `EMPTY_VALUE`. `relTime` is deleted (no callers).
- Consumes: nothing new.

**Steps:**

- [ ] Write `tests/format-language.test.ts`: `fmtMonth('2026-03', 'en', { year: true })` is `Mar 2026`, `fmtMonth('2026-03', 'ko', { year: true })` is `2026년 3월`, `fmtMonth('2026-03', 'ko')` is `3월`; `fmtDuration(5 * 60_000, 'ko')` is `5분` and `fmtDuration(5 * 60_000, 'en')` is `5m`; `fmtDurationDays(10, 'ko')` is `10일`; `fmtDateTime(null, 'en')` and `fmtDate(undefined, 'ko')` are `EMPTY_VALUE`; `fmtDate('2026-08-11', 'ko')` is `2026-08-11`. Update `tests/format-date.test.ts` to pass `'en'`. Run both; expected FAIL on the missing exports and on `n/a`.
- [ ] Change `lib/format.ts` as the Interfaces block says. Run the two tests; expected PASS. Run `pnpm typecheck`; it lists every call site that omits the language.
- [ ] Fix each site by passing the `language` already in scope. Where none is in scope, add a `language: Language` prop: `MasterPlanOverview`, `MasterScenarioComparison`, `SavedPlansPanel` in `app/tax-planning/components.tsx` (their callers in `app/tax-planning/page.tsx` have it), `AssetEventList` (callers in `app/page.tsx` and `app/net-worth/page.tsx`), `FreshnessInline` if Task 6 left it optional. `app/tax-settings/page.tsx` replaces `fmtDateTime(state.updatedAt).slice(0, 10)` with `fmtDate(state.updatedAt, language)` (the slice assumed the en-US shape). `app/data-ops/page.tsx`'s module-level `date` helper takes the language or the copy object.
- [ ] `components/TaxPlanTimeline.tsx`: delete `dateLabel` and call `fmtDateShort(value, language)` (its inputs are date-only, so the output is identical); replace the inline `Intl.DateTimeFormat(…)` month label with `fmtMonth(month.yearMonth, language)`; the active month heading and its aria-label read `fmtMonth(month.yearMonth, language, { year: true })` instead of `month.label`; `compactKrw` calls `localeFor(language)`. In `lib/tax-planning.ts`, stop building `label` and remove it from the month type (stored plans that still carry the field are read structurally and unaffected; add one line to the type's comment). The `language` prop loses its `'en'` default; both callers already pass it.
- [ ] `components/AutoRefresh.tsx`: the `'ko-KR' : 'en-US'` ternary becomes `localeFor(language)`.
- [ ] Run `node scripts/ui-guardrails.mjs`: G9 is 0 everywhere; G1 is 0 for `components/AutoRefresh.tsx` and `components/TaxPlanTimeline.tsx`; G6 drops by one in `components/TaxPlanTimeline.tsx`. Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): date, month and duration formatters take the language`.

### Task 9: One empty value, one sign rule, and percentages through `fmtPct`

**Files:**
- Modify: `lib/format.ts`, `lib/ui-copy/common.ts`, `lib/ui-copy/pages/holdings.ts`, `lib/ui-copy/pages/positionDetail.ts`, `lib/ui-copy/pages/overview.tsx`, `components/ui.tsx` (`Signed`), `components/charts.tsx`
- Modify: every file in the G6 baseline (23 files) and the sign and percent sites (`app/page.tsx`, `app/crypto-premium/page.tsx`, `app/tax-planning/plans/[id]/page.tsx`, `app/tax-planning/components.tsx`, `app/tax-planning/page.tsx`, `app/tax-planning/opportunity-analysis.tsx`, `app/rebalance/page.tsx`, `app/rebalance/proposals/[id]/page.tsx`, `app/daily-briefing/page.tsx`, `components/TaxPlanTimeline.tsx`)
- Modify: `tests/cash-inflow-format.test.ts` if its `fmtPct` calls change shape; create `tests/format-sign.test.ts`
- Modify: `scripts/ui-guardrails.baseline.json` (lower only)

**Interfaces:**
- Produces, in `lib/format.ts`: `fmtPct(value, { digits?: number; signed?: boolean; unit?: '%' | 'pp'; nullText?: string })` (add the options that are missing; defaults keep today's output: digits 2, unsigned, `%`); `fmtPctRange(lower, upper, digits)` returning `${lo}–${hi}%`; `fmtSigned(value: number | null | undefined, format: (n: number) => string): string` returning `+` plus `format(n)` for positive, `-` plus `format(|n|)` for negative, `format(0)` with no sign for zero, `EMPTY_VALUE` for null. `common.noValue` becomes `EMPTY_VALUE` in both languages (wording change: it read `No value` / `값 없음`); `holdings.noValue` and `positionDetail.noValue` are deleted and their readers use `getUiCopy(language).common.noValue`. `Signed`'s `nullText` default becomes `EMPTY_VALUE` and zero renders without a sign (wording change: `+0` becomes `0`).
- Consumes: Task 8's `EMPTY_VALUE`.

**Steps:**

- [ ] Write `tests/format-sign.test.ts`: `fmtSigned(5, String)` is `+5`, `fmtSigned(-5, String)` is `-5`, `fmtSigned(0, String)` is `0`, `fmtSigned(null, String)` is `EMPTY_VALUE`; `fmtPct(12.345, { digits: 1 })` is `12.3%`; `fmtPct(0, { signed: true })` has no `+`; `fmtPct(1.5, { unit: 'pp', digits: 1 })` is `1.5%p`; `fmtPctRange(1, 2.5, 1)` is `1.0–2.5%`; `fmtPct(null)` is `EMPTY_VALUE`; `getUiCopy('en').common.noValue === EMPTY_VALUE` and the same for `ko`. Run; expected FAIL.
- [ ] Implement the helpers and the copy change. Update `tests/cash-inflow-format.test.ts` only if the signature change breaks it. Run; expected PASS.
- [ ] Replace every `'n/a'` empty-value literal in `app/` and `components/` with `EMPTY_VALUE` (import from `lib/format`) or, where `copy` is already in hand, with `getUiCopy(language).common.noValue`; replace every `'—'` empty-value literal and the six bare JSX `—` runs in the proposal page the same way. The one JSX `n/a` badge on `/fx` becomes `{EMPTY_VALUE}`. Do not touch `'-'` sign prefixes, the `none` / `notAvailable` copy keys (already per language) or formatter zero outputs (`fmtNumber(null)` stays `0`; that is a separate question).
- [ ] Signs: every hand-written `>= 0 ? '+' : ''` and `> 0 ? '+' : '−'` becomes `fmtSigned` (the U+2212 site included; ASCII `-` everywhere, wording change); `deltaLabel` keeps its no-change threshold and delegates to `fmtSigned`; the seven `-{credit}` sites render `fmtSigned(-credit, money)` so a zero credit reads `₩0`, not `-₩0`; `Signed` implements the same rule as `fmtSigned`. `amount()` in the daily briefing keeps its own minus (it is a money formatter with a market symbol).
- [ ] Percentages: the fourteen `${fmtNumber(x, d)}%` templates become `fmtPct(x, { digits: d })`; the `%p` site becomes `fmtPct(x, { digits: 1, unit: 'pp', signed: true })`; the three ranges become `fmtPctRange`; the six raw `{n}%` renders in `app/page.tsx` become `fmtPct(n, { digits: 0 })`.
- [ ] Charts: the six `toLocaleString(…)` calls in `components/charts.tsx` become `fmtNumber(value, 1)` or `fmtNumber(value)` matching today's digits (locale pinned, so server and browser agree); `PortfolioTrendChart` takes a `valueName` prop for the tooltip series and `app/page.tsx` passes `copy.chartValueName` (new overview key: en `Value`, ko `값`). The `M` / `K` suffixes stay as they are (R6 owns chart units). `StackedAssetChart`'s `'—'` becomes `EMPTY_VALUE`.
- [ ] Run `node scripts/ui-guardrails.mjs`: G6 0 and G10 0 in every file; G5 drops only where a sign ternary was the hit (status-tone ternaries stay; they are R3's). Run `--update-baseline`; only decreases.
- [ ] Run the gates. Commit: `refactor(ui): one empty value, one sign rule, and percentages through fmtPct`.

### Task 10: Terminology decisions 1–3, the currency switch, and the switch labels

**Files:**
- Modify: `lib/glossary.ts`, `lib/ui-copy/pages/sidebar.ts`, `lots.ts`, `health.ts`, `accounts.ts`, `assetEvents.ts`, `overview.tsx`, `rebalanceSettings.ts`, `taxPlanning.ts`, `taxSettings.ts`, `netWorth.ts`, `fx.ts`, `pension.tsx`, `holdings.ts`, `realized.ts`
- Modify: `components/LanguageSwitcher.tsx`, `components/Sidebar.tsx`, `lib/currency.ts` (`DISPLAY_CURRENCY_LABELS`)
- Modify: `scripts/ui-guardrails.baseline.json` (lower only)

**Interfaces:**
- Consumes: `getPageCopy('sidebar', language)` keys `language`, `currency`, `assets`.
- Produces: `sidebar.currencies: Record<'KRW' | 'USD', string>` (en `KRW` / `USD`, ko `원화` / `달러`); `LanguageSwitcher`, `CurrencySwitcher` and `AssetViewSwitcher` take their group `label` from copy.

**Steps:**

- [ ] Tax-lot term (decision 1): replace `세금 계산 단위` with `세금 단위` at every occurrence (glossary label, the sidebar entry for `/lots`, `lots.title`, the health lines); replace `매수 단위` in the glossary's long-term and short-term descriptions with `세금 단위`; the glossary's ko `alias` becomes `세금 단위` too. In every ko copy value that still says `lot`, `Lot`, `Tax lot` or `tax-lot` (about 52 lines across `accounts.ts`, `assetEvents.ts`, `overview.tsx`, `rebalanceSettings.ts`, `taxPlanning.ts`, `taxSettings.ts`), write `세금 단위` (`accounts.ts` ko `lots: 'Tax lot'` becomes `세금 단위`; `lot 매칭 방식` becomes `세금 단위 매칭 방식`; `특정 lot 지정` becomes `특정 세금 단위 지정`). English stays `Tax lot`; `Tax Lots` as a sidebar and page title is unchanged. Do not touch the `'Tax lot'` fixtures in `tests/ui-guardrails.test.ts`.
- [ ] Market value (decision 2): replace `평가액` with `평가금액` at the sixteen sites in `netWorth.ts`, `fx.ts`, `overview.tsx`, `pension.tsx` and `taxPlanning.ts` (`월말 평가액` becomes `월말 평가금액`; `장기 평가액` / `단기 평가액` become `장기 평가금액` / `단기 평가금액`; `미배분 보유 평가액` becomes `미배분 보유 평가금액`). The `평가금액` strings in `tests/pension-*.test.ts` are broker statement headers; do not touch.
- [ ] Position column (decision 3): `holdings.ts`, `lots.ts` and `realized.ts` en `instrument: 'Instrument'` become `'Position'` (keys unchanged; ko stays 종목). `rebalanceSettings` `Instrument classes` stays. The `Instrument` strings in tests are the Robinhood CSV header; do not touch.
- [ ] Switch labels: `LanguageSwitcher`, `CurrencySwitcher` and `AssetViewSwitcher` take their group `label` from `copy.language`, `copy.currency`, `copy.assets` passed by `Sidebar`; `CurrencySwitcher` takes `labels={copy.currencies}` the way `AssetViewSwitcher` already does; `DISPLAY_CURRENCY_LABELS` in `lib/currency.ts` is deleted if nothing else reads it (search first). Wording change: the English page's currency buttons read `KRW` / `USD` instead of Korean.
- [ ] Run `node scripts/ui-guardrails.mjs`: G12 drops in `taxPlanning.ts` (the lot lines), `accounts.ts`, `assetEvents.ts`, `overview.tsx`, `rebalanceSettings.ts`, `taxSettings.ts`. Run `--update-baseline`; only decreases.
- [ ] Run `pnpm exec tsx --test tests/page-headings.test.ts tests/page-names.test.ts`; expected PASS (the `/lots` sidebar label and page title change together).
- [ ] Run the gates. Commit: `fix(ui): one Korean tax-lot term, one market-value term, Position as the English column, and translated switch labels`.
