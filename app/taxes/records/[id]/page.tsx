import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { Card, TextLink } from '@/components/ui'
import { config } from '@/config'
import { readTaxHistory } from '@/lib/adapters/tax-history-store'
import { indexEvidenceRoot, resolveTaxEvidence } from '@/lib/application/evidence-index'
import { getTaxRecordDetail } from '@/lib/application/tax-record-detail'
import { live } from '@/lib/domain/taxes/history'
import { formatMoney } from '@/lib/domain/taxes/reconcile'
import { getLanguage } from '@/lib/i18n-server'
import { routeMetadata } from '@/lib/page-names'
import { taxRecordHeading } from '@/lib/page-headings'
import { getPageCopy } from '@/lib/ui-copy'
import { reviewTaxHistory } from '../../actions'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/taxes/history')

export default async function TaxRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params,
    search = await searchParams,
    language = await getLanguage(),
    copy = getPageCopy('taxHistory', language)
  const store = readTaxHistory(),
    detail = getTaxRecordDetail(store, id)
  if (!detail) notFound()
  const { obligation, row, allocations, events, versions, adjustments, auditChanges } = detail
  const evidenceIds = new Set(detail.evidenceIds)
  const roots = { records: config.finance.recordsDir, tax: config.finance.taxDir }
  const fields = (kind: string, itemId: string) => (
    <>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="recordId" value={id} />
      <input type="hidden" name="expectedRevision" value={store.revision} />
    </>
  )
  const reason = () => (
    <label className="grid gap-1 text-body">
      {copy.reason}
      <input required name="reason" maxLength={2000} className="rounded-sm border border-line bg-card p-2" />
    </label>
  )
  return (
    <>
      <PageHeader
        {...taxRecordHeading(copy)}
        subtitle={`${obligation.authority} · ${obligation.taxYear} · ${obligation.taxUnitId}`}
        autoRefresh={false}
      />
      <TextLink href="/taxes/history">{copy.back}</TextLink>
      <p className="my-4 text-body text-ink-2">
        {copy.revision}: {store.revision} · {row.status === 'confirmed' ? copy.confirmed : copy.provisional}
      </p>
      {typeof search.error === 'string' && (
        <p role="alert" className="mb-4 text-body">
          {search.error}
        </p>
      )}
      {!config.finance.stateWritable && <p className="mb-4 text-body">{copy.readOnly}</p>}
      <Card title={copy.basis}>
        <dl className="grid gap-3 p-4 text-body sm:grid-cols-3">
          {[
            [copy.reported, row.liabilityMinor],
            [copy.settled, row.principalSettledMinor],
            [copy.outstanding, row.outstandingMinor],
          ].map(([label, minor]) => (
            <div key={label}>
              <dt className="text-ink-2">{label}</dt>
              <dd className="tabular-nums">
                {minor == null ? copy.none : formatMoney({ currency: row.currency, minor })}
              </dd>
            </div>
          ))}
        </dl>
        {row.issues.length > 0 && (
          <ul className="px-4 pb-4 text-body text-ink-2">
            {row.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        {config.finance.stateWritable && row.candidates.length > 0 && (
          <form action={reviewTaxHistory} className="grid gap-3 border-t border-line p-4">
            {fields('select-basis', id)}
            <label className="grid gap-1 text-body">
              {copy.versions}
              <select
                name="basis"
                required
                className="rounded-sm border border-line bg-card p-2"
                defaultValue={
                  obligation.effectiveBasis
                    ? `${obligation.effectiveBasis.kind}:${obligation.effectiveBasis.id}`
                    : undefined
                }
              >
                {row.candidates.map((candidate) => (
                  <option key={`${candidate.kind}:${candidate.id}`} value={`${candidate.kind}:${candidate.id}`}>
                    {candidate.kind} · {candidate.id} · {formatMoney(candidate.liability)}
                  </option>
                ))}
              </select>
            </label>
            {reason()}
            <button type="submit" className="justify-self-start rounded-sm border border-line bg-surface px-4 py-2">
              {copy.selectBasis}
            </button>
          </form>
        )}
      </Card>
      <Card title={copy.versions} className="mt-5">
        <p className="p-4 text-body">
          {copy.basis}:{' '}
          {obligation.effectiveBasis
            ? `${obligation.effectiveBasis.kind} · ${obligation.effectiveBasis.id} · ${copy.version} ${obligation.effectiveBasis.recordRevision}`
            : copy.none}
        </p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={copy.versions}>
          <table className="w-full min-w-[48rem] text-left text-body">
            <caption className="sr-only">{copy.versions}</caption>
            <thead>
              <tr>
                {[
                  copy.kind,
                  copy.version,
                  copy.filingStatus,
                  copy.supersedes,
                  copy.date,
                  copy.reported,
                  copy.evidence,
                ].map((label) => (
                  <th key={label} scope="col" className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={`${version.kind}:${version.id}`}>
                  <td className="p-3">
                    {version.kind} · {version.id}
                    {version.deleted ? ` · ${copy.archived}` : ''}
                  </td>
                  <td className="p-3">{version.recordRevision}</td>
                  <td className="p-3">
                    {version.status}
                    {version.statusDate ? ` · ${version.statusDate}` : ''}
                  </td>
                  <td className="p-3">{version.supersedesId ?? '—'}</td>
                  <td className="p-3">{version.date ?? copy.none}</td>
                  <td className="whitespace-nowrap p-3 tabular-nums">{formatMoney(version.liability)}</td>
                  <td className="p-3">{version.evidenceIds.join(' · ') || copy.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={copy.adjustments} className="mt-5">
        <p className="p-4 text-body">
          {copy.adjustments}: {formatMoney({ currency: row.currency, minor: row.adjustmentMinor })}
        </p>
        <ul className="divide-y divide-line">
          {adjustments.map((adjustment) => (
            <li key={adjustment.id} className="p-4 text-body">
              {adjustment.id} · {adjustment.effectiveDate} · {formatMoney(adjustment.amount)}
              {adjustment.deleted ? ` · ${copy.archived}` : ''}
              <div className="text-caption text-ink-2">
                {copy.evidence}: {adjustment.evidenceIds.join(' · ') || copy.none}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={copy.events} className="mt-5">
        <ul className="divide-y divide-line">
          {allocations.map((allocation) => {
            const event = events.find((item) => item.id === allocation.eventId)!
            return (
              <li key={allocation.id} className="p-4">
                <p className="text-body">
                  {event.kind} · {event.date ?? copy.none} ·{' '}
                  {formatMoney({ currency: event.currency, minor: allocation.principal })}
                </p>
                <p className="mt-1 text-caption text-ink-2">
                  {copy.interest}: {formatMoney({ currency: event.currency, minor: allocation.interest })} ·{' '}
                  {copy.penalty}: {formatMoney({ currency: event.currency, minor: allocation.penalty })} ·{' '}
                  {event.review === 'authority-confirmed'
                    ? copy.authorityConfirmed
                    : event.review === 'evidenced'
                      ? copy.evidenced
                      : copy.unreviewed}
                </p>
                {config.finance.stateWritable && (
                  <form action={reviewTaxHistory} className="mt-3 grid gap-3">
                    {fields('review-event', event.id)}
                    <label className="grid gap-1 text-body">
                      {copy.review}
                      <select
                        name="review"
                        defaultValue="evidenced"
                        className="rounded-sm border border-line bg-card p-2"
                      >
                        <option value="evidenced">{copy.evidenced}</option>
                        <option value="unreviewed">{copy.unreviewed}</option>
                      </select>
                    </label>
                    {reason()}
                    <button
                      type="submit"
                      className="justify-self-start rounded-sm border border-line bg-surface px-4 py-2"
                    >
                      {copy.save}
                    </button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
      <Card title={copy.evidence} className="mt-5">
        <p className="p-4 text-body text-ink-2">{copy.evidenceNote}</p>
        <ul className="divide-y divide-line">
          {[...evidenceIds].map((evidenceId) => {
            const evidence = live(store.evidence).find((item) => item.id === evidenceId)
            if (!evidence)
              return (
                <li key={evidenceId} className="p-4">
                  {evidenceId}: {copy.none}
                </li>
              )
            let available = false,
              status = ''
            if (config.finance.mode === 'sample') status = copy.syntheticEvidence
            else
              try {
                resolveTaxEvidence(evidence, roots)
                available = true
              } catch (error) {
                status = error instanceof Error ? error.message : copy.none
              }
            const index =
              search.findEvidence === evidenceId && !available && config.finance.mode === 'private'
                ? indexEvidenceRoot(roots[evidence.root], evidence.sha256)
                : null
            return (
              <li key={evidenceId} className="p-4">
                <p className="break-all text-body">
                  {evidenceId} · {evidence.relativePath}
                </p>
                {available ? (
                  <Link
                    className="mt-2 inline-block text-body underline"
                    href={`/taxes/evidence/${encodeURIComponent(evidenceId)}`}
                  >
                    {copy.evidence}
                  </Link>
                ) : (
                  <p className="mt-2 text-body text-ink-2">{status}</p>
                )}
                {!available && config.finance.mode === 'private' && (
                  <Link
                    className="mt-2 inline-block text-body underline"
                    href={`?findEvidence=${encodeURIComponent(evidenceId)}`}
                  >
                    {copy.findMoved}
                  </Link>
                )}
                {index && !index.complete && <p className="mt-2 text-body">{copy.partialIndex}</p>}
                {config.finance.stateWritable &&
                  index?.candidates.map((candidate) => (
                    <form key={candidate} action={reviewTaxHistory} className="mt-3 grid gap-3">
                      {fields('relink-evidence', evidenceId)}
                      <input type="hidden" name="relativePath" value={candidate} />
                      <p className="break-all text-body">{candidate}</p>
                      {reason()}
                      <button
                        type="submit"
                        className="justify-self-start rounded-sm border border-line bg-surface px-4 py-2"
                      >
                        {copy.relink}
                      </button>
                    </form>
                  ))}
              </li>
            )
          })}
        </ul>
      </Card>
      <Card title={copy.changes} className="mt-5">
        <ul className="divide-y divide-line">
          {auditChanges.map((change) => (
            <li key={change.id} className="p-4 text-body">
              {change.changedAt} · {copy.revision} {change.storeRevision} · {change.reason}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
