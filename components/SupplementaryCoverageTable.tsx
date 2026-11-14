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

export function SupplementaryCoverageTable({ rows, language, accounts }: {
  rows: SupplementaryCoverageRow[]
  language: Language
  /** When supplied, show historical bank accounts too, with their balance spans. */
  accounts?: AccountDataRange[]
}) {
  const copy = getPageCopy('accountUpdates', language)
  const nextAction = (coverage: SupplementaryCoverageRow) => maskAccountLabel(copy.action(
    coverage.kind, coverage.latestDate ? fmtDate(coverage.latestDate) : null, coverage.action, fmtDate(portfolioToday()),
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
          <div className="tabular-nums"><span className="whitespace-nowrap">{fmtDate(range.start)}</span>{range.end !== range.start ? <> ~ <span className="whitespace-nowrap">{fmtDate(range.end)}</span></> : null}</div>
          <div className="text-label text-ink-3">{copy.rows(fmtNumber(range.count))}</div>
        </> : copy.none
      } }] : []),
      { key: 'coverage', label: copy.coverage, render: (row: typeof data[number]) => <>
        <div className="whitespace-nowrap tabular-nums">{fmtDate(row.coverage?.latestDate)}</div>
        {row.coverage ? <div className="text-label text-ink-3">{copy.kinds[row.coverage.kind]} · {copy.window(row.coverage.maxLagDays)}</div> : null}
      </> },
      { key: 'status', label: copy.status, render: (row: typeof data[number]) => row.coverage
        ? <Badge tone={row.coverage.status === 'current' ? 'success' : (row.coverage.status === 'due_soon' || row.coverage.status === 'unconfirmed') ? 'warning' : 'danger'}>{copy.statuses[row.coverage.status]}</Badge>
        : <Badge>{copy.closed}</Badge> },
      { key: 'next', label: copy.next, render: (row: typeof data[number]) => <div className="max-w-80 text-label leading-relaxed text-ink-2">{row.coverage ? <AccountUpdateAction status={row.coverage.status} language={language} confirmation={maskAccountLabel(row.coverage.action)}>{nextAction(row.coverage)}</AccountUpdateAction> : copy.closedAction}</div> },
    ]}
  />
}
