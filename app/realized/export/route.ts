import { taxExportCsv } from '@/lib/tax-export'
import { EXPORT_HEADERS, loadTaxExport } from '@/lib/tax-export-request'

export const dynamic = 'force-dynamic'

/**
 * The tax worksheet for one sale year (or every year). It reads only `year` and
 * `audit` from the URL; the table's filters do not apply.
 */
export async function GET(request: Request) {
  const { rows, fileStem } = loadTaxExport(request)
  return new Response(taxExportCsv(rows), {
    headers: {
      ...EXPORT_HEADERS,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileStem}.csv"`,
    },
  })
}
