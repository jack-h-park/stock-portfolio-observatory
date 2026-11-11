export const FINANCE_ASSET_CLASSES = ['stocks', 'crypto', 'cash', 'pensions', 'gold'] as const
export type FinanceAssetClass = (typeof FINANCE_ASSET_CLASSES)[number]
export type AssetObservation = {
  owner: string
  accountId: string
  assetKey: string
  assetClass: FinanceAssetClass
  asOf: string | null
  valueKrw: number | null
  method: 'market' | 'snapshot' | 'cost' | 'unpriced'
  institution?: string
  account?: string
  currency?: string
  nativeAmount?: number
  cashKind?: string
  derived?: boolean
}

export function summarizeFinanceAssets(observations: AssetObservation[], owners: readonly string[] = ['self']) {
  const grouped = new Map<string, AssetObservation[]>()
  for (const row of observations)
    if (owners.includes(row.owner)) {
      const key = JSON.stringify([row.owner, row.accountId, row.assetKey])
      grouped.set(key, [...(grouped.get(key) ?? []), row])
    }
  const included: AssetObservation[] = [],
    omissions: { accountId: string; assetKey: string; reason: string }[] = []
  for (const rows of grouped.values()) {
    const latest = rows
      .map((row) => row.asOf ?? '')
      .sort()
      .at(-1)!
    const candidates = rows.filter((row) => (row.asOf ?? '') === latest),
      row = candidates[0]
    if (candidates.some((item) => item.valueKrw !== row.valueKrw || item.assetClass !== row.assetClass)) {
      omissions.push({ accountId: row.accountId, assetKey: row.assetKey, reason: 'conflicting-same-date-sources' })
      continue
    }
    if (row.valueKrw == null || !Number.isFinite(row.valueKrw) || row.valueKrw < 0) {
      omissions.push({
        accountId: row.accountId,
        assetKey: row.assetKey,
        reason: 'unpriced-or-unsupported-negative-balance',
      })
      continue
    }
    included.push(row)
  }
  const byClass = Object.fromEntries(
    FINANCE_ASSET_CLASSES.map((key) => [
      key,
      included.filter((row) => row.assetClass === key).reduce((n, row) => n + row.valueKrw!, 0),
    ]),
  ) as Record<FinanceAssetClass, number>
  return {
    totalKrw: Object.values(byClass).reduce((n, value) => n + value, 0),
    byClass,
    included,
    omissions,
    scope: owners.join(','),
    complete: omissions.length === 0 && included.every((row) => row.method === 'market' && row.asOf),
    liabilitiesSupported: false as const,
  }
}
