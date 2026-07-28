'use client'

import Link from 'next/link'
import { useState } from 'react'
import { updateSavedInstructionExecutionAction } from '@/app/tax-planning/actions'
import { Badge, Button, Card, EmptyState } from '@/components/ui'
import { fmtKrw, fmtNumber } from '@/lib/format'
import { positionHref } from '@/lib/position-url'
import type {
  MasterPlanInstruction,
  MasterPlanMonth,
  MonthlySaleMasterPlan,
} from '@/lib/tax-planning'
import type { SavedInstructionExecution, SavedInstructionStatus } from '@/lib/tax-plan-store'

const PAGE_SIZE = 50

function dateLabel(value: string | null | undefined) {
  if (!value) return 'n/a'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

function compactKrw(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'KRW',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function signedKrw(value: number) {
  return (
    <span className={value >= 0 ? 'text-success' : 'text-danger'}>
      {value > 0 ? '+' : ''}
      {fmtKrw(value)}
    </span>
  )
}

function profileLabel(value: string | undefined) {
  if (value === 'US_AND_KR') return 'US + KR'
  if (value === 'US_ONLY') return 'US only'
  if (value === 'KR_ONLY') return 'KR only'
  return value ?? 'No profile'
}

const EXECUTION_TONE: Record<SavedInstructionStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  planned: 'neutral',
  reviewed: 'info',
  executed: 'success',
  skipped: 'warning',
}

function ExecutionStatusControl({
  planId,
  instructionId,
  execution,
}: {
  planId: string
  instructionId: string
  execution?: SavedInstructionExecution
}) {
  const status = execution?.status ?? 'planned'
  return (
    <form action={updateSavedInstructionExecutionAction} className="min-w-[10rem]">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="instructionId" value={instructionId} />
      <div className="flex items-center gap-1.5">
        <select
          name="status"
          defaultValue={status}
          aria-label="Execution status"
          className="rounded-sm border border-line bg-card px-2 py-1 text-[11px] text-ink outline-none focus:border-info"
        >
          <option value="planned">Planned</option>
          <option value="reviewed">Reviewed</option>
          <option value="executed">Executed</option>
          <option value="skipped">Skipped</option>
        </select>
        <Button type="submit">Save</Button>
      </div>
      <details className="mt-1.5 text-[10px] text-ink-3">
        <summary className="cursor-pointer">Actuals and note</summary>
        <div className="mt-2 grid gap-1.5">
          <input
            type="date"
            name="executedAt"
            defaultValue={execution?.executedAt ?? ''}
            aria-label="Executed date"
            className="rounded-sm border border-line bg-card px-2 py-1 text-[11px] text-ink outline-none"
          />
          <input
            type="number"
            name="actualProceedsKrw"
            defaultValue={execution?.actualProceedsKrw ?? ''}
            placeholder="Actual proceeds KRW"
            aria-label="Actual proceeds KRW"
            className="rounded-sm border border-line bg-card px-2 py-1 text-[11px] text-ink outline-none"
          />
          <input
            type="number"
            name="actualGainKrw"
            defaultValue={execution?.actualGainKrw ?? ''}
            placeholder="Actual gain/loss KRW"
            aria-label="Actual gain or loss KRW"
            className="rounded-sm border border-line bg-card px-2 py-1 text-[11px] text-ink outline-none"
          />
          <input
            type="text"
            name="note"
            defaultValue={execution?.note ?? ''}
            placeholder="Execution note"
            aria-label="Execution note"
            className="rounded-sm border border-line bg-card px-2 py-1 text-[11px] text-ink outline-none"
          />
        </div>
      </details>
    </form>
  )
}

function MonthDetailCard({
  row,
  savedPlanId,
  execution,
}: {
  row: MasterPlanInstruction
  savedPlanId?: string
  execution?: SavedInstructionExecution
}) {
  return (
    <article className="rounded-md border border-line-subtle bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={row.market === 'US' ? 'info' : 'success'}>{row.market}</Badge>
            <Link
              href={positionHref(row.market, row.ticker)}
              className="font-mono text-[12px] font-medium text-info hover:underline"
            >
              {row.ticker}
            </Link>
            <span className="truncate text-[13px] font-medium text-ink">{row.name}</span>
          </div>
          <div className="mt-1 text-[11px] text-ink-3">
            {row.brokerage} · {row.account}
          </div>
        </div>
        <Badge tone={row.role === 'loss' ? 'danger' : row.role === 'gain' ? 'info' : 'neutral'}>
          {row.role === 'loss' ? 'Loss offset' : row.role === 'gain' ? 'Gain sale' : 'Neutral'}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-line-subtle py-2 text-[11px]">
        <div>
          <div className="text-ink-3">Sale date</div>
          <div className="mt-0.5 font-mono text-ink">{dateLabel(row.plannedDate)}</div>
        </div>
        <div className="text-right">
          <div className="text-ink-3">Quantity</div>
          <div className="mt-0.5 tabular-nums text-ink">{fmtNumber(row.quantity, 4)}</div>
        </div>
        <div>
          <div className="text-ink-3">Est. proceeds</div>
          <div className="mt-0.5 tabular-nums text-ink">{fmtKrw(row.proceedsKrw)}</div>
        </div>
        <div className="text-right">
          <div className="text-ink-3">Est. gain / loss</div>
          <div className="mt-0.5 tabular-nums">{signedKrw(row.gainKrw)}</div>
        </div>
      </div>

      <div className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-ink-3">
        <Badge tone={row.holdingBucket === 'long' ? 'success' : 'warning'}>{row.holdingBucket}</Badge>
        <span>{row.reason}</span>
      </div>
      {row.washSaleRisk && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-[10px] leading-relaxed text-ink-2">
          <Badge tone="warning">Wash sale review</Badge>
          <span>{row.washSaleNote}</span>
        </div>
      )}
      {savedPlanId && (
        <div className="mt-3 border-t border-line-subtle pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase text-ink-3">Execution</span>
            <Badge tone={EXECUTION_TONE[execution?.status ?? 'planned']}>{execution?.status ?? 'planned'}</Badge>
          </div>
          <ExecutionStatusControl planId={savedPlanId} instructionId={row.id} execution={execution} />
        </div>
      )}
    </article>
  )
}

function MonthSummary({ month }: { month: MasterPlanMonth }) {
  const grossGainKrw = month.gainKrw + month.lossKrw
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle sm:grid-cols-5">
      {[
        ['Planned sales', fmtKrw(month.proceedsKrw), 'text-ink'],
        ['Positions', fmtNumber(month.positionCount), 'text-ink'],
        ['Gross gains', fmtKrw(grossGainKrw), 'text-success'],
        ['Paired losses', `-${fmtKrw(month.lossKrw)}`, 'text-danger'],
        ['Net gain / loss', fmtKrw(month.gainKrw), month.gainKrw >= 0 ? 'text-success' : 'text-danger'],
      ].map(([label, value, tone]) => (
        <div key={label} className="bg-card px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase text-ink-3">{label}</div>
          <div className={`mt-1 text-[14px] font-medium tabular-nums ${tone}`}>{value}</div>
        </div>
      ))}
    </div>
  )
}

export function TaxPlanTimeline({
  plan,
  initialMonth,
  initialPage,
  savedPlanId,
  execution = {},
}: {
  plan: MonthlySaleMasterPlan
  initialMonth: string
  initialPage: number
  savedPlanId?: string
  execution?: Record<string, SavedInstructionExecution>
}) {
  const fallbackMonth = plan.months[0]?.yearMonth ?? ''
  const [selectedMonth, setSelectedMonth] = useState(initialMonth || fallbackMonth)
  const [page, setPage] = useState(initialPage)
  const activeMonth = plan.months.find((month) => month.yearMonth === selectedMonth) ?? plan.months[0]
  const maxProceeds = Math.max(...plan.months.map((month) => month.proceedsKrw), 1)
  const pageCount = Math.max(Math.ceil(Number(activeMonth?.instructions.length ?? 0) / PAGE_SIZE), 1)
  const activePage = Math.min(Math.max(page, 1), pageCount)
  const visibleInstructions =
    activeMonth?.instructions.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE) ?? []

  const yearGroups = Array.from(new Set(plan.months.map((month) => month.year))).map((year) => ({
    year,
    profile: plan.years.find((item) => item.year === year)?.filingScenario,
    months: plan.months.filter((month) => month.year === year),
  }))

  function syncUrl(month: string, nextPage = 1) {
    const params = new URLSearchParams(window.location.search)
    params.set('month', month)
    if (nextPage > 1) params.set('page', String(nextPage))
    else params.delete('page')
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}`)
  }

  function chooseMonth(month: string) {
    setSelectedMonth(month)
    setPage(1)
    syncUrl(month)
  }

  function choosePage(nextPage: number) {
    const boundedPage = Math.min(Math.max(nextPage, 1), pageCount)
    setPage(boundedPage)
    if (activeMonth) syncUrl(activeMonth.yearMonth, boundedPage)
  }

  return (
    <Card
      title="Sale timeline"
      info="Each column is one active sale month. Bar height shows planned proceeds relative to the busiest month; color shows whether that month's net result is a gain or loss."
      className="mb-5"
      accent
      action={<Badge tone="info">{fmtNumber(plan.months.length)} active months</Badge>}
    >
      {activeMonth ? (
        <>
          <div className="flex flex-col gap-3 border-b border-line-subtle pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[10px] font-medium uppercase text-ink-3">Execution span</div>
              <div className="mt-1 text-[16px] font-medium text-ink">
                {dateLabel(plan.summary.startDate)} <span className="text-ink-3">to</span>{' '}
                {dateLabel(plan.summary.endDate)}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                Select a month to inspect exact lots and quantities. Selection stays in place without reloading the page.
              </p>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[color:var(--accent-info)]" />
                Net gain
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[color:var(--accent-danger)]" />
                Net loss
              </span>
            </div>
          </div>

          <div className="-mx-1 mt-4 overflow-x-auto px-1 pb-3">
            <div className="flex min-w-max">
              {yearGroups.map((group, groupIndex) => (
                <section
                  key={group.year}
                  className={groupIndex > 0 ? 'ml-4 border-l border-line pl-4' : undefined}
                  aria-label={`${group.year} sale timeline`}
                >
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div className="text-[13px] font-medium text-ink">{group.year}</div>
                    <Badge tone={group.profile === 'US_AND_KR' ? 'warning' : 'info'}>
                      {profileLabel(group.profile)}
                    </Badge>
                  </div>
                  <div className="relative flex gap-1.5 pt-2">
                    <div className="pointer-events-none absolute left-0 right-0 top-[4.35rem] h-px bg-line" />
                    {group.months.map((month) => {
                      const selected = month.yearMonth === activeMonth.yearMonth
                      const barHeight = Math.max(Math.round((month.proceedsKrw / maxProceeds) * 48), 6)
                      return (
                        <button
                          key={month.yearMonth}
                          type="button"
                          onClick={() => chooseMonth(month.yearMonth)}
                          aria-pressed={selected}
                          aria-label={`${month.label}: ${fmtKrw(month.proceedsKrw)} planned sales`}
                          className={`group relative flex h-[8.5rem] w-[5.1rem] shrink-0 flex-col items-center rounded-md border px-1.5 py-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-info ${
                            selected
                              ? 'border-info bg-[color:var(--accent-info)]/5 shadow-card'
                              : 'border-transparent hover:border-line hover:bg-surface'
                          }`}
                        >
                          <span className="text-[11px] font-medium text-ink">
                            {new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
                              new Date(`${month.yearMonth}-01T00:00:00Z`)
                            )}
                          </span>
                          <span className="mt-0.5 text-[9px] tabular-nums text-ink-3">
                            {fmtNumber(month.positionCount)} positions
                          </span>
                          <span className="mt-auto flex h-[3.25rem] items-end">
                            <span
                              className={`block w-5 rounded-t-sm transition-all ${
                                month.gainKrw >= 0
                                  ? 'bg-[color:var(--accent-info)]'
                                  : 'bg-[color:var(--accent-danger)]'
                              } ${selected ? 'opacity-100' : 'opacity-60 group-hover:opacity-85'}`}
                              style={{ height: `${barHeight}px` }}
                            />
                          </span>
                          <span className="mt-1 text-[10px] font-medium tabular-nums text-ink">
                            {compactKrw(month.proceedsKrw)}
                          </span>
                          {selected && (
                            <span
                              aria-hidden
                              className="absolute -bottom-1 h-2 w-2 rotate-45 border-b border-r border-info bg-card"
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <section className="mt-1 rounded-md border border-line bg-surface/60 p-3 sm:p-4" aria-live="polite">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[16px] font-medium text-ink">{activeMonth.label}</h3>
                  <Badge>{fmtNumber(activeMonth.instructionCount)} instructions</Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-3">
                  Exact sale lots for this month. Tax is netted at the annual level shown below.
                </p>
              </div>
              <div className="text-[11px] text-ink-3">
                Page <span className="font-medium text-ink">{activePage}</span> of {pageCount}
              </div>
            </div>

            <MonthSummary month={activeMonth} />

            <div className="mt-3 space-y-2 sm:hidden">
              {visibleInstructions.map((row) => (
                <MonthDetailCard
                  key={row.id}
                  row={row}
                  savedPlanId={savedPlanId}
                  execution={execution[row.id]}
                />
              ))}
            </div>

            <div className="mt-3 hidden overflow-x-auto rounded-md border border-line-subtle bg-card sm:block">
              <table className="min-w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-surface text-[10px] uppercase text-ink-3">
                  <tr>
                    <th className="px-3 py-2 font-medium">Sale date</th>
                    <th className="px-3 py-2 font-medium">Position</th>
                    <th className="px-3 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 text-right font-medium">Quantity</th>
                    <th className="px-3 py-2 font-medium">Purpose</th>
                    <th className="px-3 py-2 text-right font-medium">Est. proceeds</th>
                    <th className="px-3 py-2 text-right font-medium">Est. G/L</th>
                    {savedPlanId && <th className="px-3 py-2 font-medium">Execution</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {visibleInstructions.map((row) => (
                    <tr key={row.id} className="align-top hover:bg-surface/60">
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-ink">
                        {dateLabel(row.plannedDate)}
                        <div className="mt-1 text-[10px] text-ink-3">
                          LT from {dateLabel(row.longTermEligibleDate)}
                        </div>
                      </td>
                      <td className="min-w-[16rem] px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Badge tone={row.market === 'US' ? 'info' : 'success'}>{row.market}</Badge>
                          <Link
                            href={positionHref(row.market, row.ticker)}
                            className="font-mono font-medium text-info hover:underline"
                          >
                            {row.ticker}
                          </Link>
                          <span className="max-w-[16rem] truncate font-medium text-ink">{row.name}</span>
                        </div>
                        <div className="mt-1 max-w-[28rem] text-[10px] leading-relaxed text-ink-3">{row.reason}</div>
                        {row.washSaleRisk && (
                          <div className="mt-1 max-w-[28rem] text-[10px] leading-relaxed text-warning">
                            Wash-sale review: {row.washSaleMatches} same-ticker open-lot acquisition(s) in the configured window.
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">
                        {row.brokerage}
                        <div className="mt-1 text-[10px] text-ink-3">{row.account}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                        {fmtNumber(row.quantity, 4)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={row.holdingBucket === 'long' ? 'success' : 'warning'}>
                            {row.holdingBucket}
                          </Badge>
                          <Badge tone={row.role === 'loss' ? 'danger' : row.role === 'gain' ? 'info' : 'neutral'}>
                            {row.role === 'loss' ? 'Loss offset' : row.role === 'gain' ? 'Gain sale' : 'Neutral'}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">{fmtKrw(row.proceedsKrw)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{signedKrw(row.gainKrw)}</td>
                      {savedPlanId && (
                        <td className="px-3 py-2.5">
                          <div className="mb-1.5">
                            <Badge tone={EXECUTION_TONE[execution[row.id]?.status ?? 'planned']}>
                              {execution[row.id]?.status ?? 'planned'}
                            </Badge>
                          </div>
                          <ExecutionStatusControl
                            planId={savedPlanId}
                            instructionId={row.id}
                            execution={execution[row.id]}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pageCount > 1 && (
              <div className="mt-3 flex items-center justify-between border-t border-line-subtle pt-3">
                <span className="text-[10px] text-ink-3">
                  Showing {(activePage - 1) * PAGE_SIZE + 1}-
                  {Math.min(activePage * PAGE_SIZE, activeMonth.instructionCount)} of{' '}
                  {activeMonth.instructionCount}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => choosePage(activePage - 1)}
                    disabled={activePage === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    onClick={() => choosePage(activePage + 1)}
                    disabled={activePage === pageCount}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <EmptyState>No scheduled sale instructions</EmptyState>
      )}
    </Card>
  )
}
