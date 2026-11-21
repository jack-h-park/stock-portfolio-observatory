import React from 'react'
import { Badge, Button, Card, Note, TextLink } from '@/components/ui'
import { Select } from '@/components/form'
import { getPageCopy } from '@/lib/ui-copy'
import { labelFor } from '@/lib/ui-copy/label'
import type { Language } from '@/lib/i18n'
import { getAnnualRequiredAmounts } from '@/lib/domain/taxes/annual/contracts'
import { formatMoney } from '@/lib/domain/taxes/reconcile'
import { getHypotheticalTaxPreview, HYPOTHETICAL_EXAMPLES } from '@/lib/application/hypothetical-tax-planning'

/** Server-rendered selection and pure invented calculations; no writes or private-data reader. */
export function HypotheticalTaxPlanning({ selection, language }: { selection: unknown; language: Language }) {
  const copy = getPageCopy('hypotheticalTax', language)
  const authorities = getPageCopy('taxHistory', language).authorities
  const preview = getHypotheticalTaxPreview(selection)
  const selected = typeof selection === 'string' && HYPOTHETICAL_EXAMPLES.includes(selection as typeof HYPOTHETICAL_EXAMPLES[number]) ? selection : ''
  const bases = preview.status === 'ready' ? [...new Set(preview.input.requestedComponents.flatMap(id => getAnnualRequiredAmounts(preview.input, id)))] : []
  return <div className="space-y-5">
    <Note>{copy.intro}</Note>
    <form action="/tax-planning/annual" method="get" className="flex flex-wrap items-end gap-3">
      <label className="block min-w-0 flex-1 basis-64">
        <span className="mb-2 block text-label">{copy.select}</span>
        <Select name="example" defaultValue={selected} className="w-full" aria-describedby="hypothetical-scope">
          {!selected ? <option value="" disabled>{copy.select}</option> : null}
          {HYPOTHETICAL_EXAMPLES.map(id => <option key={id} value={id}>{copy.examples[id]}</option>)}
        </Select>
      </label>
      <Button type="submit" variant="solid" size="md">{copy.apply}</Button>
    </form>
    <Card id="hypothetical-scope" title={copy.scope}>
      <div className="space-y-3 p-4 text-body text-ink-2">
        <p>{copy.requirements}</p><p>{copy.inventedReview}</p><p>{copy.exclusions}</p><p>{copy.comparison}</p>
        {preview.status === 'ready' ? <>
          <p>{copy.profile} · {preview.input.taxYear} · {labelFor(authorities, preview.input.authority)} · {preview.input.currency} · {copy.filing[preview.input.filingStatus]}</p>
          <p className="break-all">{copy.rule} · {preview.result.rulePackId}</p>
          <dl className="flex flex-wrap gap-4">
            {bases.map(key => <div key={key} className="min-w-0 flex-1 basis-64"><dt className="text-label">{copy.bases[key]}</dt><dd className="break-all text-body tabular-nums">{preview.input.amounts[key] ? formatMoney(preview.input.amounts[key]!) : copy.missing}</dd></div>)}
          </dl>
          <details><summary className="min-h-6 cursor-pointer underline">{copy.inputs}</summary>
            <pre className="mt-3 whitespace-pre-wrap break-all text-caption">{JSON.stringify(preview.input, null, 2)}</pre>
          </details>
        </> : null}
      </div>
    </Card>
    <Card id="hypothetical-results" title={copy.results}>
      <div className="space-y-4 p-4">
        {preview.status === 'unavailable' ? <div role="status"><p className="text-body">{copy.unavailable}</p><Note spacing="above-1">{copy.reasons[preview.reason]}</Note></div> : <>
          {preview.reference ? <div>
            <p className="text-body">{copy.krNote}</p>
            <p className="mt-3 break-all text-body tabular-nums">{preview.reference.exactTaxKrw ? `${preview.reference.exactTaxKrw.numerator} / ${preview.reference.exactTaxKrw.denominator} KRW` : copy.missing}</p>
          </div> : null}
          {preview.result.components.map(component => <div key={component.id} className="border-t border-line-subtle pt-3 first:border-0 first:pt-0">
            <p className="text-body font-medium">{copy.components[component.id]}</p>
            <Badge tone="neutral">{copy.modes[component.mode]}</Badge>
            <p className="mt-2 break-all text-body tabular-nums">{component.amountMinor === null ? copy.missing : formatMoney({ currency: preview.input.currency, minor: component.amountMinor })}</p>
            {component.amountMinor === null ? <Note spacing="above-1">{preview.reference ? copy.blocked.kr : preview.id === 'unsupported-method' ? copy.blocked.special : preview.id === 'missing-input' ? copy.blocked.missing : copy.blocked.generic}</Note> : null}
          </div>)}
          <details><summary className="min-h-6 cursor-pointer underline">{copy.trace}</summary>
            <pre className="mt-3 whitespace-pre-wrap break-all text-caption">{JSON.stringify({ result: preview.result, reference: preview.reference }, null, 2)}</pre>
          </details>
          <details><summary className="min-h-6 cursor-pointer underline">{copy.sources}</summary>
            <ul className="mt-3 space-y-2 text-caption">
              {preview.sources.map(source => <li key={source.id} className="break-words"><a className="underline" href={source.url}>{source.id}</a> · {source.taxYear} · {source.locator}<p className="break-all">{source.sha256}</p></li>)}
            </ul>
          </details>
          <div className="border-t border-line-subtle pt-3">
            <TextLink href={`/taxes?year=2025&authority=${encodeURIComponent(preview.input.authority)}`}>{copy.context}</TextLink>
            <Note spacing="above-1">{copy.contextNote}</Note>
          </div>
        </>}
      </div>
    </Card>
    <TextLink href="/tax-planning">{copy.back}</TextLink>
  </div>
}
