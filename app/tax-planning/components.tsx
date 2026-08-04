import Link from 'next/link'
import { Fragment } from 'react'
import { createSavedTaxPlanAction } from '@/app/tax-planning/actions'
import { DataTable } from '@/components/DataTable'
import { Badge, Card, EmptyState, MetricField, marketTone, type Tone } from '@/components/ui'
import { fmtDateTime, fmtNumber, fmtQuantity } from '@/lib/format'
import { useMoneyFormatter } from '@/components/LanguageProvider'
import { positionHref } from '@/lib/position-url'
import type { MonthlySaleMasterPlan, MonthlySalePlanSet, TaxPlanCandidate, MasterPlanStrategyKey } from '@/lib/tax-planning'
import { savedTaxPlanProgress, type SavedTaxPlan } from '@/lib/tax-plan-store'
import type { TaxPlanningCopy } from './copy'

function signedMoney(value: number, money: (value: number | null | undefined, currency?: string | null | undefined) => string) {
  return <span className={value >= 0 ? 'text-success' : 'text-danger'}>{money(value, 'KRW')}</span>
}

function PositionCell({ row }: { row: TaxPlanCandidate }) {
  return (
    <div className="min-w-[14rem]">
      <div className="flex items-center gap-2">
        <Badge tone={marketTone(row.market)}>{row.market}</Badge>
        <Link href={positionHref(row.market, row.ticker)} className="font-mono text-[12px] font-medium text-info hover:underline">
          {row.ticker}
        </Link>
      </div>
      <div className="mt-1 max-w-[20rem] truncate text-[12px] font-medium text-ink">{row.name}</div>
    </div>
  )
}

export function CandidateTable({ rows, copy }: { rows: TaxPlanCandidate[]; copy: TaxPlanningCopy }) {
  const money = useMoneyFormatter()
  if (rows.length === 0) return <EmptyState>{copy.candidateTable.empty}</EmptyState>
  return (
    <DataTable
      rows={rows}
      columns={[
        { key: 'ticker', label: copy.candidateTable.position, render: (r) => <PositionCell row={r} /> },
        { key: 'account', label: copy.candidateTable.account, render: (r) => <span className="max-w-[12rem] truncate">{r.brokerage} · {r.account}</span> },
        { key: 'acquired_date', label: copy.candidateTable.acquired },
        { key: 'holdingBucket', label: copy.candidateTable.term, render: (r) => <Badge tone={r.holdingBucket === 'long' ? 'success' : 'warning'}>{r.holdingBucket}</Badge> },
        { key: 'open_quantity', label: copy.candidateTable.quantity, align: 'right', render: (r) => fmtQuantity(r.open_quantity, 4) },
        { key: 'proceedsNative', label: copy.candidateTable.proceeds, align: 'right', render: (r) => (r.proceedsNative == null ? copy.candidateTable.notAvailable : money(r.proceedsNative, r.currency)) },
        { key: 'gainKrw', label: copy.candidateTable.baseGainLoss, align: 'right', render: (r) => signedMoney(r.gainKrw, money) },
        { key: 'estimatedTaxKrw', label: copy.candidateTable.grossLotTax, align: 'right', render: (r) => money(r.estimatedTaxKrw) },
        { key: 'estimatedAfterTaxKrw', label: copy.candidateTable.afterTax, align: 'right', render: (r) => (r.estimatedAfterTaxKrw == null ? copy.candidateTable.notAvailable : money(r.estimatedAfterTaxKrw)) },
      ]}
    />
  )
}

function dateLabel(value: string | null | undefined) {
  if (!value) return 'n/a'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

function durationLabel(days: number) {
  const rounded = Math.round(days)
  if (rounded < 31) return `${fmtNumber(rounded)} days`
  return `${fmtNumber(rounded / 30.4375, 1)} months`
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
        labelClassName="text-[10px] tracking-normal"
        valueClassName="truncate text-[20px]"
      />
    </div>
  )
}

export function MasterPlanOverview({
  planSet,
  inputIssueCount,
  fullHoldingsValueKrw,
  copy,
}: {
  planSet: MonthlySalePlanSet
  inputIssueCount: number
  fullHoldingsValueKrw: number
  copy: TaxPlanningCopy
}) {
  const money = useMoneyFormatter()
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
          <div className="text-[10px] font-medium uppercase text-ink-3">{copy.overview.executionWindow}</div>
          <h2 className="mt-1 text-[22px] font-medium leading-tight text-ink">
            {dateLabel(plan.summary.startDate)} <span className="text-ink-3">{copy.overview.to}</span>{' '}
            {dateLabel(plan.summary.endDate)}
          </h2>
          <p className="mt-2 max-w-[58rem] text-[13px] leading-relaxed text-ink-2">{plan.description}</p>
        </div>
        <div className="shrink-0 rounded-md border border-[color:var(--accent-success)]/25 bg-[color:var(--accent-success)]/5 px-3 py-2 lg:max-w-[19rem]">
          <div className="text-[10px] font-medium uppercase text-success">{copy.overview.whyThisMatters}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-ink-2">
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
        <div className="mt-3 rounded-md border border-[color:var(--accent-warning)]/30 bg-[color:var(--accent-warning)]/5 px-3 py-2 text-[12px] leading-relaxed text-ink-2" role="status">
          <span className="font-medium text-warning">{copy.overview.reviewInputRange}</span>{' '}
          {copy.overview.coverageWarning}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="border-l-2 border-[color:var(--accent-info)] px-3 py-1">
          <div className="text-[10px] font-medium uppercase text-ink-3">{copy.overview.lotsStillWaiting}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">
            <span className="font-medium tabular-nums text-ink">
              {copy.overview.waitingLots(fmtNumber(planSet.timing.waitingLotCount), money(planSet.timing.waitingProceedsKrw), planSet.timing.nextLongTermDate ? dateLabel(planSet.timing.nextLongTermDate) : null)}
            </span>
          </div>
        </div>
        <div className="border-l-2 border-[color:var(--accent-success)] px-3 py-1">
          <div className="text-[10px] font-medium uppercase text-ink-3">{copy.overview.estimatedTermBenefit}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">
            <span className="font-medium tabular-nums text-success">
              {copy.overview.termBenefit(money(planSet.timing.estimatedFederalTaxAvoidedKrw))}
            </span>
          </div>
        </div>
        <div className="border-l-2 border-[color:var(--accent-warning)] px-3 py-1">
          <div className="text-[10px] font-medium uppercase text-ink-3">{copy.overview.waitingUntil2028}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">
            <span className={`font-medium tabular-nums ${waitSavings >= 0 ? 'text-success' : 'text-danger'}`}>
              {copy.overview.waitUntil2028(waitSavings >= 0 ? copy.overview.saving : copy.overview.extraTax, money(Math.abs(waitSavings)), durationLabel(Math.max(waitDays, 0)), money(earliestKrTopUp), money(waitKrTopUp))}
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
}: {
  planSet: MonthlySalePlanSet
  horizonYears: number
  copy: TaxPlanningCopy
}) {
  const money = useMoneyFormatter()
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
          <div className="text-[10px] font-medium uppercase text-ink-3">{copy.comparison.lowestEstimatedTax}</div>
          <div className="mt-1 text-[18px] font-medium tabular-nums text-success">{money(minTax)}</div>
        </div>
        <div className="text-[11px] text-ink-3">{copy.comparison.scale}</div>
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
                    className="text-[13px] font-medium text-info hover:underline"
                  >
                    {scenarioRow.label}
                  </Link>
                  {selected && <Badge tone="success">{copy.comparison.selected}</Badge>}
                  {scenarioRow.summary.estimatedTaxKrw === minTax && <Badge tone="success">{copy.comparison.lowestTax}</Badge>}
                </div>
                <div className="mt-1 max-w-[34rem] text-[11px] leading-relaxed text-ink-3">
                  {scenarioRow.description}
                </div>
              </div>

              <div>
                <div className="flex items-end justify-between gap-3">
                  <span className="text-[10px] uppercase text-ink-3">{copy.comparison.estimatedTax}</span>
                  <span className="text-[13px] font-medium tabular-nums text-ink">
                    {money(scenarioRow.summary.estimatedTaxKrw)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-line-subtle">
                  <div
                    className={scenarioRow.summary.estimatedTaxKrw === minTax ? 'h-full bg-success' : 'h-full bg-warning'}
                    style={{ width: `${taxWidth}%` }}
                  />
                </div>
                <div className={`mt-1 text-right text-[10px] tabular-nums ${delta <= 0 ? 'text-success' : 'text-danger'}`}>
                  {delta === 0 ? copy.comparison.earliestBaseline : delta < 0 ? copy.comparison.less(money(Math.abs(delta))) : copy.comparison.more(money(delta))}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <dt className="text-ink-3">{copy.comparison.execution}</dt>
                <dd className="text-right text-ink">
                  {dateLabel(scenarioRow.summary.startDate)} {copy.comparison.to} {dateLabel(scenarioRow.summary.endDate)}
                </dd>
                <dt className="text-ink-3">{copy.comparison.longTermSales}</dt>
                <dd className="text-right tabular-nums text-ink">{fmtNumber(scenarioRow.summary.longTermSalePct, 1)}%</dd>
                <dt className="text-ink-3">{copy.comparison.averageWait}</dt>
                <dd className="text-right tabular-nums text-ink">{durationLabel(scenarioRow.summary.averageWaitDays)}</dd>
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
}: {
  plans: SavedTaxPlan[]
  selectedStrategy: MasterPlanStrategyKey
  executionMonths: number
  horizonYears: number
  copy: TaxPlanningCopy
}) {
  const money = useMoneyFormatter()
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
          <div className="text-[10px] font-medium uppercase text-ink-3">{copy.savedPlans.saveCurrentCalculation}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            {copy.savedPlans.saveDescription}
          </p>
          <input type="hidden" name="strategy" value={selectedStrategy} />
          <input type="hidden" name="executionMonths" value={executionMonths} />
          <input type="hidden" name="horizonYears" value={horizonYears} />
          <label htmlFor="plan-name" className="mt-3 block text-[10px] font-medium uppercase text-ink-3">
            {copy.savedPlans.planName}
          </label>
          <input
            id="plan-name"
            name="name"
            type="text"
            maxLength={120}
            placeholder={copy.savedPlans.placeholder}
            className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-info"
          />
          <button type="submit" className="mt-2 w-full rounded-md border border-ink bg-ink px-3 py-2 text-[12px] font-medium text-card">
            {copy.savedPlans.saveAsDraft}
          </button>
          <div className="mt-2 text-[10px] leading-relaxed text-ink-3">
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
                        <Link href={`/tax-planning/plans/${saved.id}`} className="text-[13px] font-medium text-info hover:underline">
                          {saved.name}
                        </Link>
                        <Badge tone={saved.status === 'active' ? 'warning' : saved.status === 'completed' ? 'success' : saved.status === 'reviewed' ? 'info' : 'neutral'}>
                          {saved.status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[10px] text-ink-3">
                        {saved.plan.label} · snapshot {saved.asOfDate} · revision {saved.revision}
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-ink-3">
                        <span>{copy.savedPlans.execution}</span><span>{fmtNumber(progress.completionPct, 1)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-line-subtle">
                        <div className="h-full bg-success" style={{ width: `${progress.completionPct}%` }} />
                      </div>
                    </div>
                    <div className="text-[11px] tabular-nums text-ink-2">
                      <div>{money(saved.plan.summary.proceedsKrw)} {copy.savedPlans.planned}</div>
                      <div className="mt-0.5 text-ink-3">{copy.savedPlans.executed(fmtNumber(progress.executed), fmtNumber(progress.total))}</div>
                    </div>
                    <div className="text-right text-[10px] text-ink-3">{fmtDateTime(saved.updatedAt)}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-[10rem] items-center justify-center text-center text-[12px] text-ink-3">
              {copy.savedPlans.empty}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

export function MasterPlanAnnualTax({ plan, copy }: { plan: MonthlySaleMasterPlan; copy: TaxPlanningCopy }) {
  const money = useMoneyFormatter()
  return (
    <Card
      title={copy.annualTax.title}
      info={copy.annualTax.info}
      className="mb-5"
    >
      <div className="space-y-3 md:hidden">
        {plan.years.map((year) => (
          <article key={year.year} className="rounded-md border border-line-subtle bg-surface px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] text-ink">{year.year}</span>
                <Badge tone="info">{year.filingScenario}</Badge>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase text-ink-3">{copy.annualTax.netTax}</div>
                <div className="mt-0.5 text-[15px] font-medium tabular-nums text-ink">{money(year.estimatedTaxKrw)}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-line-subtle py-2 text-[11px]">
              <div><span className="text-ink-3">{copy.annualTax.sales}</span><div className="mt-0.5 tabular-nums text-ink">{money(year.proceedsKrw)}</div></div>
              <div className="text-right"><span className="text-ink-3">{copy.annualTax.netGainLoss}</span><div className="mt-0.5 tabular-nums">{signedMoney(year.gainKrw, money)}</div></div>
              <div><span className="text-ink-3">{copy.annualTax.usGross}</span><div className="mt-0.5 tabular-nums text-ink">{money(year.usGrossTaxKrw ?? 0)}</div></div>
              <div className="text-right"><span className="text-ink-3">{copy.annualTax.krGross}</span><div className="mt-0.5 tabular-nums text-ink">{money(year.krGrossTaxKrw ?? 0)}</div></div>
              <div><span className="text-ink-3">{copy.annualTax.creditUsed}</span><div className="mt-0.5 tabular-nums text-success">-{money(year.estimatedCrossBorderTaxCreditKrw)}</div></div>
              <div className="text-right"><span className="text-ink-3">{copy.annualTax.afterTaxCash}</span><div className="mt-0.5 tabular-nums text-ink">{money(year.afterTaxKrw)}</div></div>
            </div>
            <details className="mt-2 text-[10px] text-ink-3">
              <summary className="cursor-pointer font-medium text-info">{copy.annualTax.taxComponents}</summary>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <span>{copy.annualTax.federalShortTerm} {money(year.usFederalShortTermTaxKrw ?? 0)}</span>
                <span>{copy.annualTax.federalLongTerm} {money(year.usFederalLongTermTaxKrw ?? 0)}</span>
                <span>{copy.annualTax.niit} {money(year.usNiitTaxKrw ?? 0)}</span>
                <span>{copy.annualTax.california} {money(year.usStateTaxKrw ?? 0)}</span>
                <span>{copy.annualTax.usFtcLimit} {money(year.usForeignTaxCreditLimitKrw ?? 0)}</span>
                <span>{copy.annualTax.krCreditUsed} {money(year.krForeignTaxCreditKrw ?? 0)}</span>
              </div>
            </details>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-[12px]">
          <thead className="text-[10px] uppercase text-ink-3">
            <tr>
              <th className="pb-2 pr-4 font-medium">{copy.annualTax.taxYear}</th>
              <th className="pb-2 pr-4 font-medium">{copy.annualTax.profile}</th>
              <th className="pb-2 pr-4 text-right font-medium">{copy.annualTax.sales}</th>
              <th className="pb-2 pr-4 text-right font-medium">{copy.annualTax.netGainLoss}</th>
              <th className="pb-2 pr-4 text-right font-medium">{copy.annualTax.usGross}</th>
              <th className="pb-2 pr-4 text-right font-medium">{copy.annualTax.krGross}</th>
              <th className="pb-2 pr-4 text-right font-medium">{copy.annualTax.credit}</th>
              <th className="pb-2 pr-4 text-right font-medium">{copy.annualTax.netTax}</th>
              <th className="pb-2 text-right font-medium">{copy.annualTax.afterTaxCash}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {plan.years.map((year) => (
              <Fragment key={year.year}>
                <tr>
                  <td className="pt-3 pr-4 font-mono text-ink">{year.year}</td>
                  <td className="pt-3 pr-4"><Badge tone="info">{year.filingScenario}</Badge></td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-ink">{money(year.proceedsKrw)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums">{signedMoney(year.gainKrw, money)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-ink">{money(year.usGrossTaxKrw ?? 0)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-ink">{money(year.krGrossTaxKrw ?? 0)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-success">-{money(year.estimatedCrossBorderTaxCreditKrw)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums font-medium text-ink">{money(year.estimatedTaxKrw)}</td>
                  <td className="pt-3 text-right tabular-nums text-ink">{money(year.afterTaxKrw)}</td>
                </tr>
                <tr>
                  <td colSpan={9} className="pb-3 pt-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-surface px-3 py-2 text-[10px] text-ink-3">
                      <span>{copy.annualTax.federalShortTerm} <strong className="font-medium text-ink">{money(year.usFederalShortTermTaxKrw ?? 0)}</strong></span>
                      <span>{copy.annualTax.federalLongTerm} <strong className="font-medium text-ink">{money(year.usFederalLongTermTaxKrw ?? 0)}</strong></span>
                      <span>{copy.annualTax.niit} <strong className="font-medium text-ink">{money(year.usNiitTaxKrw ?? 0)}</strong></span>
                      <span>{copy.annualTax.california} <strong className="font-medium text-ink">{money(year.usStateTaxKrw ?? 0)}</strong></span>
                      <span>{copy.annualTax.usFtcLimit} <strong className="font-medium text-ink">{money(year.usForeignTaxCreditLimitKrw ?? 0)}</strong></span>
                      <span>{copy.annualTax.usFtcUsed} <strong className="font-medium text-success">-{money(year.usForeignTaxCreditKrw ?? 0)}</strong></span>
                      <span>{copy.annualTax.krCreditUsed} <strong className="font-medium text-success">-{money(year.krForeignTaxCreditKrw ?? 0)}</strong></span>
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
