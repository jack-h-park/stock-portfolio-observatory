import { PageHeader } from '@/components/PageHeader'
import { CostBasisHoldingsTable } from '@/components/PortfolioTables'
import { Card } from '@/components/ui'
import { getCostBasisHoldings } from '@/lib/adapters/portfolio-db'

export const dynamic = 'force-dynamic'

export default function CostBasisPage() {
  const rows = getCostBasisHoldings(1000)
  const missingCost = rows.filter((row) => row.cost_status === 'missing_cost').length
  const estimated = rows.filter((row) => row.cost_status === 'estimated').length
  const priceDate = rows.find((row) => row.price_date)?.price_date ?? null

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Cost Basis"
        emphasis="Basis"
        subtitle={`${rows.length} holdings with current value and total cost review. ${missingCost} missing cost, ${estimated} estimated.`}
      />
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <Card title="Cost basis method">
          <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">
            <p>
              Use this table as the read-only source for holdings that need a current shares, value, and Total Cost check.
              Match by Symbol, Name, Account/Broker, and Shares, then use the Total Cost value in the holding currency.
            </p>
            <p>
              Cost values come from the observatory holdings snapshot. Rows marked Estimated are usable for review but
              should be checked against statements; for crypto-style activity, reconcile source cost as purchases minus
              the cost removed by sales and rewards/disposals.
            </p>
          </div>
        </Card>
        <Card title="Price basis">
          <div className="grid gap-2 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-3">Latest price date</span>
              <span className="font-medium tabular-nums text-ink">{priceDate ?? 'n/a'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-3">Missing cost rows</span>
              <span className={missingCost > 0 ? 'font-medium tabular-nums text-danger' : 'font-medium tabular-nums text-success'}>
                {missingCost}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-3">Estimated rows</span>
              <span className={estimated > 0 ? 'font-medium tabular-nums text-warning' : 'font-medium tabular-nums text-ink'}>
                {estimated}
              </span>
            </div>
          </div>
        </Card>
      </div>
      <Card title="Holdings cost basis">
        <CostBasisHoldingsTable rows={rows} />
      </Card>
    </>
  )
}
