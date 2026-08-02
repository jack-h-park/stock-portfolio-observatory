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
        eyebrow="포트폴리오"
        title="보유종목"
        emphasis="보유종목"
        subtitle={`${rows.length}개 보유 포지션을 검색하고 시장·증권사·계좌별로 확인할 수 있습니다.`}
      />
      <Card title="현재 보유종목" info="평가금액과 취득원가를 비교하고 종목을 선택해 상세 내역으로 이동할 수 있습니다.">
        <HoldingsTable rows={rows} />
      </Card>
    </>
  )
}
