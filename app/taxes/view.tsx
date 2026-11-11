import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Card, TextLink } from '@/components/ui'
import { config } from '@/config'
import { readTaxHistory } from '@/lib/adapters/tax-history-store'
import { getTaxHistoryView } from '@/lib/application/tax-history-query'
import { formatMoney } from '@/lib/domain/taxes/reconcile'
import { live } from '@/lib/domain/taxes/history'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy } from '@/lib/ui-copy'
import { routeSection } from '@/lib/page-names'

export type TaxSearch = Record<string, string | string[] | undefined>
export async function TaxHistoryScreen({
  searchParams,
  cash = false,
}: {
  searchParams: Promise<TaxSearch>
  cash?: boolean
}) {
  const language = await getLanguage(),
    copy = getPageCopy('taxHistory', language),
    params = await searchParams
  const value = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : undefined)
  const store = readTaxHistory(),
    units = live(store.taxUnits).sort((a, b) => b.year - a.year || a.id.localeCompare(b.id))
  const unitId = value('unit') ?? units[0]?.id,
    selected = units.find((row) => row.id === unitId)
  let view: ReturnType<typeof getTaxHistoryView> | null = null,
    error = ''
  if (unitId)
    try {
      view = getTaxHistoryView(store, {
        taxUnitId: unitId,
        taxYear: value('year') ? Number(value('year')) : cash ? undefined : selected?.year ?? units[0]?.year,
        authority: value('authority') || undefined,
        view: cash ? 'cash-date' : 'tax-year',
        cashDateFrom: value('from') || undefined,
        cashDateTo: value('to') || undefined,
      })
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Invalid filters'
    }
  const href = cash ? '/taxes/history' : '/taxes'
  return (
    <>
      <PageHeader
        eyebrow={routeSection(href, language)}
        title={cash ? copy.historyTitle : copy.title}
        subtitle={copy.subtitle}
        autoRefresh={false}
      />
      {config.finance.mode === 'sample' && <p className="mb-4 text-body text-ink-2">{copy.sample}</p>}
      <nav className="mb-4 flex flex-wrap gap-4" aria-label={copy.title}>
        <TextLink href="/taxes">{copy.yearView}</TextLink>
        <TextLink href="/taxes/history">{copy.cashView}</TextLink>
        <TextLink href="/tax-planning">{copy.planning}</TextLink>
      </nav>
      <p className="mb-4 text-caption text-ink-2">
        {copy.revision}: {store.revision} · {copy.scope}
      </p>
      {!config.finance.stateWritable && <p className="mb-4 text-body text-ink-2">{copy.readOnly}</p>}
      {units.length === 0 ? (
        <Card>
          <p className="p-4">{copy.empty}</p>
          <p className="px-4 pb-4 text-body text-ink-2">{copy.importHint}</p>
        </Card>
      ) : (
        <>
          <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-body">
              {copy.taxUnit}
              <select name="unit" defaultValue={unitId} className="rounded-sm border border-line bg-card p-2">
                <option value="__all__">{copy.allUnits}</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.id} · {unit.year}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-body">
              {copy.taxYear}
              <input
                name="year"
                type="number"
                min="1900"
                max="2200"
                defaultValue={value('year') ?? (cash ? '' : selected?.year ?? units[0]?.year)}
                className="w-28 rounded-sm border border-line bg-card p-2"
              />
            </label>
            <label className="grid gap-1 text-body">
              {copy.authority}
              <input
                name="authority"
                defaultValue={value('authority')}
                className="w-40 rounded-sm border border-line bg-card p-2"
              />
            </label>
            {cash && (
              <>
                <label className="grid gap-1 text-body">
                  {copy.from}
                  <input
                    type="date"
                    name="from"
                    defaultValue={value('from')}
                    className="rounded-sm border border-line bg-card p-2"
                  />
                </label>
                <label className="grid gap-1 text-body">
                  {copy.to}
                  <input
                    type="date"
                    name="to"
                    defaultValue={value('to')}
                    className="rounded-sm border border-line bg-card p-2"
                  />
                </label>
              </>
            )}
            <button className="rounded-sm border border-line bg-surface px-4 py-2" type="submit">
              {copy.apply}
            </button>
          </form>
          {error && (
            <p role="alert" className="mb-4 text-body text-ink">
              {error}
            </p>
          )}
          {view && (
            <Card title={cash ? copy.cashView : copy.yearView}>
              <div className="overflow-x-auto">
                {cash ? (
                  <table className="w-full min-w-[42rem] text-left text-body">
                    <caption className="sr-only">{copy.cashView}</caption>
                    <thead>
                      <tr>
                        {[copy.date, copy.posted, copy.kind, copy.principal, copy.interest, copy.penalty].map(
                          (label) => (
                            <th key={label} scope="col" className="border-b border-line p-3">
                              {label}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {view.cashEvents.map((event) => (
                        <tr key={event.id}>
                          <td className="p-3">{event.date ?? copy.none}</td>
                          <td className="p-3">{event.postingDate ?? '—'}</td>
                          <td className="p-3">{event.kind}<div className="text-caption text-ink-2">{event.taxUnitIds.join(' · ')}</div></td>
                          {(['principal', 'interest', 'penalty'] as const).map((field) => (
                            <td key={field} className="whitespace-nowrap p-3 tabular-nums">
                              {formatMoney({ currency: event.currency, minor: event[field] })}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full min-w-[46rem] text-left text-body">
                    <caption className="sr-only">{copy.yearView}</caption>
                    <thead>
                      <tr>
                        {[copy.authority, copy.reported, copy.settled, copy.outstanding, copy.status].map((label) => (
                          <th key={label} scope="col" className="border-b border-line p-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {view.obligations.map((row) => (
                        <tr key={row.id}>
                          <td className="p-3">
                            <Link className="underline" href={`/taxes/records/${encodeURIComponent(row.id)}`}>
                              {row.authority} · {row.taxYear}
                            </Link>
                            <div className="text-caption text-ink-2">{row.taxUnitId}</div>
                          </td>
                          <td className="whitespace-nowrap p-3 tabular-nums">
                            {row.liabilityMinor == null
                              ? copy.none
                              : formatMoney({ currency: row.currency, minor: row.liabilityMinor })}
                          </td>
                          <td className="whitespace-nowrap p-3 tabular-nums">
                            {formatMoney({ currency: row.currency, minor: row.principalSettledMinor })}
                          </td>
                          <td className="whitespace-nowrap p-3 tabular-nums">
                            {row.outstandingMinor == null
                              ? copy.none
                              : formatMoney({ currency: row.currency, minor: row.outstandingMinor })}
                          </td>
                          <td className="p-3">{row.status === 'confirmed' ? copy.confirmed : copy.provisional}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {view.missingOccurrenceDates.length > 0 && <p className="p-4 text-body text-ink-2">{copy.missingDate}</p>}
            </Card>
          )}
        </>
      )}
      {view && view.unallocated.length > 0 && (
        <Card title={copy.unallocated} className="mt-5">
          <p className="p-4 text-body text-ink-2">{copy.unallocatedNote}</p>
          <ul className="px-4 pb-4 text-body">
            {view.unallocated.map((row) => (
              <li key={row.eventId}>
                {row.eventId} · {formatMoney({ currency: row.currency, minor: row.principal })}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-5 text-body text-ink-2">{copy.compare}</p>
    </>
  )
}
