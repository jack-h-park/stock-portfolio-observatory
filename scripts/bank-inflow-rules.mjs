// The shape a bankInflowRules entry in manual-mappings.json must have. The ingest
// validates rules against these lists, and the cash inflow page's suggested rule
// is tested against them, so the two cannot drift apart.

export const BANK_INFLOW_CATEGORIES = ['salary', 'dividend', 'interest', 'other', 'transfer']
// Text keys; a rule needs at least one with a non-blank value.
export const BANK_INFLOW_MATCH_KEYS = ['institution', 'accountIncludes', 'descriptionIncludes', 'counterpartyIncludes', 'currency']
// Bounds narrow a rule to a period or an amount range; they never stand alone.
export const BANK_INFLOW_BOUND_KEYS = ['dateFrom', 'dateTo', 'amountMin', 'amountMax']
