import { createElement, type ReactNode } from 'react'
import type { DataOpsQueueKind } from '@/lib/adapters/portfolio-db'
import { fmtNumber } from '@/lib/format'
import type { Language } from '@/lib/i18n'
import { ISSUE_SEVERITY, POSITION_BREAK_SEVERITY, type IssueSeverity, type Severity } from '@/lib/tone'
import { getUiCopy, type getPageCopy } from '@/lib/ui-copy'

/**
 * The page's one-line verdict in its header. When it reports a problem, `href`
 * points at the card that lists it (`#<card id>`).
 */
export type HeaderStatus = { severity: Severity; label: ReactNode; href?: string }

/**
 * A header pill that links to a card, and that card's count badge: one count
 * and one severity for both. A pill that said "3" in yellow and led to a red
 * "2" was reporting a different issue from the card it pointed at, so each page
 * builds the pair here from one source and passes `status` to its PageHeader
 * and `issues` to the card.
 */
export type LinkedIssues = {
  status: HeaderStatus | undefined
  issues: { count: number; severity: IssueSeverity; capped?: true }
}

/**
 * The most position breaks the adapter returns (`limit 100` in
 * `readPositionBreaks`, pinned by tests/count-agreement.test.ts). A list that
 * long may have been cut, so its length is a lower bound, not a count.
 */
export const POSITION_BREAK_CAP = 100

/** Whether a position-break count is the adapter's cap rather than the real number. */
export function positionBreaksCapped(count: number): boolean {
  return count >= POSITION_BREAK_CAP
}

/** A count for display: `100+` when it is a lower bound, the plain number otherwise. */
export function fmtCount(count: number, capped: boolean | undefined, language: Language): string {
  return capped ? getUiCopy(language).common.countAtLeast(fmtNumber(count)) : fmtNumber(count)
}

/** Every linked card on the pages below lists items to look at; only the pages that say why read worse. */
const TO_REVIEW: IssueSeverity = 'attention'

function linkedIssues(
  count: number,
  severity: IssueSeverity,
  href: string,
  label: (count: number) => ReactNode,
  clear: HeaderStatus | undefined,
  capped = false,
): LinkedIssues {
  return {
    status: count > 0 ? { severity, label: label(count), href } : clear,
    issues: capped ? { count, severity, capped: true } : { count, severity },
  }
}

/** /health: failed checks plus stale sources; an error check or a missing source makes it a problem. */
export function healthLinkedIssues(
  copy: ReturnType<typeof getPageCopy<'health'>>,
  input: { failed: number; errors: number; stale: number; missing: number },
): LinkedIssues {
  const severity = ISSUE_SEVERITY[input.errors > 0 || input.missing > 0 ? 'error' : 'warning']
  return linkedIssues(
    input.failed + input.stale,
    severity,
    '#health-operational-status',
    (n) => copy.needsReview(fmtNumber(n)),
    { severity: 'ok', label: copy.allChecksPassed },
  )
}

/** /data-map: drifted and missing files; a missing file makes it a problem. */
export function dataMapLinkedIssues(
  copy: ReturnType<typeof getPageCopy<'dataMap'>>,
  summary: { missing: number; drift: number },
): LinkedIssues {
  return linkedIssues(
    summary.missing + summary.drift,
    ISSUE_SEVERITY[summary.missing > 0 ? 'error' : 'warning'],
    '#data-map-review-queue',
    (n) => copy.reviewItems(fmtNumber(n)),
    { severity: 'ok', label: copy.allMapped },
  )
}

/** The items an action queue holds: each row carries how many it stands for. */
function queueCount(queue: readonly { count: number }[]) {
  return queue.reduce((sum, item) => sum + item.count, 0)
}

/**
 * /data-ops: the KPI tiles under the queue headline, each read from the queue
 * rows it stands for, so the tiles always sum to the headline. Mapping counts
 * the income rows the suggested rules would map, as the queue row does, and so
 * does the suggestions card's badge (`mappingSuggestionRows`).
 */
export function dataOpsQueueTiles(queue: readonly { kind: DataOpsQueueKind; count: number }[]) {
  const of = (...kinds: DataOpsQueueKind[]) => queueCount(queue.filter((item) => kinds.includes(item.kind)))
  return {
    mapping: of('manual_mappings'),
    valuation: of('valuation'),
    sourceCheck: of('validation', 'source_freshness'),
    breaks: of('position_breaks'),
  }
}

/**
 * The income rows a list of mapping suggestions would map: the suggestions
 * card's badge, so it reports the number the mapping tile and queue row show
 * rather than how many suggestions the card lists.
 */
export function mappingSuggestionRows(suggestions: readonly { row_count: number | null }[]): number {
  return suggestions.reduce((sum, row) => sum + Number(row.row_count ?? 0), 0)
}

/** Whether a queue row's count is a lower bound: only the position-break row is capped, by the adapter. */
export function queueRowCapped(row: { kind: DataOpsQueueKind; count: number }): boolean {
  return row.kind === 'position_breaks' && positionBreaksCapped(row.count)
}

/**
 * /data-ops: the priority-work queue, counted by the items its rows stand for.
 * When the position-break row is capped the sum is a lower bound too, and the
 * pill, the card badge and the headline all say so.
 */
export function dataOpsLinkedIssues(
  copy: ReturnType<typeof getPageCopy<'dataOps'>>,
  queue: readonly { kind: DataOpsQueueKind; count: number }[],
  language: Language,
): LinkedIssues {
  const capped = queue.some(queueRowCapped)
  return linkedIssues(
    queueCount(queue),
    TO_REVIEW,
    '#data-ops-priority-work',
    (n) => copy.needsReview(fmtCount(n, capped, language)),
    { severity: 'ok', label: copy.noPending },
    capped,
  )
}

/**
 * The Overview: the /data-ops work queue, the same count, label and severity
 * as the /data-ops pill, linking to that queue. It used to count failed checks
 * plus stale stock sources under the same "operations review" label, so the
 * two pills named one thing and showed two numbers.
 */
export function overviewLinkedStatus(
  dataOpsCopy: ReturnType<typeof getPageCopy<'dataOps'>>,
  queue: readonly { kind: DataOpsQueueKind; count: number }[],
  language: Language,
  healthy: ReactNode,
): HeaderStatus {
  const { status } = dataOpsLinkedIssues(dataOpsCopy, queue, language)
  return status && queueCount(queue) > 0 ? { ...status, href: '/data-ops#data-ops-priority-work' } : { severity: 'ok', label: healthy }
}

/**
 * /reconciliation: the position breaks its breaks card lists, a confirmed
 * discrepancy each, so a problem (`POSITION_BREAK_SEVERITY`, which the
 * /data-ops breaks tile reads too). The hero reads the same count; the work
 * queue that also counted stale sources and valuation gaps lives on /data-ops.
 */
export function reconciliationLinkedIssues(
  copy: ReturnType<typeof getPageCopy<'reconciliation'>>,
  breaks: number,
  language: Language,
): LinkedIssues {
  const capped = positionBreaksCapped(breaks)
  return linkedIssues(
    breaks,
    POSITION_BREAK_SEVERITY.some,
    '#reconciliation-breaks',
    (n) => copy.reviewItems(fmtCount(n, capped, language)),
    { severity: 'ok', label: copy.reconciled },
    capped,
  )
}

/**
 * /review: stale operational inputs. The card that listed them moved to
 * /health, so the pill still reports the count but links nowhere and no card
 * on the page carries a matching badge.
 */
export function reviewLinkedIssues(copy: ReturnType<typeof getPageCopy<'review'>>, stale: number): { status: HeaderStatus } {
  return { status: stale > 0 ? { severity: TO_REVIEW, label: copy.freshnessIssues(stale) } : { severity: 'ok', label: copy.ready } }
}

/**
 * /rebalance: what to hold or watch before acting — positions without a usable
 * valuation plus stale inputs, the set the hold/watch card lists and the hero's
 * "watch before action" figure counts. The pill used to count only the stale
 * inputs, so it read "inputs ready" above a card listing valuation blockers.
 */
export function rebalanceLinkedIssues(
  copy: ReturnType<typeof getPageCopy<'rebalance'>>,
  input: { watch: number; freshness: number },
): LinkedIssues {
  return linkedIssues(input.watch + input.freshness, TO_REVIEW, '#rebalance-hold-watch', (n) => copy.holdWatchItems(n), {
    severity: 'ok',
    label: copy.inputsReady,
  })
}

/**
 * /tax-planning: planner warnings plus stale inputs, the set its warnings card
 * lists (the card renders only when there are some). With warnings the pill
 * also names the example assumptions, so that caveat never drops out; the
 * example assumptions alone have no card to link to, and a page with neither
 * shows no pill.
 */
export function taxPlanningLinkedIssues(
  copy: ReturnType<typeof getPageCopy<'taxPlanning'>>,
  input: { warnings: number; example: boolean },
): LinkedIssues {
  const example: HeaderStatus | undefined = input.example
    ? { severity: TO_REVIEW, label: copy.page.usingExampleAssumptions }
    : undefined
  return linkedIssues(
    input.warnings,
    TO_REVIEW,
    '#tax-planning-warnings',
    (n) => (input.example ? copy.page.warningsAndExample(fmtNumber(n), n) : copy.page.warningsCount(fmtNumber(n), n)),
    example,
  )
}

/**
 * One status for a header that has a linkable issue and a count of rows
 * converted at today's rate. The issue wins and carries the link; when both
 * are non-zero one label names both, so the header never shows an all-clear
 * beside a warning. The undated count alone has nowhere to link.
 */
function issueStatus(
  issue: number,
  undated: number,
  href: string,
  labels: { issue: () => ReactNode; undated: () => ReactNode; both: () => ReactNode },
  clear?: HeaderStatus,
): HeaderStatus | undefined {
  if (issue > 0) return { severity: TO_REVIEW, label: undated > 0 ? labels.both() : labels.issue(), href }
  if (undated > 0) return { severity: 'attention', label: labels.undated() }
  return clear
}

export function incomeHeaderStatus(copy: ReturnType<typeof getPageCopy<'income'>>, tickerless: number, undated: number): HeaderStatus {
  return issueStatus(
    tickerless,
    undated,
    '#income-tickerless',
    {
      issue: () => copy.tickerlessRows(fmtNumber(tickerless)),
      undated: () => copy.undatedRows(fmtNumber(undated)),
      both: () => copy.tickerlessAndUndated(fmtNumber(tickerless), fmtNumber(undated)),
    },
    { severity: 'ok', label: copy.tickerMapped },
  )!
}

/** /income: the pill counts tickerless rows, and so does the card's badge (the card lists them grouped, at most 20 groups). */
export function incomeLinkedIssues(copy: ReturnType<typeof getPageCopy<'income'>>, tickerless: number, undated: number): LinkedIssues {
  return { status: incomeHeaderStatus(copy, tickerless, undated), issues: { count: tickerless, severity: TO_REVIEW } }
}

/** `triageHref` is the page URL that opens the unclassified filter, keeping the source, currency and range. */
export function cashInflowHeaderStatus(
  copy: ReturnType<typeof getPageCopy<'cashInflow'>>,
  unclassified: number,
  undated: number,
  triageHref: string,
): HeaderStatus | undefined {
  // The hint explains how to classify a credit, so it rides on the pill that links to the triage card.
  const hinted = (label: string) => createElement('span', { title: copy.unclassifiedHint }, label)
  return issueStatus(unclassified, undated, `${triageHref}#cash-inflow-unclassified`, {
    issue: () => hinted(copy.unclassified(fmtNumber(unclassified))),
    undated: () => copy.undated(fmtNumber(undated)),
    both: () => hinted(copy.unclassifiedAndUndated(fmtNumber(unclassified), fmtNumber(undated))),
  })
}
