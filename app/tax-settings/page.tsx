import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, InfoTooltip, StatCard } from '@/components/ui'
import { fmtDateTime, fmtNumber } from '@/lib/format'
import { annualProfiles, assumptionBool, assumptionNumber, assumptionString, getTaxPolicyState } from '@/lib/tax-policy'
import { saveTaxSettings } from './actions'

export const dynamic = 'force-dynamic'

function Field({
  label,
  name,
  defaultValue,
  suffix,
  type = 'number',
}: {
  label: string
  name: string
  defaultValue: string | number | null
  suffix?: string
  type?: 'number' | 'text'
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <span className="flex items-center overflow-hidden rounded-md border border-line bg-card">
        <input
          name={name}
          type={type}
          defaultValue={defaultValue ?? ''}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[13px] text-ink outline-none"
        />
        {suffix && <span className="border-l border-line-subtle px-2 text-[11px] text-ink-3">{suffix}</span>}
      </span>
    </label>
  )
}

function CheckField({ label, name, defaultChecked }: { label: string; name: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] text-ink-2">
      <span>{label}</span>
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="h-4 w-4 accent-[color:var(--accent-info)]" />
    </label>
  )
}

function CompactCheck({ name, defaultChecked, label }: { name: string; defaultChecked: boolean; label: string }) {
  return (
    <label className="inline-flex items-center justify-center">
      <span className="sr-only">{label}</span>
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="h-4 w-4 accent-[color:var(--accent-info)]" />
    </label>
  )
}

function scenarioLabel(value: string) {
  if (value === 'US_ONLY') return 'US only'
  if (value === 'KR_ONLY') return 'Korea only'
  return 'US + Korea'
}

export default async function TaxSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const params = await searchParams
  const state = getTaxPolicyState()
  const { policy } = state
  const profiles = annualProfiles(policy, policy.planningHorizonYears ?? 5)

  return (
    <>
      <PageHeader
        eyebrow="Tax"
        title="Tax Settings"
        emphasis="Settings"
        subtitle="Local assumptions for realization planning. This writes only to ignored data/tax-policy.json."
        action={
          <div className="flex items-center gap-2">
            {params.saved === '1' && <Badge tone="success">Saved</Badge>}
            <Link href="/tax-planning" className="text-[12px] font-medium text-info hover:underline">
              Open planner
            </Link>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Policy Source" value={state.source === 'local' ? 'Local' : 'Example'} accent tone={state.source === 'local' ? 'success' : 'warning'} />
        <StatCard label="Scenario" value={scenarioLabel(policy.activeScenario)} />
        <StatCard label="Jurisdictions" value={fmtNumber(policy.jurisdictions.filter((item) => item.enabled).length)} />
        <StatCard label="Updated" value={state.updatedAt ? fmtDateTime(state.updatedAt).slice(0, 10) : 'n/a'} />
      </div>

      <form action={saveTaxSettings} className="space-y-5">
        <Card title="Filing profile" accent>
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Active scenario</span>
              <select name="activeScenario" defaultValue={policy.activeScenario} className="w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none">
                <option value="US_ONLY">US only</option>
                <option value="KR_ONLY">Korea only</option>
                <option value="US_AND_KR">US + Korea</option>
              </select>
            </label>
            <Field label="Base currency" name="baseCurrency" defaultValue={policy.baseCurrency} type="text" />
            <Field label="Planning horizon" name="planningHorizonYears" defaultValue={policy.planningHorizonYears ?? 5} suffix="years" />
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink-3">
              Settings are assumptions for planning. Lot evidence, filing forms, residency, treaty positions, and tax professional review remain outside the app.
            </div>
          </div>
        </Card>

        <Card
          title="Annual filing timeline"
          info="Filing means reporting workflow is required for that country/year. Tax calc means the planner includes that country's tax estimate in scenario math."
          accent
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Year</th>
                  <th className="pb-2 pr-4 font-medium">Default scenario</th>
                  <th className="pb-2 pr-4 text-center font-medium">
                    US filing
                    <InfoTooltip align="left">Tracks whether this year needs US filing work, evidence collection, and reporting review.</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 text-center font-medium">
                    US tax calc
                    <InfoTooltip align="left">Controls whether US capital gain tax assumptions are included in planning estimates for this year.</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 text-center font-medium">
                    KR filing
                    <InfoTooltip align="left">Tracks whether this year needs Korea filing work, evidence collection, and reporting review.</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 text-center font-medium">
                    KR tax calc
                    <InfoTooltip align="left">Controls whether Korea stock tax assumptions are included in planning estimates for this year.</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {profiles.map((profile) => {
                  const us = profile.jurisdictions.find((item) => item.code === 'US')
                  const kr = profile.jurisdictions.find((item) => item.code === 'KR')
                  return (
                    <tr key={profile.year}>
                      <td className="py-2 pr-4 font-mono text-ink">
                        {profile.year}
                        <input type="hidden" name="profileYear" value={profile.year} />
                      </td>
                      <td className="py-2 pr-4">
                        <select name={`filingScenario_${profile.year}`} defaultValue={profile.filingScenario} className="w-full min-w-[8rem] rounded-md border border-line bg-card px-2 py-1.5 text-[12px] text-ink outline-none">
                          <option value="US_ONLY">US only</option>
                          <option value="KR_ONLY">Korea only</option>
                          <option value="US_AND_KR">US + Korea</option>
                        </select>
                      </td>
                      <td className="py-2 pr-4 text-center"><CompactCheck name={`usFilingRequired_${profile.year}`} defaultChecked={us?.filingRequired ?? false} label={`${profile.year} US filing required`} /></td>
                      <td className="py-2 pr-4 text-center"><CompactCheck name={`usTaxCalculationEnabled_${profile.year}`} defaultChecked={us?.taxCalculationEnabled ?? false} label={`${profile.year} US tax calculation enabled`} /></td>
                      <td className="py-2 pr-4 text-center"><CompactCheck name={`krFilingRequired_${profile.year}`} defaultChecked={kr?.filingRequired ?? false} label={`${profile.year} KR filing required`} /></td>
                      <td className="py-2 pr-4 text-center"><CompactCheck name={`krTaxCalculationEnabled_${profile.year}`} defaultChecked={kr?.taxCalculationEnabled ?? false} label={`${profile.year} KR tax calculation enabled`} /></td>
                      <td className="py-2 pr-4">
                        <select name={`status_${profile.year}`} defaultValue={profile.status} className="w-full min-w-[7rem] rounded-md border border-line bg-card px-2 py-1.5 text-[12px] text-ink outline-none">
                          <option value="assumed">Assumed</option>
                          <option value="confirmed">Confirmed</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-[11px] leading-relaxed text-ink-3">
            In normal cases filing and tax calc should usually move together. Keep them separate only when reporting duty is known but the taxable calculation needs manual review, or when stress-testing a planning assumption.
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card title="US assumptions">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Short-term federal rate" name="usFederalShortTermRatePct" defaultValue={assumptionNumber(policy, 'US', 'federalShortTermRatePct', 37)} suffix="%" />
              <Field label="Long-term federal rate" name="usFederalLongTermRatePct" defaultValue={assumptionNumber(policy, 'US', 'federalLongTermRatePct', 20)} suffix="%" />
              <Field label="State rate" name="usStateRatePct" defaultValue={assumptionNumber(policy, 'US', 'stateRatePct', 0)} suffix="%" />
              <Field label="NIIT rate" name="usNiitRatePct" defaultValue={assumptionNumber(policy, 'US', 'netInvestmentIncomeTaxRatePct', 0)} suffix="%" />
              <Field label="Loss deduction limit" name="usLossDeductionLimitUsd" defaultValue={assumptionNumber(policy, 'US', 'lossDeductionLimitUsd', 3000)} suffix="USD" />
              <Field label="Wash sale before" name="usWashSaleBefore" defaultValue={assumptionNumber(policy, 'US', 'washSaleWindowDaysBefore', 30)} suffix="days" />
              <Field label="Wash sale after" name="usWashSaleAfter" defaultValue={assumptionNumber(policy, 'US', 'washSaleWindowDaysAfter', 30)} suffix="days" />
            </div>
          </Card>

          <Card title="Korea assumptions">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Stock basic deduction" name="krStockBasicDeductionKrw" defaultValue={assumptionNumber(policy, 'KR', 'stockBasicDeductionKrw', 2500000)} suffix="KRW" />
              <Field label="Foreign stock rate" name="krForeignStockFlatRatePct" defaultValue={assumptionNumber(policy, 'KR', 'foreignStockFlatRatePct', 22)} suffix="%" />
              <Field label="Foreign taxable residence threshold" name="krForeignStockTaxableResidenceYearsThreshold" defaultValue={assumptionNumber(policy, 'KR', 'foreignStockTaxableResidenceYearsThreshold', 5)} suffix="years" />
              <Field label="Foreign tax credit mode" name="krForeignTaxCreditMode" defaultValue={assumptionString(policy, 'KR', 'foreignTaxCreditMode', 'manual')} type="text" />
              <div className="sm:col-span-2 grid gap-2">
                <CheckField label="KR domestic major shareholder taxable scope" name="krDomesticMajorShareholder" defaultChecked={assumptionBool(policy, 'KR', 'domesticMajorShareholder', false)} />
                <CheckField label="KR listed off-market sale taxable scope" name="krDomesticListedOffMarketSale" defaultChecked={assumptionBool(policy, 'KR', 'domesticListedOffMarketSale', false)} />
              </div>
            </div>
          </Card>
        </div>

        <Card title="Local policy file">
          <div className="space-y-3 text-[12px] text-ink-2">
            <div className="grid gap-2 lg:grid-cols-[8rem_1fr]">
              <span className="text-ink-3">Local path</span>
              <code className="break-words font-mono text-[11px] text-ink">{state.path}</code>
              <span className="text-ink-3">Fallback</span>
              <code className="break-words font-mono text-[11px] text-ink">{state.examplePath}</code>
            </div>
            <button type="submit" className="rounded-md border border-line bg-ink px-4 py-2 text-[13px] font-medium text-card transition-opacity hover:opacity-90">
              Save local tax assumptions
            </button>
          </div>
        </Card>
      </form>
    </>
  )
}
