import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, InfoTooltip, Label, MetricField, MetricHeroCard } from '@/components/ui'
import { fmtDateTime, fmtNumber } from '@/lib/format'
import { getMeta } from '@/lib/adapters/portfolio-db'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { annualProfiles, assumptionBool, assumptionNumber, assumptionString, getTaxPolicyState } from '@/lib/tax-policy'
import { saveTaxSettings } from './actions'
import { getTaxSettingsCopy, scenarioLabel } from './copy'
import { CheckField, CompactCheck, Field } from './fields'

export const dynamic = 'force-dynamic'

export default async function TaxSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const params = await searchParams
  const language = await getLanguage()
  const copy = getTaxSettingsCopy(language)
  const glossary = getGlossary(language)
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
      ? copy.us.ytdHint(ytdComputed.basis, ytdComputed.taxYear, fmtNumber(ytdComputed[term], 2), ytdComputed.lots)
      : undefined

  return (
    <>
      <PageHeader
        eyebrow={copy.page.eyebrow}
        title={copy.page.title}
        emphasis={copy.page.emphasis}
        subtitle={copy.page.subtitle}
        action={
          <div className="flex items-center gap-2">
            {params.saved === '1' && <Badge tone="success">{copy.page.saved}</Badge>}
            <Link href="/tax-planning" className="text-caption font-medium text-info hover:underline">
              {copy.page.openPlanner}
            </Link>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title={copy.hero.title}
          info={copy.hero.info}
          eyebrow={copy.hero.eyebrow}
          value={state.source === 'local' ? copy.hero.local : copy.hero.example}
          hint={state.source === 'local' ? copy.hero.localHint : copy.hero.exampleHint}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label={copy.hero.scenario}
              value={scenarioLabel(policy.activeScenario, copy)}
              hint={copy.hero.scenarioHint}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.hero.jurisdictions}
              value={fmtNumber(policy.jurisdictions.filter((item) => item.enabled).length)}
              hint={copy.hero.jurisdictionsHint}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.hero.updated}
              value={state.updatedAt ? fmtDateTime(state.updatedAt).slice(0, 10) : copy.hero.notAvailable}
              hint={copy.hero.updatedHint}
              valueClassName="text-title"
            />
          </div>
        </MetricHeroCard>

        <Card title={copy.readOrder.title} info={copy.readOrder.info}>
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label={copy.readOrder.planningHorizon}
                value={`${fmtNumber(policy.planningHorizonYears ?? 5)} ${copy.readOrder.years}`}
                hint={copy.readOrder.planningHorizonHint}
                valueClassName="text-metric"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label={copy.readOrder.baseCurrency}
                value={policy.baseCurrency}
                hint={copy.readOrder.baseCurrencyHint}
                valueClassName="text-title"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
              {copy.readOrder.note}
            </div>
          </div>
        </Card>
      </div>

      <form action={saveTaxSettings} className="space-y-5">
        <Card title={copy.filingProfile.title} accent>
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block">
              <Label as="span" className="mb-1 block">{copy.filingProfile.activeScenario}</Label>
              <select name="activeScenario" defaultValue={policy.activeScenario} className="w-full rounded-md border border-line bg-card px-3 py-2 text-body text-ink outline-none">
                <option value="US_ONLY">{copy.scenarios.US_ONLY}</option>
                <option value="KR_ONLY">{copy.scenarios.KR_ONLY}</option>
                <option value="US_AND_KR">{copy.scenarios.US_AND_KR}</option>
              </select>
            </label>
            <Field label={copy.filingProfile.baseCurrency} name="baseCurrency" defaultValue={policy.baseCurrency} type="text" />
            <Field label={copy.filingProfile.planningHorizon} name="planningHorizonYears" defaultValue={policy.planningHorizonYears ?? 5} suffix={copy.readOrder.years} />
            <div className="rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption leading-relaxed text-ink-3">
              {copy.filingProfile.note}
            </div>
          </div>
        </Card>

        <Card
          title={copy.annualTimeline.title}
          info={copy.annualTimeline.info}
          accent
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-caption">
              <thead className="text-micro uppercase tracking-[0.08em] text-ink-3">
                <tr>
                  <th className="pb-2 pr-4 font-medium">{copy.annualTimeline.year}</th>
                  <th className="pb-2 pr-4 font-medium">{copy.annualTimeline.defaultScenario}</th>
                  <th className="pb-2 pr-4 text-center font-medium">
                    {copy.annualTimeline.usFiling}
                    <InfoTooltip align="left">{copy.annualTimeline.usFilingInfo}</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 text-center font-medium">
                    {copy.annualTimeline.usTaxCalc}
                    <InfoTooltip align="left">{copy.annualTimeline.usTaxCalcInfo}</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 text-center font-medium">
                    {copy.annualTimeline.krFiling}
                    <InfoTooltip align="left">{copy.annualTimeline.krFilingInfo}</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 text-center font-medium">
                    {copy.annualTimeline.krTaxCalc}
                    <InfoTooltip align="left">{copy.annualTimeline.krTaxCalcInfo}</InfoTooltip>
                  </th>
                  <th className="pb-2 pr-4 font-medium">{copy.annualTimeline.status}</th>
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
                        <select name={`filingScenario_${profile.year}`} defaultValue={profile.filingScenario} className="w-full min-w-[8rem] rounded-md border border-line bg-card px-2 py-1.5 text-caption text-ink outline-none">
                          <option value="US_ONLY">{copy.scenarios.US_ONLY}</option>
                          <option value="KR_ONLY">{copy.scenarios.KR_ONLY}</option>
                          <option value="US_AND_KR">{copy.scenarios.US_AND_KR}</option>
                        </select>
                      </td>
                      <td className="py-2 pr-4 text-center"><CompactCheck name={`usFilingRequired_${profile.year}`} defaultChecked={us?.filingRequired ?? false} label={`${profile.year} ${copy.compactCheck.usFilingRequired}`} /></td>
                      <td className="py-2 pr-4 text-center"><CompactCheck name={`usTaxCalculationEnabled_${profile.year}`} defaultChecked={us?.taxCalculationEnabled ?? false} label={`${profile.year} ${copy.compactCheck.usTaxCalculationEnabled}`} /></td>
                      <td className="py-2 pr-4 text-center"><CompactCheck name={`krFilingRequired_${profile.year}`} defaultChecked={kr?.filingRequired ?? false} label={`${profile.year} ${copy.compactCheck.krFilingRequired}`} /></td>
                      <td className="py-2 pr-4 text-center"><CompactCheck name={`krTaxCalculationEnabled_${profile.year}`} defaultChecked={kr?.taxCalculationEnabled ?? false} label={`${profile.year} ${copy.compactCheck.krTaxCalculationEnabled}`} /></td>
                      <td className="py-2 pr-4">
                        <select name={`status_${profile.year}`} defaultValue={profile.status} className="w-full min-w-[7rem] rounded-md border border-line bg-card px-2 py-1.5 text-caption text-ink outline-none">
                          <option value="assumed">{copy.annualTimeline.assumed}</option>
                          <option value="confirmed">{copy.annualTimeline.confirmed}</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-label leading-relaxed text-ink-3">
            {copy.annualTimeline.note}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card title={copy.us.title}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={copy.us.fallbackShortTermRate} name="usFederalShortTermRatePct" defaultValue={assumptionNumber(policy, 'US', 'federalShortTermRatePct', 24)} suffix="%" />
              <Field label={copy.us.fallbackLongTermRate} name="usFederalLongTermRatePct" defaultValue={assumptionNumber(policy, 'US', 'federalLongTermRatePct', 15)} suffix="%" />
              <Field label={copy.us.fallbackStateRate} name="usStateRatePct" defaultValue={assumptionNumber(policy, 'US', 'stateRatePct', 9.3)} suffix="%" />
              <Field label={copy.us.niitRate} name="usNiitRatePct" defaultValue={assumptionNumber(policy, 'US', 'netInvestmentIncomeTaxRatePct', 3.8)} suffix="%" />
              <Field label={copy.us.filingStatus} name="usFilingStatus" defaultValue={assumptionString(policy, 'US', 'filingStatus', 'MFJ')} type="text" />
              <Field label={copy.us.state} name="usStateCode" defaultValue={assumptionString(policy, 'US', 'stateCode', 'CA')} type="text" />
              <Field label={copy.us.wageBaseYear} name="usWageBaseYear" defaultValue={assumptionNumber(policy, 'US', 'wageBaseYear', 2025)} />
              <Field label={copy.us.w2Wages} name="usWageBaseUsd" defaultValue={assumptionNumber(policy, 'US', 'wageBaseUsd', 0)} suffix="USD" />
              <Field label={copy.us.annualIncomeGrowth} name="usAnnualIncomeGrowthPct" defaultValue={assumptionNumber(policy, 'US', 'annualIncomeGrowthPct', 0)} suffix="%" />
              <Field label={copy.us.federalBracketInflation} name="usFederalBracketInflationPct" defaultValue={assumptionNumber(policy, 'US', 'federalBracketInflationPct', 2.5)} suffix="%" />
              <Field label={copy.us.californiaBracketInflation} name="usCaliforniaBracketInflationPct" defaultValue={assumptionNumber(policy, 'US', 'californiaBracketInflationPct', 2.5)} suffix="%" />
              <Field label={copy.us.planningUsdKrw} name="usPlanningUsdKrwRate" defaultValue={assumptionNumber(policy, 'US', 'planningUsdKrwRate', 0) || null} suffix="KRW" />
              <Field label={copy.us.currentTaxInputYear} name="usTaxInputYear" defaultValue={assumptionNumber(policy, 'US', 'taxInputYear', new Date().getFullYear())} />
              <Field label={copy.us.lossDeductionLimit} name="usLossDeductionLimitUsd" defaultValue={assumptionNumber(policy, 'US', 'lossDeductionLimitUsd', 3000)} suffix="USD" />
              <Field label={copy.us.ytdRealizedShort} name="usYtdRealizedShortGainLossUsd" defaultValue={assumptionNumber(policy, 'US', 'ytdRealizedShortGainLossUsd', 0)} suffix="USD" hint={ytdHint('shortUsd')} />
              <Field label={copy.us.ytdRealizedLong} name="usYtdRealizedLongGainLossUsd" defaultValue={assumptionNumber(policy, 'US', 'ytdRealizedLongGainLossUsd', 0)} suffix="USD" hint={ytdHint('longUsd')} />
              <Field label={copy.us.shortLossCarryover} name="usShortTermCapitalLossCarryoverUsd" defaultValue={assumptionNumber(policy, 'US', 'shortTermCapitalLossCarryoverUsd', 0)} suffix="USD" />
              <Field label={copy.us.longLossCarryover} name="usLongTermCapitalLossCarryoverUsd" defaultValue={assumptionNumber(policy, 'US', 'longTermCapitalLossCarryoverUsd', 0)} suffix="USD" />
              <Field label={copy.us.ftcCarryover} name="usForeignTaxCreditCarryoverUsd" defaultValue={assumptionNumber(policy, 'US', 'foreignTaxCreditCarryoverUsd', 0)} suffix="USD" />
              <Field label={copy.us.ftcForeignSourceShare} name="usFtcForeignSourceGainPct" defaultValue={assumptionNumber(policy, 'US', 'ftcForeignSourceGainPct', 0)} suffix="%" />
              <Field label={copy.us.washSaleBefore} name="usWashSaleBefore" defaultValue={assumptionNumber(policy, 'US', 'washSaleWindowDaysBefore', 30)} suffix={copy.us.days} hint={glossary.washSale.description} />
              <Field label={copy.us.washSaleAfter} name="usWashSaleAfter" defaultValue={assumptionNumber(policy, 'US', 'washSaleWindowDaysAfter', 30)} suffix={copy.us.days} hint={glossary.washSale.description} />
              <div className="sm:col-span-2 rounded-md border border-line-subtle bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
                {copy.us.note}
              </div>
            </div>
          </Card>

          <Card title={copy.kr.title}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={copy.kr.stockBasicDeduction} name="krStockBasicDeductionKrw" defaultValue={assumptionNumber(policy, 'KR', 'stockBasicDeductionKrw', 2500000)} suffix="KRW" />
              <Field label={copy.kr.foreignStockRate} name="krForeignStockFlatRatePct" defaultValue={assumptionNumber(policy, 'KR', 'foreignStockFlatRatePct', 22)} suffix="%" />
              <Field label={copy.kr.foreignTaxableResidenceThreshold} name="krForeignStockTaxableResidenceYearsThreshold" defaultValue={assumptionNumber(policy, 'KR', 'foreignStockTaxableResidenceYearsThreshold', 5)} suffix={copy.readOrder.years} />
              <Field label={copy.kr.residentThroughYear} name="krResidentThroughYear" defaultValue={assumptionNumber(policy, 'KR', 'residentThroughYear', 2027)} />
              <label className="block">
                <Label as="span" className="mb-1 block">{copy.kr.crossBorderCreditModel}</Label>
                <select name="krForeignTaxCreditMode" defaultValue={assumptionString(policy, 'KR', 'foreignTaxCreditMode', 'manual')} className="w-full rounded-md border border-line bg-card px-3 py-2 text-body text-ink outline-none">
                  <option value="manual">{copy.kr.noAutomaticCredit}</option>
                  <option value="estimated-us-source">{copy.kr.krCreditForUsTax}</option>
                  <option value="estimated-us-ftc">{copy.kr.usForm1116Limit}</option>
                </select>
              </label>
              <div className="sm:col-span-2 grid gap-2">
                <CheckField label={copy.kr.domesticMajorShareholder} name="krDomesticMajorShareholder" defaultChecked={assumptionBool(policy, 'KR', 'domesticMajorShareholder', false)} />
                <CheckField label={copy.kr.listedOffMarketSale} name="krDomesticListedOffMarketSale" defaultChecked={assumptionBool(policy, 'KR', 'domesticListedOffMarketSale', false)} />
              </div>
            </div>
          </Card>
        </div>

        <Card title={copy.localPolicy.title}>
          <div className="space-y-3 text-caption text-ink-2">
            <div className="grid gap-2 lg:grid-cols-[8rem_1fr]">
              <span className="text-ink-3">{copy.localPolicy.localPath}</span>
              <code className="break-words font-mono text-label text-ink">{state.path}</code>
              <span className="text-ink-3">{copy.localPolicy.fallback}</span>
              <code className="break-words font-mono text-label text-ink">{state.examplePath}</code>
            </div>
            <button type="submit" className="rounded-md border border-line bg-ink px-4 py-2 text-body font-medium text-card transition-opacity hover:opacity-90">
              {copy.localPolicy.save}
            </button>
          </div>
        </Card>

        <Card title={copy.calculationBasis.title} info={copy.calculationBasis.info}>
          <div className="grid gap-3 text-caption text-ink-2 md:grid-cols-2 xl:grid-cols-4">
            <a href="https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill" target="_blank" rel="noreferrer" className="rounded-md border border-line-subtle bg-surface px-3 py-2 hover:border-info">
              <span className="block font-medium text-ink">{copy.calculationBasis.federalBrackets}</span>
              <span className="mt-1 block text-label text-ink-3">{copy.calculationBasis.federalBracketsNote}</span>
            </a>
            <a href="https://www.irs.gov/taxtopics/tc409" target="_blank" rel="noreferrer" className="rounded-md border border-line-subtle bg-surface px-3 py-2 hover:border-info">
              <span className="block font-medium text-ink">{copy.calculationBasis.capitalGainNetting}</span>
              <span className="mt-1 block text-label text-ink-3">{copy.calculationBasis.capitalGainNettingNote}</span>
            </a>
            <a href="https://www.irs.gov/individuals/international-taxpayers/foreign-tax-credit-how-to-figure-the-credit" target="_blank" rel="noreferrer" className="rounded-md border border-line-subtle bg-surface px-3 py-2 hover:border-info">
              <span className="block font-medium text-ink">{copy.calculationBasis.foreignTaxCreditLimit}</span>
              <span className="mt-1 block text-label text-ink-3">{copy.calculationBasis.foreignTaxCreditLimitNote}</span>
            </a>
            <a href="https://www.ftb.ca.gov/forms/2025/2025-540-booklet.html" target="_blank" rel="noreferrer" className="rounded-md border border-line-subtle bg-surface px-3 py-2 hover:border-info">
              <span className="block font-medium text-ink">{copy.calculationBasis.californiaSchedule}</span>
              <span className="mt-1 block text-label text-ink-3">{copy.calculationBasis.californiaScheduleNote}</span>
            </a>
          </div>
        </Card>
      </form>
    </>
  )
}
