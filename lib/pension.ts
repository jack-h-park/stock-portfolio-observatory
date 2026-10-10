import { pensionCreditLimit, type TaxPolicy } from '@/lib/tax-policy'

/**
 * Pension contributions set against the Korean tax-credit limits, kept free of
 * the database. The limits come from the policy, never from the code.
 */
export type PensionContributionYear = { year: number; ownKrw: number; employerKrw: number | null }

export type ContributionLimitRow = {
  year: number
  irpOwnKrw: number
  pensionSavingsOwnKrw: number
  combinedOwnKrw: number
  /** Employer contributions to IRP, or null when no account's evidence names any for the year. */
  employerKrw: number | null
  limit: { pensionSavingsLimitKrw: number; combinedLimitKrw: number } | null
  /** Own contributions the credit counts: pension savings up to its own limit, plus IRP, capped by the combined limit. Null with no limit. */
  creditEligibleKrw: number | null
}

/** One row per year with any contribution, newest first. Employer money never counts toward the credit. */
export function contributionsAgainstLimits(
  accounts: { wrapper: string; contributionsByYear: PensionContributionYear[] }[],
  policy: TaxPolicy
): ContributionLimitRow[] {
  const years = new Map<number, { irp: number; savings: number; employer: number | null }>()
  for (const account of accounts) {
    for (const row of account.contributionsByYear) {
      const entry = years.get(row.year) ?? { irp: 0, savings: 0, employer: null }
      if (account.wrapper === 'pension_savings') entry.savings += row.ownKrw
      else entry.irp += row.ownKrw
      if (row.employerKrw != null) entry.employer = (entry.employer ?? 0) + row.employerKrw
      years.set(row.year, entry)
    }
  }
  return [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, entry]) => {
      const limit = pensionCreditLimit(policy, year)
      return {
        year,
        irpOwnKrw: entry.irp,
        pensionSavingsOwnKrw: entry.savings,
        combinedOwnKrw: entry.irp + entry.savings,
        employerKrw: entry.employer,
        limit,
        creditEligibleKrw: limit ? Math.min(Math.min(entry.savings, limit.pensionSavingsLimitKrw) + entry.irp, limit.combinedLimitKrw) : null,
      }
    })
}
