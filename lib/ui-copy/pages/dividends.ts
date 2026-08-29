import { defineCopy } from '@/lib/ui-copy/define'

export const dividends = defineCopy({
  en: {
    title: 'Dividends',
    emphasis: 'Dividends',
    subtitle: (total: string, rows: string) => `${total} across ${rows} dividend rows.`,
    openIncome: 'Open Income Review',
    trendCard: 'Annual dividend income',
    yearsCard: 'Yearly totals',
    axisLabel: 'KRW thousand / USD',
    note: 'KR bars are KRW thousands; US bars are native USD.',
    rows: (count: string) => `${count} rows`,
  },
  ko: {
    title: '배당 내역',
    emphasis: '내역',
    subtitle: (total: string, rows: string) => `배당 ${rows}건, 합계 ${total}.`,
    openIncome: '수익 검토 열기',
    trendCard: '연간 배당 수익',
    yearsCard: '연도별 합계',
    axisLabel: '천 원 / 달러',
    note: '한국 막대는 천 원, 미국 막대는 달러 원화입니다.',
    rows: (count: string) => `${count}건`,
  },
})
