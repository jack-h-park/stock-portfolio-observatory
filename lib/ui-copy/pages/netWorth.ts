import { defineCopy } from '@/lib/ui-copy/define'

/**
 * A cash row's `kind`: the bank map's kinds the extractors write to
 * cash_balances, and `cash`, the overview's name for a row without one. An
 * unlisted kind shows raw.
 */
export const CASH_KINDS = ['checking', 'savings', 'cma', 'deposit', 'fx', 'cash'] as const
type CashKind = (typeof CASH_KINDS)[number]

export const netWorth = defineCopy({
  en: {
    title: 'Total Assets',
    emphasis: 'Assets',
    subtitle: (asOf: string) => `Securities, crypto, bank deposits, pensions and gold in one KRW figure. Portfolio data as of ${asOf}.`,
    total: 'Covered total assets',
    byClass: 'By asset class',
    classes: { stocks: 'Stocks', crypto: 'Crypto', cash: 'Cash', pensions: 'Pensions', gold: 'Gold' },
    asOfNotesHint: "A dated class is valued from a snapshot, at cost, or from a balance older than today, not from today's price.",
    allocation: {
      title: 'Allocation',
      byClass: 'By what it is',
      byWrapper: 'By account type',
      note: "Known pension exposure and cash are classified independently of the account wrapper; unmapped pension products stay in a separate bucket. A taxable or ISA security's class comes from the same mapping the rebalance page uses (data/instrument-classes.json), so a gold ETF mapped to gold counts as gold here too.",
      classes: { kr_equity: 'Korean equity', us_equity: 'US equity', bonds: 'Bonds', gold: 'Gold', crypto: 'Crypto', pension: 'Pension', cash: 'Cash', unclassified: 'Unclassified' },
      wrappers: { taxable: 'Taxable', isa: 'ISA', pension: 'Pension' },
      wrapperNote: 'Taxable includes bank cash, physical gold and crypto.',
      columns: { name: 'Class', value: 'Value', pct: 'Share' },
      marketDefaults: (count: number) => `${count} securities have no mapping and are counted by their market (KR or US). A gold or bond ETF among them needs a mapping to move.`,
      unclassified: (list: string) => `Unclassified (no mapping, and not a KR or US market): ${list}.`,
      showDefaults: 'Show them',
      movedLabel: (label: string) => `Securities counted in ${label} by mapping`,
      movedTitle: (label: string) => `Counted in ${label} by mapping, not by their market:`,
    },
    asOfNote: (label: string, asOf: string) => `${label} as of ${asOf}`,
    trend: 'Total assets trend',
    trendStarts: (parts: string[]) => (parts.length ? `Each class starts on its first data: ${parts.join(' · ')}` : 'No asset class has data yet.'),
    classSince: (label: string, date: string) => `${label} from ${date}`,
    trendNote:
      'Cash includes estimated balances of accounts with no statement on file (a parking account, a matured term deposit, a closed CMA), traced from the transfers the statements show. Pensions move only on certificate and snapshot dates, and hold the last value between them. Gold uses remaining grams after purchases and sales, valued at the KRX price on or before each date, or remaining purchase cost including purchase fees when no price is stored. Dates with unresolved gold quantities, or neither a price nor known remaining cost, are excluded from historical gold totals. Before a class starts it adds nothing. The last point is today.',
    chartAxisKrw: 'KRW',
    chartAxisUsd: 'USD',
    noTrend: 'No total assets history yet.',
    balances: 'Deposit balances',
    columns: { institution: 'Institution', account: 'Account', kind: 'Kind', asOf: 'As of', balance: 'Balance', krw: 'Value' },
    kinds: { checking: 'Checking', savings: 'Savings', cma: 'CMA', deposit: 'Deposit', fx: 'fx', cash: 'cash' } satisfies Record<CashKind, string>,
    derived: 'Derived from an anchor balance',
    unpriced: (list: string) => `No USD/KRW rate is available for ${list}. These accounts are not in the total.`,
    history: 'Month-end history',
    historyColumns: { month: 'Month', stocks: 'Stocks', crypto: 'Crypto', cash: 'Cash', pensions: 'Pensions', gold: 'Gold', total: 'Total' },
    historyNote: "Each month's last portfolio snapshot, and today for the current month. A dash is a class with no data yet on that date.",
    historyFxNote: 'Past USD deposits are converted at the historical USD/KRW rate where one is stored, otherwise at today\'s rate.',
    none: '—',
    empty: 'No deposit balances collected yet',
    children: {
      toggle: 'Include children',
      toggleAria: (included: boolean) => (included ? 'Include children: included' : 'Include children: excluded'),
      toggleHint: "Off: every figure is the maintainer's own. On: the children's accounts are added beside them, never inside a total.",
      title: "Children's accounts",
      note: "Each child's own accounts, held for them. They are not in Covered total assets, the class totals or the FBAR worksheet.",
      band: 'Children',
      combined: 'Total incl. children',
      historyColumn: 'Children (separate)',
      columns: { owner: 'Owner', account: 'Account', asOf: 'As of', value: 'Value' },
      subtotal: (label: string) => `${label} total`,
      empty: 'No child account is on file.',
      derivedNote: (label: string, from: string, until: string, method: string) =>
        method === 'contributions'
          ? `${label}: ${from} to ${until} is derived from cumulative net contributions (money in less money out), not a market value; the series is the snapshot from then on.`
          : `${label}: ${from} to ${until} is derived from the transaction certificate, with each day's holdings valued at that day's close plus cash; the series is the snapshot from then on.`,
    },
  },
  ko: {
    title: '총자산',
    emphasis: '총자산',
    subtitle: (asOf: string) => `증권, 암호화폐, 은행 예금, 연금, 금을 원화 한 숫자로 보여줍니다. 포트폴리오 기준일: ${asOf}.`,
    total: '확인 가능한 총자산',
    byClass: '자산군별',
    classes: { stocks: '주식', crypto: '암호화폐', cash: '현금', pensions: '연금', gold: '금' },
    asOfNotesHint: '날짜가 붙은 자산군은 오늘 시세가 아니라 스냅샷, 취득원가 또는 오늘 이전 잔고 기준입니다.',
    allocation: {
      title: '자산 비중',
      byClass: '자산 종류별',
      byWrapper: '계좌 유형별',
      note: '연금도 확인된 경제적 노출과 계좌 유형을 별도로 분류합니다. 미분류 연금 상품은 따로 표시하며, 연금 현금은 노출 기준으로 현금입니다. 일반·ISA 계좌 종목의 분류는 리밸런싱 화면과 같은 매핑(data/instrument-classes.json)을 따르므로, 금으로 지정한 금 ETF는 여기서도 금입니다.',
      classes: { kr_equity: '한국 주식', us_equity: '미국 주식', bonds: '채권', gold: '금', crypto: '가상자산', pension: '연금', cash: '현금', unclassified: '미분류' },
      wrappers: { taxable: '일반(과세)', isa: 'ISA', pension: '연금' },
      wrapperNote: '일반(과세)에는 은행 현금, 금현물, 가상자산이 포함됩니다.',
      columns: { name: '분류', value: '금액', pct: '비중' },
      marketDefaults: (count: number) => `매핑이 없는 ${count}개 종목은 상장 시장(한국/미국) 기준으로 넣었습니다. 이 중 금 ETF나 채권 ETF는 매핑을 지정해야 옮겨집니다.`,
      unclassified: (list: string) => `미분류 (매핑이 없고 한국·미국 시장도 아님): ${list}.`,
      showDefaults: '종목 보기',
      movedLabel: (label: string) => `매핑으로 ${label}에 들어간 종목`,
      movedTitle: (label: string) => `상장 시장이 아니라 매핑에 따라 ${label}에 넣은 종목:`,
    },
    asOfNote: (label: string, asOf: string) => `${label} ${asOf} 기준`,
    trend: '자산 현황 추이',
    trendStarts: (parts: string[]) => (parts.length ? `자산군별 데이터 시작일: ${parts.join(' · ')}` : '아직 데이터가 있는 자산군이 없습니다.'),
    classSince: (label: string, date: string) => `${label} ${date}부터`,
    trendNote:
      '현금에는 거래내역이 없는 계좌(파킹통장, 만기된 예적금, 해지된 CMA)의 추정 잔액이 포함되며, 다른 계좌 거래내역에 나온 이체로 계산합니다. 연금은 증명서와 스냅샷 날짜에만 바뀌고, 그 사이에는 마지막 값을 유지합니다. 금은 매수·매도 후 남은 그램 × 해당 날짜 이전 최신 KRX 시세이며, 시세가 없으면 매입수수료를 포함한 잔여 취득원가입니다. 과거 금 보유량을 확인할 수 없거나 시세와 잔여 원가가 모두 없는 날짜는 과거 금 합계에서 제외합니다. 데이터가 시작되기 전의 자산군은 더하지 않습니다. 마지막 점은 오늘입니다.',
    chartAxisKrw: '원',
    chartAxisUsd: '달러',
    noTrend: '아직 자산 현황 이력이 없습니다.',
    balances: '예금 잔고',
    columns: { institution: '기관', account: '계좌', kind: '종류', asOf: '기준일', balance: '잔고', krw: '평가금액' },
    kinds: { checking: '입출금', savings: '저축', cma: 'CMA', deposit: '예금', fx: '외화', cash: '현금' } satisfies Record<CashKind, string>,
    derived: '기준 잔고에서 역산',
    unpriced: (list: string) => `${list}은(는) USD/KRW 환율이 없어 합계에 포함되지 않았습니다.`,
    history: '월말 추이',
    historyColumns: { month: '월', stocks: '주식', crypto: '암호화폐', cash: '현금', pensions: '연금', gold: '금', total: '합계' },
    historyNote: '매월 마지막 포트폴리오 스냅샷 기준이며, 이번 달은 오늘 기준입니다. 대시(—)는 그 날짜에 아직 데이터가 없는 자산군입니다.',
    historyFxNote: '과거 USD 예금은 저장된 당시 USD/KRW 환율로 환산하고, 없으면 오늘 환율을 씁니다.',
    none: '—',
    empty: '아직 수집된 예금 잔고가 없습니다',
    children: {
      toggle: '자녀 포함',
      toggleAria: (included: boolean) => (included ? '자녀 포함: 포함됨' : '자녀 포함: 제외됨'),
      toggleHint: '끄면 모든 숫자가 본인 것만입니다. 켜면 자녀 계좌를 옆에 따로 보여주며, 어떤 합계에도 더하지 않습니다.',
      title: '자녀 계좌',
      note: '자녀 명의로 보유한 계좌입니다. 확인 가능한 총자산, 자산군 합계, 해외 계좌 신고(FBAR) 화면에는 포함되지 않습니다.',
      band: '자녀',
      combined: '자녀 포함 합계',
      historyColumn: '자녀 (별도)',
      columns: { owner: '명의', account: '계좌', asOf: '기준일', value: '평가금액' },
      subtotal: (label: string) => `${label} 합계`,
      empty: '등록된 자녀 계좌가 없습니다.',
      derivedNote: (label: string, from: string, until: string, method: string) =>
        method === 'contributions'
          ? `${label}: ${from}부터 ${until}까지는 평가금액이 아니라 누적 순납입액(입금 - 출금)으로 추정한 값이며, 그 이후는 잔고 스냅샷입니다.`
          : `${label}: ${from}부터 ${until}까지는 거래내역증명서로 추정한 값으로, 그날의 보유 수량을 그날 종가로 평가하고 예수금을 더했습니다. 그 이후는 잔고 스냅샷입니다.`,
    },
  },
})
