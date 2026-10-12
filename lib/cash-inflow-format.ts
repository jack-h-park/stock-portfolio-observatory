/** `salaryShare12m` is a fraction (0-1); `fmtPct` takes a percent number. Null stays null. */
export function salarySharePct(share: number | null | undefined): number | null {
  return share == null ? null : share * 100
}
