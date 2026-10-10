import { cookies } from 'next/headers'
import { ASSET_VIEW_COOKIE, normalizeAssetView, type AssetView } from '@/lib/asset-view'

export async function getAssetView(): Promise<AssetView> {
  const cookieStore = await cookies()
  return normalizeAssetView(cookieStore.get(ASSET_VIEW_COOKIE)?.value)
}
