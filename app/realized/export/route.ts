import { getRealizedLots } from '@/lib/adapters/portfolio-db'
import { form8949Csv } from '@/lib/realized-lots'
import { queryRealized } from '@/lib/realized-lots-query'

export const dynamic = 'force-dynamic'

/**
 * The table's rows as a Form 8949 worksheet.
 *
 * It reads the URL through the same function as the page, so the file holds
 * exactly what the table shows for those filters. The page pins the year it is
 * showing into the link, so a default year is never a surprise in the file.
 */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries())
  const { filtered, year } = queryRealized(getRealizedLots(), params, String(new Date().getFullYear()))
  return new Response(form8949Csv(filtered), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="realized-lots-${year}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
