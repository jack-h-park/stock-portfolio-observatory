import Link from 'next/link'
import { Fragment } from 'react'
import { createSavedTaxPlanAction } from '@/app/tax-planning/actions'
import { DataTable } from '@/components/DataTable'
import { Badge, Card, EmptyState, MetricField, marketTone, type Tone } from '@/components/ui'
import { fmtDateTime, fmtKrw, fmtMoney, fmtNumber, fmtQuantity } from '@/lib/format'
import { GLOSSARY } from '@/lib/glossary'
import { positionHref } from '@/lib/position-url'
import type { MonthlySaleMasterPlan, MonthlySalePlanSet, TaxPlanCandidate, MasterPlanStrategyKey } from '@/lib/tax-planning'
import { savedTaxPlanProgress, type SavedTaxPlan } from '@/lib/tax-plan-store'
import { signedKrw } from './view-utils'

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

export function CandidateTable({ rows }: { rows: TaxPlanCandidate[] }) {
  if (rows.length === 0) return <EmptyState>No sale candidates with open tax lots</EmptyState>
  return (
    <DataTable
      rows={rows}
      columns={[
        { key: 'ticker', label: 'Position', render: (r) => <PositionCell row={r} /> },
        { key: 'account', label: 'Account', render: (r) => <span className="max-w-[12rem] truncate">{r.brokerage} · {r.account}</span> },
        { key: 'acquired_date', label: 'Acquired' },
        { key: 'holdingBucket', label: 'Term', render: (r) => <Badge tone={r.holdingBucket === 'long' ? 'success' : 'warning'}>{r.holdingBucket}</Badge> },
        { key: 'open_quantity', label: 'Qty', align: 'right', render: (r) => fmtQuantity(r.open_quantity, 4) },
        { key: 'proceedsNative', label: 'Proceeds', align: 'right', render: (r) => (r.proceedsNative == null ? 'n/a' : fmtMoney(r.proceedsNative, r.currency)) },
        { key: 'gainKrw', label: 'Base G/L', align: 'right', render: (r) => signedKrw(r.gainKrw) },
        { key: 'estimatedTaxKrw', label: 'Gross Lot Tax', align: 'right', render: (r) => fmtKrw(r.estimatedTaxKrw) },
        { key: 'estimatedAfterTaxKrw', label: 'After Tax', align: 'right', render: (r) => (r.estimatedAfterTaxKrw == null ? 'n/a' : fmtKrw(r.estimatedAfterTaxKrw)) },
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
}: {
  planSet: MonthlySalePlanSet
  inputIssueCount: number
  fullHoldingsValueKrw: number
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
      title="Selected plan"
      info="This plan uses tax-lot acquisition dates, annual filing profiles, current prices, and current FX. It does not use a market forecast."
      className="mb-5"
      accent
      action={<Badge tone="success">{plan.label}</Badge>}
    >
      <div className="flex flex-col gap-3 border-b border-line-subtle pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase text-ink-3">Recommended execution window</div>
          <h2 className="mt-1 text-[22px] font-medium leading-tight text-ink">
            {dateLabel(plan.summary.startDate)} <span className="text-ink-3">to</span>{' '}
            {dateLabel(plan.summary.endDate)}
          </h2>
          <p className="mt-2 max-w-[58rem] text-[13px] leading-relaxed text-ink-2">{plan.description}</p>
        </div>
        <div className="shrink-0 rounded-md border border-[color:var(--accent-success)]/25 bg-[color:var(--accent-success)]/5 px-3 py-2 lg:max-w-[19rem]">
          <div className="text-[10px] font-medium uppercase text-success">Why this matters</div>
          <div className="mt-1 text-[11px] leading-relaxed text-ink-2">
            {fmtNumber(plan.summary.longTermSalePct, 1)}% of planned proceeds receive long-term treatment under this schedule.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-line-subtle border-b border-line-subtle md:grid-cols-4">
        <PlanMetric
          label="Planned sales"
          value={fmtKrw(plan.summary.proceedsKrw)}
          hint={`${fmtNumber(plan.summary.lotCount)} priced lots`}
        />
        <PlanMetric
          label="Estimated tax"
          value={fmtKrw(plan.summary.estimatedTaxKrw)}
          hint={`${fmtNumber(plan.summary.longTermSalePct, 1)}% long-term`}
          tone={plan.summary.estimatedTaxKrw > 0 ? 'warning' : 'success'}
        />
        <PlanMetric
          label="After-tax cash"
          value={fmtKrw(plan.summary.afterTaxKrw)}
          hint={`${fmtNumber(plan.summary.instructionCount)} sale instructions`}
          tone="success"
        />
        <PlanMetric
          label="Input coverage"
          value={`${fmtNumber(coveragePct, 1)}%`}
          hint={`${fmtNumber(inputIssueCount)} issues · ${fmtNumber(planSet.coverage.missingValuationCount)} unpriced`}
          info={GLOSSARY.coverage.description}
          tone={inputIssueCount ? 'warning' : 'success'}
        />
      </div>

      {coverageNeedsReview ? (
        <div className="mt-3 rounded-md border border-[color:var(--accent-warning)]/30 bg-[color:var(--accent-warning)]/5 px-3 py-2 text-[12px] leading-relaxed text-ink-2" role="status">
          <span className="font-medium text-warning">Review the input range.</span>{' '}
          The planned amount is greater than the current holding market value, so coverage exceeds 100%. Check for duplicate tax lots or stale prices before using the result.
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="border-l-2 border-[color:var(--accent-info)] px-3 py-1">
          <div className="text-[10px] font-medium uppercase text-ink-3">Lots still waiting</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">
            <span className="font-medium tabular-nums text-ink">{fmtNumber(planSet.timing.waitingLotCount)} lots</span>{' '}
            representing {fmtKrw(planSet.timing.waitingProceedsKrw)} have not crossed one year.
            {planSet.timing.nextLongTermDate ? ` Next: ${dateLabel(planSet.timing.nextLongTermDate)}.` : ''}
          </div>
        </div>
        <div className="border-l-2 border-[color:var(--accent-success)] px-3 py-1">
          <div className="text-[10px] font-medium uppercase text-ink-3">Estimated term benefit</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">
            Waiting for long-term treatment avoids an estimated{' '}
            <span className="font-medium tabular-nums text-success">
              {fmtKrw(planSet.timing.estimatedFederalTaxAvoidedKrw)}
            </span>{' '}
            of federal rate difference on currently profitable short-term lots.
          </div>
        </div>
        <div className="border-l-2 border-[color:var(--accent-warning)] px-3 py-1">
          <div className="text-[10px] font-medium uppercase text-ink-3">Waiting until 2028</div>
          <div className="mt-1 text-[12px] leading-relaxed text-ink-2">
            Estimated {waitSavings >= 0 ? 'saving' : 'extra tax'}:{' '}
            <span className={`font-medium tabular-nums ${waitSavings >= 0 ? 'text-success' : 'text-danger'}`}>
              {fmtKrw(Math.abs(waitSavings))}
            </span>
            , for about {durationLabel(Math.max(waitDays, 0))} more waiting. KR top-up changes from{' '}
            {fmtKrw(earliestKrTopUp)} to {fmtKrw(waitKrTopUp)}.
          </div>
        </div>
      </div>
    </Card>
  )
}

export function MasterScenarioComparison({
  planSet,
  horizonYears,
}: {
  planSet: MonthlySalePlanSet
  horizonYears: number
}) {
  const baseline = planSet.scenarios.find((item) => item.strategy === 'EARLIEST_LT')
  const minTax = Math.min(...planSet.scenarios.map((item) => item.summary.estimatedTaxKrw))
  const maxTax = Math.max(...planSet.scenarios.map((item) => item.summary.estimatedTaxKrw), 1)
  return (
    <Card
      title="Plan comparison"
      info="Every row sells the same currently priced lots. Only timing and holding-term treatment change."
      className="mb-5"
    >
      <div className="mb-3 flex flex-col gap-1 border-b border-line-subtle pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase text-ink-3">Lowest estimated tax</div>
          <div className="mt-1 text-[18px] font-medium tabular-nums text-success">{fmtKrw(minTax)}</div>
        </div>
        <div className="text-[11px] text-ink-3">Tax bars share one scale. Shorter is lower.</div>
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
                  {selected && <Badge tone="success">Selected</Badge>}
                  {scenarioRow.summary.estimatedTaxKrw === minTax && <Badge tone="success">Lowest tax</Badge>}
                </div>
                <div className="mt-1 max-w-[34rem] text-[11px] leading-relaxed text-ink-3">
                  {scenarioRow.description}
                </div>
              </div>

              <div>
                <div className="flex items-end justify-between gap-3">
                  <span className="text-[10px] uppercase text-ink-3">Estimated tax</span>
                  <span className="text-[13px] font-medium tabular-nums text-ink">
                    {fmtKrw(scenarioRow.summary.estimatedTaxKrw)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-line-subtle">
                  <div
                    className={scenarioRow.summary.estimatedTaxKrw === minTax ? 'h-full bg-success' : 'h-full bg-warning'}
                    style={{ width: `${taxWidth}%` }}
                  />
                </div>
                <div className={`mt-1 text-right text-[10px] tabular-nums ${delta <= 0 ? 'text-success' : 'text-danger'}`}>
                  {delta === 0 ? 'Earliest baseline' : delta < 0 ? `${fmtKrw(Math.abs(delta))} less` : `${fmtKrw(delta)} more`}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <dt className="text-ink-3">Execution</dt>
                <dd className="text-right text-ink">
                  {dateLabel(scenarioRow.summary.startDate)} to {dateLabel(scenarioRow.summary.endDate)}
                </dd>
                <dt className="text-ink-3">Long-term sales</dt>
                <dd className="text-right tabular-nums text-ink">{fmtNumber(scenarioRow.summary.longTermSalePct, 1)}%</dd>
                <dt className="text-ink-3">Average wait</dt>
                <dd className="text-right tabular-nums text-ink">{durationLabel(scenarioRow.summary.averageWaitDays)}</dd>
                <dt className="text-ink-3">KR top-up</dt>
                <dd className="text-right tabular-nums text-ink">{fmtKrw(scenarioRow.summary.incrementalKrTaxAfterCreditKrw)}</dd>
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
}: {
  plans: SavedTaxPlan[]
  selectedStrategy: MasterPlanStrategyKey
  executionMonths: number
  horizonYears: number
}) {
  const visiblePlans = plans.filter((plan) => plan.status !== 'archived').slice(0, 5)
  return (
    <Card
      title="Saved execution plans"
      info="Saving creates an immutable calculation snapshot. Review and execution states are recorded separately from the original tax estimate."
      className="mb-5"
      action={<Badge>{fmtNumber(visiblePlans.length)} recent</Badge>}
    >
      <div className="grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <form action={createSavedTaxPlanAction} className="rounded-md border border-line-subtle bg-surface p-3">
          <div className="text-[10px] font-medium uppercase text-ink-3">Save current calculation</div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            Freeze the selected strategy, quantities, dates, tax assumptions, and lot-level instructions before review.
          </p>
          <input type="hidden" name="strategy" value={selectedStrategy} />
          <input type="hidden" name="executionMonths" value={executionMonths} />
          <input type="hidden" name="horizonYears" value={horizonYears} />
          <label htmlFor="plan-name" className="mt-3 block text-[10px] font-medium uppercase text-ink-3">
            Plan name
          </label>
          <input
            id="plan-name"
            name="name"
            type="text"
            maxLength={120}
            placeholder="e.g. 2026 staged baseline"
            className="mt-1 w-full rounded-md border border-line bg-card px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-info"
          />
          <button type="submit" className="mt-2 w-full rounded-md border border-ink bg-ink px-3 py-2 text-[12px] font-medium text-card">
            Save as draft
          </button>
          <div className="mt-2 text-[10px] leading-relaxed text-ink-3">
            Stored locally in an ignored private JSON file; it is not committed to the public repository.
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
                        <span>Execution</span><span>{fmtNumber(progress.completionPct, 1)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-line-subtle">
                        <div className="h-full bg-success" style={{ width: `${progress.completionPct}%` }} />
                      </div>
                    </div>
                    <div className="text-[11px] tabular-nums text-ink-2">
                      <div>{fmtKrw(saved.plan.summary.proceedsKrw)} planned</div>
                      <div className="mt-0.5 text-ink-3">{fmtNumber(progress.executed)} / {fmtNumber(progress.total)} executed</div>
                    </div>
                    <div className="text-right text-[10px] text-ink-3">{fmtDateTime(saved.updatedAt)}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-[10rem] items-center justify-center text-center text-[12px] text-ink-3">
              No saved plans yet. Save the current calculation when it is ready for review.
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

export function MasterPlanAnnualTax({ plan }: { plan: MonthlySaleMasterPlan }) {
  return (
    <Card
      title="Annual tax roll-up"
      info="The annual result nets scheduled gains and losses, stacks short-term gains on projected ordinary income, applies long-term brackets, NIIT and California tax, then applies only the configured cross-border credit model."
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
                <div className="text-[10px] uppercase text-ink-3">Net tax</div>
                <div className="mt-0.5 text-[15px] font-medium tabular-nums text-ink">{fmtKrw(year.estimatedTaxKrw)}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-line-subtle py-2 text-[11px]">
              <div><span className="text-ink-3">Sales</span><div className="mt-0.5 tabular-nums text-ink">{fmtKrw(year.proceedsKrw)}</div></div>
              <div className="text-right"><span className="text-ink-3">Net G/L</span><div className="mt-0.5 tabular-nums">{signedKrw(year.gainKrw)}</div></div>
              <div><span className="text-ink-3">US gross</span><div className="mt-0.5 tabular-nums text-ink">{fmtKrw(year.usGrossTaxKrw ?? 0)}</div></div>
              <div className="text-right"><span className="text-ink-3">KR gross</span><div className="mt-0.5 tabular-nums text-ink">{fmtKrw(year.krGrossTaxKrw ?? 0)}</div></div>
              <div><span className="text-ink-3">Credit used</span><div className="mt-0.5 tabular-nums text-success">-{fmtKrw(year.estimatedCrossBorderTaxCreditKrw)}</div></div>
              <div className="text-right"><span className="text-ink-3">After-tax cash</span><div className="mt-0.5 tabular-nums text-ink">{fmtKrw(year.afterTaxKrw)}</div></div>
            </div>
            <details className="mt-2 text-[10px] text-ink-3">
              <summary className="cursor-pointer font-medium text-info">Tax components</summary>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <span>Federal ST {fmtKrw(year.usFederalShortTermTaxKrw ?? 0)}</span>
                <span>Federal LT {fmtKrw(year.usFederalLongTermTaxKrw ?? 0)}</span>
                <span>NIIT {fmtKrw(year.usNiitTaxKrw ?? 0)}</span>
                <span>California {fmtKrw(year.usStateTaxKrw ?? 0)}</span>
                <span>US FTC limit {fmtKrw(year.usForeignTaxCreditLimitKrw ?? 0)}</span>
                <span>KR credit {fmtKrw(year.krForeignTaxCreditKrw ?? 0)}</span>
              </div>
            </details>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-[12px]">
          <thead className="text-[10px] uppercase text-ink-3">
            <tr>
              <th className="pb-2 pr-4 font-medium">Tax year</th>
              <th className="pb-2 pr-4 font-medium">Profile</th>
              <th className="pb-2 pr-4 text-right font-medium">Sales</th>
              <th className="pb-2 pr-4 text-right font-medium">Net G/L</th>
              <th className="pb-2 pr-4 text-right font-medium">US gross</th>
              <th className="pb-2 pr-4 text-right font-medium">KR gross</th>
              <th className="pb-2 pr-4 text-right font-medium">Credit</th>
              <th className="pb-2 pr-4 text-right font-medium">Net tax</th>
              <th className="pb-2 text-right font-medium">After-tax cash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {plan.years.map((year) => (
              <Fragment key={year.year}>
                <tr>
                  <td className="pt-3 pr-4 font-mono text-ink">{year.year}</td>
                  <td className="pt-3 pr-4"><Badge tone="info">{year.filingScenario}</Badge></td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(year.proceedsKrw)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums">{signedKrw(year.gainKrw)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(year.usGrossTaxKrw ?? 0)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-ink">{fmtKrw(year.krGrossTaxKrw ?? 0)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums text-success">-{fmtKrw(year.estimatedCrossBorderTaxCreditKrw)}</td>
                  <td className="pt-3 pr-4 text-right tabular-nums font-medium text-ink">{fmtKrw(year.estimatedTaxKrw)}</td>
                  <td className="pt-3 text-right tabular-nums text-ink">{fmtKrw(year.afterTaxKrw)}</td>
                </tr>
                <tr>
                  <td colSpan={9} className="pb-3 pt-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-surface px-3 py-2 text-[10px] text-ink-3">
                      <span>Federal ST <strong className="font-medium text-ink">{fmtKrw(year.usFederalShortTermTaxKrw ?? 0)}</strong></span>
                      <span>Federal LT <strong className="font-medium text-ink">{fmtKrw(year.usFederalLongTermTaxKrw ?? 0)}</strong></span>
                      <span>NIIT <strong className="font-medium text-ink">{fmtKrw(year.usNiitTaxKrw ?? 0)}</strong></span>
                      <span>California <strong className="font-medium text-ink">{fmtKrw(year.usStateTaxKrw ?? 0)}</strong></span>
                      <span>US FTC limit <strong className="font-medium text-ink">{fmtKrw(year.usForeignTaxCreditLimitKrw ?? 0)}</strong></span>
                      <span>US FTC used <strong className="font-medium text-success">-{fmtKrw(year.usForeignTaxCreditKrw ?? 0)}</strong></span>
                      <span>KR credit used <strong className="font-medium text-success">-{fmtKrw(year.krForeignTaxCreditKrw ?? 0)}</strong></span>
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
