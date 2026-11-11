import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { Card, TextLink } from '@/components/ui'
import { config } from '@/config'
import { readTaxHistory } from '@/lib/adapters/tax-history-store'
import { indexEvidenceRoot, resolveTaxEvidence } from '@/lib/application/evidence-index'
import { live } from '@/lib/domain/taxes/history'
import { formatMoney, reconcileTaxHistory } from '@/lib/domain/taxes/reconcile'
import { getLanguage } from '@/lib/i18n-server'
import { routeMetadata } from '@/lib/page-names'
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
    obligation = live(store.obligations).find((row) => row.id === id)
  if (!obligation) notFound()
  const row = reconcileTaxHistory(store).obligations.find((item) => item.id === id)!
  const allocations = live(store.allocations).filter((item) => item.obligationId === id)
  const events = live(store.events).filter((event) => allocations.some((allocation) => allocation.eventId === event.id))
  const evidenceIds = new Set([
    ...row.candidates.flatMap((item) => item.evidenceIds),
    ...events.flatMap((item) => item.evidenceIds),
    ...allocations.flatMap((item) => item.evidenceIds),
    ...(obligation.effectiveBasis?.evidenceIds ?? []),
  ])
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
        title={copy.recordTitle}
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
          {store.changes
            .filter((change) =>
              change.records.some(
                (record) =>
                  record.id === id ||
                  allocations.some((allocation) => allocation.id === record.id) ||
                  events.some((event) => event.id === record.id) ||
                  evidenceIds.has(record.id) ||
                  row.candidates.some((candidate) => candidate.id === record.id),
              ),
            )
            .map((change) => (
              <li key={change.id} className="p-4 text-body">
                {change.changedAt} · {copy.revision} {change.storeRevision} · {change.reason}
              </li>
            ))}
        </ul>
      </Card>
    </>
  )
}
