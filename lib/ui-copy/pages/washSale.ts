import { defineCopy } from '@/lib/ui-copy/define'

// The wash-sale banner, shown at the top of Overview and /tax-planning while any
// window is open. One entry so both pages say the same thing.
export const washSale = defineCopy({
  en: {
    title: (count: number) => `Wash-sale window: do not buy ${count === 1 ? 'this ticker' : `these ${count} tickers`} in any account`,
    scope:
      'A US stock sold at a loss is blocked for 30 calendar days after the sale. A buy of the same ticker in that time, in ANY account, disallows the loss: every Robinhood account including Agentic, Chase, Merrill and Fidelity, and also a spouse’s account or an IRA, which this app cannot see. An IRA buy loses the deduction for good.',
    drip: 'A dividend reinvestment is a buy. Turn it off for these tickers wherever they are still held.',
    columns: { loss: 'Realized loss', until: 'Do not buy until' },
    untilDate: (date: string) => `${date} (inclusive)`,
    clearFrom: (date: string) => `OK from ${date}`,
    daysLeft: (days: number) => (days === 0 ? 'last day' : `${days} day${days === 1 ? '' : 's'} left`),
    soldIn: (accounts: string) => `Sold in ${accounts}`,
    stillHeld: (accounts: string) => `Still held in ${accounts}: a reinvested dividend there counts`,
    boughtBefore: (dates: string, amount: string) => `Bought within 30 days before the sale (${dates}): ${amount} of the loss may be disallowed`,
    boughtBeforeSoldTogether: (dates: string) => `Bought within 30 days before the sale (${dates}), but those shares were sold in the same sale`,
    boughtAfter: (dates: string, amount: string) => `Already bought after the sale (${dates}): ${amount} of the loss is likely disallowed`,
    reinvested: 'reinvested',
    asOf: (today: string, through: string) => `Measured on ${today}. US transactions are ingested through ${through}; a buy after that is not visible here.`,
    estimate: 'The disallowed amount is an estimate pro-rated by share count; the broker’s 1099-B is the filed figure.',
  },
  ko: {
    title: (count: number) => `워시세일 기간: ${count === 1 ? '이 종목은' : `이 ${count}개 종목은`} 어느 계좌에서도 매수 금지`,
    scope:
      '손실로 매도한 미국 주식은 매도 후 30일(달력일) 동안 같은 종목을 사면 안 됩니다. 이 기간에 어느 계좌에서든 다시 사면 그 손실이 인정되지 않습니다. Agentic을 포함한 모든 Robinhood 계좌, Chase, Merrill, Fidelity뿐 아니라, 이 앱이 볼 수 없는 배우자 계좌와 IRA도 해당됩니다. IRA에서 사면 공제가 영구히 사라집니다.',
    drip: '배당 재투자도 매수입니다. 이 종목을 아직 보유한 계좌에서는 배당 재투자를 꺼 두세요.',
    columns: { loss: '실현 손실', until: '매수 금지:' },
    untilDate: (date: string) => `${date}까지 (당일 포함)`,
    clearFrom: (date: string) => `${date}부터 매수 가능`,
    daysLeft: (days: number) => (days === 0 ? '오늘이 마지막 날' : `${days}일 남음`),
    soldIn: (accounts: string) => `매도 계좌: ${accounts}`,
    stillHeld: (accounts: string) => `아직 보유 중: ${accounts} (배당 재투자도 매수로 간주)`,
    boughtBefore: (dates: string, amount: string) => `매도 전 30일 안에 매수함 (${dates}): 손실 중 ${amount}가 인정되지 않을 수 있음`,
    boughtBeforeSoldTogether: (dates: string) => `매도 전 30일 안에 매수함 (${dates}), 다만 그 주식은 같은 매도에서 함께 팔림`,
    boughtAfter: (dates: string, amount: string) => `매도 후 이미 매수함 (${dates}): 손실 중 ${amount}가 인정되지 않을 가능성이 높음`,
    reinvested: '배당 재투자',
    asOf: (today: string, through: string) => `${today} 기준. 미국 거래내역은 ${through}까지 반영되어 있어, 그 이후의 매수는 여기 보이지 않습니다.`,
    estimate: '인정되지 않는 금액은 주식 수 비율로 나눈 추정치이며, 신고 기준은 증권사 1099-B입니다.',
  },
})
