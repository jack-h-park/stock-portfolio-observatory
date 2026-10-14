/** A share or a change held as a fraction (0.25); `fmtPct` takes a percent number (25). Null stays null. */
export function fractionPct(share: number | null | undefined): number | null {
  return share == null ? null : share * 100
}

/** `salaryShare12m` is a fraction (0-1); `fmtPct` takes a percent number. Null stays null. */
export const salarySharePct = fractionPct

/**
 * A bankInflowRules entry to paste into the laptop's manual-mappings.json for one
 * group of unclassified credits. It matches the group's institution and
 * description (its account when the description is blank), which is what the
 * ingest's validation requires, and names `other` for the reader to change.
 */
export function ruleSnippet(group: { institution: string; account: string; description: string }): string {
  const description = group.description.trim()
  const match = description
    ? { institution: group.institution, descriptionIncludes: description }
    : { institution: group.institution, accountIncludes: group.account }
  const slug = (description || group.account).replace(/\s+/g, '-').slice(0, 40)
  return JSON.stringify({ id: `other-${group.institution}-${slug}`, match, category: 'other', note: '' })
}
