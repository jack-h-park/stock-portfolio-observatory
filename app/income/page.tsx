import Link from 'next/link'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { TrendBarChart } from '@/components/charts'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, marketTone } from '@/components/ui'
import { getIncomeReview } from '@/lib/adapters/portfolio-db'
import { fmtNumber, fmtPct } from '@/lib/format'
import { convertMoney, createMoneyFormatter } from '@/lib/currency'
import { getCurrencyPreferences } from '@/lib/currency-server'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'
import { positionHref } from '@/lib/position-url'

export const dynamic = 'force-dynamic'

const COPY = {
  en: {
    eyebrow: 'Portfolio',
    title: 'Income Review',
    emphasis: 'Income',
    subtitle: (rows: string, month: string) => `${rows} income rows across KR and US sources. Latest month: ${month}.`,
    tickerlessRows: (count: string) => `${count} tickerless row(s)`,
    tickerMapped: 'Ticker-mapped',
    trailing12mIncome: 'Trailing 12M Income',
    trailing12mInfo: 'Income received over the last twelve months, converted to KRW. Use this as the headline income run-rate.',
    incomeRunRate: 'Income run-rate',
    baseIncomeHint: 'KRW base income after applying FX',
    ytdIncome: 'YTD Income',
    latestMonth: (month: string) => `Latest month ${month}`,
    yieldOnMarket: 'Yield on Market',
    yieldOnMarketHint: 'Income divided by market value',
    yieldOnCost: 'Yield on Cost',
    yieldOnCostHint: 'Income divided by cost basis',
    incomeCoverage: 'Income Coverage',
    incomeCoverageInfo: 'Native-currency source totals and unmapped rows that can affect position-level income analysis.',
    nativeTotals: 'KRW / USD Native',
    sourceRows: (count: string) => `${count} source rows`,
    tickerlessRowsLabel: 'Tickerless Rows',
    tickerlessHint: 'Included in totals, excluded from position yield rankings',
    readOrder: 'Read order: run-rate first, then yield, then mapping coverage.',
    incomeMix: 'Income mix',
    dividendDistribution: 'Dividend / distribution',
    interest: 'Interest',
    otherIncome: 'Other income',
    marketIncome: 'Market income',
    native: 'native',
    rows: 'rows',
    dataQuality: 'Data quality',
    tickerMappedRows: 'Ticker-mapped rows',
    tickerlessRowsLower: 'Tickerless rows',
    tickerlessQualityNote: 'Tickerless rows are kept in income totals but excluded from position yield rankings until mapped.',
    monthlyIncomeTrend: 'Monthly income trend',
    yearlyNativeTotals: 'Yearly native totals',
    chartAxis: 'KRW thousand',
    chartAxisUsd: 'USD',
    chartNote: 'Values are KRW thousands after applying the configured FX snapshot.',
    chartNoteUsd: 'Values are USD after applying the configured FX snapshot.',
    topIncomePositions: 'Top income positions',
    tickerlessIncomeRows: 'Tickerless income rows',
    allIncomeMapped: 'All income rows are ticker-mapped',
    columns: {
      year: 'Year',
      currency: 'Currency',
      rows: 'Rows',
      native: 'Native',
      base: 'Base',
      position: 'Position',
      nativeIncome: 'Native Income',
      baseIncome: 'Base Income',
      marketValue: 'Market Value',
      yield: 'Yield',
      yieldOnCost: 'Yield on Cost',
      market: 'Market',
      type: 'Type',
      name: 'Name',
    },
  },
  ko: {
    eyebrow: '포트폴리오',
    title: '수익 검토',
    emphasis: '수익',
    subtitle: (rows: string, month: string) => `한국/미국 원본의 수익 행 ${rows}건입니다. 최신 월: ${month}.`,
    tickerlessRows: (count: string) => `종목 미연결 ${count}건`,
    tickerMapped: '종목 연결 완료',
    trailing12mIncome: '최근 12개월 수익',
    trailing12mInfo: '최근 12개월 동안 받은 수익을 원화로 환산한 값입니다. 수익 흐름의 대표 지표로 봅니다.',
    incomeRunRate: '수익 흐름',
    baseIncomeHint: '환율 적용 후 원화 기준 수익',
    ytdIncome: '연초 이후 수익',
    latestMonth: (month: string) => `최신 월 ${month}`,
    yieldOnMarket: '평가금액 대비 수익률',
    yieldOnMarketHint: '수익을 현재 평가금액으로 나눈 값',
    yieldOnCost: '취득원가 대비 수익률',
    yieldOnCostHint: '수익을 취득원가로 나눈 값',
    incomeCoverage: '수익 데이터 범위',
    incomeCoverageInfo: '현지 통화 기준 원본 합계와 종목에 연결되지 않은 행입니다. 종목별 수익 분석에 영향을 줄 수 있습니다.',
    nativeTotals: 'KRW / USD 원본 합계',
    sourceRows: (count: string) => `원본 ${count}행`,
    tickerlessRowsLabel: '종목 미연결 행',
    tickerlessHint: '합계에는 포함되지만 종목별 수익률 순위에서는 제외됩니다.',
    readOrder: '읽는 순서: 수익 흐름, 수익률, 매핑 범위 순으로 확인합니다.',
    incomeMix: '수익 구성',
    dividendDistribution: '배당 / 분배금',
    interest: '이자',
    otherIncome: '기타 수익',
    marketIncome: '시장별 수익',
    native: '현지 통화',
    rows: '행',
    dataQuality: '데이터 품질',
    tickerMappedRows: '종목 연결 행',
    tickerlessRowsLower: '종목 미연결 행',
    tickerlessQualityNote: '종목 미연결 행은 수익 합계에는 포함되지만, 매핑되기 전까지 종목별 수익률 순위에서는 제외됩니다.',
    monthlyIncomeTrend: '월별 수익 추이',
    yearlyNativeTotals: '연도별 현지 통화 합계',
    chartAxis: '천 원',
    chartAxisUsd: '달러',
    chartNote: '설정된 환율 스냅샷을 적용한 천 원 단위 값입니다.',
    chartNoteUsd: '설정된 환율 스냅샷을 적용한 달러 값입니다.',
    topIncomePositions: '수익 상위 종목',
    tickerlessIncomeRows: '종목 미연결 수익 행',
    allIncomeMapped: '모든 수익 행이 종목에 연결되어 있습니다.',
    columns: {
      year: '연도',
      currency: '통화',
      rows: '행',
      native: '현지 통화',
      base: '원화 기준',
      position: '종목',
      nativeIncome: '현지 통화 수익',
      baseIncome: '원화 수익',
      marketValue: '평가금액',
      yield: '수익률',
      yieldOnCost: '취득원가 대비 수익률',
      market: '시장',
      type: '유형',
      name: '이름',
    },
  },
} as const

export default async function IncomePage() {
  const language = await getLanguage()
  const currencyPreferences = await getCurrencyPreferences()
  const money = createMoneyFormatter(currencyPreferences)
  // The chart plots the KRW base figure, so it has to convert on the same terms as
  // every money value on the page — otherwise the axis stays ₩ while the cards read $.
  const displayBaseValue = (value: number | null | undefined) =>
    convertMoney(Number(value ?? 0), 'KRW', currencyPreferences.displayCurrency, currencyPreferences.usdKrwRate).value
  const usd = currencyPreferences.displayCurrency === 'USD'
  const chartDivisor = usd ? 1 : 1000
  const chartPrefix = usd ? '$' : '₩'
  const chartSuffix = usd ? '' : 'K'
  const copy = COPY[language]
  const glossary = getGlossary(language)
  const income = getIncomeReview()
  const latestMonth = income.byMonth[income.byMonth.length - 1]
  const latestMonthLabel = latestMonth?.month ?? 'n/a'

  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtNumber(income.totals.row_count), latestMonthLabel)}
        action={income.totals.tickerless_count ? <Badge tone="warning">{copy.tickerlessRows(fmtNumber(income.totals.tickerless_count))}</Badge> : <Badge tone="success">{copy.tickerMapped}</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title={copy.trailing12mIncome}
          info={copy.trailing12mInfo}
          eyebrow={copy.incomeRunRate}
          value={money(income.totals.trailing_12m_base_income)}
          hint={copy.baseIncomeHint}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label={copy.ytdIncome}
              value={money(income.totals.ytd_base_income)}
              hint={copy.latestMonth(latestMonthLabel)}
              tone="success"
              valueClassName="text-title"
            />
            <MetricField
              label={copy.yieldOnMarket}
              value={fmtPct(income.totals.yield_on_market)}
              info={glossary.yieldOnMarket.description}
              hint={copy.yieldOnMarketHint}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.yieldOnCost}
              value={fmtPct(income.totals.yield_on_cost)}
              info={glossary.yieldOnCost.description}
              hint={copy.yieldOnCostHint}
              valueClassName="text-title"
            />
          </div>
        </MetricHeroCard>

        <Card title={copy.incomeCoverage} info={copy.incomeCoverageInfo}>
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label={copy.nativeTotals}
                value={`${money(income.totals.krw_income, 'KRW')} / ${money(income.totals.usd_income, 'USD')}`}
                hint={copy.sourceRows(fmtNumber(income.totals.row_count))}
                valueClassName="text-title"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label={copy.tickerlessRowsLabel}
                value={fmtNumber(income.totals.tickerless_count)}
                info={glossary.tickerless.description}
                hint={copy.tickerlessHint}
                tone={income.totals.tickerless_count ? 'warning' : 'success'}
                valueClassName="text-metric"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
              {copy.readOrder}
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title={copy.incomeMix}>
          <div className="grid gap-3 text-caption">
            <div className="flex items-center justify-between">
              <span className="text-ink-3">{copy.dividendDistribution}</span>
              <span className="font-medium tabular-nums text-ink">{money(income.totals.dividend_base_income)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">{copy.interest}</span>
              <span className="font-medium tabular-nums text-ink">{money(income.totals.interest_base_income)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">{copy.otherIncome}</span>
              <span className="font-medium tabular-nums text-ink">{money(income.totals.other_base_income)}</span>
            </div>
          </div>
        </Card>

        <Card title={copy.marketIncome}>
          <ul className="divide-y divide-line-subtle">
            {income.byMarket.map((row) => (
              <li key={`${row.market}:${row.currency}`} className="flex items-center gap-3 py-2 text-caption">
                <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-medium tabular-nums text-ink">{money(row.base_income)}</div>
                  <div className="text-label text-ink-3">{money(row.native_income, row.currency)} {copy.native} · {fmtNumber(row.row_count)} {copy.rows}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={copy.dataQuality}>
          <div className="grid gap-3 text-caption">
            <div className="flex items-center justify-between">
              <span className="text-ink-3">{copy.tickerMappedRows}</span>
              <span className="font-medium tabular-nums text-success">{fmtNumber(income.totals.row_count - income.totals.tickerless_count)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-3">{copy.tickerlessRowsLower}</span>
              <span className={income.totals.tickerless_count ? 'font-medium tabular-nums text-warning' : 'font-medium tabular-nums text-success'}>
                {fmtNumber(income.totals.tickerless_count)}
              </span>
            </div>
            <div className="text-label leading-relaxed text-ink-3">
              {copy.tickerlessQualityNote}
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title={copy.monthlyIncomeTrend}>
          <TrendBarChart
            data={income.byMonth.map((row) => ({ month: row.month.slice(2), income: Math.round(displayBaseValue(row.base_income) / chartDivisor) }))}
            xKey="month"
            yKey="income"
            height={300}
            color="var(--accent-success)"
            yAxisPrefix={chartPrefix}
            yAxisSuffix={chartSuffix}
            yAxisLabel={usd ? copy.chartAxisUsd : copy.chartAxis}
          />
          <p className="mt-2 text-label text-ink-3">{usd ? copy.chartNoteUsd : copy.chartNote}</p>
        </Card>

        <Card title={copy.yearlyNativeTotals}>
          <DataTable
            rows={income.byYear}
            columns={[
              { key: 'year', label: copy.columns.year },
              { key: 'currency', label: copy.columns.currency },
              { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'native_income', label: copy.columns.native, align: 'right', render: (r) => money(r.native_income, r.currency) },
              { key: 'base_income', label: copy.columns.base, align: 'right', render: (r) => money(r.base_income) },
            ]}
          />
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5">
        <Card title={copy.topIncomePositions}>
          <DataTable
            rows={income.byPosition}
            columns={[
              {
                key: 'ticker',
                label: copy.columns.position,
                render: (r) => (
                  <div className="min-w-[14rem]">
                    <div className="flex items-center gap-2">
                      <Badge tone={marketTone(r.market)}>{r.market}</Badge>
                      <Link href={positionHref(r.market, r.ticker)} className="font-mono text-caption font-medium text-info hover:underline">
                        {r.ticker}
                      </Link>
                    </div>
                    <div className="mt-1 max-w-[20rem] truncate text-caption font-medium text-ink">{r.name}</div>
                  </div>
                ),
              },
              { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
              { key: 'native_income', label: copy.columns.nativeIncome, align: 'right', render: (r) => money(r.native_income, r.currency) },
              { key: 'base_income', label: copy.columns.baseIncome, align: 'right', render: (r) => money(r.base_income) },
              { key: 'market_value', label: copy.columns.marketValue, align: 'right', render: (r) => (r.market_value == null ? 'n/a' : money(r.market_value)) },
              { key: 'trailing_yield', label: copy.columns.yield, align: 'right', render: (r) => fmtPct(r.trailing_yield) },
              { key: 'yield_on_cost', label: copy.columns.yieldOnCost, align: 'right', render: (r) => fmtPct(r.yield_on_cost) },
            ]}
          />
        </Card>

        <Card title={copy.tickerlessIncomeRows} accent={income.tickerless.length > 0}>
          {income.tickerless.length === 0 ? (
            <EmptyState ok>{copy.allIncomeMapped}</EmptyState>
          ) : (
            <DataTable
              rows={income.tickerless}
              columns={[
                { key: 'market', label: copy.columns.market, render: (r) => <Badge tone={marketTone(r.market)}>{r.market}</Badge> },
                { key: 'type', label: copy.columns.type },
                { key: 'name', label: copy.columns.name },
                { key: 'row_count', label: copy.columns.rows, align: 'right', render: (r) => fmtNumber(r.row_count) },
                { key: 'native_income', label: copy.columns.native, align: 'right', render: (r) => money(r.native_income, r.currency) },
                { key: 'base_income', label: copy.columns.base, align: 'right', render: (r) => money(r.base_income) },
              ]}
            />
          )}
        </Card>
      </div>
    </>
  )
}
