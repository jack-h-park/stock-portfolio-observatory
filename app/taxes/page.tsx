import { TaxHistoryScreen, type TaxSearch } from './view'
import { routeMetadata } from '@/lib/page-names'
export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/taxes')
export default function TaxesPage(props: { searchParams: Promise<TaxSearch> }) {
  return <TaxHistoryScreen {...props} />
}
