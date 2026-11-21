import { readCoverageFreshness } from '@/lib/application/coverage-freshness'
import {AccountUpdateAction} from '@/components/AccountUpdateAction'
import { getPageCopy } from '@/lib/ui-copy'
import type { Language } from '@/lib/i18n'
import { DataTable } from '@/components/DataTable'
import { Badge } from '@/components/ui'
import type { AccountDataRange } from '@/lib/account-ranges'
import {portfolioToday} from '@/lib/adapters/portfolio-db'
import type { SupplementaryCoverageRow } from '@/lib/adapters/portfolio-db'
import { maskAccountLabel } from '@/lib/account-label'
import { fmtDate, fmtNumber } from '@/lib/format'
import { COVERAGE_SEVERITY, SUPPLEMENTARY_FRESHNESS_TONE, statusTone } from '@/lib/tone'

export function SupplementaryCoverageTable({ rows, language, accounts }: {
  rows: SupplementaryCoverageRow[]
  language: Language
  /** When supplied, show historical bank accounts too, with their balance spans. */
  accounts?: AccountDataRange[]
}) {
  const copy = getPageCopy('accountUpdates', language)
  const freshnessCopy = getPageCopy('coverageSummary', language)
  const nextAction = (coverage: SupplementaryCoverageRow) => coverage.historyGap ? <>{copy.historyGap(fmtDate(coverage.historyGap.from, language), fmtDate(coverage.historyGap.to, language))}{coverage.staleWithHistoryGap ? <> {copy.action(coverage.kind, coverage.latestDate ? fmtDate(coverage.latestDate, language) : null, coverage.action, fmtDate(portfolioToday(), language))}</> : null}</> : maskAccountLabel(copy.action(
    coverage.kind, coverage.latestDate ? fmtDate(coverage.latestDate, language) : null, coverage.action, fmtDate(portfolioToday(), language),
  ))
  const data = rows.map(coverage => ({
    label: coverage.label,
    coverage: coverage as SupplementaryCoverageRow | undefined,
    account: accounts?.find(account => `${account.brokerage} ${account.name}` === coverage.label),
  }))
  for (const account of accounts ?? []) {
    const label = `${account.brokerage} ${account.name}`
    if (!data.some(row => row.label === label)) data.push({ label, account, coverage: undefined })
  }
  return <DataTable
    caption={copy.caption}
    rows={data}
    getRowKey={row => row.label}
    emptyMessage={copy.empty}
    columns={[
      { key: 'account', label: copy.account, render: (row: typeof data[number]) => <div className="min-w-40 font-medium">{maskAccountLabel(row.label)}</div> },
      ...(accounts ? [{ key: 'range', label: copy.range, render: (row: typeof data[number]) => {
        const range = row.account?.ranges.balances
        return range?.start && range.end ? <>
          <div className="tabular-nums"><span className="whitespace-nowrap">{fmtDate(range.start, language)}</span>{range.end !== range.start ? <> ~ <span className="whitespace-nowrap">{fmtDate(range.end, language)}</span></> : null}</div>
          <div className="text-label text-ink-3">{copy.rows(fmtNumber(range.count))}</div>
        </> : copy.none
      } }] : []),
      { key: 'coverage', label: copy.coverage, render: (row: typeof data[number]) => <>
        <div className="whitespace-nowrap tabular-nums">{fmtDate(row.coverage?.latestDate, language)}</div>
        {row.coverage ? <div className="text-label text-ink-3">{copy.kinds[row.coverage.kind]} · {copy.window(row.coverage.maxLagDays)}</div> : null}
      </> },
      { key: 'freshness', label: freshnessCopy.sourceFreshness, render: (row: typeof data[number]) => {
        if (!row.coverage) return copy.none
        const state = readCoverageFreshness(row.coverage)
        return state === null ? <span className="text-label text-ink-3">{freshnessCopy.unavailable}</span>
          : <Badge tone={SUPPLEMENTARY_FRESHNESS_TONE[state]}>{copy.statuses[state]}</Badge>
      } },
      { key: 'historyGap', label: freshnessCopy.recordedGap, render: (row: typeof data[number]) => {
        if (!row.coverage) return copy.none
        const gap = row.coverage.historyGap
        return gap ? <span className="tabular-nums">{fmtDate(gap.from, language)} ~ {fmtDate(gap.to, language)}</span>
          : <span className="text-label text-ink-3">{freshnessCopy.noRecordedGap}</span>
      } },
      { key: 'status', label: copy.status, render: (row: typeof data[number]) => row.coverage
        ? <Badge tone={statusTone(COVERAGE_SEVERITY, row.coverage.status)}>{copy.statuses[row.coverage.status]}</Badge>
        : <Badge>{copy.closed}</Badge> },
      { key: 'next', label: copy.next, render: (row: typeof data[number]) => <div className="max-w-80 text-label leading-relaxed text-ink-2">{row.coverage ? <AccountUpdateAction status={row.coverage.status} language={language} confirmation={copy.unconfirmedAction(row.coverage.kind, maskAccountLabel(row.coverage.label)) ?? maskAccountLabel(row.coverage.action)}>{nextAction(row.coverage)}</AccountUpdateAction> : copy.closedAction}</div> },
    ]}
  />
}
