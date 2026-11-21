import { ReturnReportedAmounts } from '@/components/ReturnReportedAmounts'
import React from 'react'
import { Note } from '@/components/ui'
import Link from 'next/link'
import type { AnnualTaxSummaryData } from '@/lib/application/annual-tax-summary'
import { formatMoney } from '@/lib/domain/taxes/reconcile'
import type { Language } from '@/lib/i18n'
import { getPageCopy } from '@/lib/ui-copy'
import { labelFor } from '@/lib/ui-copy/label'

export function AnnualTaxSummary({ summary, language }: { summary: AnnualTaxSummaryData | null; language: Language }) {
  const copy = getPageCopy('annualTaxSummary', language)
  const historyCopy = getPageCopy('taxHistory', language)
  if (!summary) return <p className="mb-3 text-body text-ink-2" role="status">{copy.unavailable}</p>
  return <div className="mb-4 space-y-4">
    {!summary.years.length ? <p className="text-body text-ink-2">{copy.empty}</p> : null}
    <p className="text-body text-ink-2">{copy.subtitle}</p>
    <Note>{copy.revision(summary.stateRevision)}</Note>
    {summary.years.map(year => <section key={year.year} aria-label={copy.year(year.year)} className="space-y-3">
      <h3 className="text-caption font-medium text-ink">{copy.year(year.year)}</h3>
      {year.rows.map(row => {
        const amount = (minor: string | null) => minor == null ? copy.none : formatMoney({ currency: row.currency, minor })
        const filter = `unit=${encodeURIComponent(row.taxUnitId)}&year=${row.taxYear}&authority=${encodeURIComponent(row.authority)}`
        const fields = [
          [copy.liability, row.liabilityMinor], [copy.payments, row.payments?.principal ?? null],
          [copy.withholding, row.withholding?.principal ?? null], [copy.refunds, row.refunds?.principal ?? null],
          [copy.reversals, row.reversals?.principal ?? null], [copy.interest, row.interestMinor],
          [copy.penalty, row.penaltyMinor], [copy.adjustments, row.adjustmentMinor], [copy.balance, row.outstandingMinor],
        ] as const
        return <article key={row.id} className="rounded-md border border-line-subtle p-3">
          <Note>{copy.identity}</Note>
          <p className="text-body font-medium">{row.taxUnitId} · {labelFor(historyCopy.authorities, row.authority)} · {labelFor(historyCopy.taxTypes, row.taxType)} · {row.currency}</p>
          <Note spacing="above-1">{row.status === 'confirmed' ? copy.confirmed : copy.provisional}</Note>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
            {fields.map(([label, minor]) => <div key={label} className="min-w-0 flex-1 basis-48">
              <dt className="text-label text-ink-3">{label}</dt><dd className="break-words text-body tabular-nums">{amount(minor)}</dd>
            </div>)}
          </dl>
          <ReturnReportedAmounts rows={row.reportedReturns} obligationId={row.id} currency={row.currency} language={language} />
          <Note spacing="above-2">{copy.estimateBlocked}</Note>
          {row.excludedAllocations > 0 ? <Note spacing="above-2">{copy.excluded(row.excludedAllocations)}</Note> : null}
          {row.excludedAdjustments > 0 ? <Note spacing="above-2">{copy.excludedAdjustments(row.excludedAdjustments)}</Note> : null}
          {row.undatedAllocations > 0 ? <Note spacing="above-2">{copy.undated(row.undatedAllocations)}</Note> : null}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-label">
            <Link className="inline-flex min-h-6 items-center underline underline-offset-4" href={`/taxes/records/${encodeURIComponent(row.id)}`}>{copy.details}</Link>
            <Link className="inline-flex min-h-6 items-center underline underline-offset-4" href={`/taxes?${filter}`}>{copy.yearLink}</Link>
            <Link className="inline-flex min-h-6 items-center underline underline-offset-4" href={`/taxes/history?${filter}`}>{copy.cashLink}</Link>
          </div>
        </article>
      })}
    </section>)}
    {summary.unallocatedEventCount > 0 ? <Note>{copy.unallocated(summary.unallocatedEventCount)}{' '}<Link className="underline" href="/taxes/history?unit=__all__">{copy.allCash}</Link></Note> : null}
    <Note>{copy.scopeNote}</Note>
    <Note>{copy.evidenceNote}</Note>
    <Note>{copy.limits}</Note>
  </div>
}
