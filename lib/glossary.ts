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
    fx: {
      label: 'FX Rate',
      alias: 'FX',
      description: 'The rate and date used to convert foreign-currency amounts into KRW.',
    },
    taxLot: {
      label: 'Tax Lot',
      alias: 'Lot',
      description: 'A tax-calculation group split by purchase date, price, and quantity for the same security.',
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
    longTerm: {
      label: 'Long Term',
      alias: 'LT',
      description: 'Quantity or tax lots that satisfy the long-term holding-period rule for tax review.',
    },
    shortTerm: {
      label: 'Short Term',
      alias: 'ST',
      description: 'Quantity or tax lots that have not yet satisfied the long-term holding-period rule.',
    },
    tickerless: {
      label: 'Tickerless Income',
      alias: 'Tickerless',
      description: 'Dividend or interest income that has not yet been linked to a specific ticker.',
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
    concentration: {
      label: 'Concentration',
      alias: 'Position Concentration',
      description: 'How much of the portfolio is held in the largest positions. Higher concentration means fewer holdings drive more of the outcome.',
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
    degraded: {
      label: 'Degraded',
      alias: 'Partial Success',
      description: 'Required calculations completed, but an optional step or source refresh failed.',
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
    fx: {
      label: '환율',
      alias: 'FX',
      description: '달러 등 외화 금액을 원화로 환산할 때 사용한 비율과 기준일입니다.',
    },
    taxLot: {
      label: '세금 계산 단위',
      alias: 'Tax Lot',
      description: '같은 종목이라도 매수 시점과 가격별로 나눈 세금 계산용 묶음입니다.',
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
    longTerm: {
      label: '장기 보유',
      alias: 'LT',
      description: '세금상 장기 보유 요건을 충족한 수량 또는 매수 단위입니다.',
    },
    shortTerm: {
      label: '단기 보유',
      alias: 'ST',
      description: '세금상 장기 보유 요건을 아직 충족하지 않은 수량 또는 매수 단위입니다.',
    },
    tickerless: {
      label: '종목 미연결 수익',
      alias: 'Tickerless',
      description: '배당이나 이자 수익이 특정 종목과 아직 연결되지 않은 데이터입니다.',
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
    concentration: {
      label: '집중도',
      alias: 'Concentration',
      description: '상위 종목이 포트폴리오에서 차지하는 비중입니다. 높을수록 소수 종목이 결과를 더 크게 좌우합니다.',
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
    degraded: {
      label: '일부 기능 저하',
      alias: 'Degraded',
      description: '필수 계산은 완료됐지만 선택 기능이나 일부 원본 갱신에 실패한 상태입니다.',
    },
  },
} as const

export const GLOSSARY = GLOSSARY_BY_LANG.en
export type GlossaryKey = keyof typeof GLOSSARY

export function getGlossary(language: Language = 'en') {
  return GLOSSARY_BY_LANG[language]
}
