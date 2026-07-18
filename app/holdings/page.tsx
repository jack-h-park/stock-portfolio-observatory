import { PageHeader } from '@/components/PageHeader'
import { HoldingsTable } from '@/components/PortfolioTables'
import { Card } from '@/components/ui'
import { getHoldings } from '@/lib/adapters/portfolio-db'

export const dynamic = 'force-dynamic'

export default function HoldingsPage() {
  const rows = getHoldings(500)
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Holdings"
        emphasis="Holdings"
        subtitle={`${rows.length} current positions with search, account filters, sorting, and position drilldown.`}
      />
      <Card title="Current holdings">
        <HoldingsTable rows={rows} />
      </Card>
    </>
  )
}
