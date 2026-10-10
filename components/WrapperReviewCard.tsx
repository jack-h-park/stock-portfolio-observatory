import { Badge, Card, Signed, type Tone } from '@/components/ui'
import { DataTable } from '@/components/DataTable'
import type { WrapperReviewRow } from '@/lib/adapters/portfolio-db'
import { fmtKrw, fmtNumber } from '@/lib/format'
import type { getPageCopy } from '@/lib/ui-copy'

type WrapperReviewCopy = ReturnType<typeof getPageCopy<'taxPlanning'>>['wrapperReview']

const TREATMENT_TONE: Record<string, Tone> = {
  taxable: 'info',
  undecided: 'warning',
  deferred: 'neutral',
  exempt_within_limit: 'neutral',
}

/**
 * "Needs review for US tax": one row per account under a non-brokerage wrapper,
 * with the US treatment the policy gives it. Renders nothing when there is none.
 */
export function WrapperReviewCard({ rows, copy }: { rows: WrapperReviewRow[]; copy: WrapperReviewCopy }) {
  if (!rows.length) return null
  return (
    <Card title={copy.title} info={copy.info} className="mb-5">
      {rows.some((row) => row.usTreatment === 'undecided') && (
        <p className="mb-3 text-label text-ink-3">{copy.undecidedNote}</p>
      )}
      <DataTable
        caption={copy.title}
        rows={rows}
        getRowKey={(row: WrapperReviewRow) => `${row.wrapper}:${row.account}`}
        columns={[
          { key: 'account', label: copy.account, render: (row: WrapperReviewRow) => <span className="text-ink">{row.account}</span> },
          { key: 'wrapper', label: copy.wrapper, nowrap: true, render: (row: WrapperReviewRow) => copy.wrappers[row.wrapper] ?? row.wrapper },
          {
            key: 'usTreatment',
            label: copy.treatment,
            nowrap: true,
            render: (row: WrapperReviewRow) => (
              <Badge tone={TREATMENT_TONE[row.usTreatment] ?? 'neutral'}>{copy.treatments[row.usTreatment] ?? row.usTreatment}</Badge>
            ),
          },
          {
            key: 'realizedGainKrw',
            label: copy.realizedGain,
            align: 'right',
            nowrap: true,
            render: (row: WrapperReviewRow) => <Signed value={row.realizedGainKrw} format={fmtKrw} />,
          },
          {
            key: 'dividendsKrw',
            label: copy.dividends,
            align: 'right',
            nowrap: true,
            render: (row: WrapperReviewRow) => <span className="font-mono">{fmtKrw(row.dividendsKrw)}</span>,
          },
          {
            key: 'likelyPficCount',
            label: copy.likelyPfics,
            description: copy.likelyPficsInfo,
            align: 'right',
            render: (row: WrapperReviewRow) => <span className="font-mono">{fmtNumber(row.likelyPficCount)}</span>,
          },
        ]}
      />
    </Card>
  )
}
