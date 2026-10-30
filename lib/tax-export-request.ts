import { getRealizedLots } from '@/lib/adapters/portfolio-db'
import { todayLosAngeles } from '@/lib/cli/common'
import { ALL_YEARS, type RealizedLotView } from '@/lib/realized-lots'
import { readExportParams, selectTaxExportRows } from '@/lib/tax-export'

export const EXPORT_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const

/**
 * What both export routes share: only `year` and `audit` are read from the URL, so the
 * table's own filters can never narrow a file a preparer will rely on.
 */
export function loadTaxExport(request: Request): { rows: RealizedLotView[]; year: string; audit: boolean; fileStem: string } {
  const params = new URL(request.url).searchParams
  const audit = params.get('audit') === '1'
  const all = getRealizedLots({ includeSuperseded: audit })
  const years = [...new Set(all.map((row) => row.sold_year).filter(Boolean))]
  const resolved = readExportParams(params, years, todayLosAngeles().slice(0, 4))
  const rows = selectTaxExportRows(all, resolved)
  const fileStem = `tax-realized-${resolved.year === ALL_YEARS ? 'all-years' : resolved.year}${resolved.audit ? '-audit' : ''}`
  return { rows, year: resolved.year, audit: resolved.audit, fileStem }
}
