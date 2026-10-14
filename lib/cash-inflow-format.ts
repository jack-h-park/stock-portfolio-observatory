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
  const text = description || group.account
  // A short hash of the whole text keeps two long descriptions with a shared start apart.
  let hash = 0
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  const slug = text.replace(/\s+/g, '-').slice(0, 32).replace(/-+$/, '')
  return JSON.stringify({ id: `other-${group.institution}-${slug}-${hash.toString(36).slice(0, 5)}`, match, category: 'other', note: '' })
}
