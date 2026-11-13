import type { Language } from '@/lib/i18n'

export const GLOSSARY_BY_LANG = {
  en: {
    costBasis: {
      label: 'Cost Basis',
      alias: 'Acquisition Cost',
      description: 'The amount paid to acquire the asset, including fees when available.',
    },
    unrealizedGl: {
      label: 'Unrealized G/L',
      alias: 'Gain/Loss',
      description: 'The estimated gain or loss based on the current price of an asset that has not been sold.',
    },
    baseAmount: {
      label: 'KRW Equivalent',
      alias: 'Base',
      description: 'A market-currency amount converted to KRW using the FX rate shown in the dashboard.',
    },
    reconciliation: {
      label: 'Reconciliation',
      alias: 'Data Match',
      description: 'A check that holdings, cost basis, transactions, and tax-lot evidence agree with each other.',
    },
    freshness: {
      label: 'Data Freshness',
      alias: 'Freshness',
      description: 'Shows whether prices, FX rates, and source files were updated within their expected window.',
    },
    drift: {
      label: 'Source Drift',
      alias: 'Drift',
      description: 'A source file changed size or modified time after ingestion and should be reviewed again.',
    },
    tickerless: {
      label: 'Tickerless Income',
      alias: 'Tickerless',
      description: 'Income that is either not linked to a ticker yet or is naturally cash-based, such as interest and account credits.',
    },
    coverage: {
      label: 'Coverage',
      alias: 'Input Coverage',
      description: 'How much of the relevant portfolio, source data, or planned amount is represented by the current calculation.',
    },
    yieldOnMarket: {
      label: 'Yield on Market',
      alias: 'Current Yield',
      description: 'Income divided by current market value. It shows income rate using today’s valuation.',
    },
    yieldOnCost: {
      label: 'Yield on Cost',
      alias: 'Cost Yield',
      description: 'Income divided by cost basis. It shows income rate relative to what was paid for the position.',
    },
    marketGap: {
      label: 'Market Gap',
      alias: 'Allocation Gap',
      description: 'The difference between current market weight and the configured target weight.',
    },
    inputIssues: {
      label: 'Input Issues',
      alias: 'Data Issues',
      description: 'Data quality items that should be reviewed before relying on the calculation.',
    },
    washSale: {
      label: 'Wash Sale',
      alias: 'Wash Sale Window',
      description: 'A tax rule that can defer a loss when substantially identical securities are bought near the sale date.',
    },
  },
  ko: {
    costBasis: {
      label: '취득원가',
      alias: 'Cost Basis',
      description: '수수료 등을 포함해 이 자산을 취득하는 데 든 금액입니다.',
    },
    unrealizedGl: {
      label: '평가손익',
      alias: 'G/L',
      description: '아직 매도하지 않은 자산의 현재 가격 기준 예상 손익입니다.',
    },
    baseAmount: {
      label: '원화 환산액',
      alias: 'Base',
      description: '각 시장의 통화 금액을 화면에 표시된 환율로 원화 환산한 값입니다.',
    },
    reconciliation: {
      label: '데이터 일치 확인',
      alias: 'Reconciliation',
      description: '보유수량·취득원가와 거래 및 세금 자료가 서로 맞는지 확인한 결과입니다.',
    },
    freshness: {
      label: '데이터 최신 상태',
      alias: 'Freshness',
      description: '가격, 환율, 원본 파일이 정해진 허용 시간 안에 갱신되었는지 나타냅니다.',
    },
    drift: {
      label: '원본 데이터 변경',
      alias: 'Drift',
      description: '수집 이후 원본 파일의 크기나 수정 시간이 달라져 다시 확인해야 하는 상태입니다.',
    },
    tickerless: {
      label: '종목 미연결 수익',
      alias: 'Tickerless',
      description: '이자·예탁금 이용료처럼 원래 특정 종목에 연결하지 않는 현금성 수익이거나, 아직 종목 연결이 필요한 수익입니다.',
    },
    coverage: {
      label: '포함 범위',
      alias: 'Coverage',
      description: '현재 계산에 반영된 포트폴리오, 원본 데이터, 또는 계획 금액의 범위입니다.',
    },
    yieldOnMarket: {
      label: '평가금액 대비 수익률',
      alias: 'Yield on Market',
      description: '수익을 현재 평가금액으로 나눈 비율입니다. 오늘의 평가금액 기준 수익률을 보여줍니다.',
    },
    yieldOnCost: {
      label: '취득원가 대비 수익률',
      alias: 'Yield on Cost',
      description: '수익을 취득원가로 나눈 비율입니다. 실제 지불한 금액 대비 수익률을 보여줍니다.',
    },
    marketGap: {
      label: '시장 비중 차이',
      alias: 'Market Gap',
      description: '현재 시장별 비중과 설정한 목표 비중 사이의 차이입니다.',
    },
    inputIssues: {
      label: '입력 데이터 문제',
      alias: 'Input Issues',
      description: '계산 결과를 신뢰하기 전에 확인해야 하는 데이터 품질 항목입니다.',
    },
    washSale: {
      label: '워시세일',
      alias: 'Wash Sale',
      description: '매도일 전후에 실질적으로 같은 증권을 다시 사면 손실 공제가 이연될 수 있는 세금 규칙입니다.',
    },
  },
} as const

export const GLOSSARY = GLOSSARY_BY_LANG.en

export function getGlossary(language: Language = 'en') {
  return GLOSSARY_BY_LANG[language]
}
