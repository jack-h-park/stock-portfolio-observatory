import type { Language } from '@/lib/i18n'

export const UI_COPY_BY_LANG = {
  en: {
    common: {
      all: 'All',
      search: 'Search',
      sort: 'Sort',
      market: 'Market',
      brokerage: 'Broker',
      account: 'Account',
      status: 'Status',
      details: 'Details',
      clearFilters: 'Clear filters',
      noValue: 'No value',
      noRows: 'No rows to display.',
      help: 'Show explanation',
      helpFor: (label: string) => `${label} explanation`,
      closeHelp: 'Press Esc to close.',
      notRecorded: 'Not recorded',
      elapsed: 'elapsed',
    },
    freshness: {
      labels: {
        fresh: 'Fresh',
        stale: 'Needs refresh',
        drift: 'Source changed',
        missing: 'No data',
      },
      descriptions: {
        fresh: 'Collected within the expected refresh window.',
        stale: 'The last collection is old enough to need a refresh.',
        drift: 'The source file changed after ingestion and needs review.',
        missing: 'The data has not been collected or is unavailable.',
      },
    },
    priority: {
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
    runStatus: {
      success: 'Complete',
      failed: 'Failed',
      degraded: 'Degraded',
      running: 'Running',
      pass: 'Pass',
    },
  },
  ko: {
    common: {
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
      noRows: '표시할 데이터가 없습니다.',
      help: '설명 보기',
      helpFor: (label: string) => `${label} 설명`,
      closeHelp: 'Esc 키를 누르면 닫힙니다.',
      notRecorded: '기록 없음',
      elapsed: '경과',
    },
    freshness: {
      labels: {
        fresh: '최신',
        stale: '갱신 필요',
        drift: '원본 변경',
        missing: '데이터 없음',
      },
      descriptions: {
        fresh: '정해진 갱신 주기 안에 수집된 데이터입니다.',
        stale: '마지막 수집 후 시간이 지나 새로고침이 필요합니다.',
        drift: '원본 데이터가 이전과 달라져 확인이 필요합니다.',
        missing: '아직 수집되지 않았거나 사용할 수 없는 데이터입니다.',
      },
    },
    priority: {
      high: '높음',
      medium: '보통',
      low: '낮음',
    },
    runStatus: {
      success: '완료',
      failed: '실패',
      degraded: '일부 기능 저하',
      running: '진행 중',
      pass: '통과',
    },
  },
} as const

export function getUiCopy(language: Language = 'en') {
  return UI_COPY_BY_LANG[language]
}

export const COMMON_LABELS = UI_COPY_BY_LANG.en.common
export const FRESHNESS_LABELS = UI_COPY_BY_LANG.en.freshness.labels
export const FRESHNESS_DESCRIPTIONS = UI_COPY_BY_LANG.en.freshness.descriptions
export const PRIORITY_LABELS: Record<string, string> = UI_COPY_BY_LANG.en.priority
export const RUN_STATUS_LABELS: Record<string, string> = UI_COPY_BY_LANG.en.runStatus
