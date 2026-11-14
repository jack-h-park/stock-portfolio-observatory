import React from 'react'
import { Card, Badge, MetricField, TextLink } from '@/components/ui'
import { KpiBand } from '@/components/layout'
import { DataTable } from '@/components/DataTable'
import { getPageCopy } from '@/lib/ui-copy'
import { inventoryReadIssueCategory } from '@/lib/ui-copy/pages/accountInventory'
import { maskAccountLabel } from '@/lib/account-label'
import { fmtDate, fmtNumber } from '@/lib/format'
import type { Language } from '@/lib/i18n'
import type { AccountInventoryReviewModel } from '@/lib/application/account-inventory'
import type { InventoryRow } from '@/lib/domain/assets/account-inventory'

export function AccountInventoryReview({ review, language }: { review: AccountInventoryReviewModel; language: Language }) {
  const copy = getPageCopy('accountInventory', language)
  const { projection } = review
  return <section id="inventory-review" className="mb-5" aria-label={copy.title}>
    <Card title={copy.title} info={copy.info}>
      <div className="mb-3"><Badge tone="warning">{review.readIssues.length ? copy.incomplete : copy.states[projection.review.state]}</Badge></div>
      <p className="mb-3 text-label leading-relaxed text-ink-2">{copy.notice}</p>
      <KpiBand className="mb-4">
        <MetricField label={copy.confirmed} value={projection.counts.confirmedExpected === null ? copy.unknown : fmtNumber(projection.counts.confirmedExpected)} tone="warning" />
        <MetricField label={copy.expected} value={projection.counts.expected === null ? copy.unknown : fmtNumber(projection.counts.expected)} />
        <MetricField label={copy.observed} value={fmtNumber(projection.counts.observedOnly)} />
      </KpiBand>
      <p className="mb-3 text-label text-ink-3">{fmtDate(projection.asOfDate)} · {copy.recorded}</p>
      {review.readIssues.length ? <div className="mb-3 text-label text-warning"><p>{copy.partial}</p><ul>{[...new Set(review.readIssues.map(code => copy.readIssues[inventoryReadIssueCategory(code)]))].map(reason => <li key={reason}>{reason}</li>)}</ul></div> : null}
      <DataTable caption={copy.title} rows={projection.rows} getRowKey={(row: InventoryRow) => row.key} emptyMessage={projection.review.state === 'reviewed' && projection.counts.confirmedExpected === 0 ? copy.emptyReviewed : copy.empty} columns={[
        { key: 'account', label: copy.account, render: (row: InventoryRow) => <div className="min-w-40">
          <div className="font-medium">{row.aliases.map(maskAccountLabel).join(' / ')}</div>
          <div className="text-label text-ink-3">{row.owner.state === 'confirmed' ? row.owner.ownerId === 'self' ? copy.owner.self : copy.owner.other : copy.owner.unknown}</div>
          <div className="text-label text-ink-3">{copy.lifecycle[row.lifecycle.state]}</div>
        </div> },
        { key: 'identity', label: copy.identity, render: (row: InventoryRow) => <>
          <Badge tone={row.discovery === 'expected' && row.membership === 'included' ? 'info' : 'warning'}>{copy.discovery[row.discovery]}</Badge>
          <div className="mt-1 text-label text-ink-3">{copy.membership[row.membership]}</div>
        </> },
        { key: 'evidence', label: copy.evidence, render: (row: InventoryRow) => {
          const recorded = review.recordedSources.filter(s => row.observationKeys.includes(s.observationKey))
          const refs = [...new Set([...row.evidenceRefs, ...recorded.flatMap(s => s.refs)])].sort()
          return <div className="min-w-56 text-label">
            {row.sources.length ? row.sources.map(s => <div key={s.kind} className="mb-2">
              <div>{copy.kinds[s.kind]} · {copy.sources[s.state]}</div>
              <div className="text-ink-3">{fmtDate(s.throughDate)} · {copy.history[s.history.state]}</div>
            </div>) : <div className="mb-2 text-ink-3">{copy.noRequirements}</div>}
            {recorded.map(s => <div key={s.observationKey} className="text-ink-3">{copy.kinds[s.kind]} · {fmtDate(s.throughDate)}</div>)}
            {refs.length ? <details className="mt-2"><summary className="cursor-pointer text-info">{copy.references} ({fmtNumber(refs.length)})</summary>
              <ul className="mt-1 space-y-1">{refs.map(r => <li key={r} className="break-all text-ink-3">{maskAccountLabel(r)}</li>)}</ul>
            </details> : null}
          </div>
        } },
        { key: 'next', label: copy.next, render: (row: InventoryRow) => <div className="max-w-64 text-label leading-relaxed">{copy.actions[row.action]}</div> },
      ]} />
      <div className="mt-3 flex flex-wrap gap-4 text-label"><TextLink href="/data-map">{copy.sourcesLink}</TextLink><TextLink href="/data-ops#account-coverage">{copy.details}</TextLink></div>
      {projection.laterObservations.length ? <p className="mt-2 text-label text-ink-3">{copy.later}</p> : null}
    </Card>
  </section>
}
