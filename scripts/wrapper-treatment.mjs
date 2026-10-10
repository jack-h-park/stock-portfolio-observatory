// Tax treatment of an account wrapper, per jurisdiction. One module for the
// ingest (the us_wrapper_treatment_decided check) and the app (lib/tax-policy.ts),
// so the two can never disagree about a default.
//
//   taxable              treated like any other brokerage account
//   undecided            kept out of the estimate until a preparer settles it
//   deferred             excluded: the tax falls due on withdrawal
//   exempt_within_limit  excluded: exempt up to the wrapper's limit

/** @typedef {'taxable' | 'undecided' | 'deferred' | 'exempt_within_limit'} WrapperTreatment */

/** @type {readonly WrapperTreatment[]} */
export const WRAPPER_TREATMENTS = Object.freeze(['taxable', 'undecided', 'deferred', 'exempt_within_limit'])

/** The wrappers a policy can decide. The plain brokerage wrapper, `taxable`, is not one of them. */
export const DECIDABLE_WRAPPERS = Object.freeze(['isa', 'irp', 'pension_savings'])

/**
 * The defaults when the policy says nothing. They follow the spec, with one
 * ruling: US `isa` stays `taxable`, because ISA lots are in the US estimate today
 * and the default view must not move. Anything unknown is `undecided`.
 * @type {Readonly<Record<string, Readonly<Record<string, WrapperTreatment>>>>}
 */
export const DEFAULT_WRAPPER_TREATMENT = Object.freeze({
  KR: Object.freeze({ isa: 'exempt_within_limit', irp: 'deferred', pension_savings: 'deferred' }),
  US: Object.freeze({ isa: 'taxable', irp: 'undecided', pension_savings: 'undecided' }),
})

/**
 * @param {unknown} policy the parsed tax policy, or null when there is none
 * @param {string} jurisdiction
 * @param {string} wrapper
 * @returns {WrapperTreatment}
 */
export function resolveWrapperTreatment(policy, jurisdiction, wrapper) {
  if (wrapper === 'taxable') return 'taxable'
  const configured = /** @type {any} */ (policy)?.wrapperTreatment?.[jurisdiction]?.[wrapper]
  if (WRAPPER_TREATMENTS.includes(configured)) return configured
  return DEFAULT_WRAPPER_TREATMENT[jurisdiction]?.[wrapper] ?? 'undecided'
}
