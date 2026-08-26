import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DataTable } from '@/components/DataTable'
import { FreshnessInline } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard } from '@/components/ui'
import { getOperationalHealth, getPositionDetail, type FreshnessItem } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtNumber, fmtPct, fmtQuantity, shortHash } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { buildTaxPlan } from '@/lib/tax-planning'
import { getTaxPolicyState } from '@/lib/tax-policy'
import { GLOSSARY } from '@/lib/glossary'
import { bucketTone, signTone } from '@/lib/tone'

export const dynamic = 'force-dynamic'

type MoneyFormatter = ReturnType<typeof createMoneyFormatter>

// Both helpers below take the page's formatter rather than importing `fmtMoney`
// directly. They used to be module-scope closures over the raw lib formatter, so
// they ignored the display-currency preference that the rest of the page honours —
// the market-value column rendered in KRW next to a cost column rendered in USD.
function moneyOrNa(money: MoneyFormatter, value: number | null | undefined, currency: string) {
  return value == null ? 'No value' : money(value, currency)
}

function eventTone(kind: string) {
  if (kind === 'Dividend') return 'success'
  if (kind === 'Sell') return 'warning'
  if (kind === 'Tax lot') return 'neutral'
  return 'info'
}

function isFreshnessItem(item: FreshnessItem | undefined): item is FreshnessItem {
  return item != null
}

function ReconciliationStrip({
  label,
  left,
  right,
  diff,
  unit,
  money,
}: {
  label: string
  left: number
  right: number
  diff: number
  unit: 'quantity' | 'KRW'
  money: MoneyFormatter
}) {
  const ok = Math.abs(diff) < (unit === 'quantity' ? 0.0001 : 1)
  return (
    <div className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-ink">{label}</span>
        <Badge tone={ok ? 'success' : 'warning'}>{ok ? 'Matched' : 'Needs review'}</Badge>
      </div>
      <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
        <div>
          <div className="text-ink-3">Holdings</div>
          <div className="font-medium tabular-nums text-ink">{unit === 'KRW' ? money(left, 'KRW') : fmtNumber(left, 4)}</div>
        </div>
        <div>
          <div className="text-ink-3">Tax lots</div>
          <div className="font-medium tabular-nums text-ink">{unit === 'KRW' ? money(right, 'KRW') : fmtNumber(right, 4)}</div>
        </div>
        <div>
          <div className="text-ink-3">Difference</div>
          <div className={ok ? 'font-medium tabular-nums text-success' : 'font-medium tabular-nums text-warning'}>
            {unit === 'KRW' ? money(diff, 'KRW') : fmtNumber(diff, 4)}
          </div>
        </div>
      </div>
    </div>
  )
}

export default async function PositionPage({ params }: { params: Promise<{ market: string; ticker: string }> }) {
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const { market: rawMarket, ticker: rawTicker } = await params
  const market = decodeURIComponent(rawMarket).toUpperCase()
  const ticker = decodeURIComponent(rawTicker)
  const detail = getPositionDetail(market, ticker)
  if (!detail) notFound()
  const operational = getOperationalHealth()
  const marketFreshness = operational.snapshots.find((item) => item.key === (detail.market === 'KR' ? 'kr_prices' : 'us_prices'))
  const fxFreshness = operational.snapshots.find((item) => item.key === 'fx_rates')
  const freshnessItems = [marketFreshness, fxFreshness].filter(isFreshnessItem)
  const taxPolicy = getTaxPolicyState()
  const taxPlan = buildTaxPlan({ lots: detail.lots, policy: taxPolicy.policy, objective: 'minimize-tax' })

  const nativeUnrealizedPct =
    detail.totals.native_cost > 0 && detail.totals.native_unrealized_gl != null
      ? (detail.totals.native_unrealized_gl / detail.totals.native_cost) * 100
      : null
  const baseUnrealizedPct =
    detail.totals.base_cost > 0 && detail.totals.base_unrealized_gl != null
      ? (detail.totals.base_unrealized_gl / detail.totals.base_cost) * 100
      : null
  const quantityDiff = detail.totals.quantity - detail.lotTotals.open_quantity
  const baseCostDiff = detail.totals.base_cost - detail.lotTotals.cost_basis_krw
  const hasReconIssue = Math.abs(quantityDiff) >= 0.0001 || Math.abs(baseCostDiff) >= 1
  const accountLotProfile = detail.holdings.map((holding) => {
    const lots = detail.lots.filter((lot) => lot.account === holding.account && lot.brokerage === holding.brokerage)
    return {
      id: `${holding.brokerage}:${holding.account}`,
      brokerage: holding.brokerage,
      account: holding.account,
      quantity: holding.quantity,
      native_cost: holding.native_cost,
      native_market_value: holding.native_market_value,
      native_unrealized_gl: holding.native_unrealized_gl,
      lot_count: lots.length,
      long_count: lots.filter((lot) => lot.tax_term === 'Long-term').length,
      short_count: lots.filter((lot) => lot.tax_term === 'Short-term').length,
      lot_cost_krw: lots.reduce((sum, lot) => sum + Number(lot.cost_basis_krw ?? 0), 0),
    }
  })
  const timeline = [
    ...detail.transactions.map((row, index) => ({
      id: `tx:${index}:${row.date}:${row.account}:${row.type}`,
      date: row.date,
      kind: row.type === 'SELL' ? 'Sell' : row.type === 'BUY' ? 'Buy' : row.type || 'Transaction',
      account: row.account,
      brokerage: row.brokerage,
      quantity: row.quantity,
      amount: row.native_amount,
      currency: row.currency,
      source: row.source,
      detail: row.raw_type || row.type,
    })),
    ...detail.dividends.map((row, index) => ({
      id: `div:${index}:${row.date}:${row.account}`,
      date: row.date,
      kind: 'Dividend',
      account: row.account,
      brokerage: row.brokerage,
      quantity: null,
      amount: row.native_amount,
      currency: row.currency,
      source: row.source,
      detail: row.type || 'income',
    })),
    ...detail.lots.map((row, index) => ({
      id: `lot:${index}:${row.acquired_date}:${row.account}`,
      date: row.acquired_date,
      kind: 'Tax lot',
      account: row.account,
      brokerage: row.brokerage,
      quantity: row.open_quantity,
      amount: row.native_cost_basis,
      currency: row.currency,
      source: row.source,
      detail: row.tax_term || 'open lot',
    })),
  ]
    .filter((event) => event.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 40)
  const lineageSummary = detail.sources.map((source) => ({
    id: source.source,
    label: source.file?.filename ?? source.source,
    usage: source.usages.join(', '),
    rows: source.file?.row_count ?? null,
    modified: source.file ? new Date(source.file.mtime_ms).toISOString() : null,
    status: source.file ? 'linked' : 'unlinked',
  }))

  return (
    <>
      <PageHeader
        eyebrow={`${detail.market} Holding`}
        title={detail.name}
        emphasis={detail.ticker}
        subtitle={`${fmtNumber(detail.totals.account_count)} accounts · ${fmtNumber(detail.lotTotals.lot_count)} open tax lots · ${fmtNumber(detail.transactions.length)} transactions`}
        action={<Link href="/holdings" className="text-[12px] font-medium text-info hover:underline">Back to holdings</Link>}
      />

      <Card title="Valuation Data Freshness" info={GLOSSARY.freshness.description} className="mb-5">
        <div className="grid gap-2 lg:grid-cols-2">
          {freshnessItems.map((item) => (
            <div key={item.key} className="rounded-md border border-line-subtle bg-surface px-3 py-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{item.label}</div>
              <FreshnessInline item={item} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="First Checks" info="Summarizes whether this position's quantity, cost basis, and evidence agree." className="mb-5" accent={hasReconIssue}>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="text-[12px] font-medium text-ink">Reconciliation status</span>
              <Badge tone={hasReconIssue ? 'warning' : 'success'}>{hasReconIssue ? 'Needs review' : 'Matched'}</Badge>
            </div>
            <div className="text-[11px] leading-relaxed text-ink-3">
              Quantity difference {fmtQuantity(quantityDiff, 4)} · base cost difference {money(baseCostDiff, 'KRW')}
            </div>
          </div>
          <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
            <div className="mb-1 text-[12px] font-medium text-ink">Evidence links</div>
            <div className="text-[11px] leading-relaxed text-ink-3">
              {fmtNumber(detail.sources.filter((source) => source.file).length)} source files linked · {fmtNumber(detail.sources.filter((source) => !source.file).length)} unresolved references
            </div>
          </div>
          <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
            <div className="mb-1 text-[12px] font-medium text-ink">Activity coverage</div>
            <div className="text-[11px] leading-relaxed text-ink-3">
              {fmtNumber(detail.transactions.length)} transactions · {fmtNumber(detail.dividends.length)} dividends · {fmtNumber(detail.lots.length)} open tax lots
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title="Market Value"
          info="Current position value in the position's native currency. Use this as the position-level headline before checking cost basis or gain/loss."
          eyebrow="Position headline"
          value={moneyOrNa(money, detail.totals.native_market_value, detail.currency)}
          hint={`${fmtQuantity(detail.totals.quantity, 4)} shares or units`}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label="Cost Basis"
              value={money(detail.totals.native_cost, detail.currency)}
              info={GLOSSARY.costBasis.description}
              hint={GLOSSARY.costBasis.description}
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Unrealized G/L"
              value={moneyOrNa(money, detail.totals.native_unrealized_gl, detail.currency)}
              info={GLOSSARY.unrealizedGl.description}
              hint={nativeUnrealizedPct == null ? 'No value' : fmtPct(nativeUnrealizedPct)}
              tone={signTone(detail.totals.native_unrealized_gl)}
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Base Unrealized G/L"
              value={moneyOrNa(money, detail.totals.base_unrealized_gl, 'KRW')}
              info={`${GLOSSARY.unrealizedGl.description} ${GLOSSARY.baseAmount.description}`}
              hint={baseUnrealizedPct == null ? GLOSSARY.baseAmount.description : `${fmtPct(baseUnrealizedPct)} · ${GLOSSARY.baseAmount.description}`}
              tone={signTone(detail.totals.base_unrealized_gl)}
              valueClassName="text-[18px]"
            />
          </div>
        </MetricHeroCard>

        <Card title="Position Coverage" info="Quantity, income, and row coverage for this single position.">
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label="Quantity"
                value={fmtQuantity(detail.totals.quantity, 4)}
                hint={`${fmtNumber(detail.holdings.length)} account holding row(s)`}
                valueClassName="text-[28px]"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label="Dividends"
                value={money(detail.dividendTotals.native_amount, detail.currency)}
                hint={`${fmtNumber(detail.dividendTotals.count)} rows`}
                tone="success"
                valueClassName="text-[18px]"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
              Read order: value first, then cost and gain/loss, then reconciliation and lot details.
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Reconciliation" info={GLOSSARY.reconciliation.description}>
          <div className="space-y-3">
            <ReconciliationStrip label="Open quantity" left={detail.totals.quantity} right={detail.lotTotals.open_quantity} diff={quantityDiff} unit="quantity" money={money} />
            <ReconciliationStrip label="Base cost" left={detail.totals.base_cost} right={detail.lotTotals.cost_basis_krw} diff={baseCostDiff} unit="KRW" money={money} />
          </div>
        </Card>

        <Card title="Holding-Period Mix" info="Splits quantity into long-term and short-term buckets for tax review.">
          <div className="grid gap-3 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Long-term quantity</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(detail.totals.long_term_qty, 4)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Short-term quantity</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(detail.totals.short_term_qty, 4)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">Long / short tax-lot count</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(detail.lotTotals.long_term_count)} / {fmtNumber(detail.lotTotals.short_term_count)}</span>
            </div>
          </div>
        </Card>

        <Card title="Transaction mix">
          {detail.transactionSummary.length === 0 ? (
            <EmptyState>No ticker-level transactions</EmptyState>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {detail.transactionSummary.map((row) => (
                <li key={row.type} className="flex items-center justify-between gap-3 py-2 text-[12px]">
                  <Badge tone={row.type === 'DIVIDEND' ? 'success' : row.type === 'SELL' ? 'warning' : 'info'}>{row.type}</Badge>
                  <span className="text-ink-3">{fmtNumber(row.count)} rows</span>
                  <span className="font-medium tabular-nums text-ink">{row.amount == null ? 'n/a' : money(row.amount, detail.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Account holdings">
          <DataTable
            rows={detail.holdings}
            columns={[
              { key: 'brokerage', label: 'Broker' },
              { key: 'account', label: 'Account' },
              { key: 'quantity', label: 'Qty', align: 'right', render: (r) => fmtQuantity(r.quantity, 4) },
              { key: 'native_cost', label: 'Cost', align: 'right', render: (r) => money(r.native_cost, r.currency) },
              { key: 'native_market_value', label: 'Market', align: 'right', render: (r) => moneyOrNa(money, r.native_market_value, r.currency) },
              {
                key: 'native_unrealized_gl',
                label: 'G/L',
                align: 'right',
                render: (r) => (
                  <span className={Number(r.native_unrealized_gl ?? 0) >= 0 ? 'text-success' : 'text-danger'}>
                    {moneyOrNa(money, r.native_unrealized_gl, r.currency)}
                  </span>
                ),
              },
              { key: 'lot_count', label: 'Lots', align: 'right' },
            ]}
          />
        </Card>

        <Card title="Account lot profile">
          <DataTable
            rows={accountLotProfile}
            columns={[
              { key: 'brokerage', label: 'Broker' },
              { key: 'account', label: 'Account' },
              { key: 'quantity', label: 'Qty', align: 'right', render: (r) => fmtQuantity(r.quantity, 4) },
              { key: 'lot_count', label: 'Lots', align: 'right', render: (r) => fmtNumber(r.lot_count) },
              { key: 'long_count', label: 'LT', align: 'right', render: (r) => fmtNumber(r.long_count) },
              { key: 'short_count', label: 'ST', align: 'right', render: (r) => fmtNumber(r.short_count) },
              { key: 'lot_cost_krw', label: 'Lot Cost', align: 'right', render: (r) => money(r.lot_cost_krw, 'KRW') },
            ]}
          />
        </Card>
      </div>

      <Card title="Activity timeline" className="mb-5">
        {timeline.length === 0 ? (
          <EmptyState>No dated activity for this ticker</EmptyState>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {timeline.map((event) => (
              <li key={event.id} className="grid gap-2 py-2.5 text-[12px] lg:grid-cols-[7rem_6rem_1fr_8rem_8rem] lg:items-center">
                <span className="tabular-nums text-ink-3">{event.date}</span>
                <Badge tone={eventTone(event.kind)}>{event.kind}</Badge>
                <span className="min-w-0 truncate text-ink">
                  {event.brokerage} · {event.account} · {event.detail}
                </span>
                <span className="text-right tabular-nums text-ink-3">{event.quantity == null ? 'n/a' : fmtQuantity(event.quantity, 4)}</span>
                <span className="text-right tabular-nums text-ink">{event.amount == null ? 'n/a' : money(event.amount, event.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Source evidence summary">
          <DataTable
            rows={lineageSummary}
            columns={[
              { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'linked' ? 'success' : 'warning'}>{r.status}</Badge> },
              { key: 'label', label: 'File / source', render: (r) => <span className="max-w-[20rem] break-words">{r.label}</span> },
              { key: 'usage', label: 'Usage' },
              { key: 'rows', label: 'Rows', align: 'right', render: (r) => (r.rows == null ? 'n/a' : fmtNumber(r.rows)) },
              { key: 'modified', label: 'Modified', render: (r) => (r.modified ? fmtDateTime(r.modified) : 'n/a') },
            ]}
          />
        </Card>

        <Card title="Technical lineage">
          <DataTable
            rows={detail.sources}
            columns={[
              { key: 'source', label: 'Source', render: (r) => <span className="max-w-[18rem] break-words">{r.source}</span> },
              { key: 'usages', label: 'Usage', render: (r) => r.usages.join(', ') },
              { key: 'row_count', label: 'Rows', align: 'right', render: (r) => (r.file ? fmtNumber(r.file.row_count) : 'n/a') },
              { key: 'mtime_ms', label: 'Modified', render: (r) => (r.file ? fmtDateTime(new Date(r.file.mtime_ms).toISOString()) : 'n/a') },
              { key: 'sha256', label: 'SHA', render: (r) => (r.file ? <code className="font-mono text-[11px]">{shortHash(r.file.sha256)}</code> : 'n/a') },
            ]}
          />
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5">
        <Card
          title="Tax realization preview"
          action={
            <Link href={`/tax-planning?scenario=${taxPlan.assumptions.scenario}&objective=minimize-tax`} className="text-[12px] font-medium text-info hover:underline">
              Open planner
            </Link>
          }
        >
          {taxPlan.recommended.length === 0 ? (
            <EmptyState>No tax-lot sale preview available</EmptyState>
          ) : (
            <DataTable
              rows={taxPlan.recommended.slice(0, 8)}
              columns={[
                { key: 'brokerage', label: 'Broker' },
                { key: 'account', label: 'Account' },
                { key: 'acquired_date', label: 'Acquired' },
                { key: 'holdingBucket', label: 'Term', render: (r) => <Badge tone={bucketTone(r.holdingBucket)}>{r.holdingBucket}</Badge> },
                { key: 'open_quantity', label: 'Qty', align: 'right', render: (r) => fmtQuantity(r.open_quantity, 4) },
                { key: 'proceedsNative', label: 'Proceeds', align: 'right', render: (r) => (r.proceedsNative == null ? 'n/a' : money(r.proceedsNative, r.currency)) },
                {
                  key: 'gainKrw',
                  label: 'Base G/L',
                  align: 'right',
                  render: (r) => (
                    <span className={Number(r.gainKrw ?? 0) >= 0 ? 'text-success' : 'text-danger'}>
                      {r.gainKrw == null ? 'n/a' : money(r.gainKrw, 'KRW')}
                    </span>
                  ),
                },
                { key: 'estimatedTaxKrw', label: 'Est. Tax', align: 'right', render: (r) => money(r.estimatedTaxKrw, 'KRW') },
              ]}
            />
          )}
        </Card>

        <Card title="Open tax lots">
          {detail.lots.length === 0 ? (
            <EmptyState>No open tax lots for this ticker</EmptyState>
          ) : (
            <DataTable
              rows={detail.lots}
              columns={[
                { key: 'brokerage', label: 'Broker' },
                { key: 'account', label: 'Account' },
                { key: 'acquired_date', label: 'Acquired' },
                { key: 'tax_term', label: 'Term' },
                { key: 'open_quantity', label: 'Qty', align: 'right', render: (r) => fmtQuantity(r.open_quantity, 4) },
                { key: 'native_cost_basis', label: 'Cost', align: 'right', render: (r) => money(r.native_cost_basis, r.currency) },
                { key: 'cost_basis_krw', label: 'Base Cost', align: 'right', render: (r) => money(r.cost_basis_krw, 'KRW') },
                { key: 'source', label: 'Source' },
              ]}
            />
          )}
        </Card>

        <Card title="Transactions">
          {detail.transactions.length === 0 ? (
            <EmptyState>No ticker-level transactions</EmptyState>
          ) : (
            <DataTable
              rows={detail.transactions}
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'brokerage', label: 'Broker' },
                { key: 'account', label: 'Account' },
                { key: 'type', label: 'Type', render: (r) => <Badge tone={r.type === 'SELL' ? 'warning' : r.type === 'DIVIDEND' ? 'success' : 'info'}>{r.type}</Badge> },
                { key: 'quantity', label: 'Qty', align: 'right', render: (r) => fmtQuantity(r.quantity, 4) },
                { key: 'native_amount', label: 'Amount', align: 'right', render: (r) => moneyOrNa(money, r.native_amount, r.currency) },
                { key: 'native_unit_price', label: 'Unit', align: 'right', render: (r) => moneyOrNa(money, r.native_unit_price, r.currency) },
                { key: 'source', label: 'Source' },
                { key: 'page', label: 'Page', align: 'right' },
              ]}
            />
          )}
        </Card>

        <Card title="Dividends">
          {detail.dividends.length === 0 ? (
            <EmptyState>No dividend rows for this ticker</EmptyState>
          ) : (
            <DataTable
              rows={detail.dividends}
              columns={[
                { key: 'date', label: 'Date' },
                { key: 'brokerage', label: 'Broker' },
                { key: 'account', label: 'Account' },
                { key: 'native_amount', label: 'Amount', align: 'right', render: (r) => money(r.native_amount, r.currency) },
                { key: 'native_tax_withheld', label: 'Tax', align: 'right', render: (r) => moneyOrNa(money, r.native_tax_withheld, r.currency) },
                { key: 'amount_krw', label: 'Base Amount', align: 'right', render: (r) => money(r.amount_krw, 'KRW') },
                { key: 'source', label: 'Source' },
                { key: 'page', label: 'Page', align: 'right' },
              ]}
            />
          )}
        </Card>
      </div>
    </>
  )
}
