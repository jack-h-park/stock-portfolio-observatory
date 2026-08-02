import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, InfoTooltip, MetricField, MetricHeroCard } from '@/components/ui'
import { fmtDateTime, fmtNumber } from '@/lib/format'
import { getMeta } from '@/lib/adapters/portfolio-db'
import { GLOSSARY } from '@/lib/glossary'
import { annualProfiles, assumptionBool, assumptionNumber, assumptionString, getTaxPolicyState } from '@/lib/tax-policy'
import { saveTaxSettings } from './actions'

export const dynamic = 'force-dynamic'

function Field({
  label,
  name,
  defaultValue,
  suffix,
  type = 'number',
  hint,
}: {
  label: string
  name: string
  defaultValue: string | number | null
  suffix?: string
  type?: 'number' | 'text'
  hint?: string
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
      {hint && <span className="mt-1 block text-[11px] leading-snug text-ink-3">{hint}</span>}
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

  // What the ingest computed from the actual sales, shown beside the field
  // rather than written into it. These two assumptions drive the tax estimate
  // directly, and the computed figure is a FIFO replay of our own wherever the
  // year has no 1099-B yet — close enough to check an entry against, not close
  // enough to file. The operator still decides; they just no longer have to
  // guess, which is how both fields sat at 0 through a year of sales.
  const ytdComputed = (() => {
    try {
      const raw = getMeta()?.us_ytd_realized_computed
      return raw ? (JSON.parse(raw) as { taxYear: string; basis: string; shortUsd: number; longUsd: number; lots: number }) : null
    } catch {
      return null
    }
  })()
  const ytdHint = (term: 'shortUsd' | 'longUsd') =>
    ytdComputed
      ? `${ytdComputed.basis} for ${ytdComputed.taxYear}: ${fmtNumber(ytdComputed[term], 2)} USD across ${ytdComputed.lots} lot(s)`
      : undefined

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

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title="Policy Source"
          info="Shows whether the planner is using your local ignored tax-policy.json file or the example fallback assumptions."
          eyebrow="Tax settings headline"
          value={state.source === 'local' ? 'Local' : 'Example'}
          hint={state.source === 'local' ? 'Using local planning assumptions' : 'Using example assumptions until local settings are saved'}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label="Scenario"
              value={scenarioLabel(policy.activeScenario)}
              hint="Default filing scenario"
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Jurisdictions"
              value={fmtNumber(policy.jurisdictions.filter((item) => item.enabled).length)}
              hint="Enabled tax regimes"
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Updated"
              value={state.updatedAt ? fmtDateTime(state.updatedAt).slice(0, 10) : 'n/a'}
              hint="Last settings write"
              valueClassName="text-[18px]"
            />
          </div>
        </MetricHeroCard>

        <Card title="Settings Read Order" info="Start with the policy source, then confirm scenario, jurisdictions, and annual filing assumptions.">
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label="Planning Horizon"
                value={`${fmtNumber(policy.planningHorizonYears ?? 5)} years`}
                hint="Years projected in planner scenarios"
                valueClassName="text-[28px]"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label="Base Currency"
                value={policy.baseCurrency}
                hint="Currency used for planning summaries"
                valueClassName="text-[18px]"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
              Settings are assumptions for planning; filing forms and tax professional review remain outside the app.
            </div>
          </div>
        </Card>
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
              <Field label="Fallback short-term rate" name="usFederalShortTermRatePct" defaultValue={assumptionNumber(policy, 'US', 'federalShortTermRatePct', 24)} suffix="%" />
              <Field label="Fallback long-term rate" name="usFederalLongTermRatePct" defaultValue={assumptionNumber(policy, 'US', 'federalLongTermRatePct', 15)} suffix="%" />
              <Field label="Fallback state rate" name="usStateRatePct" defaultValue={assumptionNumber(policy, 'US', 'stateRatePct', 9.3)} suffix="%" />
              <Field label="NIIT rate" name="usNiitRatePct" defaultValue={assumptionNumber(policy, 'US', 'netInvestmentIncomeTaxRatePct', 3.8)} suffix="%" />
              <Field label="Filing status" name="usFilingStatus" defaultValue={assumptionString(policy, 'US', 'filingStatus', 'MFJ')} type="text" />
              <Field label="State" name="usStateCode" defaultValue={assumptionString(policy, 'US', 'stateCode', 'CA')} type="text" />
              <Field label="Wage base year" name="usWageBaseYear" defaultValue={assumptionNumber(policy, 'US', 'wageBaseYear', 2025)} />
              <Field label="W-2 wages" name="usWageBaseUsd" defaultValue={assumptionNumber(policy, 'US', 'wageBaseUsd', 0)} suffix="USD" />
              <Field label="Annual income growth" name="usAnnualIncomeGrowthPct" defaultValue={assumptionNumber(policy, 'US', 'annualIncomeGrowthPct', 0)} suffix="%" />
              <Field label="Federal bracket inflation" name="usFederalBracketInflationPct" defaultValue={assumptionNumber(policy, 'US', 'federalBracketInflationPct', 2.5)} suffix="%" />
              <Field label="California bracket inflation" name="usCaliforniaBracketInflationPct" defaultValue={assumptionNumber(policy, 'US', 'californiaBracketInflationPct', 2.5)} suffix="%" />
              <Field label="Planning USD/KRW" name="usPlanningUsdKrwRate" defaultValue={assumptionNumber(policy, 'US', 'planningUsdKrwRate', 0) || null} suffix="KRW" />
              <Field label="Current tax input year" name="usTaxInputYear" defaultValue={assumptionNumber(policy, 'US', 'taxInputYear', new Date().getFullYear())} />
              <Field label="Loss deduction limit" name="usLossDeductionLimitUsd" defaultValue={assumptionNumber(policy, 'US', 'lossDeductionLimitUsd', 3000)} suffix="USD" />
              <Field label="YTD realized short G/L" name="usYtdRealizedShortGainLossUsd" defaultValue={assumptionNumber(policy, 'US', 'ytdRealizedShortGainLossUsd', 0)} suffix="USD" hint={ytdHint('shortUsd')} />
              <Field label="YTD realized long G/L" name="usYtdRealizedLongGainLossUsd" defaultValue={assumptionNumber(policy, 'US', 'ytdRealizedLongGainLossUsd', 0)} suffix="USD" hint={ytdHint('longUsd')} />
              <Field label="Short loss carryover" name="usShortTermCapitalLossCarryoverUsd" defaultValue={assumptionNumber(policy, 'US', 'shortTermCapitalLossCarryoverUsd', 0)} suffix="USD" />
              <Field label="Long loss carryover" name="usLongTermCapitalLossCarryoverUsd" defaultValue={assumptionNumber(policy, 'US', 'longTermCapitalLossCarryoverUsd', 0)} suffix="USD" />
              <Field label="FTC carryover" name="usForeignTaxCreditCarryoverUsd" defaultValue={assumptionNumber(policy, 'US', 'foreignTaxCreditCarryoverUsd', 0)} suffix="USD" />
              <Field label="FTC foreign-source share" name="usFtcForeignSourceGainPct" defaultValue={assumptionNumber(policy, 'US', 'ftcForeignSourceGainPct', 0)} suffix="%" />
            <Field label="Wash sale before" name="usWashSaleBefore" defaultValue={assumptionNumber(policy, 'US', 'washSaleWindowDaysBefore', 30)} suffix="days" hint={GLOSSARY.washSale.description} />
            <Field label="Wash sale after" name="usWashSaleAfter" defaultValue={assumptionNumber(policy, 'US', 'washSaleWindowDaysAfter', 30)} suffix="days" hint={GLOSSARY.washSale.description} />
              <div className="sm:col-span-2 rounded-md border border-line-subtle bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
                MFJ uses the official 2026 federal brackets and long-term capital-gain thresholds. Later federal years and the 2025 California schedule are inflation projections. Fallback rates apply to unsupported filing statuses or states. FTC foreign-source share must be supported by sourcing or treaty analysis; zero prevents the planner from claiming a US credit automatically.
              </div>
            </div>
          </Card>

          <Card title="Korea assumptions">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Stock basic deduction" name="krStockBasicDeductionKrw" defaultValue={assumptionNumber(policy, 'KR', 'stockBasicDeductionKrw', 2500000)} suffix="KRW" />
              <Field label="Foreign stock rate" name="krForeignStockFlatRatePct" defaultValue={assumptionNumber(policy, 'KR', 'foreignStockFlatRatePct', 22)} suffix="%" />
              <Field label="Foreign taxable residence threshold" name="krForeignStockTaxableResidenceYearsThreshold" defaultValue={assumptionNumber(policy, 'KR', 'foreignStockTaxableResidenceYearsThreshold', 5)} suffix="years" />
              <Field label="Resident through year" name="krResidentThroughYear" defaultValue={assumptionNumber(policy, 'KR', 'residentThroughYear', 2027)} />
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Cross-border credit model</span>
                <select name="krForeignTaxCreditMode" defaultValue={assumptionString(policy, 'KR', 'foreignTaxCreditMode', 'manual')} className="w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none">
                  <option value="manual">No automatic credit</option>
                  <option value="estimated-us-source">KR credit for modeled US federal tax</option>
                  <option value="estimated-us-ftc">US Form 1116-style limit for KR tax</option>
                </select>
              </label>
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

        <Card title="Calculation basis" info="Primary sources used by the planner. Later-year inflation and treaty sourcing remain planning assumptions, not filing conclusions.">
          <div className="grid gap-3 text-[12px] text-ink-2 md:grid-cols-2 xl:grid-cols-4">
            <a href="https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill" target="_blank" rel="noreferrer" className="rounded-md border border-line-subtle bg-surface px-3 py-2 hover:border-info">
              <span className="block font-medium text-ink">2026 federal brackets</span>
              <span className="mt-1 block text-[11px] text-ink-3">IRS Rev. Proc. 2025-32 summary</span>
            </a>
            <a href="https://www.irs.gov/taxtopics/tc409" target="_blank" rel="noreferrer" className="rounded-md border border-line-subtle bg-surface px-3 py-2 hover:border-info">
              <span className="block font-medium text-ink">Capital gain netting</span>
              <span className="mt-1 block text-[11px] text-ink-3">IRS Topic 409</span>
            </a>
            <a href="https://www.irs.gov/individuals/international-taxpayers/foreign-tax-credit-how-to-figure-the-credit" target="_blank" rel="noreferrer" className="rounded-md border border-line-subtle bg-surface px-3 py-2 hover:border-info">
              <span className="block font-medium text-ink">Foreign tax credit limit</span>
              <span className="mt-1 block text-[11px] text-ink-3">IRS Form 1116 overview</span>
            </a>
            <a href="https://www.ftb.ca.gov/forms/2025/2025-540-booklet.html" target="_blank" rel="noreferrer" className="rounded-md border border-line-subtle bg-surface px-3 py-2 hover:border-info">
              <span className="block font-medium text-ink">California schedule</span>
              <span className="mt-1 block text-[11px] text-ink-3">2025 FTB Schedule Y</span>
            </a>
          </div>
        </Card>
      </form>
    </>
  )
}
