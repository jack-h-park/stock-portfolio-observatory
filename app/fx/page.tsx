import { PortfolioMultiTrendChart } from '@/components/charts'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, MetricField, MetricHeroCard } from '@/components/ui'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getFxDashboard } from '@/lib/adapters/portfolio-db'
import { EMPTY_VALUE, fmtNumber } from '@/lib/format'
import { formatKrw, formatUsd } from '@/lib/currency'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy } from '@/lib/ui-copy'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand } from '@/components/layout'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/fx')

/** Synthetic rows below the real exchange sources; real rows carry `institution` instead. */
type ExchangeSourceRowId = 'toss-unmatched' | 'other-inbound' | 'total'
type ExchangeSourceRow = {
  rowId?: ExchangeSourceRowId
  institution?: string
  rateStatus: string
  exchangeCount: number | null
  usdBought: number
  krwSpent: number | null
  weightedAverageRate: number | null
  unrealizedKrw: number | null
  rowType?: 'inbound'
}
const exchangeSourceRowLabel = { 'toss-unmatched': 'tossUnmatchedInbound', 'other-inbound': 'otherInbound', total: 'total' } as const

export default async function FxPage() {
  const language = await getLanguage()
  const copy = getPageCopy('fx', language)
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const data = getFxDashboard(100)
  const hana = data.institutions.find((item) => item.institution === 'Hana Bank')
  const chartData = data.monthly.map((item) => ({ date: item.month, rate: item.averageRate }))
  const missingTransfers = data.transfers.filter((event) => event.match_status === 'destination_account_missing')
  const eventLabel = (event: any) => event.event_type === 'TRANSFER' ? (event.direction === 'IN' ? copy.eventTypes.transferIn : copy.eventTypes.transferOut) : event.event_type === 'EXCHANGE_CANCEL' ? copy.eventTypes.cancellation : copy.eventTypes.buyUsd
  const rateBadge = (status: string) => status === 'actual' ? <Badge tone="success">{copy.rateStatus.actual}</Badge> : status === 'estimated' ? <Badge tone="warning">{copy.rateStatus.estimated}</Badge> : <Badge tone="neutral">{EMPTY_VALUE}</Badge>
  const institutionName = (institution: string) => copy.institutionNames[institution] ?? institution
  const dual = (krw: number | null | undefined, usd: number | null | undefined) => `${formatKrw(krw)} / ${formatUsd(usd)}`
  const exchangeTotal = data.exchangeBreakdown.reduce((total, row) => ({ ...total, exchangeCount: total.exchangeCount + row.exchangeCount, usdBought: total.usdBought + row.usdBought, krwSpent: total.krwSpent + row.krwSpent, unrealizedKrw: (total.unrealizedKrw ?? 0) + (row.unrealizedKrw ?? 0) }), { rowId: 'total' as const, rateStatus: 'total', exchangeCount: 0, usdBought: 0, krwSpent: 0, weightedAverageRate: null as number | null, unrealizedKrw: 0 as number | null })
  exchangeTotal.weightedAverageRate = exchangeTotal.usdBought ? exchangeTotal.krwSpent / exchangeTotal.usdBought : null
  const exchangeRows: ExchangeSourceRow[] = [
    ...data.exchangeBreakdown,
    { rowId: 'toss-unmatched', rateStatus: 'inbound_estimated', exchangeCount: null, usdBought: data.summary.hanaTossUnmatchedUsd, krwSpent: null, weightedAverageRate: null, unrealizedKrw: null, rowType: 'inbound' },
    { rowId: 'other-inbound', rateStatus: 'inbound_estimated', exchangeCount: null, usdBought: data.summary.hanaOtherInboundUsd, krwSpent: null, weightedAverageRate: null, unrealizedKrw: null, rowType: 'inbound' },
    exchangeTotal,
  ]

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
        <MetricHeroCard title={copy.deployed} eyebrow="KRW → USD" value={dual(data.summary.krwSpent, data.summary.usdBought)} hint={`${copy.acquired}: ${formatUsd(data.summary.usdBought)}`}>
          <KpiBand>
            <MetricField label={copy.avg} value={data.summary.weightedAverageRate == null ? EMPTY_VALUE : `₩${fmtNumber(data.summary.weightedAverageRate, 2)}`} hint={copy.rateUnit} valueClassName="text-title" />
            <MetricField label={copy.savings} value={money(data.summary.spreadSavingsKrw)} hint={copy.savingsHint} tone="success" valueClassName="text-title" />
            <MetricField label={copy.realized} value={data.summary.realizedFxGlKrw == null ? copy.realizedNone : money(data.summary.realizedFxGlKrw)} hint={copy.realizedHint} valueClassName="text-title" />
          </KpiBand>
        </MetricHeroCard>

        <Card title={copy.method}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <MetricField label={copy.actual} value={fmtNumber(data.summary.actualCount)} hint={copy.actualHint} valueClassName="text-metric" />
            <MetricField label={copy.estimated} value={fmtNumber(data.summary.estimatedCount)} hint={copy.estimatedHint} tone="warning" valueClassName="text-metric" />
            <MetricField label={copy.transfers} value={fmtNumber(data.summary.transferCount)} hint={`${copy.missing}: ${fmtNumber(data.summary.missingDestinationCount)}`} valueClassName="text-title" />
            <MetricField label={copy.balance} value={hana?.latestBalanceUsd == null ? EMPTY_VALUE : money(hana.latestBalanceUsd, 'USD')} hint={hana?.latestBalanceDate ?? EMPTY_VALUE} valueClassName="text-title" />
            <MetricField label={copy.current} value={data.summary.currentUsdKrw == null ? EMPTY_VALUE : `₩${fmtNumber(data.summary.currentUsdKrw, 2)}`} hint={data.summary.currentUsdKrwAsOf ?? EMPTY_VALUE} valueClassName="text-title" />
          </div>
        </Card>
      </CardRow>

      <Card title={copy.exchangeSource.title} className="mb-5" info={copy.exchangeSource.info}>
        <DataTable rows={exchangeRows} getRowKey={(row: ExchangeSourceRow) => `${row.rowId ?? row.institution}-${row.rateStatus}`} columns={[
          { key: 'institution', label: copy.exchangeSource.columns.source, render: (r: ExchangeSourceRow) => r.rowId ? copy.exchangeSource.rows[exchangeSourceRowLabel[r.rowId]] : institutionName(r.institution ?? '') },
          { key: 'rateStatus', label: copy.exchangeSource.columns.rateBasis, render: (r: ExchangeSourceRow) => r.rowType === 'inbound' ? <Badge tone="warning">{copy.exchangeSource.inboundEstimated}</Badge> : rateBadge(r.rateStatus) },
          { key: 'exchangeCount', label: copy.exchangeSource.columns.rows, align: 'right', render: (r: ExchangeSourceRow) => r.exchangeCount == null ? EMPTY_VALUE : fmtNumber(r.exchangeCount) },
          { key: 'usdBought', label: copy.exchangeSource.columns.usdExchanged, align: 'right', render: (r: ExchangeSourceRow) => money(r.usdBought, 'USD') },
          { key: 'krwSpent', label: copy.exchangeSource.columns.krwCost, align: 'right', render: (r: ExchangeSourceRow) => r.rowType === 'inbound' ? EMPTY_VALUE : dual(r.krwSpent, r.usdBought) },
          { key: 'weightedAverageRate', label: copy.exchangeSource.columns.avgRate, align: 'right', render: (r: ExchangeSourceRow) => r.weightedAverageRate == null ? EMPTY_VALUE : `₩${fmtNumber(r.weightedAverageRate, 2)}` },
          { key: 'unrealizedKrw', label: copy.exchangeSource.columns.unrealized, align: 'right', render: (r: ExchangeSourceRow) => r.rowType === 'inbound' ? copy.exchangeSource.includedInRemittance : r.unrealizedKrw == null ? EMPTY_VALUE : dual(r.unrealizedKrw, r.unrealizedKrw / (data.summary.currentUsdKrw || 1)) },
        ]} />
        <p className="mt-3 text-label leading-relaxed text-ink-3">{copy.exchangeSource.separateNote}</p>
      </Card>

      <Card title={copy.hanaOutbound} className="mb-5" info={copy.hanaOutboundHint}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricField label={copy.outbound.total} value={formatUsd(data.summary.hanaOutboundUsd)} hint={copy.outbound.rowCount(fmtNumber(data.summary.hanaOutboundTransferCount))} valueClassName="text-metric" />
          <MetricField label={copy.knownMirae} value={formatUsd(data.summary.hanaKnownMiraeUsd)} hint={copy.outbound.knownMiraeHint} valueClassName="text-title" />
          <MetricField label={copy.destinationUnknown} value={formatUsd(data.summary.hanaUnknownDestinationUsd)} hint={copy.outbound.destinationUnknownHint} tone="warning" valueClassName="text-title" />
          <MetricField label={copy.remittanceCost} value={dual(data.summary.hanaOutboundCostKrw, data.summary.hanaOutboundUsd)} hint={data.summary.hanaOutboundEstimatedCostRate == null ? EMPTY_VALUE : `₩${fmtNumber(data.summary.hanaOutboundEstimatedCostRate, 2)} / USD`} valueClassName="text-title" />
          <MetricField label={copy.remittanceValue} value={dual(data.summary.hanaOutboundValueKrw, data.summary.hanaOutboundUsd)} hint={data.summary.currentUsdKrwAsOf ?? EMPTY_VALUE} valueClassName="text-title" />
          <MetricField label={copy.remittanceGl} value={dual(data.summary.hanaOutboundUnrealizedKrw, data.summary.hanaOutboundUnrealizedKrw / (data.summary.currentUsdKrw || 1))} hint={copy.outbound.remittanceGlHint} tone={data.summary.hanaOutboundUnrealizedKrw >= 0 ? 'success' : 'warning'} valueClassName="text-title" />
          <MetricField label={copy.confirmedGl} value={dual(data.summary.hanaOutboundConfirmedUnrealizedKrw, data.summary.hanaOutboundConfirmedUnrealizedKrw / (data.summary.currentUsdKrw || 1))} hint={copy.outbound.confirmedGlHint} tone={data.summary.hanaOutboundConfirmedUnrealizedKrw >= 0 ? 'success' : 'warning'} valueClassName="text-title" />
          <MetricField label={copy.estimatedGl} value={dual(data.summary.hanaOutboundEstimatedUnrealizedKrw, data.summary.hanaOutboundEstimatedUnrealizedKrw / (data.summary.currentUsdKrw || 1))} hint={copy.outbound.estimatedGlHint} tone="warning" valueClassName="text-title" />
          <MetricField label={copy.tossMatched} value={formatUsd(data.summary.hanaTossMatchedUsd)} hint={copy.outbound.tossUnmatched(formatUsd(data.summary.hanaTossUnmatchedUsd))} valueClassName="text-title" />
          <MetricField label={copy.outbound.otherInbound} value={formatUsd(data.summary.hanaOtherInboundUsd)} hint={copy.outbound.otherInboundHint} valueClassName="text-title" />
        </div>
      </Card>

      <CardRow>
        <Card title={copy.institutions}>
          <DataTable rows={data.institutions} columns={[
            { key: 'institution', label: copy.institution, render: (r) => institutionName(r.institution) },
            { key: 'exchangeCount', label: copy.count, align: 'right', render: (r) => fmtNumber(r.exchangeCount) },
            { key: 'usdBought', label: copy.usd, align: 'right', render: (r) => money(r.usdBought, 'USD') },
            { key: 'krwSpent', label: copy.krw, align: 'right', render: (r) => money(r.krwSpent) },
            { key: 'weightedAverageRate', label: copy.rate, align: 'right', render: (r) => r.weightedAverageRate == null ? EMPTY_VALUE : `₩${fmtNumber(r.weightedAverageRate, 2)}` },
            { key: 'latestBalanceUsd', label: copy.accountBalance, align: 'right', priority: 'secondary', render: (r) => r.latestBalanceUsd == null ? EMPTY_VALUE : money(r.latestBalanceUsd, 'USD') },
          ]} />
        </Card>
        <Card title={copy.trend}>
          <PortfolioMultiTrendChart data={chartData} series={[{ dataKey: 'rate', name: 'KRW/USD', color: 'var(--brand-blue)' }]} height={290} valuePrefix="₩" valueSuffix="" axisLabel={copy.rateUnit} />
          <p className="mt-2 text-label leading-relaxed text-ink-3">{copy.estimateNote}</p>
        </Card>
      </CardRow>

      <Card title={copy.transferReview} className="mb-5" info={copy.realizedHint}>
        <DataTable rows={missingTransfers} emptyMessage={copy.noUnmatchedTransfers} columns={[
          { key: 'date', label: copy.date },
          { key: 'institution', label: copy.institution, render: (r) => institutionName(r.institution) },
          { key: 'direction', label: copy.type, render: eventLabel },
          { key: 'usd_amount', label: copy.usd, align: 'right', render: (r) => money(r.usd_amount, 'USD') },
          { key: 'counterparty', label: copy.counterparty, render: (r) => r.counterparty ?? copy.unknownCounterparty },
          { key: 'match_status', label: copy.match, render: () => <Badge tone="warning">{copy.needsMiraeLedger}</Badge> },
          { key: 'note', label: copy.note, priority: 'secondary' },
        ]} />
      </Card>

      <Card title={copy.recent}>
        <DataTable rows={data.recent} getRowKey={(row) => row.id} columns={[
          { key: 'date', label: copy.date, nowrap: true, render: (r) => `${r.date}${r.time ? ` ${r.time}` : ''}` },
          { key: 'institution', label: copy.institution, render: (r) => institutionName(r.institution) },
          { key: 'event_type', label: copy.type, render: eventLabel },
          { key: 'usd_amount', label: copy.usd, align: 'right', render: (r) => money(r.usd_amount, 'USD') },
          { key: 'krw_amount', label: copy.krw, align: 'right', render: (r) => r.krw_amount == null ? EMPTY_VALUE : money(r.krw_amount) },
          { key: 'applied_rate', label: copy.rate, align: 'right', render: (r) => r.applied_rate == null ? EMPTY_VALUE : `₩${fmtNumber(r.applied_rate, 2)}` },
          { key: 'rate_status', label: copy.status, render: (r) => rateBadge(r.rate_status) },
          { key: 'source', label: copy.source, priority: 'tertiary' },
        ]} />
      </Card>
    </>
  )
}
