import { defineCopy } from '@/lib/ui-copy/define'

/**
 * /health was the page the copy registry never reached.
 *
 * P2 recorded "Korean for every page" as finished, but this one had no copy
 * module at all and never called getPageCopy — every string was written inline
 * in English, so a Korean reader got an English page with Korean navigation
 * around it.
 *
 * The title also changes here. The sidebar calls this route "System Health"
 * while the heading said "Data Health", so the name you clicked was not the
 * name you arrived at. The sidebar wins, and "System Health" with the eyebrow
 * "System" matches what every other page does — the eyebrow repeats the
 * heading's first word.
 */
export const health = defineCopy({
  en: {
    title: 'System Health',
    emphasis: 'Health',
    subtitle: (checkedAt: string) => `The latest data check ran at ${checkedAt}.`,
    needsReview: (count: string) => `Needs review ${count}`,
    allChecksPassed: 'All checks passed',

    accountCoverage: 'Account coverage',
    accountCoverageInfo: "How far each brokerage account's source data reaches. This is separate from file integrity.",
    openUpdates: 'Open updates',
    actionNeeded: 'Action needed',
    dueSoon: 'Due soon',
    current: 'Current',
    accountCoverageNote:
      'The account table names the exact document, account, cutoff date, and destination path. “Fresh” below continues to mean file integrity.',

    operationalStatus: 'Operational Status',
    operationalStatusInfo:
      'Shows whether prices, FX rates, and source files are collected normally and agree with each other.',
    stalenessNote:
      'Korean and US stock prices are marked stale after 36 hours, crypto after 8 hours, and FX after 7 days. Source files are marked changed when their size or modified time differs from ingestion.',

    priceFxFreshness: 'Price & FX Freshness',

    reconciliationCoverage: 'Reconciliation Coverage',
    reconciliationCoverageInfo:
      "Whether each brokerage's holding summary agrees with its tax-lot records in the latest ingest. Breaks are counted per position; the Reconciliation page lists them.",
    openReconciliation: 'Open reconciliation',
    nothingToReconcile: 'No holdings or tax lots to reconcile',
    holdingsVsLots: (brokerage: string) => `${brokerage} holdings ↔ tax lots`,
    /** Quoted verbatim inside merrillNote — the two must stay in step. */
    noLotDetail: 'No lot detail',
    matched: 'Matched',
    breaks: (count: number, capped: boolean) => `${count}${capped ? '+' : ''} ${count === 1 && !capped ? 'break' : 'breaks'}`,
    merrillNote:
      'Merrill exports positions under two layouts, and only one carries tax-lot detail. When the flat layout was the last download, its lots drop out of the ingest and the row above reads “No lot detail” until the tax-lot view is exported again. Its reinvestments also arrive as one dateless grouped lot per position, so the match is by quantity and cost, not by acquisition date.',

    refreshHistory: 'Refresh History',
    noRefreshRuns: 'No refresh runs recorded',
    refreshRunsHint: (path: string) => `Run history is read from ${path}.`,
    latestStart: 'Latest start',
    duration: 'Duration',
    completedSteps: 'Completed steps',
    totalRuns: 'Total runs',
    degradedLead: 'Degraded, not failed.',
    /**
     * Built as one sentence rather than assembled from fragments in the page.
     * The English needs plural agreement in three places ("are"/"is", "those
     * steps is"/"that step is"), and Korean needs none of them — splitting it
     * across the JSX would have forced Korean to carry English's grammar.
     *
     * It takes the step names as a list, not a joined string, so each language
     * derives what it needs from one argument: English reads the length for
     * agreement, Korean only joins.
     */
    degradedBody: (steps: string[]) =>
      `${steps.join(', ')} failed but ${steps.length > 1 ? 'are' : 'is'} marked optional, so the run continued and every figure is complete. The source behind ${steps.length > 1 ? 'those steps is' : 'that step is'} running on its previous snapshot — the freshness rows above say how old.`,
    exitCode: (code: string) => `exit ${code}`,
    latestErrorTail: 'Latest error tail',

    fxSnapshot: 'FX snapshot',
    asOf: 'As of',
    noFxRate: 'No FX rate configured',

    freshnessIssues: 'Freshness issues',
    noFreshnessIssues: 'No stale, drifted, or missing operational inputs',

    validationChecks: 'Validation checks',
    noChecks: 'No checks found',

    pdfEvidence: 'PDF evidence',
    noPdfEvidence: 'No PDF evidence extracted',
    gainLoss: 'Gain/Loss',
    pages: (count: string) => `${count} pages`,
    rows: (count: string) => `${count} rows`,
    taxCost: (amount: string) => `${amount} tax cost`,
  },
  ko: {
    title: '시스템 상태',
    emphasis: '상태',
    subtitle: (checkedAt: string) => `가장 최근 데이터 점검은 ${checkedAt}에 실행됐습니다.`,
    needsReview: (count: string) => `검토 필요 ${count}`,
    allChecksPassed: '모든 점검 통과',

    accountCoverage: '계좌 커버리지',
    accountCoverageInfo: '증권사 계좌별로 원본 데이터가 어디까지 들어왔는지 봅니다. 파일 무결성과는 별개입니다.',
    openUpdates: '업데이트 열기',
    actionNeeded: '조치 필요',
    dueSoon: '기한 임박',
    current: '최신',
    accountCoverageNote:
      '계좌 표에는 해당 문서, 계좌, 기준일, 저장 경로가 그대로 적혀 있습니다. 아래의 “최신”은 여전히 파일 무결성을 뜻합니다.',

    operationalStatus: '운영 상태',
    operationalStatusInfo: '가격·환율·원본 파일이 정상적으로 수집되고 서로 일치하는지 보여줍니다.',
    stalenessNote:
      '한국·미국 주식 가격은 36시간, 암호화폐는 8시간, 환율은 7일이 지나면 오래된 것으로 표시합니다. 원본 파일은 크기나 수정 시각이 수집 당시와 다르면 변경된 것으로 표시합니다.',

    priceFxFreshness: '가격·환율 최신성',

    reconciliationCoverage: '대조 커버리지',
    reconciliationCoverageInfo:
      '최근 수집분에서 증권사별 보유 요약이 세금 계산 단위 기록과 일치하는지 봅니다. 불일치는 종목 단위로 세며, 목록은 대조 페이지에 있습니다.',
    openReconciliation: '대조 열기',
    nothingToReconcile: '대조할 보유종목이나 세금 계산 단위가 없습니다.',
    holdingsVsLots: (brokerage: string) => `${brokerage} 보유 ↔ 세금 계산 단위`,
    noLotDetail: '계산 단위 없음',
    matched: '일치',
    breaks: (count: number, capped: boolean) => `불일치 ${count}${capped ? '+' : ''}건`,
    merrillNote:
      'Merrill은 보유 내역을 두 가지 형식으로 내보내는데, 세금 계산 단위 정보가 담긴 쪽은 하나뿐입니다. 마지막 다운로드가 평면 형식이었다면 계산 단위가 수집에서 빠지고, 세금 계산 단위 화면을 다시 내보낼 때까지 위 행에는 “계산 단위 없음”이 표시됩니다. 재투자분도 종목당 날짜 없는 묶음 하나로 들어오기 때문에, 대조는 취득일이 아니라 수량과 원가로 맞춥니다.',

    refreshHistory: '갱신 이력',
    noRefreshRuns: '기록된 갱신 실행이 없습니다.',
    refreshRunsHint: (path: string) => `실행 이력은 ${path}에서 읽습니다.`,
    latestStart: '최근 시작',
    duration: '소요 시간',
    completedSteps: '완료 단계',
    totalRuns: '전체 실행',
    degradedLead: '실패가 아니라 성능 저하입니다.',
    degradedBody: (steps: string[]) =>
      `${steps.join(', ')}이(가) 실패했지만 선택 단계로 표시돼 있어 실행은 계속됐고 모든 수치는 완전합니다. 해당 단계의 원본은 직전 스냅샷으로 동작 중이며, 얼마나 오래됐는지는 위의 최신성 행에 나와 있습니다.`,
    exitCode: (code: string) => `종료 코드 ${code}`,
    latestErrorTail: '최근 오류 로그',

    fxSnapshot: '환율 스냅샷',
    asOf: '기준일',
    noFxRate: '설정된 환율이 없습니다.',

    freshnessIssues: '최신성 이슈',
    noFreshnessIssues: '오래되거나 변경되거나 누락된 운영 입력이 없습니다.',

    validationChecks: '검증 점검',
    noChecks: '점검 항목이 없습니다.',

    pdfEvidence: 'PDF 근거',
    noPdfEvidence: '추출된 PDF 근거가 없습니다.',
    gainLoss: '양도손익',
    pages: (count: string) => `${count}쪽`,
    rows: (count: string) => `${count}행`,
    taxCost: (amount: string) => `취득원가 ${amount}`,
  },
})
