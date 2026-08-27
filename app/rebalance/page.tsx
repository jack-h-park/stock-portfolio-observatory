import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, Signed, marketTone } from '@/components/ui'
import { getOperationalHealth, getRebalanceReview, type ReviewPosition } from '@/lib/adapters/portfolio-db'
import { fmtNumber, fmtPct } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'
import { getPageCopy } from '@/lib/ui-copy'

export const dynamic = 'force-dynamic'

function PositionLink({ row }: { row: ReviewPosition }) {
  return (
    <div className="min-w-[14rem]">
      <div className="flex items-center gap-2">
        <Badge tone={marketTone(row.market)}>{row.market}</Badge>
        <Link href={positionHref(row.market, row.ticker)} className="font-mono text-caption font-medium text-info hover:underline">
          {row.ticker}
        </Link>
      </div>
      <div className="mt-1 max-w-[20rem] truncate text-caption font-medium text-ink">{row.name}</div>
    </div>
  )
}


export default async function RebalancePage() {
  const language = await getLanguage()
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const copy = getPageCopy('rebalance', language)
  const glossary = getGlossary(language)
  const rebalance = getRebalanceReview()
  const operational = getOperationalHealth()
  const freshnessIssues = operational.staleItems.length
  const largestGap = rebalance.marketGaps.reduce((max, row) => Math.max(max, Math.abs(row.gapPct)), 0)

  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(rebalance.policy.marketTargets.map((row) => `${row.market} ${fmtNumber(row.targetPct)}%`).join(' / '), fmtNumber(rebalance.policy.positionCapPct))}
        action={freshnessIssues ? <Badge tone="warning">{copy.freshnessIssues(freshnessIssues)}</Badge> : <Badge tone="success">{copy.inputsReady}</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title={copy.largestMarketGap}
          info={glossary.marketGap.description}
          eyebrow={copy.primarySignal}
          value={fmtPct(largestGap)}
          hint={copy.marketGapHint}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label={copy.baseMarketValue}
              value={money(rebalance.totals.base_market_value)}
              hint={copy.baseMarketValueHint}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.reduceCandidates}
              value={fmtNumber(rebalance.reduceCandidates.length)}
              hint={copy.reduceCandidatesHint}
              tone={rebalance.reduceCandidates.length ? 'warning' : 'success'}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.watchBeforeAction}
              value={fmtNumber(rebalance.watchCandidates.length + freshnessIssues)}
              hint={copy.watchBeforeActionHint}
              tone={rebalance.watchCandidates.length + freshnessIssues ? 'warning' : 'success'}
              valueClassName="text-title"
            />
          </div>
        </MetricHeroCard>

        <Card title={copy.executionRisk} info={copy.executionRiskInfo}>
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label={copy.taxSensitive}
                value={fmtNumber(rebalance.taxSensitive.length)}
                hint={copy.taxSensitiveHint}
                tone={rebalance.taxSensitive.length ? 'warning' : 'success'}
                valueClassName="text-metric"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label={copy.freshnessIssuesLabel}
                value={fmtNumber(freshnessIssues)}
                info={glossary.freshness.description}
                hint={copy.freshnessIssuesHint}
                tone={freshnessIssues ? 'warning' : 'success'}
                valueClassName="text-title"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
              {copy.decisionOrder}
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title={copy.marketTargetGaps}>
          <DataTable
            rows={rebalance.marketGaps}
            columns={[
              { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
              { key: 'currentPct', label: copy.columns.current, align: 'right', render: (r) => fmtPct(r.currentPct) },
              { key: 'targetPct', label: copy.columns.target, align: 'right', render: (r) => fmtPct(r.targetPct) },
              { key: 'gapValue', label: copy.columns.gap, align: 'right', render: (r) => <Signed value={r.gapValue} format={(m) => money(m, 'KRW')} /> },
              { key: 'action', label: copy.columns.action, render: (r) => <Badge tone={r.action === 'Hold' ? 'success' : 'warning'}>{r.action}</Badge> },
            ]}
          />
        </Card>

        <Card title={copy.addContext}>
          {rebalance.addContext.length === 0 ? (
            <EmptyState ok>{copy.noMarketAddGap}</EmptyState>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {rebalance.addContext.map((row) => (
                <li key={row.market} className="flex items-center gap-3 py-2 text-caption">
                  <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium tabular-nums text-ink">{money(row.gapValue)} {copy.underTarget}</div>
                    <div className="text-label text-ink-3">{fmtPct(row.gapPct)} {copy.gap} · {copy.existingPositions(fmtNumber(row.candidateCount))}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={copy.outsidePolicy}>
          {rebalance.untargetedMarkets.length === 0 ? (
            <EmptyState ok>{copy.everyMarketTargeted}</EmptyState>
          ) : (
            <>
              <ul className="divide-y divide-line-subtle">
                {rebalance.untargetedMarkets.map((row) => (
                  <li key={row.market} className="flex items-center gap-3 py-2 text-caption">
                    <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium tabular-nums text-ink">{money(row.currentValue)}</div>
                      <div className="text-label text-ink-3">{copy.ofPortfolioNoTarget(fmtPct(row.currentPctOfPortfolio))}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-label text-ink-3">
                {copy.outsidePolicyNote(rebalance.policy.marketTargets.map((row) => row.market).join('/'))}
              </p>
            </>
          )}
        </Card>

        <Card title={copy.executionGuardrails}>
          <div className="space-y-2 text-caption text-ink-2">
            <div className="flex items-center justify-between gap-3">
              <span>{copy.marketGapTolerance}</span>
              <Badge tone="neutral">2%</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{copy.singlePositionCap}</span>
              <Badge tone="neutral">{fmtNumber(rebalance.policy.positionCapPct)}%</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>{copy.shortTermWarning}</span>
              <Badge tone="warning">50%+</Badge>
            </div>
            <div className="text-label leading-relaxed text-ink-3">
              {copy.guardrailNote}
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.reduceCandidates}>
          {rebalance.reduceCandidates.length === 0 ? (
            <EmptyState ok>{copy.noPositionAboveCap}</EmptyState>
          ) : (
            <DataTable
              rows={rebalance.reduceCandidates}
              columns={[
                { key: 'ticker', label: copy.columns.position, render: (r) => <PositionLink row={r} /> },
                { key: 'currentPct', label: copy.columns.currentPct, align: 'right', render: (r) => fmtPct(r.currentPct) },
                { key: 'capGapPct', label: copy.columns.overCap, align: 'right', render: (r) => fmtPct(r.capGapPct) },
                { key: 'capGapValue', label: copy.columns.gapValue, align: 'right', render: (r) => money(r.capGapValue) },
                { key: 'base_unrealized_gl', label: copy.columns.baseGl, align: 'right', render: (r) => (r.base_unrealized_gl == null ? 'n/a' : money(r.base_unrealized_gl)) },
                { key: 'short_term_ratio', label: copy.columns.shortPct, align: 'right', render: (r) => fmtPct(r.short_term_ratio) },
              ]}
            />
          )}
        </Card>

        <Card title={copy.taxSensitiveWatchlist}>
          {rebalance.taxSensitive.length === 0 ? (
            <EmptyState ok>{copy.noHighShortTerm}</EmptyState>
          ) : (
            <DataTable
              rows={rebalance.taxSensitive}
              columns={[
                { key: 'ticker', label: copy.columns.position, render: (r) => <PositionLink row={r} /> },
                { key: 'base_market_value', label: copy.columns.baseMarket, align: 'right', render: (r) => (r.base_market_value == null ? 'n/a' : money(r.base_market_value)) },
                { key: 'short_term_ratio', label: copy.columns.shortPct, align: 'right', render: (r) => fmtPct(r.short_term_ratio) },
                { key: 'short_term_qty', label: copy.columns.shortQty, align: 'right', render: (r) => fmtNumber(r.short_term_qty, 4) },
                { key: 'reason', label: copy.columns.reason },
              ]}
            />
          )}
        </Card>
      </div>

      <Card title={copy.holdWatch} accent={rebalance.watchCandidates.length + freshnessIssues > 0}>
        {rebalance.watchCandidates.length === 0 && freshnessIssues === 0 ? (
          <EmptyState ok>{copy.noBlockers}</EmptyState>
        ) : (
          <div className="space-y-4">
            {freshnessIssues > 0 && (
              <div className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption text-ink-2">
                <div className="font-medium text-warning">{copy.staleInputs(freshnessIssues)}</div>
                <Link href="/health" className="mt-1 inline-block text-label font-medium text-info hover:underline">
                  {copy.openHealth}
                </Link>
              </div>
            )}
            {rebalance.watchCandidates.length > 0 && (
              <DataTable
                rows={rebalance.watchCandidates}
                columns={[
                  { key: 'ticker', label: copy.columns.position, render: (r) => <PositionLink row={r} /> },
                  { key: 'base_cost', label: copy.columns.baseCost, align: 'right', render: (r) => money(r.base_cost) },
                  { key: 'native_cost', label: copy.columns.nativeCost, align: 'right', render: (r) => money(r.native_cost, r.currency) },
                  { key: 'reason', label: copy.columns.reason },
                ]}
              />
            )}
          </div>
        )}
      </Card>
    </>
  )
}
