'use client'

import Link from 'next/link'
import { useState } from 'react'
import { updateSavedInstructionExecutionAction } from '@/app/tax-planning/actions'
import { getPageCopy } from '@/lib/ui-copy'
import { Badge, Button, Card, EmptyState, Label, Signed, marketTone } from '@/components/ui'
import { fmtNumber } from '@/lib/format'
import { useMoneyFormatter } from '@/components/LanguageProvider'
import type { Language } from '@/lib/i18n'
import { positionHref } from '@/lib/position-url'
import type { MasterPlanMonth, MonthlySaleMasterPlan } from '@/lib/tax-planning'
import type { SavedInstructionExecution, SavedInstructionStatus } from '@/lib/tax-plan-store'
import { bucketTone } from '@/lib/tone'
import { Input, Select } from '@/components/form'
import { DataTable } from '@/components/DataTable'
import { SubmitButton } from '@/components/SubmitButton'

const PAGE_SIZE = 50

function dateLabel(value: string | null | undefined, language: Language) {
  if (!value) return 'n/a'
  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

function compactKrw(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
    style: 'currency',
    currency: 'KRW',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}


function profileLabel(value: string | undefined, copy: ReturnType<typeof getPageCopy<'taxPlanning'>>['timeline']) {
  if (value === 'US_AND_KR') return 'US + KR'
  if (value === 'US_ONLY') return copy.usOnly
  if (value === 'KR_ONLY') return copy.krOnly
  return value ?? copy.noProfile
}

function instructionStatusLabel(status: SavedInstructionStatus, copy: ReturnType<typeof getPageCopy<'taxPlanning'>>['timeline']) {
  if (status === 'reviewed') return copy.reviewedStatus
  if (status === 'executed') return copy.executedStatus
  if (status === 'skipped') return copy.skippedStatus
  return copy.plannedStatus
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
  copy,
}: {
  planId: string
  instructionId: string
  execution?: SavedInstructionExecution
  copy: ReturnType<typeof getPageCopy<'taxPlanning'>>['timeline']
}) {
  const status = execution?.status ?? 'planned'
  return (
    <form action={updateSavedInstructionExecutionAction} className="min-w-[10rem]">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="instructionId" value={instructionId} />
      <div className="flex items-center gap-1.5">
        <Select
          name="status"
          defaultValue={status}
          aria-label={copy.executionStatus} size="sm">
          <option value="planned">{copy.plannedStatus}</option>
          <option value="reviewed">{copy.reviewedStatus}</option>
          <option value="executed">{copy.executedStatus}</option>
          <option value="skipped">{copy.skippedStatus}</option>
        </Select>
        <SubmitButton>{copy.save}</SubmitButton>
      </div>
      <details className="mt-1.5 text-micro text-ink-3">
        <summary className="cursor-pointer">{copy.actualsAndNote}</summary>
        <div className="mt-2 grid gap-1.5">
          <Input
            type="date"
            name="executedAt"
            defaultValue={execution?.executedAt ?? ''}
            aria-label={copy.executedDate} size="sm" />
          <Input
            type="number"
            name="actualProceedsKrw"
            defaultValue={execution?.actualProceedsKrw ?? ''}
            placeholder={copy.actualProceedsKrw}
            aria-label={copy.actualProceedsKrw} size="sm" />
          <Input
            type="number"
            name="actualGainKrw"
            defaultValue={execution?.actualGainKrw ?? ''}
            placeholder={copy.actualGainLossKrw}
            aria-label={copy.actualGainOrLossKrw} size="sm" />
          <Input
            type="text"
            name="note"
            defaultValue={execution?.note ?? ''}
            placeholder={copy.executionNote}
            aria-label={copy.executionNote} size="sm" />
        </div>
      </details>
    </form>
  )
}


function MonthSummary({
  month,
  copy,
  money,
}: {
  month: MasterPlanMonth
  copy: ReturnType<typeof getPageCopy<'taxPlanning'>>['timeline']
  money: (value: number | null | undefined, currency?: string | null | undefined) => string
}) {
  const grossGainKrw = month.gainKrw + month.lossKrw
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle sm:grid-cols-5">
      {[
        [copy.plannedSales, money(month.proceedsKrw, 'KRW'), 'text-ink'],
        [copy.position, fmtNumber(month.positionCount), 'text-ink'],
        [copy.grossGains, money(grossGainKrw, 'KRW'), 'text-success'],
        [copy.pairedLosses, `-${money(month.lossKrw, 'KRW')}`, 'text-danger'],
        [copy.netGainLoss, money(month.gainKrw, 'KRW'), month.gainKrw >= 0 ? 'text-success' : 'text-danger'],
      ].map(([label, value, tone]) => (
        <div key={label} className="bg-card px-3 py-2.5">
          <Label size="micro">{label}</Label>
          <div className={`mt-1 text-body-lg font-medium tabular-nums ${tone}`}>{value}</div>
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
  language = 'en',
}: {
  plan: MonthlySaleMasterPlan
  initialMonth: string
  initialPage: number
  savedPlanId?: string
  execution?: Record<string, SavedInstructionExecution>
  language?: Language
}) {
  const money = useMoneyFormatter()
  const copy = getPageCopy('taxPlanning', language).timeline
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
      title={copy.saleTimeline}
      info={copy.saleTimelineInfo}
      className="mb-5"
      accent
      action={<Badge tone="info">{copy.activeMonths(fmtNumber(plan.months.length))}</Badge>}
    >
      {activeMonth ? (
        <>
          <div className="flex flex-col gap-3 border-b border-line-subtle pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Label size="micro">{copy.executionSpan}</Label>
              <div className="mt-1 text-title font-medium text-ink">
                {dateLabel(plan.summary.startDate, language)} <span className="text-ink-3">{copy.to}</span>{' '}
                {dateLabel(plan.summary.endDate, language)}
              </div>
              <p className="mt-1 text-label leading-relaxed text-ink-3">
                {copy.inspectHint}
              </p>
            </div>
            <div className="flex items-center gap-4 text-micro text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[color:var(--accent-info)]" />
                {copy.netGain}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[color:var(--accent-danger)]" />
                {copy.netLoss}
              </span>
            </div>
          </div>

          <div className="-mx-1 mt-4 overflow-x-auto px-1 pb-3">
            <div className="flex min-w-max">
              {yearGroups.map((group, groupIndex) => (
                <section
                  key={group.year}
                  className={groupIndex > 0 ? 'ml-4 border-l border-line pl-4' : undefined}
                  aria-label={copy.saleTimelineAria(group.year)}
                >
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div className="text-body font-medium text-ink">{group.year}</div>
                    <Badge tone={group.profile === 'US_AND_KR' ? 'warning' : 'info'}>
                      {profileLabel(group.profile, copy)}
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
                          aria-label={copy.plannedSalesAria(month.label, money(month.proceedsKrw, 'KRW'))}
                          className={`group relative flex h-[8.5rem] w-[5.1rem] shrink-0 flex-col items-center rounded-md border px-1.5 py-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-info ${
                            selected
                              ? 'border-info bg-[color:var(--accent-info)]/5 shadow-card'
                              : 'border-transparent hover:border-line hover:bg-surface'
                          }`}
                        >
                          <span className="text-label font-medium text-ink">
                            {new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', timeZone: 'UTC' }).format(
                              new Date(`${month.yearMonth}-01T00:00:00Z`)
                            )}
                          </span>
                          <span className="mt-0.5 text-micro tabular-nums text-ink-3">
                            {fmtNumber(month.positionCount)} {copy.positions}
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
                          <span className="mt-1 text-micro font-medium tabular-nums text-ink">
                            {compactKrw(month.proceedsKrw, language)}
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
                  <h3 className="text-title font-medium text-ink">{activeMonth.label}</h3>
                  <Badge>{copy.instructions(fmtNumber(activeMonth.instructionCount))}</Badge>
                </div>
                <p className="mt-1 text-label text-ink-3">
                  {copy.monthDetailHint}
                </p>
              </div>
              <div className="text-label text-ink-3">
                {copy.page} <span className="font-medium text-ink">{activePage}</span> {copy.of} {pageCount}
              </div>
            </div>

            <MonthSummary month={activeMonth} copy={copy} money={money} />

            {/* One table. The card list that stood beside it below sm was a
                second rendering of the same rows, kept in step by hand;
                DataTable's column priorities hide the same columns instead. */}
            <div className="mt-3">
              <DataTable
                caption={copy.saleDate}
                rows={visibleInstructions}
                getRowKey={(row: any) => row.id}
                columns={[
                  {
                    key: 'plannedDate',
                    label: copy.saleDate,
                    nowrap: true,
                    render: (row: any) => (
                      <>
                        <span className="font-mono text-ink">{dateLabel(row.plannedDate, language)}</span>
                        <div className="mt-1 text-micro text-ink-3">{copy.longTermFrom(dateLabel(row.longTermEligibleDate, language))}</div>
                      </>
                    ),
                  },
                  {
                    key: 'position',
                    label: copy.position,
                    render: (row: any) => (
                      <div className="min-w-[16rem]">
                        <div className="flex items-center gap-2">
                          <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                          <Link href={positionHref(row.market, row.ticker)} className="font-mono font-medium text-info hover:underline">
                            {row.ticker}
                          </Link>
                          <span className="max-w-[16rem] truncate font-medium text-ink">{row.name}</span>
                        </div>
                        <div className="mt-1 max-w-[28rem] text-micro leading-relaxed text-ink-3">{row.reason}</div>
                        {row.washSaleRisk && (
                          <div className="mt-1 max-w-[28rem] text-micro leading-relaxed text-warning">
                            {copy.washSaleReviewDetail(row.washSaleMatches)}
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'account',
                    label: copy.account,
                    priority: 'secondary',
                    render: (row: any) => (
                      <>
                        {row.brokerage}
                        <div className="mt-1 text-micro text-ink-3">{row.account}</div>
                      </>
                    ),
                  },
                  { key: 'quantity', label: copy.quantity, align: 'right', render: (row: any) => fmtNumber(row.quantity, 4) },
                  {
                    key: 'purpose',
                    label: copy.purpose,
                    priority: 'secondary',
                    render: (row: any) => (
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={bucketTone(row.holdingBucket)}>{row.holdingBucket}</Badge>
                        <Badge tone={row.role === 'loss' ? 'danger' : row.role === 'gain' ? 'info' : 'neutral'}>
                          {row.role === 'loss' ? copy.lossOffset : row.role === 'gain' ? copy.gainSale : copy.neutral}
                        </Badge>
                      </div>
                    ),
                  },
                  { key: 'proceeds', label: copy.estimatedProceeds, align: 'right', render: (row: any) => money(row.proceedsKrw, 'KRW') },
                  { key: 'gain', label: copy.estimatedGainLoss, align: 'right', render: (row: any) => <Signed value={row.gainKrw} format={(m) => money(m, 'KRW')} /> },
                  ...(savedPlanId
                    ? [
                        {
                          key: 'execution',
                          label: copy.execution,
                          render: (row: any) => (
                            <>
                              <div className="mb-1.5">
                                <Badge tone={EXECUTION_TONE[execution[row.id]?.status ?? 'planned']}>
                                  {instructionStatusLabel(execution[row.id]?.status ?? 'planned', copy)}
                                </Badge>
                              </div>
                              <ExecutionStatusControl planId={savedPlanId} instructionId={row.id} execution={execution[row.id]} copy={copy} />
                            </>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </div>

            {pageCount > 1 && (
              <div className="mt-3 flex items-center justify-between border-t border-line-subtle pt-3">
                <span className="text-micro text-ink-3">
                  {copy.showing} {(activePage - 1) * PAGE_SIZE + 1}-
                  {Math.min(activePage * PAGE_SIZE, activeMonth.instructionCount)} {copy.of}{' '}
                  {activeMonth.instructionCount}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => choosePage(activePage - 1)}
                    disabled={activePage === 1}
                  >
                    {copy.previous}
                  </Button>
                  <Button
                    onClick={() => choosePage(activePage + 1)}
                    disabled={activePage === pageCount}
                  >
                    {copy.next}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <EmptyState>{copy.noScheduledSaleInstructions}</EmptyState>
      )}
    </Card>
  )
}
