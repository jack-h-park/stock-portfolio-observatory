import { PageHeader } from '@/components/PageHeader'
import { Button, Card } from '@/components/ui'
import { TrendBarChart } from '@/components/charts'
import { getDividendByYear } from '@/lib/adapters/portfolio-db'
import { fmtMoney, fmtNumber } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default function DividendsPage() {
  const rows = getDividendByYear()
  const byCurrency = rows.reduce((m, r) => {
    m.set(r.currency, (m.get(r.currency) || 0) + r.amount)
    return m
  }, new Map<string, number>())
  const totalLabel = Array.from(byCurrency.entries()).map(([currency, amount]) => fmtMoney(amount, currency)).join(' / ')
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Dividends"
        emphasis="Dividends"
        subtitle={`${totalLabel} across ${fmtNumber(rows.reduce((s, r) => s + r.count, 0))} dividend rows.`}
        action={<Button href="/income" variant="solid">Open Income Review</Button>}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Annual dividend income">
          <TrendBarChart
            data={rows.map((r) => ({ year: `${r.currency} ${r.year}`, amount: Math.round(r.currency === 'KRW' ? r.amount / 1000 : r.amount) }))}
            xKey="year"
            yKey="amount"
            height={300}
            color="var(--accent-success)"
            yAxisLabel="KRW thousand / USD"
          />
          <p className="mt-2 text-[11px] text-ink-3">KR bars are KRW thousands; US bars are native USD.</p>
        </Card>
        <Card title="Yearly totals">
          <ul className="divide-y divide-line-subtle">
            {rows.map((r) => (
              <li key={r.year} className="flex items-center justify-between py-2 text-[13px]">
                <span className="font-medium text-ink">{r.currency} {r.year}</span>
                <span className="text-ink-3">{fmtNumber(r.count)} rows</span>
                <span className="font-medium tabular-nums text-ink">{fmtMoney(r.amount, r.currency)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
