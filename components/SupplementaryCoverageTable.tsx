import { DataTable } from '@/components/DataTable'
import { Badge } from '@/components/ui'
import type { AccountDataRange } from '@/lib/account-ranges'
import type { SupplementaryCoverageRow } from '@/lib/adapters/portfolio-db'
import { maskAccountLabel } from '@/lib/account-label'
import { fmtDate, fmtNumber } from '@/lib/format'

export function SupplementaryCoverageTable({ rows, language, accounts }: {
  rows: SupplementaryCoverageRow[]
  language: string
  /** When supplied, show historical bank accounts too, with their balance spans. */
  accounts?: AccountDataRange[]
}) {
  const ko = language === 'ko'
  const kinds = ko
    ? { deposit: '예금', cma: 'CMA', pension: '연금', gold: '금현물', gold_price: '금 시세' }
    : { deposit: 'Deposits', cma: 'CMA', pension: 'Pension', gold: 'Gold', gold_price: 'Gold price' }
  const statuses = ko
    ? { action_needed: '업데이트 필요', missing: '자료 없음', due_soon: '곧 필요', current: '현재 기준' }
    : { action_needed: 'Update needed', missing: 'No data', due_soon: 'Due soon', current: 'Current' }
  const nextAction = (coverage: SupplementaryCoverageRow) => {
    if (ko) return maskAccountLabel(coverage.action)
    if (coverage.kind === 'gold_price') return 'Refresh KRX gold prices.'
    if (coverage.kind === 'pension') return 'Capture current holdings and file the pension CSV in inbox.'
    return coverage.latestDate
      ? `Download ${kinds[coverage.kind].toLowerCase()} history from ${fmtDate(coverage.latestDate)} and place it in inbox.`
      : 'Download the full available history and place it in inbox.'
  }
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
    caption={ko ? '은행·CMA 및 추가 자료 업데이트' : 'Bank, CMA and supplementary updates'}
    rows={data}
    getRowKey={row => row.label}
    emptyMessage={ko ? '등록된 자료가 없습니다.' : 'No registered sources.'}
    columns={[
      { key: 'account', label: ko ? '계좌·자료' : 'Account / source', render: (row: typeof data[number]) => <div className="min-w-40 font-medium">{maskAccountLabel(row.label)}</div> },
      ...(accounts ? [{ key: 'range', label: ko ? '잔고 기록 기간' : 'Balance history period', render: (row: typeof data[number]) => {
        const range = row.account?.ranges.balances
        return range?.start && range.end ? <>
          <div className="tabular-nums"><span className="whitespace-nowrap">{fmtDate(range.start)}</span>{range.end !== range.start ? <> ~ <span className="whitespace-nowrap">{fmtDate(range.end)}</span></> : null}</div>
          <div className="text-label text-ink-3">{fmtNumber(range.count)}{ko ? '건' : ' records'}</div>
        </> : '—'
      } }] : []),
      { key: 'coverage', label: ko ? '반영 기준일' : 'Covered through', render: (row: typeof data[number]) => <>
        <div className="whitespace-nowrap tabular-nums">{fmtDate(row.coverage?.latestDate)}</div>
        {row.coverage ? <div className="text-label text-ink-3">{kinds[row.coverage.kind]} · {ko ? `${row.coverage.maxLagDays}일 기준` : `${row.coverage.maxLagDays}-day window`}</div> : null}
      </> },
      { key: 'status', label: ko ? '상태' : 'Status', render: (row: typeof data[number]) => row.coverage
        ? <Badge tone={row.coverage.status === 'current' ? 'success' : row.coverage.status === 'due_soon' ? 'warning' : 'danger'}>{statuses[row.coverage.status]}</Badge>
        : <Badge>{ko ? '종료 계좌' : 'Closed account'}</Badge> },
      { key: 'next', label: ko ? '다음 다운로드·조치' : 'Next download / action', render: (row: typeof data[number]) => <div className="max-w-80 text-label leading-relaxed text-ink-2">{row.coverage ? nextAction(row.coverage) : ko ? '추가 다운로드 불필요 · 과거 기록 보존' : 'No further downloads · history retained'}</div> },
    ]}
  />
}
