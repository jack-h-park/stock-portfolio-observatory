import { PageHeader } from '@/components/PageHeader'
import { LotsTable } from '@/components/PortfolioTables'
import { Card } from '@/components/ui'
import { getTaxLots } from '@/lib/adapters/portfolio-db'

export const dynamic = 'force-dynamic'

export default function LotsPage() {
  const rows = getTaxLots(1000)
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Tax Lots"
        emphasis="Lots"
        subtitle={`${rows.length} open lots with search, account filters, sorting, and ticker drilldown.`}
      />
      <Card title="Open tax lots">
        <LotsTable rows={rows} />
      </Card>
    </>
  )
}
