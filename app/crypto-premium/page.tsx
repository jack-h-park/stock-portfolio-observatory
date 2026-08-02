import { PortfolioMultiTrendChart } from '@/components/charts'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard } from '@/components/ui'
import { getCryptoPremium } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtKrw, fmtMoney, fmtNumber, fmtQuantity } from '@/lib/format'

export const dynamic = 'force-dynamic'

// Distinct hues per coin. Recharts needs a stable colour per series, and the
// allocation palette is keyed by market rather than by symbol.
const SERIES_COLORS = ['var(--brand-blue)', 'var(--brand-purple)', 'var(--accent-warning)', 'var(--accent-success)']

/** Above this, the premium is worth acting on rather than just noting. */
const NOTABLE_PREMIUM_PCT = 2

function signedPct(value: number | null | undefined) {
  if (value == null) return <span className="text-ink-3">n/a</span>
  return (
    <span className={value >= 0 ? 'text-success' : 'text-danger'}>
      {value >= 0 ? '+' : ''}
      {fmtNumber(value, 2)}%
    </span>
  )
}

function signedKrw(value: number | null | undefined) {
  if (value == null) return <span className="text-ink-3">n/a</span>
  return (
    <span className={value >= 0 ? 'text-success' : 'text-danger'}>
      {value >= 0 ? '+' : '-'}
      {fmtKrw(Math.abs(value))}
    </span>
  )
}

export default function CryptoPremiumPage() {
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
        eyebrow="Crypto"
        title="Korea Premium"
        emphasis="Premium"
        subtitle={
          premium.fx
            ? `Won order book against the dollar order book converted at USD/KRW ${fmtNumber(premium.fx.rate, 2)} (${premium.fx.asOfDate}). Snapshot ${fmtDateTime(premium.generatedAt)}.`
            : 'No crypto price snapshot yet — run pnpm refresh.'
        }
        action={
          notable.length ? (
            <Badge tone="warning">{notable.length} coin(s) beyond ±{NOTABLE_PREMIUM_PCT}%</Badge>
          ) : (
            <Badge tone="success">Near parity</Badge>
          )
        }
      />

      {premium.spot.length === 0 ? (
        <EmptyState>No coin is quoted on both a KRW and a USD book — nothing to compare.</EmptyState>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
            <MetricHeroCard
              title="Weighted Premium"
              info="KRW-venue crypto premium weighted by the value of held KRW-venue positions. Use this as the headline premium exposure signal."
              eyebrow="Premium headline"
              value={weighted == null ? 'n/a' : `${weighted >= 0 ? '+' : ''}${fmtNumber(weighted, 2)}%`}
              hint="Across KRW-venue holdings, weighted by value"
            >
              <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
                <MetricField
                  label="Premium-Bearing Value"
                  value={fmtKrw(premium.exposure.heldValueKrw)}
                  hint="KRW-venue positions marked at their own book"
                  valueClassName="text-[18px]"
                />
                <MetricField
                  label="Value From Premium"
                  value={fmtKrw(premium.exposure.premiumValueKrw)}
                  hint="What parity would remove"
                  tone={premium.exposure.premiumValueKrw >= 0 ? 'success' : 'danger'}
                  valueClassName="text-[18px]"
                />
                <MetricField
                  label="Coins Compared"
                  value={fmtNumber(premium.spot.length)}
                  hint={`${premium.symbols.length} with history`}
                  valueClassName="text-[18px]"
                />
              </div>
            </MetricHeroCard>

            <Card title="Premium Read Order" info="Start with weighted exposure, then check premium-bearing value and coin-level rows.">
              <div className="flex min-h-[16rem] flex-col justify-between gap-4">
                <div className="space-y-4">
                  <MetricField
                    label="Threshold"
                    value={`±${NOTABLE_PREMIUM_PCT}%`}
                    hint="Notable premium threshold"
                    valueClassName="text-[28px]"
                  />
                  <div className="h-px bg-line-subtle" />
                  <MetricField
                    label="Coverage"
                    value={coverageStart && coverageEnd ? `${coverageStart} → ${coverageEnd}` : 'n/a'}
                    hint="Available premium history"
                    valueClassName="text-[18px]"
                  />
                </div>
                <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
                  Portfolio totals use each venue price; this page isolates the hidden venue premium risk.
                </div>
              </div>
            </Card>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card title="Current premium by coin" className="xl:col-span-2">
              <DataTable
                rows={premium.spot}
                columns={[
                  {
                    key: 'symbol',
                    label: 'Coin',
                    render: (r) => (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-medium text-ink">{r.symbol}</span>
                        {r.heldQuantity > 0 ? null : <Badge tone="neutral">not held in KRW</Badge>}
                      </div>
                    ),
                  },
                  { key: 'krwPrice', label: 'Bithumb (KRW)', align: 'right', render: (r) => fmtKrw(r.krwPrice) },
                  { key: 'usdPrice', label: 'Global (USD)', align: 'right', render: (r) => fmtMoney(r.usdPrice, 'USD') },
                  { key: 'impliedKrw', label: 'Implied KRW', align: 'right', render: (r) => fmtKrw(r.impliedKrw) },
                  { key: 'premiumPct', label: 'Premium', align: 'right', render: (r) => signedPct(r.premiumPct) },
                  {
                    key: 'heldQuantity',
                    label: 'Held',
                    align: 'right',
                    render: (r) => (r.heldQuantity > 0 ? fmtQuantity(r.heldQuantity) : '—'),
                  },
                  {
                    key: 'premiumValueKrw',
                    label: 'Value From Premium',
                    align: 'right',
                    render: (r) => (r.heldQuantity > 0 ? signedKrw(r.premiumValueKrw) : '—'),
                  },
                ]}
              />
              <p className="mt-2 text-[11px] text-ink-3">
                Implied KRW is the dollar price at the FX snapshot above. A coin quoted on only one of the two books cannot
                be compared and is absent rather than shown at zero.
              </p>
            </Card>

            <Card title="What this measures">
              <div className="space-y-3 text-[12px] leading-relaxed text-ink-2">
                <p>
                  Each venue&apos;s holding is valued at that venue&apos;s own order book, so the premium never distorts the
                  portfolio total. The cost of that choice is that the exposure becomes invisible everywhere else — this page
                  is where it is visible.
                </p>
                <p>
                  It is a second way to lose money on a Bithumb position: the coin can be flat in dollars and still fall in
                  won if the premium compresses. <span className="text-ink">Value From Premium</span> is what that would cost
                  at today&apos;s prices.
                </p>
                <p className="text-ink-3">
                  Both legs are read at the same instant — Bithumb&apos;s daily candle closes at 00:00 KST, and the dollar
                  close is taken at that same 15:00 UTC rather than at the end of the UTC day. Comparing the two daily closes
                  instead charges every overnight move to the premium.
                </p>
              </div>
            </Card>
          </div>

          <Card
            title="Premium history"
            info={
              coverageStart && coverageEnd
                ? `${coverageStart} to ${coverageEnd} — the window is limited by how far Bithumb's candlestick endpoint reaches, not by choice.`
                : undefined
            }
          >
            {chartData.length === 0 ? (
              <EmptyState>No overlapping history — run pnpm refresh.</EmptyState>
            ) : (
              <PortfolioMultiTrendChart
                data={chartData}
                series={series}
                height={280}
                valuePrefix=""
                valueSuffix="%"
                axisLabel="Premium %"
              />
            )}
          </Card>
        </>
      )}
    </>
  )
}
