/**
 * Why a sale instruction is scheduled. Kept free of imports so a client
 * component can read it; lib/tax-planning re-exports it.
 */
export type MasterPlanReasonCode =
  | 'WAIT_US_ONLY_YEAR'
  | 'EARLY_LOSS_OFFSET'
  | 'LOSS_INVENTORY'
  | 'MIXED_RETURNS'
  | 'FIRST_LONG_TERM_WINDOW'
  | 'SHORT_TERM_SALE'

/**
 * The English reason each code has always been stored as. Saved plans hold the
 * sentence without a code, so this table is also how they recover one.
 */
export const MASTER_PLAN_REASONS = {
  WAIT_US_ONLY_YEAR: 'Held for long-term treatment and same-year netting in the first US-only filing year',
  EARLY_LOSS_OFFSET: 'Early loss candidate for same-year gain offset; wash-sale review required',
  LOSS_INVENTORY: 'Loss inventory scheduled with the annual realization plan',
  MIXED_RETURNS: 'A gain on one return and a loss on the other this year; scheduled as a sale, not as loss inventory',
  FIRST_LONG_TERM_WINDOW: 'First permitted window after long-term eligibility',
  SHORT_TERM_SALE: 'Short-term sale under the selected scenario',
} satisfies Record<MasterPlanReasonCode, string>

const REASON_CODE_BY_TEXT = new Map(
  Object.entries(MASTER_PLAN_REASONS).map(([code, text]) => [text, code as MasterPlanReasonCode])
)

/** The reason code of an instruction, read from the stored English reason when it predates codes. */
export function instructionReasonCode(instruction: { reason: string; reasonCode?: MasterPlanReasonCode }): MasterPlanReasonCode | null {
  return instruction.reasonCode ?? REASON_CODE_BY_TEXT.get(instruction.reason) ?? null
}
