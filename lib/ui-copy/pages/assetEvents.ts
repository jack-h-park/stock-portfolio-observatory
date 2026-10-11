import { defineCopy } from '@/lib/ui-copy/define'

// The asset events list shown under the total-assets trend, on Overview (all
// assets) and on /net-worth. One entry so both pages say the same thing.
export const assetEvents = defineCopy({
  en: {
    title: 'Major asset events',
    method:
      'Money of 10M KRW or more that arrived from outside the statements, and every holding period whose gain or loss is 10M KRW or more. A holding period ends when the open cost of a ticker falls below 1M KRW. Unrealized gain is valued at today’s price; the tax column is the tax planner’s estimate for selling the open lots now.',
    columns: { n: '#', period: 'Period', event: 'Event', invested: 'Invested (peak)', gain: 'Gain before tax', tax: 'Estimated tax', afterTax: 'After tax' },
    held: 'held',
    unlabeled: (arrivals: number) => (arrivals > 1 ? `Unlabeled inflow (${arrivals} transfers)` : 'Unlabeled inflow'),
    unpriced: (count: number) => `${count} open lot(s) have no price; the gain is understated`,
    categories: { asset_sale: 'Asset sale', inheritance: 'Inheritance', insurance: 'Insurance', income: 'Income', other: 'Other' },
    breakdown: (realized: string, unrealized: string, dividends: string) => `Realized ${realized} · unrealized ${unrealized} · dividends ${dividends}`,
    empty: 'No event reaches 10M KRW yet',
    none: '—',
  },
  ko: {
    title: '자산 변화 주요 사건',
    method:
      '거래내역 밖에서 들어온 1,000만 원 이상의 돈과, 손익이 ±1,000만 원 이상인 보유 구간입니다. 한 종목의 보유 원가가 100만 원 미만으로 떨어지면 보유 구간이 끝납니다. 미실현 손익은 오늘 가격 기준이며, 세금은 남은 lot을 지금 판다고 할 때 세금 계획의 추정치입니다.',
    columns: { n: '#', period: '기간', event: '사건', invested: '투입(최대)', gain: '세전 손익', tax: '예상 세금', afterTax: '세후' },
    held: '보유 중',
    unlabeled: (arrivals: number) => (arrivals > 1 ? `출처 미지정 입금 (${arrivals}회)` : '출처 미지정 입금'),
    unpriced: (count: number) => `시세 없는 lot ${count}개: 손익이 실제보다 적게 잡힘`,
    categories: { asset_sale: '자산 매도', inheritance: '상속', insurance: '보험·연금 해지', income: '소득', other: '기타' },
    breakdown: (realized: string, unrealized: string, dividends: string) => `실현 ${realized} · 미실현 ${unrealized} · 배당 ${dividends}`,
    empty: '아직 1,000만 원 이상인 사건이 없습니다',
    none: '—',
  },
})
