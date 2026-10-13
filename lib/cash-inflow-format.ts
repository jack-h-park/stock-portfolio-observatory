/** A share or a change held as a fraction (0.25); `fmtPct` takes a percent number (25). Null stays null. */
export function fractionPct(share: number | null | undefined): number | null {
  return share == null ? null : share * 100
}

/** `salaryShare12m` is a fraction (0-1); `fmtPct` takes a percent number. Null stays null. */
export const salarySharePct = fractionPct
