import { getIngestedAt } from '@/lib/adapters/portfolio-db'
import { summarizeTaxExport, taxExportNotes } from '@/lib/tax-export'
import { EXPORT_HEADERS, loadTaxExport } from '@/lib/tax-export-request'

export const dynamic = 'force-dynamic'

/** The notes file that goes with the worksheet: same rows, same year, plus what is not covered. */
export async function GET(request: Request) {
  const { rows, year, audit, fileStem } = loadTaxExport(request)
  const text = taxExportNotes(summarizeTaxExport(rows), { year, audit, builtAt: getIngestedAt()?.slice(0, 10) ?? null })
  return new Response(text, {
    headers: {
      ...EXPORT_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${fileStem}-notes.txt"`,
    },
  })
}
