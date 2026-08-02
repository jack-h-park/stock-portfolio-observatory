export const COMMON_LABELS = {
  all: '전체',
  search: '검색',
  sort: '정렬',
  market: '시장',
  brokerage: '증권사',
  account: '계좌',
  status: '상태',
  details: '상세 보기',
  clearFilters: '필터 초기화',
  noValue: '값 없음',
} as const

export const FRESHNESS_LABELS = {
  fresh: '최신',
  stale: '갱신 필요',
  drift: '원본 변경',
  missing: '데이터 없음',
} as const

export const FRESHNESS_DESCRIPTIONS = {
  fresh: '정해진 갱신 주기 안에 수집된 데이터입니다.',
  stale: '마지막 수집 후 시간이 지나 새로고침이 필요합니다.',
  drift: '원본 데이터가 이전과 달라져 확인이 필요합니다.',
  missing: '아직 수집되지 않았거나 사용할 수 없는 데이터입니다.',
} as const

export const PRIORITY_LABELS: Record<string, string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
}

export const RUN_STATUS_LABELS: Record<string, string> = {
  success: '완료',
  failed: '실패',
  degraded: '일부 기능 저하',
  running: '진행 중',
  pass: '통과',
}
