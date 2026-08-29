import Link from 'next/link'
import { createSavedTaxPlanAction } from '@/app/tax-planning/actions'
import { DataTable } from '@/components/DataTable'
import { Badge, Card, EmptyState, Label, MetricField, Signed, marketTone, type Tone } from '@/components/ui'
import type { createMoneyFormatter } from '@/lib/currency'
import { fmtDateShort, fmtDateTime, fmtDurationDays, fmtNumber, fmtQuantity } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import type { MonthlySaleMasterPlan, MonthlySalePlanSet, TaxPlanCandidate, MasterPlanStrategyKey } from '@/lib/tax-planning'
import { savedTaxPlanProgress, type SavedTaxPlan } from '@/lib/tax-plan-store'
import { bucketTone, signClass } from '@/lib/tone'
import type { getPageCopy } from '@/lib/ui-copy'

type TaxPlanningCopy = ReturnType<typeof getPageCopy<'taxPlanning'>>
import { Input } from '@/components/form'
import { SubmitButton } from '@/components/SubmitButton'

type MoneyFormatter = ReturnType<typeof createMoneyFormatter>

function PositionCell({ row }: { row: TaxPlanCandidate }) {
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

export function CandidateTable({ rows, copy, money }: { rows: TaxPlanCandidate[]; copy: TaxPlanningCopy; money: MoneyFormatter }) {
  if (rows.length === 0) return <EmptyState>{copy.candidateTable.empty}</EmptyState>
  return (
    <DataTable
      rows={rows}
      columns={[
        { key: 'ticker', label: copy.candidateTable.position, render: (r) => <PositionCell row={r} /> },
        { key: 'account', label: copy.candidateTable.account, render: (r) => <span className="max-w-[12rem] truncate">{r.brokerage} · {r.account}</span> },
        { key: 'acquired_date', label: copy.candidateTable.acquired },
        { key: 'holdingBucket', label: copy.candidateTable.term, render: (r) => <Badge tone={bucketTone(r.holdingBucket)}>{r.holdingBucket}</Badge> },
        { key: 'open_quantity', label: copy.candidateTable.quantity, align: 'right', render: (r) => fmtQuantity(r.open_quantity, 4) },
        { key: 'proceedsNative', label: copy.candidateTable.proceeds, align: 'right', render: (r) => (r.proceedsNative == null ? copy.candidateTable.notAvailable : money(r.proceedsNative, r.currency)) },
        { key: 'gainKrw', label: copy.candidateTable.baseGainLoss, align: 'right', render: (r) => <Signed value={r.gainKrw} format={(m) => money(m, 'KRW')} /> },
        { key: 'estimatedTaxKrw', label: copy.candidateTable.grossLotTax, align: 'right', render: (r) => money(r.estimatedTaxKrw) },
        { key: 'estimatedAfterTaxKrw', label: copy.candidateTable.afterTax, align: 'right', render: (r) => (r.estimatedAfterTaxKrw == null ? copy.candidateTable.notAvailable : money(r.estimatedAfterTaxKrw)) },
      ]}
    />
  )
}

function PlanMetric({
  label,
  value,
  hint,
  info,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint: string
  info?: string
  tone?: Tone
}) {
  return (
    <div className="min-w-0 px-3 py-3 first:pl-0 last:pr-0">
      <MetricField
        label={label}
        value={value}
        hint={hint}
        info={info}
        tone={tone}
        labelClassName="tracking-normal"
        valueClassName="truncate text-title"
      />
    </div>
  )
}

export function MasterPlanOverview({
  planSet,
  inputIssueCount,
  fullHoldingsValueKrw,
  copy,
  money,
}: {
  planSet: MonthlySalePlanSet
  inputIssueCount: number
  fullHoldingsValueKrw: number
  copy: TaxPlanningCopy
  money: MoneyFormatter
}) {
  const plan = planSet.selectedPlan
  const earliest = planSet.scenarios.find((item) => item.strategy === 'EARLIEST_LT')
  const wait = planSet.scenarios.find((item) => item.strategy === 'WAIT_US_ONLY')
  const waitSavings = Number(earliest?.summary.estimatedTaxKrw ?? 0) - Number(wait?.summary.estimatedTaxKrw ?? 0)
  const waitDays = Number(wait?.summary.averageWaitDays ?? 0) - Number(earliest?.summary.averageWaitDays ?? 0)
  const earliestKrTopUp = Number(earliest?.summary.incrementalKrTaxAfterCreditKrw ?? 0)
  const waitKrTopUp = Number(wait?.summary.incrementalKrTaxAfterCreditKrw ?? 0)
  const coveragePct = fullHoldingsValueKrw > 0 ? (planSet.coverage.modeledProceedsKrw / fullHoldingsValueKrw) * 100 : 0
  const coverageNeedsReview = coveragePct > 100.5

  return (
    <Card
      title={copy.overview.title}
      info={copy.overview.info}
      className="mb-5"
      accent
      action={<Badge tone="success">{plan.label}</Badge>}
    >
      <div className="flex flex-col gap-3 border-b border-line-subtle pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Label size="micro">{copy.overview.executionWindow}</Label>
          <h2 className="mt-1 text-title font-medium leading-tight text-ink">
            {fmtDateShort(plan.summary.startDate)} <span className="text-ink-3">{copy.overview.to}</span>{' '}
            {fmtDateShort(plan.summary.endDate)}
          </h2>
          <p className="mt-2 max-w-[58rem] text-body leading-relaxed text-ink-2">{plan.description}</p>
        </div>
        <div className="shrink-0 rounded-md border border-[color:var(--accent-success)]/25 bg-[color:var(--accent-success)]/5 px-3 py-2 lg:max-w-[19rem]">
          <Label size="micro" className="text-success">{copy.overview.whyThisMatters}</Label>
          <div className="mt-1 text-label leading-relaxed text-ink-2">
            {copy.overview.longTermTreatment(fmtNumber(plan.summary.longTermSalePct, 1))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-line-subtle border-b border-line-subtle md:grid-cols-4">
        <PlanMetric
          label={copy.overview.plannedSales}
          value={money(plan.summary.proceedsKrw)}
          hint={copy.overview.pricedLots(fmtNumber(plan.summary.lotCount))}
        />
        <PlanMetric
          label={copy.overview.estimatedTax}
          value={money(plan.summary.estimatedTaxKrw)}
          hint={copy.overview.longTermPct(fmtNumber(plan.summary.longTermSalePct, 1))}
          tone={plan.summary.estimatedTaxKrw > 0 ? 'warning' : 'success'}
        />
        <PlanMetric
          label={copy.overview.afterTaxCash}
          value={money(plan.summary.afterTaxKrw)}
          hint={copy.overview.saleInstructions(fmtNumber(plan.summary.instructionCount))}
          tone="success"
        />
        <PlanMetric
          label={copy.overview.inputCoverage}
          value={`${fmtNumber(coveragePct, 1)}%`}
          hint={copy.overview.coverageHint(fmtNumber(inputIssueCount), fmtNumber(planSet.coverage.missingValuationCount))}
          info={copy.overview.inputCoverageInfo}
          tone={inputIssueCount ? 'warning' : 'success'}
        />
      </div>

      {coverageNeedsReview ? (
        <div className="mt-3 rounded-md border border-[color:var(--accent-warning)]/30 bg-[color:var(--accent-warning)]/5 px-3 py-2 text-caption leading-relaxed text-ink-2" role="status">
          <span className="font-medium text-warning">{copy.overview.reviewInputRange}</span>{' '}
          {copy.overview.coverageWarning}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="border-l-2 border-[color:var(--accent-info)] px-3 py-1">
          <Label size="micro">{copy.overview.lotsStillWaiting}</Label>
          <div className="mt-1 text-caption leading-relaxed text-ink-2">
            <span className="font-medium tabular-nums text-ink">
              {copy.overview.waitingLots(fmtNumber(planSet.timing.waitingLotCount), money(planSet.timing.waitingProceedsKrw), planSet.timing.nextLongTermDate ? fmtDateShort(planSet.timing.nextLongTermDate) : null)}
            </span>
          </div>
        </div>
        <div className="border-l-2 border-[color:var(--accent-success)] px-3 py-1">
          <Label size="micro">{copy.overview.estimatedTermBenefit}</Label>
          <div className="mt-1 text-caption leading-relaxed text-ink-2">
            <span className="font-medium tabular-nums text-success">
              {copy.overview.termBenefit(money(planSet.timing.estimatedFederalTaxAvoidedKrw))}
            </span>
          </div>
        </div>
        <div className="border-l-2 border-[color:var(--accent-warning)] px-3 py-1">
          <Label size="micro">{copy.overview.waitingUntil2028}</Label>
          <div className="mt-1 text-caption leading-relaxed text-ink-2">
            <span className={`font-medium tabular-nums ${signClass(waitSavings)}`}>
              {copy.overview.waitUntil2028(waitSavings >= 0 ? copy.overview.saving : copy.overview.extraTax, money(Math.abs(waitSavings)), fmtDurationDays(Math.max(waitDays, 0)), money(earliestKrTopUp), money(waitKrTopUp))}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

export function MasterScenarioComparison({
  planSet,
  horizonYears,
  copy,
  money,
}: {
  planSet: MonthlySalePlanSet
  horizonYears: number
  copy: TaxPlanningCopy
  money: MoneyFormatter
}) {
  const baseline = planSet.scenarios.find((item) => item.strategy === 'EARLIEST_LT')
  const minTax = Math.min(...planSet.scenarios.map((item) => item.summary.estimatedTaxKrw))
  const maxTax = Math.max(...planSet.scenarios.map((item) => item.summary.estimatedTaxKrw), 1)
  return (
    <Card
      title={copy.comparison.title}
      info={copy.comparison.info}
      className="mb-5"
    >
      <div className="mb-3 flex flex-col gap-1 border-b border-line-subtle pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Label size="micro">{copy.comparison.lowestEstimatedTax}</Label>
          <div className="mt-1 text-title font-medium tabular-nums text-success">{money(minTax)}</div>
        </div>
        <div className="text-label text-ink-3">{copy.comparison.scale}</div>
      </div>
      <div className="divide-y divide-line-subtle">
        {planSet.scenarios.map((scenarioRow) => {
          const delta = scenarioRow.summary.estimatedTaxKrw - Number(baseline?.summary.estimatedTaxKrw ?? 0)
          const selected = scenarioRow.strategy === planSet.selectedPlan.strategy
          const taxWidth = Math.max((scenarioRow.summary.estimatedTaxKrw / maxTax) * 100, 2)
          return (
            <div
              key={scenarioRow.strategy}
              className={`grid gap-3 py-3 lg:grid-cols-[minmax(18rem,1.5fr)_minmax(15rem,1fr)_minmax(14rem,0.8fr)] lg:items-center ${
                selected ? '-mx-2 rounded-md bg-surface px-2' : ''
              }`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/tax-planning?master=${scenarioRow.strategy}&pace=${planSet.executionMonths}&horizon=${horizonYears}`}
                    className="inline-flex min-h-6 items-center text-body font-medium text-info hover:underline"
                  >
                    {scenarioRow.label}
                  </Link>
                  {selected && <Badge tone="success">{copy.comparison.selected}</Badge>}
                  {scenarioRow.summary.estimatedTaxKrw === minTax && <Badge tone="success">{copy.comparison.lowestTax}</Badge>}
                </div>
                <div className="mt-1 max-w-[34rem] text-label leading-relaxed text-ink-3">
                  {scenarioRow.description}
                </div>
              </div>

              <div>
                <div className="flex items-end justify-between gap-3">
                  <Label as="span" size="micro">{copy.comparison.estimatedTax}</Label>
                  <span className="text-body font-medium tabular-nums text-ink">
                    {money(scenarioRow.summary.estimatedTaxKrw)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-line-subtle">
                  <div
                    className={scenarioRow.summary.estimatedTaxKrw === minTax ? 'h-full bg-success' : 'h-full bg-warning'}
                    style={{ width: `${taxWidth}%` }}
                  />
                </div>
                <div className={`mt-1 text-right text-micro tabular-nums ${signClass(-delta)}`}>
                  {delta === 0 ? copy.comparison.earliestBaseline : delta < 0 ? copy.comparison.less(money(Math.abs(delta))) : copy.comparison.more(money(delta))}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-label">
                <dt className="text-ink-3">{copy.comparison.execution}</dt>
                <dd className="text-right text-ink">
                  {fmtDateShort(scenarioRow.summary.startDate)} {copy.comparison.to} {fmtDateShort(scenarioRow.summary.endDate)}
                </dd>
                <dt className="text-ink-3">{copy.comparison.longTermSales}</dt>
                <dd className="text-right tabular-nums text-ink">{fmtNumber(scenarioRow.summary.longTermSalePct, 1)}%</dd>
                <dt className="text-ink-3">{copy.comparison.averageWait}</dt>
                <dd className="text-right tabular-nums text-ink">{fmtDurationDays(scenarioRow.summary.averageWaitDays)}</dd>
                <dt className="text-ink-3">{copy.comparison.krTopUp}</dt>
                <dd className="text-right tabular-nums text-ink">{money(scenarioRow.summary.incrementalKrTaxAfterCreditKrw)}</dd>
              </dl>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function SavedPlansPanel({
  plans,
  selectedStrategy,
  executionMonths,
  horizonYears,
  copy,
  money,
}: {
  plans: SavedTaxPlan[]
  selectedStrategy: MasterPlanStrategyKey
  executionMonths: number
  horizonYears: number
  copy: TaxPlanningCopy
  money: MoneyFormatter
}) {
  const visiblePlans = plans.filter((plan) => plan.status !== 'archived').slice(0, 5)
  return (
    <Card
      title={copy.savedPlans.title}
      info={copy.savedPlans.info}
      className="mb-5"
      action={<Badge>{copy.savedPlans.recent(fmtNumber(visiblePlans.length))}</Badge>}
    >
      <div className="grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <form action={createSavedTaxPlanAction} className="rounded-md border border-line-subtle bg-surface p-3">
          <Label size="micro">{copy.savedPlans.saveCurrentCalculation}</Label>
          <p className="mt-1 text-label leading-relaxed text-ink-3">
            {copy.savedPlans.saveDescription}
          </p>
          <input type="hidden" name="strategy" value={selectedStrategy} />
          <input type="hidden" name="executionMonths" value={executionMonths} />
          <input type="hidden" name="horizonYears" value={horizonYears} />
          <label htmlFor="plan-name" className="mt-3 block text-micro font-medium uppercase text-ink-3">
            {copy.savedPlans.planName}
          </label>
          <Input
            id="plan-name"
            name="name"
            type="text"
            maxLength={120}
            required
            placeholder={copy.savedPlans.placeholder} className="mt-1 w-full" />
          <SubmitButton variant="solid" size="md" className="mt-2 w-full">
            {copy.savedPlans.saveAsDraft}
          </SubmitButton>
          <div className="mt-2 text-micro leading-relaxed text-ink-3">
            {copy.savedPlans.storageNote}
          </div>
        </form>

        <div>
          {visiblePlans.length ? (
            <div className="divide-y divide-line-subtle">
              {visiblePlans.map((saved) => {
                const progress = savedTaxPlanProgress(saved)
                return (
                  <div key={saved.id} className="grid gap-3 py-3 first:pt-0 lg:grid-cols-[minmax(15rem,1fr)_12rem_11rem_auto] lg:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/tax-planning/plans/${saved.id}`} className="inline-flex min-h-6 items-center text-body font-medium text-info hover:underline">
                          {saved.name}
                        </Link>
                        <Badge tone={saved.status === 'active' ? 'warning' : saved.status === 'completed' ? 'success' : saved.status === 'reviewed' ? 'info' : 'neutral'}>
                          {saved.status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-micro text-ink-3">
                        {saved.plan.label} · snapshot {saved.asOfDate} · revision {saved.revision}
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-micro text-ink-3">
                        <span>{copy.savedPlans.execution}</span><span>{fmtNumber(progress.completionPct, 1)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-line-subtle">
                        <div className="h-full bg-success" style={{ width: `${progress.completionPct}%` }} />
                      </div>
                    </div>
                    <div className="text-label tabular-nums text-ink-2">
                      <div>{money(saved.plan.summary.proceedsKrw)} {copy.savedPlans.planned}</div>
                      <div className="mt-0.5 text-ink-3">{copy.savedPlans.executed(fmtNumber(progress.executed), fmtNumber(progress.total))}</div>
                    </div>
                    <div className="text-right text-micro text-ink-3">{fmtDateTime(saved.updatedAt)}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-[10rem] items-center justify-center text-center text-caption text-ink-3">
              {copy.savedPlans.empty}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

export function MasterPlanAnnualTax({ plan, copy, money }: { plan: MonthlySaleMasterPlan; copy: TaxPlanningCopy; money: MoneyFormatter }) {
  return (
    <Card
      title={copy.annualTax.title}
      info={copy.annualTax.info}
      className="mb-5"
    >
      {/* One table, not a card list and a table side by side. The pair had to be
          kept in step by hand and the mobile copy quietly dropped two of the tax
          components; DataTable's column priorities hide the same columns below
          md without a second rendering. */}
      <DataTable
        caption={copy.annualTax.title}
        rows={plan.years}
        getRowKey={(year: any) => year.year}
        columns={[
          { key: 'year', label: copy.annualTax.taxYear, nowrap: true, render: (y: any) => <span className="font-mono text-ink">{y.year}</span> },
          { key: 'profile', label: copy.annualTax.profile, render: (y: any) => <Badge tone="info">{y.filingScenario}</Badge> },
          { key: 'proceeds', label: copy.annualTax.sales, align: 'right', render: (y: any) => money(y.proceedsKrw) },
          { key: 'gain', label: copy.annualTax.netGainLoss, align: 'right', render: (y: any) => <Signed value={y.gainKrw} format={(m) => money(m, 'KRW')} /> },
          { key: 'usGross', label: copy.annualTax.usGross, align: 'right', priority: 'secondary', render: (y: any) => money(y.usGrossTaxKrw ?? 0) },
          { key: 'krGross', label: copy.annualTax.krGross, align: 'right', priority: 'secondary', render: (y: any) => money(y.krGrossTaxKrw ?? 0) },
          { key: 'credit', label: copy.annualTax.credit, align: 'right', priority: 'secondary', render: (y: any) => <span className="text-success">-{money(y.estimatedCrossBorderTaxCreditKrw)}</span> },
          { key: 'netTax', label: copy.annualTax.netTax, align: 'right', render: (y: any) => <span className="font-medium text-ink">{money(y.estimatedTaxKrw)}</span> },
          { key: 'afterTax', label: copy.annualTax.afterTaxCash, align: 'right', render: (y: any) => money(y.afterTaxKrw) },
          {
            key: 'components',
            label: copy.annualTax.taxComponents,
            priority: 'tertiary',
            render: (y: any) => (
              <div className="grid gap-1 text-micro text-ink-3">
                <span>{copy.annualTax.federalShortTerm} <strong className="font-medium text-ink">{money(y.usFederalShortTermTaxKrw ?? 0)}</strong></span>
                <span>{copy.annualTax.federalLongTerm} <strong className="font-medium text-ink">{money(y.usFederalLongTermTaxKrw ?? 0)}</strong></span>
                <span>{copy.annualTax.niit} <strong className="font-medium text-ink">{money(y.usNiitTaxKrw ?? 0)}</strong></span>
                <span>{copy.annualTax.california} <strong className="font-medium text-ink">{money(y.usStateTaxKrw ?? 0)}</strong></span>
                <span>{copy.annualTax.usFtcLimit} <strong className="font-medium text-ink">{money(y.usForeignTaxCreditLimitKrw ?? 0)}</strong></span>
                <span>{copy.annualTax.usFtcUsed} <strong className="font-medium text-success">-{money(y.usForeignTaxCreditKrw ?? 0)}</strong></span>
                <span>{copy.annualTax.krCreditUsed} <strong className="font-medium text-success">-{money(y.krForeignTaxCreditKrw ?? 0)}</strong></span>
              </div>
            ),
          },
        ]}
      />
    </Card>
  )
}
