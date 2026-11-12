import React from 'react'
import Link from 'next/link'
import { CardRow } from '@/components/layout'
import type { NetWorth } from '@/lib/net-worth'
import type { Language } from '@/lib/i18n'
import type { AssetCoverageReview } from '@/lib/application/asset-coverage'
import { getPageCopy } from '@/lib/ui-copy'

export function AssetCoverageNote({ summary, language, review }: { summary: NetWorth; language: Language; review?: AssetCoverageReview }) {
  const copy = getPageCopy('assetCoverage', language)
  const range = (dates: { oldest: string | null; newest: string | null; undated: number } | null | undefined) => {
    if (!dates) return copy.unknown
    const known = dates.oldest ? (dates.oldest === dates.newest ? dates.oldest : `${dates.oldest} – ${dates.newest}`) : copy.unknown
    return dates.undated ? `${known} · ${copy.undated(dates.undated)}` : known
  }
  const statuses = (counts: AssetCoverageReview['accounts']) => counts
    ? copy.statuses(counts.current, counts.dueSoon, counts.actionNeeded, counts.missing) : copy.unknown
  const fields = [
    [copy.cash, range(review?.cash)],
    ...(['market', 'snapshot', 'cost'] as const).map(method => [copy[method], range(summary.valuationDates?.[method])]),
    [copy.fx, summary.fxAsOf ?? copy.unknown],
  ]
  return (
    <section aria-label={copy.title} className="mt-3 space-y-3 text-body text-ink-2">
      <p>{copy.boundary(summary.coverage?.omittedAssetCount ?? 0)}</p>
      <details className="rounded-md border border-line-subtle p-3">
        <summary className="cursor-pointer font-medium text-ink">{copy.title}</summary>
        <CardRow columns={2} spacing="none" className="mt-3">
          <div className="space-y-2">
            <h3 className="text-caption font-medium">{copy.balances}</h3>
            <dl className="space-y-2">
              {fields.map(([label, value]) => <div key={label}><dt className="text-label text-ink-3">{label}</dt><dd className="tabular-nums">{value}</dd></div>)}
            </dl>
            {review ? <p className="text-label text-ink-3">{copy.cashCounts(review.cash.nonzero, review.cash.zero)}</p> : null}
          </div>
          <div className="space-y-2">
            <h3 className="text-caption font-medium">{copy.source}</h3>
            <p className="text-label text-ink-3">{copy.scope}</p>
            <dl className="space-y-2">
              <div><dt className="text-label text-ink-3">{copy.accounts}</dt><dd>{statuses(review?.accounts ?? null)}</dd></div>
              <div><dt className="text-label text-ink-3">{copy.supplementary}</dt><dd>{statuses(review?.supplementary ?? null)}</dd></div>
              <div><dt className="text-label text-ink-3">{copy.periods}</dt><dd className="tabular-nums">{range(review?.statementPeriods)}</dd></div>
              <div><dt className="text-label text-ink-3">{copy.checks}</dt><dd>{review?.failedChecks ?? copy.unknown}</dd></div>
              <div><dt className="text-label text-ink-3">{copy.files}</dt><dd>{review?.files ? copy.fileCounts(review.files.fresh, review.files.stale, review.files.drift, review.files.missing) : copy.unknown}</dd></div>
            </dl>
            <p className="text-label text-ink-3">{copy.periodHint}</p>
          </div>
        </CardRow>
        <p className="mt-3 text-label text-ink-3">{copy.freshnessHint}</p>
        <p className="mt-2 text-label text-ink-3">{copy.history}</p>
        <nav aria-label={copy.title} className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-label">
          {([['/health', copy.healthLink], ['/accounts', copy.accountsLink], ['/data-ops', copy.dataLink], ['/reconciliation', copy.reconciliationLink]] as const).map(([href, label]) => <Link key={href} href={href} className="underline underline-offset-4">{label}</Link>)}
        </nav>
      </details>
    </section>
  )
}
