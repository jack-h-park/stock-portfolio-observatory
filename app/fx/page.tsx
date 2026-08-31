import { PortfolioMultiTrendChart } from '@/components/charts'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, MetricField, MetricHeroCard } from '@/components/ui'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getFxDashboard } from '@/lib/adapters/portfolio-db'
import { fmtNumber } from '@/lib/format'
import { formatUsd } from '@/lib/currency'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy } from '@/lib/ui-copy'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand } from '@/components/layout'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/fx')


export default async function FxPage() {
  const language = await getLanguage()
  const copy = getPageCopy('fx', language)
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
        eyebrow={routeSection('/fx', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtNumber(data.summary.exchangeCount))}
        action={data.summary.missingDestinationCount ? <Badge tone="warning">{copy.qualityGap(fmtNumber(data.summary.missingDestinationCount))}</Badge> : <Badge tone="success">{copy.qualityOk}</Badge>}
      />

      <CardRow columns="hero">
        <MetricHeroCard title={copy.deployed} eyebrow="KRW → USD" value={money(data.summary.krwSpent)} hint={`${copy.acquired}: ${money(data.summary.usdBought, 'USD')}`}>
          <KpiBand>
            <MetricField label={copy.avg} value={data.summary.weightedAverageRate == null ? 'n/a' : `₩${fmtNumber(data.summary.weightedAverageRate, 2)}`} hint="KRW per USD" valueClassName="text-title" />
            <MetricField label={copy.savings} value={money(data.summary.spreadSavingsKrw)} hint={copy.savingsHint} tone="success" valueClassName="text-title" />
            <MetricField label={copy.realized} value={data.summary.realizedFxGlKrw == null ? copy.realizedNone : money(data.summary.realizedFxGlKrw)} hint={copy.realizedHint} valueClassName="text-title" />
          </KpiBand>
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
      </CardRow>

      <Card title={language === 'ko' ? '환전 주체별 미실현 손익' : 'Unrealized FX by exchange source'} className="mb-5" info={language === 'ko' ? '하나은행 직접 환전과 토스증권 환전을 분리한 화면입니다. 전체 송금 손익과 혼동하지 않도록 원화 원가와 평균환율을 함께 표시합니다.' : 'Separates direct Hana exchanges from Toss exchanges so they are not confused with the full remittance result.'}>
        <DataTable rows={data.exchangeBreakdown} getRowKey={(row) => `${row.institution}-${row.rateStatus}`} columns={[
          { key: 'institution', label: language === 'ko' ? '환전기관' : 'Exchange source', render: (r) => r.institution === 'Hana Bank' ? '하나은행' : r.institution === 'Toss Securities' ? '토스증권' : r.institution },
          { key: 'rateStatus', label: language === 'ko' ? '환율 근거' : 'Rate basis', render: (r) => rateBadge(r.rateStatus) },
          { key: 'exchangeCount', label: language === 'ko' ? '건수' : 'Rows', align: 'right', render: (r) => fmtNumber(r.exchangeCount) },
          { key: 'usdBought', label: language === 'ko' ? '환전 USD' : 'USD exchanged', align: 'right', render: (r) => money(r.usdBought, 'USD') },
          { key: 'krwSpent', label: language === 'ko' ? '원화 원가' : 'KRW cost', align: 'right', render: (r) => money(r.krwSpent) },
          { key: 'weightedAverageRate', label: language === 'ko' ? '평균 환율' : 'Avg. rate', align: 'right', render: (r) => r.weightedAverageRate == null ? 'n/a' : `₩${fmtNumber(r.weightedAverageRate, 2)}` },
          { key: 'unrealizedKrw', label: language === 'ko' ? '현재 환율 기준 손익' : 'Unrealized P/L', align: 'right', render: (r) => r.unrealizedKrw == null ? 'n/a' : money(r.unrealizedKrw) },
        ]} />
        <p className="mt-3 text-label leading-relaxed text-ink-3">{language === 'ko' ? '예: 하나은행 직접 환전 실제확인분은 평균 ₩1,387.19/USD, 현재 환율 ₩1,377.15/USD 기준 약 -₩1.53M입니다. 전체 송금 기준 손익은 아래 별도 카드에서 계산합니다.' : 'Example: confirmed direct Hana exchanges average ₩1,387.19/USD, or about -₩1.53M at the current rate. The full remittance result below is a separate calculation.'}</p>
      </Card>

      <Card title={copy.hanaOutbound} className="mb-5" info={copy.hanaOutboundHint}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricField label={language === 'ko' ? '하나은행 USD 출금 합계' : 'Hana outbound USD total'} value={formatUsd(data.summary.hanaOutboundUsd)} hint={`${fmtNumber(data.summary.hanaOutboundTransferCount)} ${language === 'ko' ? '건' : 'rows'}`} valueClassName="text-metric" />
          <MetricField label={copy.knownMirae} value={formatUsd(data.summary.hanaKnownMiraeUsd)} hint={language === 'ko' ? '미래에셋으로 표시된 2건' : 'Two rows marked Mirae Asset'} valueClassName="text-title" />
          <MetricField label={copy.destinationUnknown} value={formatUsd(data.summary.hanaUnknownDestinationUsd)} hint={language === 'ko' ? '미국 계좌 입금과 후속 대조 필요' : 'Requires later US-account reconciliation'} tone="warning" valueClassName="text-title" />
          <MetricField label={copy.remittanceCost} value={money(data.summary.hanaOutboundCostKrw)} hint={data.summary.hanaOutboundEstimatedCostRate == null ? 'n/a' : `₩${fmtNumber(data.summary.hanaOutboundEstimatedCostRate, 2)} / USD`} valueClassName="text-title" />
          <MetricField label={copy.remittanceValue} value={money(data.summary.hanaOutboundValueKrw)} hint={data.summary.currentUsdKrwAsOf ?? 'n/a'} valueClassName="text-title" />
          <MetricField label={copy.remittanceGl} value={money(data.summary.hanaOutboundUnrealizedKrw)} hint={language === 'ko' ? '입금일 환율 가정 포함' : 'Includes deposit-date rate assumptions'} tone={data.summary.hanaOutboundUnrealizedKrw >= 0 ? 'success' : 'warning'} valueClassName="text-title" />
          <MetricField label={copy.confirmedGl} value={money(data.summary.hanaOutboundConfirmedUnrealizedKrw)} hint={language === 'ko' ? '실제 적용환율이 기록된 원가만' : 'Only rows with an actual applied rate'} tone={data.summary.hanaOutboundConfirmedUnrealizedKrw >= 0 ? 'success' : 'warning'} valueClassName="text-title" />
          <MetricField label={copy.estimatedGl} value={money(data.summary.hanaOutboundEstimatedUnrealizedKrw)} hint={language === 'ko' ? '과거 추정환율·입금일 환율 가정' : 'Historical and deposit-date assumptions'} tone="warning" valueClassName="text-title" />
          <MetricField label={copy.tossMatched} value={formatUsd(data.summary.hanaTossMatchedUsd)} hint={language === 'ko' ? `미매칭 ${formatUsd(data.summary.hanaTossUnmatchedUsd)}` : `${formatUsd(data.summary.hanaTossUnmatchedUsd)} unmatched`} valueClassName="text-title" />
        </div>
      </Card>

      <CardRow>
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
      </CardRow>

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
