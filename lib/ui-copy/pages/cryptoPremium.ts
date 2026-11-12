import { defineCopy } from '@/lib/ui-copy/define'

export const cryptoPremium = defineCopy({
  en: {
    title: 'Korea Premium',
    emphasis: 'Premium',
    subtitleWithData: (rate: string, fxDate: string, snapshot: string) =>
      `Won order book against the dollar order book converted at USD/KRW ${rate} (${fxDate}). Snapshot ${snapshot}.`,
    subtitleNoData: 'No crypto price snapshot yet — run pnpm refresh.',
    weightedPremium: 'Weighted Premium',
    weightedPremiumInfo:
      'KRW-venue crypto premium weighted by the value of held KRW-venue positions. Use this as the headline premium exposure signal.',
    premiumHeadline: 'Premium headline',
    weightedHint: 'Across KRW-venue holdings, weighted by value',
    premiumBearingValue: 'Premium-Bearing Value',
    premiumBearingHint: 'KRW-venue positions marked at their own book',
    valueFromPremium: 'Value From Premium',
    valueFromPremiumHint: 'What parity would remove',
    coinsCompared: 'Coins Compared',
    readOrder: 'Premium Read Order',
    readOrderInfo: 'Start with weighted exposure, then check premium-bearing value and coin-level rows.',
    threshold: 'Threshold',
    thresholdHint: 'Notable premium threshold',
    coverage: 'Coverage',
    coverageHint: 'Available premium history',
    byCoin: 'Current premium by coin',
    whatThisMeasures: 'What this measures',
    history: 'Premium history',
    nearParity: 'Near parity',
    noPairs: 'No coin is quoted on both a KRW and a USD book — nothing to compare.',
    noHistory: 'No overlapping history — run pnpm refresh.',
    axisLabel: 'Premium %',
    notableBadge: (count: string, pct: string) => `${count} coin(s) beyond ±${pct}%`,
    withHistoryHint: (count: string) => `${count} with history`,
    readOrderNote: 'Portfolio totals use each venue price; this page isolates the hidden venue premium risk.',
    notHeldBadge: 'not held in KRW',
    tableFootnote:
      'Implied KRW is the dollar price at the FX snapshot above. A coin quoted on only one of the two books cannot be compared and is absent rather than shown at zero.',
    measures: {
      valuation:
        "Each venue's holding is valued at that venue's own order book, so the premium never distorts the portfolio total. The cost of that choice is that the exposure becomes invisible everywhere else — this page is where it is visible.",
      riskLead:
        'It is a second way to lose money on a Bithumb position: the coin can be flat in dollars and still fall in won if the premium compresses.',
      riskTail: "is what that would cost at today's prices.",
      timing:
        "Both legs are read at the same instant — Bithumb's daily candle closes at 00:00 KST, and the dollar close is taken at that same 15:00 UTC rather than at the end of the UTC day. Comparing the two daily closes instead charges every overnight move to the premium.",
    },
    historyInfo: (start: string, end: string) =>
      `${start} to ${end} — the window is limited by how far Bithumb's candlestick endpoint reaches, not by choice.`,
    columns: {
      coin: 'Coin',
      krwVenue: 'Bithumb (KRW)',
      globalVenue: 'Global (USD)',
      impliedKrw: 'Implied KRW',
      premium: 'Premium',
      held: 'Held',
      valueFromPremium: 'Value From Premium',
    },
  },
  ko: {
    title: '코리아 프리미엄',
    emphasis: '프리미엄',
    subtitleWithData: (rate: string, fxDate: string, snapshot: string) =>
      `원화 호가를 USD/KRW ${rate}(${fxDate})로 환산한 달러 호가와 비교합니다. 스냅샷 ${snapshot}.`,
    subtitleNoData: '아직 가상자산 시세 스냅샷이 없습니다 — pnpm refresh를 실행하세요.',
    weightedPremium: '가중 프리미엄',
    weightedPremiumInfo:
      '보유 중인 원화 거래소 포지션의 평가금액으로 가중한 프리미엄입니다. 프리미엄 노출을 보는 대표 지표로 쓰세요.',
    premiumHeadline: '프리미엄 대표값',
    weightedHint: '원화 거래소 보유분 전체를 평가금액으로 가중',
    premiumBearingValue: '프리미엄 적용 금액',
    premiumBearingHint: '각 거래소 자체 호가로 평가한 원화 거래소 포지션',
    valueFromPremium: '프리미엄 기여분',
    valueFromPremiumHint: '가격이 같아지면 사라지는 금액',
    coinsCompared: '비교된 코인',
    readOrder: '프리미엄 읽는 순서',
    readOrderInfo: '가중 노출을 먼저 보고, 프리미엄 적용 금액과 코인별 행을 확인하세요.',
    threshold: '기준선',
    thresholdHint: '주목할 프리미엄 기준',
    coverage: '이력 범위',
    coverageHint: '확보된 프리미엄 이력',
    byCoin: '코인별 현재 프리미엄',
    whatThisMeasures: '이 지표의 의미',
    history: '프리미엄 추이',
    nearParity: '가격 차 거의 없음',
    noPairs: '원화·달러 양쪽에 호가가 있는 코인이 없어 비교할 대상이 없습니다.',
    noHistory: '겹치는 이력이 없습니다 — pnpm refresh를 실행하세요.',
    axisLabel: '프리미엄 %',
    notableBadge: (count: string, pct: string) => `±${pct}% 초과 코인 ${count}개`,
    withHistoryHint: (count: string) => `이력 있음 ${count}개`,
    readOrderNote: '포트폴리오 합계는 거래소별 가격을 쓰고, 이 페이지는 그 안에 숨은 거래소 프리미엄 위험만 따로 보여줍니다.',
    notHeldBadge: '원화 거래소 미보유',
    tableFootnote:
      '환산 원화는 위 환율 스냅샷으로 달러 가격을 환산한 값입니다. 두 호가 중 한쪽에만 있는 코인은 비교할 수 없으므로 0으로 표시하지 않고 제외합니다.',
    measures: {
      valuation:
        '각 거래소의 보유분은 그 거래소 자체 호가로 평가하므로 프리미엄이 포트폴리오 합계를 왜곡하지 않습니다. 대신 그 노출은 다른 화면에서는 보이지 않으며, 이 페이지에서만 드러납니다.',
      riskLead:
        '빗썸 포지션에서 돈을 잃는 두 번째 경로입니다. 코인 가격이 달러 기준으로 그대로여도 프리미엄이 줄면 원화 기준으로는 떨어질 수 있습니다.',
      riskTail: '은(는) 오늘 가격 기준으로 그 경우 잃게 될 금액입니다.',
      timing:
        '두 가격은 같은 시점에 읽습니다 — 빗썸 일봉은 한국 시간 0시에 마감하고, 달러 종가도 같은 시각(협정 세계시 15시)에 잡으며 협정 세계시 하루 끝에 잡지 않습니다. 두 일봉 종가를 그대로 비교하면 밤사이 변동이 모두 프리미엄으로 잡힙니다.',
    },
    historyInfo: (start: string, end: string) =>
      `${start}부터 ${end}까지 — 이 기간은 임의로 정한 것이 아니라 빗썸 캔들 데이터가 제공하는 범위에 따른 것입니다.`,
    columns: {
      coin: '코인',
      krwVenue: '빗썸 (원화)',
      globalVenue: '해외 (달러)',
      impliedKrw: '환산 원화',
      premium: '프리미엄',
      held: '보유량',
      valueFromPremium: '프리미엄 기여분',
    },
  },
})
