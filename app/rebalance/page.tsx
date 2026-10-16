import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, Signed, TextLink, marketTone } from '@/components/ui'
import { getOperationalHealth, getRebalanceReview, type ReviewPosition } from '@/lib/adapters/portfolio-db'
import { fmtNumber, fmtPct } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'
import { getPageCopy } from '@/lib/ui-copy'
import { routeMetadata, routeSection } from '@/lib/page-names'
import { CardRow, KpiBand } from '@/components/layout'
import { Field } from '@/components/form'
import { SubmitButton } from '@/components/SubmitButton'
import { getRebalancePolicy } from '@/lib/rebalance-policy'
import { dbAvailable, portfolioToday } from '@/lib/adapters/portfolio-db'
import { getRebalanceInput } from '@/lib/adapters/rebalance-input'
import { getAllocationPolicy } from '@/lib/rebalance/allocation-policy'
import { computeAllocation, type Allocation, type SleeveRow } from '@/lib/rebalance/allocation'
import { getInstrumentClasses, type InstrumentClasses } from '@/lib/rebalance/instrument-classes'
import { listProposals, type Proposal, type ProposalStatus } from '@/lib/rebalance/proposal-store'
import { isProposalErrorCode, PROPOSAL_STATUS_TONE } from '@/lib/rebalance/proposal-actions'
import { fmtDateShort } from '@/lib/format'
import { createManualProposal, saveRebalanceTargets } from './actions'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/rebalance')

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

const CLOSED: ProposalStatus[] = ['rejected', 'expired', 'closed']


const SLEEVE_TONE = { below: 'warning', within: 'success', above: 'warning' } as const

/** The allocation by sleeve, or why there is none. Never throws: the market-gap view below must still render. */
function loadAllocation(): { state: 'ok'; allocation: Allocation } | { state: 'missing' | 'invalid' | 'classes_unreadable' | 'no_data' } {
  const policyState = getAllocationPolicy()
  if (policyState.error) return { state: 'invalid' }
  if (!policyState.policy) return { state: 'missing' }
  let classes: InstrumentClasses
  try {
    classes = getInstrumentClasses()
  } catch (error) {
    console.error('[rebalance] instrument classes:', error)
    return { state: 'classes_unreadable' }
  }
  if (!dbAvailable()) return { state: 'no_data' }
  try {
    const input = getRebalanceInput(portfolioToday())
    return { state: 'ok', allocation: computeAllocation(input, policyState.policy, classes) }
  } catch (error) {
    console.error('[rebalance] allocation:', error)
    return { state: 'no_data' }
  }
}

function loadProposals(): Proposal[] | null {
  try {
    return listProposals()
  } catch (error) {
    console.error('[rebalance] proposals:', error)
    return null
  }
}

export default async function RebalancePage({ searchParams }: { searchParams: Promise<{ target?: string; error?: string }> }) {
  const params = await searchParams
  const language = await getLanguage()
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const copy = getPageCopy('rebalance', language)
  const glossary = getGlossary(language)
  const rebalance = getRebalanceReview()
  const targetPolicy = getRebalancePolicy()
  const editor = copy.targetEditor
  const operational = getOperationalHealth()
  const freshnessIssues = operational.staleItems.length
  const largestGap = rebalance.marketGaps.reduce((max, row) => Math.max(max, Math.abs(row.gapPct)), 0)
  const proposalCopy = getPageCopy('rebalanceProposal', language)
  const allocationState = loadAllocation()
  const proposals = loadProposals()
  const openProposal = proposals?.find((p) => !CLOSED.includes(p.status)) ?? null
  const pastProposals = proposals?.filter((p) => p !== openProposal) ?? []
  const errorMessage = isProposalErrorCode(params.error) ? proposalCopy.errors[params.error] : null
  const ac = copy.allocation
  const pc = copy.proposals

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/rebalance', language)}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(rebalance.policy.marketTargets.map((row) => `${row.market} ${fmtNumber(row.targetPct)}%`).join(' / '), fmtNumber(rebalance.policy.positionCapPct))}
        action={
          <div className="flex items-center gap-2">
            {freshnessIssues ? <Badge tone="warning">{copy.freshnessIssues(freshnessIssues)}</Badge> : <Badge tone="success">{copy.inputsReady}</Badge>}
            <TextLink href="/rebalance/settings">{copy.settingsLink}</TextLink>
          </div>
        }
      />

      {errorMessage && (
        <Card title={proposalCopy.errorTitle} accent className="mb-5">
          <p className="text-caption text-warning">{errorMessage}</p>
        </Card>
      )}

      <CardRow>
        <Card
          title={ac.title}
          info={ac.info}
          action={
            allocationState.state === 'ok' && allocationState.allocation.unclassified.length > 0 ? (
              <Badge tone="warning">{ac.unclassified(allocationState.allocation.unclassified.length)}</Badge>
            ) : undefined
          }
        >
          {allocationState.state === 'ok' ? (
            <DataTable
              minWidth="28rem"
              rows={allocationState.allocation.sleeves}
              getRowKey={(r: SleeveRow) => r.sleeve}
              columns={[
                { key: 'sleeve', label: ac.sleeve, render: (r: SleeveRow) => <span className="font-medium text-ink">{proposalCopy.sleeves[r.sleeve]}</span> },
                { key: 'pct', label: ac.current, align: 'right', render: (r: SleeveRow) => fmtPct(r.pct) },
                { key: 'target', label: ac.target, align: 'right', render: (r: SleeveRow) => fmtPct(r.target) },
                { key: 'band', label: ac.band, align: 'right', render: (r: SleeveRow) => `${fmtNumber(Math.max(0, r.lower), 1)}–${fmtNumber(Math.min(100, r.upper), 1)}%` },
                { key: 'status', label: ac.status, render: (r: SleeveRow) => <Badge tone={SLEEVE_TONE[r.status]}>{ac.statuses[r.status]}</Badge> },
              ]}
            />
          ) : allocationState.state === 'missing' ? (
            <EmptyState>
              <span className="block">{ac.notConfigured}</span>
              <TextLink href="/rebalance/settings">{ac.configure}</TextLink>
            </EmptyState>
          ) : allocationState.state === 'invalid' ? (
            <EmptyState>
              <span className="block text-warning">{ac.policyInvalid}</span>
              <TextLink href="/rebalance/settings">{ac.configure}</TextLink>
            </EmptyState>
          ) : allocationState.state === 'classes_unreadable' ? (
            <EmptyState>
              <span className="block text-warning">{proposalCopy.classesUnreadable}</span>
              <TextLink href="/rebalance/settings">{ac.configure}</TextLink>
            </EmptyState>
          ) : (
            <EmptyState>{ac.noData}</EmptyState>
          )}
        </Card>

        <Card title={pc.title} info={pc.info} accent>
          <div className="space-y-4">
            <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">{proposalCopy.disclaimer}</div>
            {proposals === null ? (
              <EmptyState>{pc.unreadable}</EmptyState>
            ) : openProposal ? (
              <div className="rounded-md border border-line-subtle px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-label text-ink-3">{pc.open}</span>
                    <Link href={`/rebalance/proposals/${encodeURIComponent(openProposal.id)}`} className="font-mono text-caption font-medium text-info hover:underline">
                      {openProposal.id}
                    </Link>
                  </div>
                  <Badge tone={PROPOSAL_STATUS_TONE[openProposal.status]}>{proposalCopy.statuses[openProposal.status]}</Badge>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-label">
                  <div><dt className="text-ink-3">{pc.kind}</dt><dd className="text-ink">{proposalCopy.kinds[openProposal.kind]}</dd></div>
                  <div><dt className="text-ink-3">{pc.created}</dt><dd className="tabular-nums text-ink">{fmtDateShort(openProposal.createdAt, language)}</dd></div>
                  <div><dt className="text-ink-3">{pc.expires}</dt><dd className="tabular-nums text-ink">{fmtDateShort(openProposal.expiresAt, language)}</dd></div>
                </dl>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-caption text-ink-3">{pc.none}</p>
                {allocationState.state === 'ok' && (
                  <form action={createManualProposal} className="space-y-1">
                    <SubmitButton variant="solid">{pc.create}</SubmitButton>
                    <p className="text-label text-ink-3">{pc.createNote}</p>
                  </form>
                )}
              </div>
            )}
            {proposals !== null && (
              <div>
                <div className="mb-1 text-label font-medium text-ink-2">{pc.past}</div>
                {pastProposals.length === 0 ? (
                  <p className="text-label text-ink-3">{pc.noPast}</p>
                ) : (
                  <ul className="divide-y divide-line-subtle">
                    {pastProposals.slice(0, 12).map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-label">
                        <Link href={`/rebalance/proposals/${encodeURIComponent(p.id)}`} className="font-mono font-medium text-info hover:underline">
                          {p.id}
                        </Link>
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums text-ink-3">{fmtDateShort(p.createdAt, language)}</span>
                          <Badge tone={PROPOSAL_STATUS_TONE[p.status]}>{proposalCopy.statuses[p.status]}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Card>
      </CardRow>

      <CardRow columns="hero">
        <MetricHeroCard
          title={copy.largestMarketGap}
          info={glossary.marketGap.description}
          eyebrow={copy.primarySignal}
          value={fmtPct(largestGap)}
          hint={copy.marketGapHint}
        >
          <KpiBand>
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
          </KpiBand>
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
      </CardRow>

      <CardRow columns="hero">
        <Card title={copy.marketTargetGaps}>
          <DataTable
            minWidth="30rem"
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

        <Card title={editor.title}>
          {rebalance.policy.marketSplitSource === 'allocation_policy' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-caption text-ink-2">
                <span>{editor.usLabel}</span>
                <Badge tone="neutral">{fmtNumber(rebalance.policy.marketTargets.find((t) => t.market === 'US')?.targetPct ?? 0, 1)}%</Badge>
              </div>
              <p className="text-label leading-relaxed text-ink-3">{editor.derivedNote}</p>
              <TextLink href="/rebalance/settings">{copy.settingsLink}</TextLink>
            </div>
          ) : (
          <form action={saveRebalanceTargets} className="space-y-4">
            <Field label={editor.usLabel} name="usTargetPct" defaultValue={targetPolicy.usTargetPct} suffix="%" />
            <div className="flex items-center justify-between gap-3 text-caption text-ink-2">
              <span>{editor.krLabel}</span>
              <Badge tone="neutral">{fmtNumber(100 - targetPolicy.usTargetPct)}%</Badge>
            </div>
            <p className="text-label leading-relaxed text-ink-3">
              {targetPolicy.source === 'default' ? editor.defaultNote : editor.hint}
            </p>
            <div className="flex items-center gap-3">
              <SubmitButton>{editor.save}</SubmitButton>
              {params.target === 'saved' && <Badge tone="success">{editor.saved}</Badge>}
              {params.target === 'invalid' && <Badge tone="warning">{editor.invalid}</Badge>}
            </div>
          </form>
          )}
        </Card>
      </CardRow>

      <CardRow columns={3}>
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
      </CardRow>

      <CardRow>
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
      </CardRow>

      <Card title={copy.holdWatch} accent={rebalance.watchCandidates.length + freshnessIssues > 0}>
        {rebalance.watchCandidates.length === 0 && freshnessIssues === 0 ? (
          <EmptyState ok>{copy.noBlockers}</EmptyState>
        ) : (
          <div className="space-y-4">
            {freshnessIssues > 0 && (
              <div className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption text-ink-2">
                <div className="font-medium text-warning">{copy.staleInputs(freshnessIssues)}</div>
                <Link href="/health" className="mt-1 inline-flex min-h-6 items-center text-label font-medium text-info hover:underline">
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
