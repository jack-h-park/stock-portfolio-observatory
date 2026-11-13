import { PortfolioMultiTrendChart } from '@/components/charts'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, HeroAside, MetricField, MetricHeroCard, Signed } from '@/components/ui'
import { getCryptoPremium } from '@/lib/adapters/portfolio-db'
import { EMPTY_VALUE, fmtDateTime, fmtNumber, fmtPct, fmtQuantity } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { signTone } from '@/lib/tone'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy } from '@/lib/ui-copy'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand } from '@/components/layout'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/crypto-premium')

// Distinct hues per coin. Recharts needs a stable colour per series, and the
// allocation palette is keyed by market rather than by symbol.
const SERIES_COLORS = ['var(--brand-blue)', 'var(--brand-purple)', 'var(--accent-warning)', 'var(--accent-success)']

/** Above this, the premium is worth acting on rather than just noting. */
const NOTABLE_PREMIUM_PCT = 2

export default async function CryptoPremiumPage() {
  const language = await getLanguage()
  const copy = getPageCopy('cryptoPremium', language)
  const glossary = getGlossary(language)
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const premium = getCryptoPremium()
  const chartData = premium.history.map((point) => ({
    date: point.date.slice(5),
    ...Object.fromEntries(premium.symbols.map((symbol) => [symbol, point.bySymbol[symbol] ?? null])),
  }))
  const series = premium.symbols.map((symbol, index) => ({
    dataKey: symbol,
    name: symbol,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
  }))
  const weighted = premium.exposure.weightedPremiumPct
  const notable = premium.spot.filter((row) => Math.abs(row.premiumPct) >= NOTABLE_PREMIUM_PCT)
  const coverageStart = premium.history[0]?.date ?? null
  const coverageEnd = premium.history[premium.history.length - 1]?.date ?? null

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/crypto-premium', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={
          premium.fx
            ? copy.subtitleWithData(
                fmtNumber(premium.fx.rate, 2),
                premium.fx.asOfDate,
                fmtDateTime(premium.generatedAt, language),
              )
            : copy.subtitleNoData
        }
        action={
          notable.length ? (
            <Badge tone="warning">{copy.notableBadge(String(notable.length), String(NOTABLE_PREMIUM_PCT))}</Badge>
          ) : (
            <Badge tone="success">{copy.nearParity}</Badge>
          )
        }
      />

      {premium.spot.length === 0 ? (
        <EmptyState>{copy.noPairs}</EmptyState>
      ) : (
        <>
          <CardRow columns="hero">
            <MetricHeroCard
              title={copy.weightedPremium}
              info={copy.weightedPremiumInfo}
              eyebrow={copy.premiumHeadline}
              value={fmtPct(weighted, { signed: true })}
              hint={copy.weightedHint}
            >
              <KpiBand>
                <MetricField
                  label={copy.premiumBearingValue}
                  value={money(premium.exposure.heldValueKrw)}
                  hint={copy.premiumBearingHint}
                />
                <MetricField
                  label={copy.valueFromPremium}
                  value={money(premium.exposure.premiumValueKrw)}
                  hint={copy.valueFromPremiumHint}
                  tone={signTone(premium.exposure.premiumValueKrw)}
                />
                <MetricField
                  label={copy.coinsCompared}
                  value={fmtNumber(premium.spot.length)}
                  hint={copy.withHistoryHint(String(premium.symbols.length))}
                />
              </KpiBand>
            </MetricHeroCard>

            <HeroAside title={copy.readOrder} info={copy.readOrderInfo} note={copy.readOrderNote}>
              <MetricField
                label={copy.threshold}
                value={`±${NOTABLE_PREMIUM_PCT}%`}
                hint={copy.thresholdHint}
                size="metric"
              />
              <MetricField
                label={copy.coverage}
                value={coverageStart && coverageEnd ? `${coverageStart} → ${coverageEnd}` : EMPTY_VALUE}
                info={glossary.coverage.description}
                hint={copy.coverageHint}
              />
            </HeroAside>
          </CardRow>

          <CardRow columns={3}>
            <Card title={copy.byCoin} className="xl:col-span-2">
              <DataTable
                rows={premium.spot}
                columns={[
                  {
                    key: 'symbol',
                    label: copy.columns.coin,
                    render: (r) => (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-caption font-medium text-ink">{r.symbol}</span>
                        {r.heldQuantity > 0 ? null : <Badge tone="neutral">{copy.notHeldBadge}</Badge>}
                      </div>
                    ),
                  },
                  { key: 'krwPrice', label: copy.columns.krwVenue, align: 'right', render: (r) => money(r.krwPrice) },
                  { key: 'usdPrice', label: copy.columns.globalVenue, align: 'right', render: (r) => money(r.usdPrice, 'USD') },
                  { key: 'impliedKrw', label: copy.columns.impliedKrw, align: 'right', render: (r) => money(r.impliedKrw) },
                  { key: 'premiumPct', label: copy.columns.premium, align: 'right', render: (r) => <Signed value={r.premiumPct} format={(m) => fmtPct(m)} /> },
                  {
                    key: 'heldQuantity',
                    label: copy.columns.held,
                    align: 'right',
                    render: (r) => (r.heldQuantity > 0 ? fmtQuantity(r.heldQuantity) : EMPTY_VALUE),
                  },
                  {
                    key: 'premiumValueKrw',
                    label: copy.columns.valueFromPremium,
                    align: 'right',
                    render: (r) => (r.heldQuantity > 0 ? <Signed value={r.premiumValueKrw} format={(m) => money(m, 'KRW')} /> : EMPTY_VALUE),
                  },
                ]}
              />
              <p className="mt-2 text-label text-ink-3">{copy.tableFootnote}</p>
            </Card>

            <Card title={copy.whatThisMeasures}>
              <div className="space-y-3 text-caption leading-relaxed text-ink-2">
                <p>{copy.measures.valuation}</p>
                <p>
                  {copy.measures.riskLead}{' '}
                  <span className="text-ink">{copy.valueFromPremium}</span>
                  {copy.measures.riskTail}
                </p>
                <p className="text-ink-3">{copy.measures.timing}</p>
              </div>
            </Card>
          </CardRow>

          <Card
            title={copy.history}
            info={
              coverageStart && coverageEnd ? copy.historyInfo(coverageStart, coverageEnd) : undefined
            }
          >
            {chartData.length === 0 ? (
              <EmptyState>{copy.noHistory}</EmptyState>
            ) : (
              <PortfolioMultiTrendChart
                data={chartData}
                series={series}
                height={280}
                valuePrefix=""
                valueSuffix="%"
                axisLabel={copy.axisLabel}
              />
            )}
          </Card>
        </>
      )}
    </>
  )
}
