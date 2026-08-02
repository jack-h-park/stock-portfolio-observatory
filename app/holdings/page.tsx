import { PageHeader } from '@/components/PageHeader'
import { HoldingsTable } from '@/components/PortfolioTables'
import { Card } from '@/components/ui'
import { getHoldings } from '@/lib/adapters/portfolio-db'
import { getLanguage } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

const COPY = {
  en: {
    eyebrow: 'Portfolio',
    title: 'Holdings',
    emphasis: 'Holdings',
    subtitle: (count: number) => `Search ${count} open positions by market, broker, or account.`,
    cardTitle: 'Current Holdings',
    cardInfo: 'Compare market value with cost basis and open position details from the selected security.',
  },
  ko: {
    eyebrow: '포트폴리오',
    title: '보유종목',
    emphasis: '보유종목',
    subtitle: (count: number) => `${count}개 보유 포지션을 검색하고 시장·증권사·계좌별로 확인할 수 있습니다.`,
    cardTitle: '현재 보유종목',
    cardInfo: '평가금액과 취득원가를 비교하고 종목을 선택해 상세 내역으로 이동할 수 있습니다.',
  },
} as const

export default async function HoldingsPage() {
  const language = await getLanguage()
  const copy = COPY[language]
  const rows = getHoldings(500)
  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(rows.length)}
      />
      <Card title={copy.cardTitle} info={copy.cardInfo}>
        <HoldingsTable rows={rows} language={language} />
      </Card>
    </>
  )
}
