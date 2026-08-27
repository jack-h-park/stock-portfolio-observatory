import { PortfolioMultiTrendChart } from '@/components/charts'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, MetricField, MetricHeroCard } from '@/components/ui'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getFxDashboard } from '@/lib/adapters/portfolio-db'
import { fmtNumber } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

const COPY = {
  en: {
    eyebrow: 'Detailed Records', title: 'FX Exchange & Gain', emphasis: 'FX',
    subtitle: (count: string) => `${count} net KRW/USD exchanges from Toss Securities and Hana Bank.`,
    qualityOk: 'FX ledger current', qualityGap: (count: string) => `${count} transfer gap(s)`,
    deployed: 'KRW Exchanged', acquired: 'USD acquired', avg: 'Weighted Average Rate',
    savings: 'Estimated Spread Savings', savingsHint: 'Hana savings versus the full published TT-send spread',
    realized: 'Realized FX Gain/Loss', realizedNone: 'Not realized',
    realizedHint: 'Owned-account USD transfers carry basis and do not realize FX gain. No explicit USD→KRW sale is present.',
    method: 'Rate & Coverage Status', actual: 'Actual rate rows', estimated: 'Estimated rate rows', transfers: 'USD transfer rows',
    missing: 'Mirae 9346 gaps', balance: 'Latest Hana USD balance', current: 'Current USD/KRW snapshot',
    institutions: 'By Institution', trend: 'Monthly Weighted Exchange Rate', transferReview: 'Transfer Review', recent: 'Recent FX Ledger',
    date: 'Date', institution: 'Institution', type: 'Event', usd: 'USD', krw: 'KRW', rate: 'Rate', status: 'Rate status',
    counterparty: 'Counterparty', match: 'Match status', source: 'Source', accountBalance: 'Latest USD balance',
    preference: 'Preference', count: 'Exchanges', note: 'Evidence note',
    estimateNote: 'Hana annual PDF rows use the first published daily TT-send spread with a user-confirmed 90% preference. They remain marked estimated because transaction times are absent.',
  },
  ko: {
    eyebrow: '상세 기록', title: '환전 · 환차익', emphasis: '환전',
    subtitle: (count: string) => `토스증권과 하나은행의 원/달러 순환전 ${count}건입니다.`,
    qualityOk: 'FX 원장 최신', qualityGap: (count: string) => `이체 미연결 ${count}건`,
    deployed: '환전한 원화', acquired: '취득한 달러', avg: '가중평균 환율',
    savings: '추정 환율우대 절감액', savingsHint: '하나은행 고시 송금 보낼 때 환율의 우대 전 스프레드 대비 절감액',
    realized: '실현 환차익', realizedNone: '미실현',
    realizedHint: '본인 계좌 간 달러 이체는 취득원가를 승계하며 환차익을 실현하지 않습니다. 명시적인 달러→원화 매도는 현재 없습니다.',
    method: '환율 · 원장 상태', actual: '실제 환율 행', estimated: '추정 환율 행', transfers: '달러 이체 행',
    missing: '미래에셋 9346 미연결', balance: '최근 하나은행 달러 잔액', current: '현재 USD/KRW 스냅샷',
    institutions: '기관별 현황', trend: '월별 가중평균 환율', transferReview: '이체 검토', recent: '최근 FX 원장',
    date: '일자', institution: '기관', type: '유형', usd: '달러', krw: '원화', rate: '환율', status: '환율 상태',
    counterparty: '상대 기관', match: '연결 상태', source: '원본', accountBalance: '최근 달러 잔액',
    preference: '우대율', count: '환전 건수', note: '근거 메모',
    estimateNote: '하나은행 연간 PDF 행은 거래시각이 없어 당일 최초 고시 송금 스프레드와 사용자가 확인한 90% 우대율로 추정했습니다. 모든 행은 실제값이 아닌 추정값으로 표시됩니다.',
  },
} as const

export default async function FxPage() {
  const language = await getLanguage()
  const copy = COPY[language]
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const data = getFxDashboard(100)
  const hana = data.institutions.find((item) => item.institution === 'Hana Bank')
  const chartData = data.monthly.map((item) => ({ date: item.month, rate: item.averageRate }))
  const missingTransfers = data.transfers.filter((event) => event.match_status === 'destination_account_missing')
  const eventLabel = (event: any) => event.event_type === 'TRANSFER' ? (event.direction === 'IN' ? 'Transfer in' : 'Transfer out') : event.event_type === 'EXCHANGE_CANCEL' ? 'Cancellation' : 'Buy USD'
  const rateBadge = (status: string) => status === 'actual' ? <Badge tone="success">{language === 'ko' ? '실제' : 'Actual'}</Badge> : status === 'estimated' ? <Badge tone="warning">{language === 'ko' ? '추정' : 'Estimated'}</Badge> : <Badge tone="neutral">n/a</Badge>

  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtNumber(data.summary.exchangeCount))}
        action={data.summary.missingDestinationCount ? <Badge tone="warning">{copy.qualityGap(fmtNumber(data.summary.missingDestinationCount))}</Badge> : <Badge tone="success">{copy.qualityOk}</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard title={copy.deployed} eyebrow="KRW → USD" value={money(data.summary.krwSpent)} hint={`${copy.acquired}: ${money(data.summary.usdBought, 'USD')}`}>
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField label={copy.avg} value={data.summary.weightedAverageRate == null ? 'n/a' : `₩${fmtNumber(data.summary.weightedAverageRate, 2)}`} hint="KRW per USD" valueClassName="text-title" />
            <MetricField label={copy.savings} value={money(data.summary.spreadSavingsKrw)} hint={copy.savingsHint} tone="success" valueClassName="text-title" />
            <MetricField label={copy.realized} value={data.summary.realizedFxGlKrw == null ? copy.realizedNone : money(data.summary.realizedFxGlKrw)} hint={copy.realizedHint} valueClassName="text-title" />
          </div>
        </MetricHeroCard>

        <Card title={copy.method}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <MetricField label={copy.actual} value={fmtNumber(data.summary.actualCount)} hint="Toss statement rates + one Hana XLS rate" valueClassName="text-metric" />
            <MetricField label={copy.estimated} value={fmtNumber(data.summary.estimatedCount)} hint="Hana historical rows" tone="warning" valueClassName="text-metric" />
            <MetricField label={copy.transfers} value={fmtNumber(data.summary.transferCount)} hint={`${copy.missing}: ${fmtNumber(data.summary.missingDestinationCount)}`} valueClassName="text-title" />
            <MetricField label={copy.balance} value={hana?.latestBalanceUsd == null ? 'n/a' : money(hana.latestBalanceUsd, 'USD')} hint={hana?.latestBalanceDate ?? 'n/a'} valueClassName="text-title" />
            <MetricField label={copy.current} value={data.summary.currentUsdKrw == null ? 'n/a' : `₩${fmtNumber(data.summary.currentUsdKrw, 2)}`} hint={data.summary.currentUsdKrwAsOf ?? 'n/a'} valueClassName="text-title" />
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.institutions}>
          <DataTable rows={data.institutions} columns={[
            { key: 'institution', label: copy.institution },
            { key: 'exchangeCount', label: copy.count, align: 'right', render: (r) => fmtNumber(r.exchangeCount) },
            { key: 'usdBought', label: copy.usd, align: 'right', render: (r) => money(r.usdBought, 'USD') },
            { key: 'krwSpent', label: copy.krw, align: 'right', render: (r) => money(r.krwSpent) },
            { key: 'weightedAverageRate', label: copy.rate, align: 'right', render: (r) => r.weightedAverageRate == null ? 'n/a' : `₩${fmtNumber(r.weightedAverageRate, 2)}` },
            { key: 'latestBalanceUsd', label: copy.accountBalance, align: 'right', priority: 'secondary', render: (r) => r.latestBalanceUsd == null ? 'n/a' : money(r.latestBalanceUsd, 'USD') },
          ]} />
        </Card>
        <Card title={copy.trend}>
          <PortfolioMultiTrendChart data={chartData} series={[{ dataKey: 'rate', name: 'KRW/USD', color: 'var(--brand-blue)' }]} height={290} valuePrefix="₩" valueSuffix="" axisLabel="KRW per USD" />
          <p className="mt-2 text-label leading-relaxed text-ink-3">{copy.estimateNote}</p>
        </Card>
      </div>

      <Card title={copy.transferReview} className="mb-5" info={copy.realizedHint}>
        <DataTable rows={missingTransfers} emptyMessage={language === 'ko' ? '미연결 이체가 없습니다.' : 'No unmatched owned-account transfers.'} columns={[
          { key: 'date', label: copy.date },
          { key: 'institution', label: copy.institution },
          { key: 'direction', label: copy.type, render: eventLabel },
          { key: 'usd_amount', label: copy.usd, align: 'right', render: (r) => money(r.usd_amount, 'USD') },
          { key: 'counterparty', label: copy.counterparty, render: (r) => r.counterparty ?? 'Unknown' },
          { key: 'match_status', label: copy.match, render: () => <Badge tone="warning">{language === 'ko' ? '9346 원장 필요' : 'Needs 9346 ledger'}</Badge> },
          { key: 'note', label: copy.note, priority: 'secondary' },
        ]} />
      </Card>

      <Card title={copy.recent}>
        <DataTable rows={data.recent} getRowKey={(row) => row.id} columns={[
          { key: 'date', label: copy.date, nowrap: true, render: (r) => `${r.date}${r.time ? ` ${r.time}` : ''}` },
          { key: 'institution', label: copy.institution },
          { key: 'event_type', label: copy.type, render: eventLabel },
          { key: 'usd_amount', label: copy.usd, align: 'right', render: (r) => money(r.usd_amount, 'USD') },
          { key: 'krw_amount', label: copy.krw, align: 'right', render: (r) => r.krw_amount == null ? '—' : money(r.krw_amount) },
          { key: 'applied_rate', label: copy.rate, align: 'right', render: (r) => r.applied_rate == null ? '—' : `₩${fmtNumber(r.applied_rate, 2)}` },
          { key: 'rate_status', label: copy.status, render: (r) => rateBadge(r.rate_status) },
          { key: 'source', label: copy.source, priority: 'tertiary' },
        ]} />
      </Card>
    </>
  )
}
