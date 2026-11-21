import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DataTable } from '@/components/DataTable'
import { FreshnessInline } from '@/components/Freshness'
import { HelpPopover } from '@/components/HelpPopover'
import { OperatorDetails } from '@/components/OperatorDetails'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, HeroAside, MetricField, MetricHeroCard, Note, Panel, TextLink } from '@/components/ui'
import { WashSaleBanner } from '@/components/WashSaleBanner'
import { getOperationalHealth, getPositionDetail, getWashSaleReview, type FreshnessItem, type PositionSourceRef } from '@/lib/adapters/portfolio-db'
import { accountRows, washSaleForTicker, type AccountRow } from '@/lib/position-detail'
import { EMPTY_VALUE, fmtDateTime, fmtNumber, fmtPct, fmtQuantity, shortHash } from '@/lib/format'
import { freshnessLabel } from '@/lib/freshness-text'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { buildTaxPlan } from '@/lib/tax-planning'
import { getTaxPolicyState } from '@/lib/tax-policy'
import { getGlossary } from '@/lib/glossary'
import { EVIDENCE_LINK_SEVERITY, POSITION_EVENT_TONE, REVIEW_SEVERITY, bucketTone, categoryTone, signClass, signTone, statusTone, toneTextClass } from '@/lib/tone'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy } from '@/lib/ui-copy'
import { CardRow, KpiBand, Total, TotalsStrip } from '@/components/layout'
import { positionHeading } from '@/lib/page-headings'
import { AccountCell } from '@/components/PositionCell'
import { displayAccount } from '@/lib/account-label'
import { ALL_YEARS } from '@/lib/realized-lots'

export const dynamic = 'force-dynamic'

// A detail tab named after the page type would be useless here: open three
// positions and you get three identical tabs. Name it after the instrument.
export async function generateMetadata({ params }: { params: Promise<{ market: string; ticker: string }> }): Promise<Metadata> {
  const { market: rawMarket, ticker: rawTicker } = await params
  const market = decodeURIComponent(rawMarket).toUpperCase()
  const ticker = decodeURIComponent(rawTicker)
  const detail = getPositionDetail(market, ticker)
  return { title: detail ? `${ticker} · ${detail.name}` : ticker }
}

type MoneyFormatter = ReturnType<typeof createMoneyFormatter>
type PageCopy = ReturnType<typeof getPageCopy<'positionDetail'>>

// Both helpers below take the page's formatter rather than importing `fmtMoney`
// directly. They used to be module-scope closures over the raw lib formatter, so
// they ignored the display-currency preference that the rest of the page honours —
// the market-value column rendered in KRW next to a cost column rendered in USD.
function moneyOrNa(money: MoneyFormatter, value: number | null | undefined, currency: string) {
  return value == null ? EMPTY_VALUE : money(value, currency)
}

type CopyMap = Record<string, string>

// Translates a raw data value through the first copy map that owns it as a key,
// falling back to the raw value. Own-key check, so a raw value that happens to
// name an Object.prototype member (`constructor`) never renders a function.
function translated<T extends string | null | undefined>(raw: T, ...maps: CopyMap[]): string | T {
  if (raw == null) return raw
  for (const map of maps) if (Object.hasOwn(map, raw)) return map[raw]
  return raw
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
  copy,
}: {
  label: string
  left: number
  right: number
  diff: number
  unit: 'quantity' | 'KRW'
  money: MoneyFormatter
  copy: PageCopy
}) {
  const ok = Math.abs(diff) < (unit === 'quantity' ? 0.0001 : 1)
  return (
    <Panel text="caption">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-ink">{label}</span>
        <Badge tone={statusTone(REVIEW_SEVERITY, ok ? 'clear' : 'needs_review')}>{ok ? copy.matched : copy.needsReview}</Badge>
      </div>
      <div className="mt-2 grid gap-2 text-label sm:grid-cols-3">
        <div>
          <div className="text-ink-3">{copy.holdings}</div>
          <div className="font-medium tabular-nums text-ink">{unit === 'KRW' ? money(left, 'KRW') : fmtNumber(left, 4)}</div>
        </div>
        <div>
          <div className="text-ink-3">{copy.taxLots}</div>
          <div className="font-medium tabular-nums text-ink">{unit === 'KRW' ? money(right, 'KRW') : fmtNumber(right, 4)}</div>
        </div>
        <div>
          <div className="text-ink-3">{copy.difference}</div>
          <div className={`font-medium tabular-nums ${toneTextClass(statusTone(REVIEW_SEVERITY, ok ? 'clear' : 'needs_review'))}`}>
            {unit === 'KRW' ? money(diff, 'KRW') : fmtNumber(diff, 4)}
          </div>
        </div>
      </div>
    </Panel>
  )
}

export default async function PositionPage({ params }: { params: Promise<{ market: string; ticker: string }> }) {
  const language = await getLanguage()
  const copy = getPageCopy('positionDetail', language)
  const glossary = getGlossary(language)
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
  const accounts = accountRows(detail.holdings, detail.lots)
  const washSale = washSaleForTicker(getWashSaleReview(), detail.market, detail.ticker)
  const timeline = [
    ...detail.transactions.map((row, index) => ({
      id: `tx:${index}:${row.date}:${row.account}:${row.type}`,
      date: row.date,
      kind: row.type === 'SELL' ? 'sell' : row.type === 'BUY' ? 'buy' : row.type || 'transaction',
      account: row.account,
      brokerage: row.brokerage,
      quantity: row.quantity,
      amount: row.native_amount,
      currency: row.currency,
      source: row.source,
      // A broker's own raw_type text with no label stays as written.
      detail: translated(row.raw_type || row.type, copy.transactionTypes),
    })),
    ...detail.dividends.map((row, index) => ({
      id: `div:${index}:${row.date}:${row.account}`,
      date: row.date,
      kind: 'dividend',
      account: row.account,
      brokerage: row.brokerage,
      quantity: null,
      amount: row.native_amount,
      currency: row.currency,
      source: row.source,
      detail: translated(row.type, copy.transactionTypes) || copy.eventDetail.income,
    })),
    ...detail.lots.map((row, index) => ({
      id: `lot:${index}:${row.acquired_date}:${row.account}`,
      date: row.acquired_date,
      kind: 'taxLot',
      account: row.account,
      brokerage: row.brokerage,
      quantity: row.open_quantity,
      amount: row.native_cost_basis,
      currency: row.currency,
      source: row.source,
      detail: translated(row.tax_term, copy.terms) || copy.eventDetail.openLot,
    })),
  ]
    .filter((event) => event.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 40)
  const recordHref = (path: string, extra: Record<string, string> = {}) =>
    `${path}?${new URLSearchParams({ ticker: detail.ticker, market: detail.market, ...extra }).toString()}`

  return (
    <>
      <PageHeader
        parent="/holdings"
        language={language}
        {...positionHeading(detail.name)}
        subtitle={copy.subtitle(fmtNumber(detail.totals.account_count), fmtNumber(detail.lotTotals.lot_count), fmtNumber(detail.transactions.length))}
      />

      <WashSaleBanner review={washSale} copy={getPageCopy('washSale', language)} />

      <CardRow columns="hero">
        <MetricHeroCard
          id="position-lead"
          title={copy.marketValue}
          info={copy.marketValueInfo}
          eyebrow={copy.positionHeadline}
          value={moneyOrNa(money, detail.totals.native_market_value, detail.currency)}
          hint={copy.quantityHint(fmtQuantity(detail.totals.quantity, 4))}
        >
          <div>
            <KpiBand>
              <MetricField
                label={copy.costBasis}
                value={money(detail.totals.native_cost, detail.currency)}
                info={glossary.costBasis.description}
                hint={glossary.costBasis.description}
              />
              <MetricField
                label={copy.unrealized}
                value={moneyOrNa(money, detail.totals.native_unrealized_gl, detail.currency)}
                info={glossary.unrealizedGl.description}
                hint={fmtPct(nativeUnrealizedPct)}
                tone={signTone(detail.totals.native_unrealized_gl)}
              />
              <MetricField
                label={copy.baseUnrealized}
                value={moneyOrNa(money, detail.totals.base_unrealized_gl, 'KRW')}
                info={`${glossary.unrealizedGl.description} ${glossary.baseAmount.description}`}
                hint={baseUnrealizedPct == null ? glossary.baseAmount.description : `${fmtPct(baseUnrealizedPct)} · ${glossary.baseAmount.description}`}
                tone={signTone(detail.totals.base_unrealized_gl)}
              />
            </KpiBand>
            {/* How old the price and FX behind these figures are, under the figures they qualify. */}
            {freshnessItems.length > 0 && (
              <Note row spacing="above-3">
                {freshnessItems.map((item) => (
                  <span key={item.key} className="inline-flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-2">{freshnessLabel(item, language)}</span>
                    <FreshnessInline item={item} language={language} />
                  </span>
                ))}
                <HelpPopover>{glossary.freshness.description}</HelpPopover>
              </Note>
            )}
          </div>
        </MetricHeroCard>

        <HeroAside title={copy.coverage} info={copy.coverageInfo} note={copy.readOrderNote}>
          <MetricField
            label={copy.quantity}
            value={fmtQuantity(detail.totals.quantity, 4)}
            hint={copy.holdingRowsHint(fmtNumber(detail.holdings.length))}
            size="metric"
          />
          <MetricField
            label={copy.dividends}
            value={money(detail.dividendTotals.native_amount, detail.currency)}
            hint={copy.rowCount(fmtNumber(detail.dividendTotals.count))}
            tone="success"
          />
        </HeroAside>
      </CardRow>

      <CardRow columns={1}>
        <Card
          title={copy.reconciliation}
          info={glossary.reconciliation.description}
          action={<Badge tone={statusTone(REVIEW_SEVERITY, hasReconIssue ? 'needs_review' : 'clear')}>{hasReconIssue ? copy.needsReview : copy.matched}</Badge>}
        >
          <div className="space-y-3">
            <ReconciliationStrip label={copy.openQuantity} left={detail.totals.quantity} right={detail.lotTotals.open_quantity} diff={quantityDiff} unit="quantity" money={money} copy={copy} />
            <ReconciliationStrip label={copy.baseCost} left={detail.totals.base_cost} right={detail.lotTotals.cost_basis_krw} diff={baseCostDiff} unit="KRW" money={money} copy={copy} />
          </div>
        </Card>

        <Card title={copy.accountHoldings}>
          <DataTable
            rows={accounts}
            columns={[
              { key: 'account', label: copy.columns.account, render: (r) => <AccountCell brokerage={r.brokerage} account={r.account} /> },
              { key: 'quantity', label: copy.columns.quantity, align: 'right', render: (r) => fmtQuantity(r.quantity, 4) },
              { key: 'native_cost', priority: 'secondary', label: copy.columns.cost, align: 'right', render: (r) => money(r.native_cost, r.currency) },
              { key: 'native_market_value', label: copy.columns.market, align: 'right', render: (r) => moneyOrNa(money, r.native_market_value, r.currency) },
              {
                key: 'native_unrealized_gl',
                label: copy.columns.gainLoss,
                align: 'right',
                render: (r) => (
                  <span className={signClass(r.native_unrealized_gl)}>
                    {moneyOrNa(money, r.native_unrealized_gl, r.currency)}
                  </span>
                ),
              },
              { key: 'lot_count', priority: 'secondary', label: copy.columns.lots, align: 'right', render: (r) => fmtNumber(r.lot_count) },
              { key: 'long_count', priority: 'secondary', label: copy.columns.long, align: 'right', render: (r) => fmtNumber(r.long_count) },
              { key: 'short_count', priority: 'secondary', label: copy.columns.short, align: 'right', render: (r) => fmtNumber(r.short_count) },
              { key: 'lot_cost_krw', priority: 'secondary', label: copy.columns.lotCost, align: 'right', render: (r) => money(r.lot_cost_krw, 'KRW') },
            ]}
          />
        </Card>

        {/* This position's rows on the record pages. An exact ticker, not a search:
            a one-letter ticker is a substring of half the table. */}
        <Card
          title={copy.openTaxLots}
          action={
            <span className="flex flex-wrap items-center gap-x-4">
              <TextLink href={recordHref('/lots')}>{copy.links.lots}</TextLink>
              <TextLink href={recordHref('/realized', { year: ALL_YEARS })}>{copy.links.realized}</TextLink>
            </span>
          }
        >
          <div className="space-y-3">
            <TotalsStrip columns="sm-3">
              <Total label={copy.longQuantity} value={fmtNumber(detail.totals.long_term_qty, 4)} />
              <Total label={copy.shortQuantity} value={fmtNumber(detail.totals.short_term_qty, 4)} />
              <Total label={copy.longShortLots} value={`${fmtNumber(detail.lotTotals.long_term_count)} / ${fmtNumber(detail.lotTotals.short_term_count)}`} />
            </TotalsStrip>
            {detail.lots.length === 0 ? (
              <EmptyState>{copy.noOpenLots}</EmptyState>
            ) : (
              <DataTable
                rows={detail.lots}
                columns={[
                  { key: 'account', label: copy.columns.account, render: (r) => <AccountCell brokerage={r.brokerage} account={r.account} /> },
                  { key: 'acquired_date', label: copy.columns.acquired },
                  { key: 'tax_term', priority: 'secondary', label: copy.columns.term, render: (r) => translated(r.tax_term, copy.terms) },
                  { key: 'open_quantity', label: copy.columns.quantity, align: 'right', render: (r) => fmtQuantity(r.open_quantity, 4) },
                  { key: 'native_cost_basis', priority: 'secondary', label: copy.columns.cost, align: 'right', render: (r) => money(r.native_cost_basis, r.currency) },
                  { key: 'cost_basis_krw', label: copy.columns.baseCost, align: 'right', render: (r) => money(r.cost_basis_krw, 'KRW') },
                  { key: 'source', priority: 'tertiary', label: copy.columns.source },
                ]}
              />
            )}
          </div>
        </Card>

        <Card
          title={copy.taxPreview}
          action={
            <TextLink href="/tax-planning">
              {copy.openPlanner}
            </TextLink>
          }
        >
          {taxPlan.recommended.length === 0 ? (
            <EmptyState>{copy.noTaxPreview}</EmptyState>
          ) : (
            <DataTable
              rows={taxPlan.recommended.slice(0, 8)}
              columns={[
                { key: 'account', label: copy.columns.account, render: (r) => <AccountCell brokerage={r.brokerage} account={r.account} /> },
                { key: 'acquired_date', label: copy.columns.acquired },
                { key: 'holdingBucket', priority: 'secondary', label: copy.columns.term, render: (r: { holdingBucket: 'long' | 'short' }) => <Badge tone={bucketTone(r.holdingBucket)}>{copy.buckets[r.holdingBucket] ?? r.holdingBucket}</Badge> },
                { key: 'open_quantity', priority: 'secondary', label: copy.columns.quantity, align: 'right', render: (r) => fmtQuantity(r.open_quantity, 4) },
                { key: 'proceedsNative', priority: 'secondary', label: copy.columns.proceeds, align: 'right', render: (r) => (r.proceedsNative == null ? EMPTY_VALUE : money(r.proceedsNative, r.currency)) },
                {
                  key: 'gainKrw',
                  label: copy.columns.baseGainLoss,
                  align: 'right',
                  render: (r) => (
                    <span className={signClass(r.gainKrw)}>
                      {r.gainKrw == null ? EMPTY_VALUE : money(r.gainKrw, 'KRW')}
                    </span>
                  ),
                },
                { key: 'estimatedTaxKrw', label: copy.columns.estimatedTax, align: 'right', render: (r) => money(r.estimatedTaxKrw, 'KRW') },
              ]}
            />
          )}
        </Card>

        <Card title={copy.activityTimeline} action={<TextLink href={recordHref('/transactions')}>{copy.links.transactions}</TextLink>}>
          <div className="space-y-3">
            {detail.transactionSummary.length > 0 && (
              <TotalsStrip columns="sm-4">
                {detail.transactionSummary.map((row) => (
                  <Total
                    key={row.type}
                    label={`${translated(row.type, copy.transactionTypes)} · ${copy.rowCount(fmtNumber(row.count))}`}
                    value={row.amount == null ? EMPTY_VALUE : money(row.amount, detail.currency)}
                  />
                ))}
              </TotalsStrip>
            )}
            {timeline.length === 0 ? (
              <EmptyState>{copy.noActivity}</EmptyState>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {timeline.map((event) => (
                  <li key={event.id} className="grid gap-2 py-2.5 text-caption lg:grid-cols-[7rem_6rem_1fr_8rem_8rem] lg:items-center">
                    <span className="tabular-nums text-ink-3">{event.date}</span>
                    <Badge tone={categoryTone(POSITION_EVENT_TONE, event.kind, 'info')}>{translated(event.kind, copy.eventKinds, copy.transactionTypes)}</Badge>
                    <span className="min-w-0 truncate text-ink">
                      {displayAccount(event.brokerage, event.account)} · {event.detail}
                    </span>
                    <span className="text-right tabular-nums text-ink-3">{event.quantity == null ? EMPTY_VALUE : fmtQuantity(event.quantity, 4)}</span>
                    <span className="text-right tabular-nums text-ink">{event.amount == null ? EMPTY_VALUE : money(event.amount, event.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card title={copy.dividends}>
          {detail.dividends.length === 0 ? (
            <EmptyState>{copy.noDividends}</EmptyState>
          ) : (
            <DataTable
              rows={detail.dividends}
              columns={[
                { key: 'date', label: copy.columns.paidDate },
                { key: 'account', label: copy.columns.account, render: (r) => <AccountCell brokerage={r.brokerage} account={r.account} /> },
                { key: 'native_amount', priority: 'secondary', label: copy.columns.amount, align: 'right', render: (r) => money(r.native_amount, r.currency) },
                { key: 'native_tax_withheld', priority: 'secondary', label: copy.columns.tax, align: 'right', render: (r) => moneyOrNa(money, r.native_tax_withheld, r.currency) },
                { key: 'amount_krw', label: copy.columns.baseAmount, align: 'right', render: (r) => money(r.amount_krw, 'KRW') },
                { key: 'source', priority: 'tertiary', label: copy.columns.source },
                { key: 'page', priority: 'tertiary', label: copy.columns.page, align: 'right' },
              ]}
            />
          )}
        </Card>
      </CardRow>

      <OperatorDetails language={language}>
        <Card title={copy.evidenceSummary}>
          <Note spacing="below-3">
            {copy.evidenceDetail(
              fmtNumber(detail.sources.filter((source) => source.file).length),
              fmtNumber(detail.sources.filter((source) => !source.file).length),
            )}
          </Note>
          <DataTable
            rows={detail.sources}
            getRowKey={(r: PositionSourceRef) => r.source}
            columns={[
              {
                key: 'status',
                label: copy.columns.status,
                render: (r: PositionSourceRef) => {
                  const status = r.file ? 'linked' : 'unlinked'
                  return <Badge tone={statusTone(EVIDENCE_LINK_SEVERITY, status)}>{copy.linkStatus[status]}</Badge>
                },
              },
              { key: 'file', label: copy.columns.file, render: (r) => <span className="max-w-[20rem] break-words">{r.file?.filename ?? r.source}</span> },
              { key: 'usages', priority: 'secondary', label: copy.columns.usage, render: (r) => r.usages.map((usage) => translated(usage, copy.sourceUsages)).join(', ') },
              { key: 'row_count', priority: 'secondary', label: copy.columns.rows, align: 'right', render: (r) => (r.file ? fmtNumber(r.file.row_count) : EMPTY_VALUE) },
              { key: 'mtime_ms', priority: 'secondary', label: copy.columns.modified, render: (r) => (r.file ? fmtDateTime(new Date(r.file.mtime_ms).toISOString(), language) : EMPTY_VALUE) },
              { key: 'sha256', priority: 'tertiary', label: copy.columns.sha, render: (r) => (r.file ? <code className="font-mono text-label">{shortHash(r.file.sha256)}</code> : EMPTY_VALUE) },
            ]}
          />
        </Card>
      </OperatorDetails>
    </>
  )
}
