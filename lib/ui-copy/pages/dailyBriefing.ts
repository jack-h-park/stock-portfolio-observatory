import type { BriefingActivity, BriefingSessionMove } from '@/lib/adapters/briefing-archive'
import { defineCopy } from '@/lib/ui-copy/define'

/*
 * The session-panel wording lives here, in both languages, so it can be
 * exercised directly. The briefing repo settled these sentences after getting
 * them wrong in a way that mattered, and a page component that only reads right
 * under review is not evidence.
 *
 * The raw `kind` slugs are compared here, above the Korean half, so the Korean
 * implementations carry no English string literal of their own.
 */
type Fmt = (n: number, digits: number) => string
type MoverNotes = Record<string, { why: string }>

const isRestatement = (a: BriefingActivity) => a.kind === 'split'
const isClosed = (a: BriefingActivity) => a.kind === 'closed'

const TRADE_VERB: Record<string, string> = { bought: 'Bought', sold: 'Sold', opened: 'Opened', closed: 'Closed' }
const KO_TRADE_VERB: Record<string, string> = { bought: '매수', sold: '매도', opened: '신규 매수', closed: '전량 매도' }
const KO_BADGE: Record<string, string> = { bought: '매수', sold: '매도', opened: '신규', closed: '청산', split: '정정' }

function shares(quantity: number, fmt: Fmt) {
  const n = Math.abs(quantity)
  return `${fmt(n, 4)} share${n === 1 ? '' : 's'}`
}

export const dailyBriefing = defineCopy({
  en: {
    title: "Today's Briefing",
    emphasis: 'Briefing',
    subtitle: 'Archived daily briefings, published each trading morning.',
    briefingDate: 'Briefing date',
    view: 'View',
    latest: 'Latest',
    latestSuffix: 'latest',
    costShort: 'Cost',
    archived: 'Archived',
    sessionReturn: 'Session Return',
    sessionPlInfo:
      'Price movement on the shares already held, measured against the previous archived snapshot. Shares bought or sold since then are excluded, so this is the market move and not the effect of trading.',
    sessionPl: 'Session P/L',
    dailyMove: 'Daily move',
    standingSnapshot: 'Standing snapshot',
    portfolioValue: 'Portfolio Value',
    unrealized: 'Unrealized P/L',
    readOrder: 'Briefing Read Order',
    readOrderInfo: 'Use the daily move first, then standing value and cumulative unrealized performance.',
    market: 'Market',
    costBasis: 'Cost Basis',
    standingVsCost: 'Standing versus purchase cost',
    cumulativeNote: 'cumulative since purchase — moves slowly',
    gainers: 'Session gainers',
    decliners: 'Session decliners',
    bestVsCost: 'Best vs cost',
    worstVsCost: 'Worst vs cost',
    largestPositions: 'Largest positions',
    marketContext: 'Market context',
    suggestedActions: 'Suggested actions to consider',
    documentBuilt: 'Document built',
    markets: 'Markets',
    archive: 'Archive',
    actNow: 'Act now',
    thisWeek: 'This week',
    fyi: 'FYI',
    noMovers: 'No movers in this briefing',
    noSessionMovesUp: 'No material moves up this session',
    noSessionMovesDown: 'No material moves down this session',
    noSnapshot: 'No holdings snapshot was retained for this briefing.',
    noPrices: 'The holdings sheet carried no usable prices on both sides of the comparison.',
    noNote: 'No note in this briefing.',
    unreadable: 'That briefing could not be read.',
    noArchive: 'No briefings archived yet.',
    noPriorSnapshot: 'No prior snapshot was available to compare against.',
    sessionZero: 'Session figures are therefore zero; the standing-versus-cost view below is unaffected.',
    olderBriefing: (date: string) => `Older briefing, ${date}`,
    newerBriefing: (date: string) => `Newer briefing, ${date}`,
    briefingRange: (count: number, from: string, to: string) =>
      `${count} briefing${count === 1 ? '' : 's'} · ${from} → ${to}`,
    archiveUnreadableHint: (dir: string) => `Archive directory ${dir} contains no readable briefing documents.`,
    archiveMissingHint: (dir: string) =>
      `Set STOCK_BRIEFING_ARCHIVE_DIR to the briefing archive path (currently ${dir}, which does not exist).`,
    docSubtitle: (dateLabel: string, built: string) => `${dateLabel} · built ${built}`,
    openPublished: 'Open published page ↗',
    narrativeOnlyHint:
      'Holdings snapshots were only retained from the archive rollout onward; earlier days kept the narrative alone.',
    narrativeOnly: (date: string) => `No portfolio numbers for ${date} — this briefing was archived narrative-only.`,
    bandSince: (date: string | null) => `price moves since ${date}`,
    bandDayOverDay: 'day-over-day comparison',
    marketClosed: (market: string, date: string | null) =>
      `Every tracked ${market} price matches ${date} — the market was closed, or the sheet has not re-priced.`,
    noComparison: (market: string) => `No day-over-day comparison for ${market} in this briefing.`,
    pricedHint: (covered: string, uncovered: number) =>
      `${covered} priced${uncovered ? `, ${uncovered} without prices` : ''}`,
    positionCount: (count: number) => `${count} positions`,
    priorValueHint: (amount: string) => `on ${amount} prior value`,
    unrealizedHint: (pct: string, cost: string) => `${pct} vs ${cost} cost`,
    reportingCurrency: (currency: string) => `${currency} reporting currency`,
    readOrderNote: 'Session figures answer today; portfolio value and unrealized P/L answer current standing.',
    sessionMoversInfo: (minAmount: string) =>
      `Ranked by price change since the previous snapshot, among positions worth at least ${minAmount}.`,
    activitySince: (date: string | null) => `Activity since ${date}`,
    activityNote:
      'Detected from share-count changes between snapshots — no trade feed is involved. Excluded from Session P/L, which measures price movement on the shares already held.',
    standingBand: (flag: string, market: string) => `${flag} ${market} — standing vs cost`,
    bestVsCostInfo: (minAmount: string) =>
      `Ranked by unrealized gain versus cost basis, among positions of at least ${minAmount}. Cumulative since purchase — not a one-day move.`,
    worstVsCostInfo: (minAmount: string) =>
      `Ranked by unrealized loss versus cost basis, among positions of at least ${minAmount}. Cumulative since purchase — not a one-day move.`,
    largestInfo:
      'Ranked by market value, not cost — a position down 60% is no longer a large exposure whatever was paid for it.',
    // The actions footnote: these fragments sit between the bold priority labels
    // the page renders. Each meaning carries its own leading separator, because
    // English needs a space after the label while a Korean particle attaches to
    // it directly.
    actionsLead: 'Ordered by how soon each item deserves attention:',
    actNowMeaning:
      ' means a dated catalyst makes deciding today materially better than waiting (at most one per briefing),',
    thisWeekMeaning: ' a decision due before a near-term event,',
    fyiMeaning: ' context with no action implied.',
    disclaimer: 'Generated commentary, informational only — not investment advice.',
    noMarkets: 'none',
    footer:
      'Read-only view of the briefing archive written by the daily briefing cron. The same documents are published to briefing.jackpark.me, so both surfaces always show the same numbers for a date. Figures are the snapshot taken on the briefing date and do not update, and each market is reported in its own currency — they are never summed.',
    /**
     * What a row in "Activity since <date>" says.
     *
     * A `split` is NOT a trade. The briefing flags a share count that moved while
     * total cost stood still — a split, a bonus issue, or the sheet correcting
     * itself — and giving it a trade verb would put "Split 3 shares" exactly where
     * "Bought 3 shares" used to be: the same claim about the reader's own behaviour,
     * reworded. So it states what is known and what it implies, and names the ratio
     * only when the briefing recognised one.
     */
    activityWording: (a: BriefingActivity, fmt: Fmt): string => {
      if (isRestatement(a)) {
        const named = a.ratioLabel ? ` ${a.ratioLabel}` : ''
        return `Share count restated${named} · now holding ${fmt(a.quantity, 4)} · cost basis unchanged, so this is not a purchase or sale.`
      }
      const verb = TRADE_VERB[a.kind] ?? a.kind
      const holding = isClosed(a) ? '' : ` · now holding ${fmt(a.quantity, 4)}`
      return `${verb} ${shares(a.quantityChange, fmt)}${holding}`
    },
    /** Badge text. `split` reads as "restated"; a raw `split` is trade vocabulary. */
    activityBadge: (a: BriefingActivity): string => (isRestatement(a) ? 'restated' : a.kind),
    /**
     * The paragraph beside a session mover.
     *
     * A move the briefing flagged as possibly a corporate action takes the caveat
     * INSTEAD of the researched note. That note was written to explain a fall; if
     * the fall may not have happened, explaining it is the wrong thing to show.
     */
    moverNote: (m: BriefingSessionMove, notes: MoverNotes): string => {
      if (m.suspectedRestatement) {
        return `A ${m.suspectedRestatement} split moves the price by exactly this factor, and the share count here has not changed. If that is what happened the loss is not real and the sheet needs the new count — the figure is left in the session total until it can be told apart from a fall.`
      }
      return notes[m.ticker]?.why ?? 'No researched note for this session move.'
    },
    columns: {
      ticker: 'Ticker',
      marketValue: 'Market Value',
      returnPct: 'Return',
      quantity: 'Qty',
      accounts: 'Accounts',
    },
  },
  ko: {
    title: '오늘의 브리핑',
    emphasis: '브리핑',
    subtitle: '거래일 아침마다 발행되어 보관된 일일 브리핑입니다.',
    briefingDate: '브리핑 날짜',
    view: '보기',
    latest: '최신',
    latestSuffix: '최신',
    costShort: '원가',
    archived: '보관됨',
    sessionReturn: '당일 수익률',
    sessionPlInfo: '이미 보유 중이던 주식의 가격 변동을, 직전에 보관된 스냅샷과 비교해 측정한 값입니다. 그 이후의 매수·매도는 제외하므로 매매의 효과가 아니라 시장의 움직임입니다.',
    sessionPl: '당일 손익',
    dailyMove: '당일 변동',
    standingSnapshot: '기준 스냅샷',
    portfolioValue: '포트폴리오 평가금액',
    unrealized: '평가손익',
    readOrder: '브리핑 읽는 순서',
    readOrderInfo: '당일 변동을 먼저 보고, 그다음 기준 평가금액과 누적 평가손익을 확인하세요.',
    market: '시장',
    costBasis: '취득원가',
    standingVsCost: '취득원가 대비 현재',
    cumulativeNote: '매수 이후 누적 — 천천히 움직입니다',
    gainers: '당일 상승',
    decliners: '당일 하락',
    bestVsCost: '원가 대비 최고',
    worstVsCost: '원가 대비 최저',
    largestPositions: '최대 보유',
    marketContext: '시장 상황',
    suggestedActions: '검토할 만한 조치',
    documentBuilt: '문서 생성',
    markets: '시장',
    archive: '보관함',
    actNow: '즉시',
    thisWeek: '이번 주',
    fyi: '참고',
    noMovers: '이 브리핑에는 변동 종목이 없습니다',
    noSessionMovesUp: '이번 세션에 눈에 띄게 오른 종목이 없습니다',
    noSessionMovesDown: '이번 세션에 눈에 띄게 내린 종목이 없습니다',
    noSnapshot: '이 브리핑에는 보유 스냅샷이 보관되지 않았습니다.',
    noPrices: '보유 시트에 비교 양쪽 모두 쓸 수 있는 가격이 없었습니다.',
    noNote: '이 브리핑에는 메모가 없습니다.',
    unreadable: '해당 브리핑을 읽을 수 없었습니다.',
    noArchive: '아직 보관된 브리핑이 없습니다.',
    noPriorSnapshot: '비교할 이전 스냅샷이 없었습니다.',
    sessionZero: '따라서 당일 수치는 0입니다. 아래의 원가 대비 현황은 영향을 받지 않습니다.',
    olderBriefing: (date: string) => `이전 브리핑, ${date}`,
    newerBriefing: (date: string) => `다음 브리핑, ${date}`,
    briefingRange: (count: number, from: string, to: string) => `브리핑 ${count}건 · ${from} → ${to}`,
    archiveUnreadableHint: (dir: string) => `보관 디렉터리 ${dir}에 읽을 수 있는 브리핑 문서가 없습니다.`,
    archiveMissingHint: (dir: string) =>
      `STOCK_BRIEFING_ARCHIVE_DIR를 브리핑 보관 경로로 설정하세요. 현재 값 ${dir}은(는) 존재하지 않습니다.`,
    docSubtitle: (dateLabel: string, built: string) => `${dateLabel} · ${built} 생성`,
    openPublished: '발행된 페이지 열기 ↗',
    narrativeOnlyHint: '보유 스냅샷은 보관 기능을 도입한 이후부터만 남아 있습니다. 그 이전 날짜는 서술만 보관했습니다.',
    narrativeOnly: (date: string) => `${date}의 포트폴리오 수치가 없습니다 — 이 브리핑은 서술만 보관되었습니다.`,
    bandSince: (date: string | null) => `${date} 이후 가격 변동`,
    bandDayOverDay: '전일 대비 비교',
    marketClosed: (market: string, date: string | null) =>
      `추적 중인 ${market} 가격이 모두 ${date}와 같습니다 — 휴장했거나 시트의 가격이 갱신되지 않았습니다.`,
    noComparison: (market: string) => `이 브리핑에는 ${market}의 전일 대비 비교가 없습니다.`,
    pricedHint: (covered: string, uncovered: number) =>
      `가격 반영 ${covered}개${uncovered ? `, 가격 없음 ${uncovered}개` : ''}`,
    positionCount: (count: number) => `보유종목 ${count}개`,
    priorValueHint: (amount: string) => `직전 평가금액 ${amount} 기준`,
    unrealizedHint: (pct: string, cost: string) => `취득원가 ${cost} 대비 ${pct}`,
    reportingCurrency: (currency: string) => `보고 통화 ${currency}`,
    readOrderNote: '당일 수치는 오늘의 변동을, 포트폴리오 평가금액과 평가손익은 현재 상태를 보여줍니다.',
    sessionMoversInfo: (minAmount: string) =>
      `평가금액 ${minAmount} 이상 종목 중, 직전 스냅샷 이후 가격 변동 순으로 정렬했습니다.`,
    activitySince: (date: string | null) => `${date} 이후 활동`,
    activityNote:
      '스냅샷 사이의 보유 수량 변화로 감지했으며, 거래 내역은 사용하지 않습니다. 이미 보유한 주식의 가격 변동만 측정하는 당일 손익에서는 제외됩니다.',
    standingBand: (flag: string, market: string) => `${flag} ${market} — 취득원가 대비 현황`,
    bestVsCostInfo: (minAmount: string) =>
      `${minAmount} 이상 종목 중 취득원가 대비 평가이익 순으로 정렬했습니다. 매수 이후 누적이며 하루 변동이 아닙니다.`,
    worstVsCostInfo: (minAmount: string) =>
      `${minAmount} 이상 종목 중 취득원가 대비 평가손실 순으로 정렬했습니다. 매수 이후 누적이며 하루 변동이 아닙니다.`,
    largestInfo: '취득원가가 아니라 평가금액 순입니다 — 60% 하락한 종목은 얼마에 샀든 더 이상 큰 노출이 아닙니다.',
    actionsLead: '얼마나 빨리 살펴봐야 하는지에 따라 정렬했습니다:',
    actNowMeaning: '는 날짜가 정해진 계기 때문에 오늘 결정하는 편이 기다리는 것보다 확실히 나은 경우(브리핑당 최대 1개),',
    thisWeekMeaning: '는 가까운 이벤트 전에 내려야 할 결정,',
    fyiMeaning: '은(는) 조치가 필요 없는 참고 맥락입니다.',
    disclaimer: '자동 생성된 해설로 정보 제공용이며, 투자 조언이 아닙니다.',
    noMarkets: '없음',
    footer:
      '일일 브리핑 예약 작업이 작성한 브리핑 보관함을 읽기 전용으로 보여줍니다. 같은 문서가 공개 브리핑 페이지에도 발행되므로 두 화면은 같은 날짜에 항상 같은 수치를 보여줍니다. 수치는 브리핑 날짜에 찍은 스냅샷이라 갱신되지 않으며, 각 시장은 자체 통화로 표시하고 합산하지 않습니다.',
    activityWording: (a: BriefingActivity, fmt: Fmt): string => {
      if (isRestatement(a)) {
        const named = a.ratioLabel ? ` (${a.ratioLabel})` : ''
        return `보유 수량 정정${named} · 현재 ${fmt(a.quantity, 4)}주 보유 · 취득원가가 그대로이므로 매수나 매도가 아닙니다.`
      }
      const verb = KO_TRADE_VERB[a.kind] ?? a.kind
      const traded = `${fmt(Math.abs(a.quantityChange), 4)}주 ${verb}`
      return isClosed(a) ? traded : `${traded} · 현재 ${fmt(a.quantity, 4)}주 보유`
    },
    activityBadge: (a: BriefingActivity): string => KO_BADGE[a.kind] ?? a.kind,
    moverNote: (m: BriefingSessionMove, notes: MoverNotes): string => {
      if (m.suspectedRestatement) {
        return `${m.suspectedRestatement} 분할이면 가격이 정확히 이 비율만큼 움직이는데, 여기서는 보유 수량이 바뀌지 않았습니다. 그런 경우라면 이 손실은 실제가 아니며 시트에 새 수량을 반영해야 합니다 — 하락과 구분할 수 있을 때까지 이 수치는 당일 합계에 남겨 둡니다.`
      }
      return notes[m.ticker]?.why ?? '이 세션 변동에 대한 조사 메모가 없습니다.'
    },
    columns: {
      ticker: '종목코드',
      marketValue: '평가금액',
      returnPct: '수익률',
      quantity: '수량',
      accounts: '계좌',
    },
  },
})
