import type { MasterPlanInstruction, MonthlySaleMasterPlan, MultiYearTaxScenario, TaxPlanWarning } from '@/lib/tax-planning'
// Not from lib/tax-planning: that module reads the tax policy from disk, and the
// client-side sale timeline imports this file.
import { instructionReasonCode } from '@/lib/tax-plan-reasons'
import type { taxPlanning } from '@/lib/ui-copy/pages/taxPlanning'

type TaxPlanningCopy = (typeof taxPlanning)['en']

export function sameKrw(a: number | null | undefined, b: number | null | undefined) {
  return Math.round(Number(a ?? 0)) === Math.round(Number(b ?? 0))
}

export function marketAmount(row: MultiYearTaxScenario['years'][number], market: string) {
  return row.markets.find((item) => item.market === market)?.proceedsKrw ?? 0
}

/*
 * The engine keeps writing English `label` / `description` / `reason` fields
 * (saved plans and scripts read them). Pages render these from copy by code
 * instead, and fall back to the stored English for a code the copy does not know.
 */

export function masterPlanName(plan: Pick<MonthlySaleMasterPlan, 'strategy' | 'executionMonths' | 'label'>, copy: TaxPlanningCopy) {
  return copy.strategies.label[plan.strategy]?.(plan.executionMonths) ?? plan.label
}

export function masterPlanDescription(plan: Pick<MonthlySaleMasterPlan, 'strategy' | 'executionMonths' | 'description'>, copy: TaxPlanningCopy) {
  return copy.strategies.description[plan.strategy]?.(plan.executionMonths) ?? plan.description
}

export function multiYearScenarioName(scenario: Pick<MultiYearTaxScenario, 'key' | 'label'>, copy: TaxPlanningCopy) {
  return copy.scenarios.label[scenario.key] ?? scenario.label
}

export function multiYearScenarioDescription(scenario: Pick<MultiYearTaxScenario, 'key' | 'description'>, copy: TaxPlanningCopy) {
  return copy.scenarios.description[scenario.key] ?? scenario.description
}

export function taxPlanWarningText(warning: TaxPlanWarning, copy: TaxPlanningCopy) {
  if (warning.code === 'WASH_SALE_REVIEW') {
    return warning.daysBefore == null || warning.daysAfter == null
      ? warning.message
      : copy.planWarnings.washSaleReview(warning.daysBefore, warning.daysAfter)
  }
  return copy.planWarnings.codes[warning.code] ?? warning.message
}

export function instructionReasonText(instruction: Pick<MasterPlanInstruction, 'reason' | 'reasonCode'>, copy: TaxPlanningCopy) {
  const code = instructionReasonCode(instruction)
  return code ? copy.timeline.reasons[code] : instruction.reason
}
