export const ASSET_VIEWS = ['stocks', 'all'] as const
export type AssetView = (typeof ASSET_VIEWS)[number]
export const ASSET_VIEW_COOKIE = 'stock-observatory-asset-view'
export function normalizeAssetView(value: unknown): AssetView {
  return value === 'all' ? 'all' : 'stocks'
}
