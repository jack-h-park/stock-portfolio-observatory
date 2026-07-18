import { PageHeader } from '@/components/PageHeader'
import { TransactionsTable } from '@/components/PortfolioTables'
import { Card } from '@/components/ui'
import { getRecentTransactions } from '@/lib/adapters/portfolio-db'

export const dynamic = 'force-dynamic'

export default function TransactionsPage() {
  const rows = getRecentTransactions(200)
  return (
    <>
      <PageHeader eyebrow="Portfolio" title="Transactions" emphasis="Transactions" subtitle="Most recent ledger rows from the normalized transaction TSV." />
      <Card title="Recent transactions">
        <TransactionsTable rows={rows} />
      </Card>
    </>
  )
}
