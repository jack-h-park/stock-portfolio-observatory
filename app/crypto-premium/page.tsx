import { PortfolioMultiTrendChart } from '@/components/charts'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, Signed } from '@/components/ui'
import { getCryptoPremium } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtNumber, fmtPct, fmtQuantity } from '@/lib/format'
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
            ? `Won order book against the dollar order book converted at USD/KRW ${fmtNumber(premium.fx.rate, 2)} (${premium.fx.asOfDate}). Snapshot ${fmtDateTime(premium.generatedAt)}.`
            : copy.subtitleNoData
        }
        action={
          notable.length ? (
            <Badge tone="warning">{notable.length} coin(s) beyond ±{NOTABLE_PREMIUM_PCT}%</Badge>
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
              info="KRW-venue crypto premium weighted by the value of held KRW-venue positions. Use this as the headline premium exposure signal."
              eyebrow={copy.premiumHeadline}
              value={weighted == null ? 'n/a' : `${weighted >= 0 ? '+' : ''}${fmtNumber(weighted, 2)}%`}
              hint={copy.weightedHint}
            >
              <KpiBand>
                <MetricField
                  label={copy.premiumBearingValue}
                  value={money(premium.exposure.heldValueKrw)}
                  hint={copy.premiumBearingHint}
                  valueClassName="text-title"
                />
                <MetricField
                  label={copy.valueFromPremium}
                  value={money(premium.exposure.premiumValueKrw)}
                  hint={copy.valueFromPremiumHint}
                  tone={signTone(premium.exposure.premiumValueKrw)}
                  valueClassName="text-title"
                />
                <MetricField
                  label={copy.coinsCompared}
                  value={fmtNumber(premium.spot.length)}
                  hint={`${premium.symbols.length} with history`}
                  valueClassName="text-title"
                />
              </KpiBand>
            </MetricHeroCard>

            <Card title={copy.readOrder} info={copy.readOrderInfo}>
              <div className="flex min-h-[16rem] flex-col justify-between gap-4">
                <div className="space-y-4">
                  <MetricField
                    label={copy.threshold}
                    value={`±${NOTABLE_PREMIUM_PCT}%`}
                    hint={copy.thresholdHint}
                    valueClassName="text-metric"
                  />
                  <div className="h-px bg-line-subtle" />
                  <MetricField
                    label={copy.coverage}
                    value={coverageStart && coverageEnd ? `${coverageStart} → ${coverageEnd}` : 'n/a'}
                    info={glossary.coverage.description}
                    hint={copy.coverageHint}
                    valueClassName="text-title"
                  />
                </div>
                <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
                  Portfolio totals use each venue price; this page isolates the hidden venue premium risk.
                </div>
              </div>
            </Card>
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
                        {r.heldQuantity > 0 ? null : <Badge tone="neutral">not held in KRW</Badge>}
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
                    render: (r) => (r.heldQuantity > 0 ? fmtQuantity(r.heldQuantity) : '—'),
                  },
                  {
                    key: 'premiumValueKrw',
                    label: copy.columns.valueFromPremium,
                    align: 'right',
                    render: (r) => (r.heldQuantity > 0 ? <Signed value={r.premiumValueKrw} format={(m) => money(m, 'KRW')} /> : '—'),
                  },
                ]}
              />
              <p className="mt-2 text-label text-ink-3">
                Implied KRW is the dollar price at the FX snapshot above. A coin quoted on only one of the two books cannot
                be compared and is absent rather than shown at zero.
              </p>
            </Card>

            <Card title={copy.whatThisMeasures}>
              <div className="space-y-3 text-caption leading-relaxed text-ink-2">
                <p>
                  Each venue&apos;s holding is valued at that venue&apos;s own order book, so the premium never distorts the
                  portfolio total. The cost of that choice is that the exposure becomes invisible everywhere else — this page
                  is where it is visible.
                </p>
                <p>
                  It is a second way to lose money on a Bithumb position: the coin can be flat in dollars and still fall in
                  won if the premium compresses. <span className="text-ink">{copy.valueFromPremium}</span> is what that would cost
                  at today&apos;s prices.
                </p>
                <p className="text-ink-3">
                  Both legs are read at the same instant — Bithumb&apos;s daily candle closes at 00:00 KST, and the dollar
                  close is taken at that same 15:00 UTC rather than at the end of the UTC day. Comparing the two daily closes
                  instead charges every overnight move to the premium.
                </p>
              </div>
            </Card>
          </CardRow>

          <Card
            title={copy.history}
            info={
              coverageStart && coverageEnd
                ? `${coverageStart} to ${coverageEnd} — the window is limited by how far Bithumb's candlestick endpoint reaches, not by choice.`
                : undefined
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
