import { PageHeader } from '@/components/PageHeader'
import { Button, Card } from '@/components/ui'
import { TrendBarChart } from '@/components/charts'
import { getDividendByYear } from '@/lib/adapters/portfolio-db'
import { dividendChartAmount, fmtNumber } from '@/lib/format'
import { createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy } from '@/lib/ui-copy'

export const dynamic = 'force-dynamic'

export default async function DividendsPage() {
  const language = await getLanguage()
  const copy = getPageCopy('dividends', language)
  const money = createMoneyFormatter(await getCurrencyPreferences())
  const rows = getDividendByYear()
  const byCurrency = rows.reduce((m, r) => {
    m.set(r.currency, (m.get(r.currency) || 0) + r.amount)
    return m
  }, new Map<string, number>())
  const totalLabel = Array.from(byCurrency.entries()).map(([currency, amount]) => money(amount, currency)).join(' / ')
  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(totalLabel, fmtNumber(rows.reduce((s, r) => s + r.count, 0)))}
        action={<Button href="/income" variant="solid">{copy.openIncome}</Button>}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.trendCard}>
          <TrendBarChart
            data={rows.map((r) => ({ year: `${r.currency} ${r.year}`, currency: r.currency, amount: dividendChartAmount(r.currency, r.amount) }))}
            xKey="year"
            yKey="amount"
            height={300}
            color="var(--accent-success)"
            barColorKey="currency"
            allowDecimals
            yAxisLabel={copy.axisLabel}
          />
          <p className="mt-2 text-label text-ink-3">{copy.note}</p>
        </Card>
        <Card title={copy.yearsCard}>
          <ul className="divide-y divide-line-subtle">
            {rows.map((r) => (
              <li key={r.year} className="flex items-center justify-between py-2 text-body">
                <span className="font-medium text-ink">{r.currency} {r.year}</span>
                <span className="text-ink-3">{copy.rows(fmtNumber(r.count))}</span>
                <span className="font-medium tabular-nums text-ink">{money(r.amount, r.currency)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
