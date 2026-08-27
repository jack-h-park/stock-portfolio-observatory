import type { getPageCopy } from '@/lib/ui-copy'

export type TaxSettingsCopy = ReturnType<typeof getPageCopy<'taxSettings'>>

/** The filing scenario a year defaults to, worded. Stays with the page: the
 *  stored value is a code, and only this screen turns it into a sentence. */
export function scenarioLabel(value: string, copy: TaxSettingsCopy) {
  if (value === 'US_ONLY') return copy.scenarios.US_ONLY
  if (value === 'KR_ONLY') return copy.scenarios.KR_ONLY
  return copy.scenarios.US_AND_KR
}
