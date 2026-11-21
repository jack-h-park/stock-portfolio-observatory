import { EMPTY_VALUE } from '@/lib/format'

/** Mirrors the SNAPSHOT_PRICE_DATES freshness detail in lib/adapters/portfolio-db.ts. */
type SnapshotPriceDates = { market: 'KR' | 'US' | 'CRYPTO'; newest: string; oldest: string | null }[]

/**
 * A dividends row's `income_category`: what the ingest's defaultIncomeCategory
 * writes, plus `unknown`, the adapter's name for a row without one. A category
 * a manual mapping invents shows raw.
 */
export const INCOME_CATEGORIES = ['dividend', 'interest', 'stock_lending', 'other', 'unknown'] as const
export type IncomeCategoryCode = (typeof INCOME_CATEGORIES)[number]

export const UI_COPY_BY_LANG = {
  en: {
    common: {
      all: 'All',
      breadcrumb: 'Breadcrumb',
      search: 'Search',
      sort: 'Sort',
      market: 'Market',
      brokerage: 'Broker',
      account: 'Account',
      status: 'Status',
      details: 'Details',
      operatorDetails: 'Operator details',
      clearFilters: 'Clear filters',
      tickerFilter: (ticker: string) => `Ticker: ${ticker}`,
      removeTickerFilter: (ticker: string) => `Remove ticker filter: ${ticker}`,
      filters: 'Filters',
      noValue: EMPTY_VALUE,
      noRows: 'No rows to display.',
      loading: 'Loading',
      help: 'Show explanation',
      helpFor: (label: string) => `${label} explanation`,
      closeHelp: 'Press Esc to close.',
      notRecorded: 'Not recorded',
      elapsed: 'elapsed',
      skipToContent: 'Skip to main content',
      issueCount: (count: string) => `${count} to review`,
      /** A count that is a lower bound: the source list stopped at its cap. */
      countAtLeast: (count: string) => `${count}+`,
      appDescription: 'Assets, cash flow and KR/US tax history with private local evidence.',
      privateAccess: {
        title: 'Approved owner devices only',
        description:
          'This website, including assets, taxes and evidence, is limited to approved owner devices on Tailscale. New or re-enrolled devices require review. No SSH tunnel is needed for normal browser access.',
      },
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
      snapshotLabels: {
        kr_prices: 'KR prices',
        us_prices: 'US prices',
        crypto_prices: 'Crypto prices',
        fx_rates: 'USD/KRW FX',
        snapshot_prices: 'Prices in figures',
      },
      detail: {
        PRICE_SNAPSHOT: ({ count, marketDate }: { count: number; marketDate: string | null }) =>
          `${count} prices · market date ${marketDate ?? 'unknown'}`,
        CRYPTO_SNAPSHOT: ({ count, quotes }: { count: number; quotes: string[] }) =>
          `${count} prices · ${quotes.join(', ') || 'none'}`,
        FX_RATE: ({ rate, source }: { rate: number; source: string }) => `${rate} · ${source}`,
        FX_RATE_MISSING: () => 'No FX rate configured.',
        SOURCE_MISSING: () => 'Source file is missing from disk.',
        SOURCE_CHANGED: ({ recordedBytes, currentBytes }: { recordedBytes: number; currentBytes: number }) =>
          `Changed since ingest. Recorded ${recordedBytes} bytes; current ${currentBytes} bytes.`,
        SOURCE_MTIME_ONLY: () => 'Content matches the SHA-256 captured at ingest; only modified time changed.',
        SOURCE_MATCHES: () => 'Matches the content fingerprint captured at ingest.',
        SNAPSHOT_PRICE_DATES: ({ markets }: { markets: SnapshotPriceDates }) =>
          `market date ${markets
            .map(({ market, newest, oldest }) => `${({ KR: 'KR', US: 'US', CRYPTO: 'Crypto' } as const)[market]} ${newest}${oldest ? ` (oldest ${oldest})` : ''}`)
            .join(' · ')}`,
      },
    },
    devCopy: {
      label: 'Development copy',
      ingested: (date: string) => `DB ingested ${date}`,
      age: (days: number) => `${days} days ago`,
      unknown: 'ingest time not recorded',
      description:
        'This dev server reads a local database that nothing refreshes. It is not the production database. Run `make pull-prod-db` to copy the current one from the host.',
    },
    priority: {
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
    /**
     * A transaction row's type. The keys are the types the ingest accepts (its
     * `transaction_types_mapped` check in scripts/ingest-stock-data.mjs); read
     * with `labelFor(transactionTypes, type)` from lib/ui-copy/label.ts, so a
     * new type still shows.
     */
    transactionTypes: {
      BUY: 'Buy',
      SELL: 'Sell',
      DIVIDEND: 'Dividend',
      INTEREST: 'Interest',
      REINVEST: 'Reinvestment',
      TRANSFER_IN: 'Transfer in',
      TRANSFER_OUT: 'Transfer out',
      CASH_SWEEP: 'Cash sweep',
      JOURNAL: 'Journal',
      STOCK_SPLIT: 'Stock split',
      STOCK_LENDING_INCOME: 'Stock lending income',
      OTHER_INCOME: 'Other income',
      INTERNAL_TRANSFER: 'Internal transfer',
      CORPORATE_ACTION: 'Corporate action',
      FEE: 'Fee',
      STAKING_REWARD: 'Staking reward',
      SHARE_REWARD: 'Share reward',
      DEPOSIT: 'Deposit',
      TRUST_OUT: 'Trust transfer',
    } as Record<string, string>,
    /** Read with `labelFor(incomeCategories, category)` (lib/ui-copy/label.ts): manual mappings can write any category. */
    incomeCategories: {
      dividend: 'dividend',
      interest: 'interest',
      stock_lending: 'stock_lending',
      other: 'other',
      unknown: 'unknown',
    } satisfies Record<IncomeCategoryCode, string>,
    runStatus: {
      success: 'Complete',
      failed: 'Failed',
      degraded: 'Degraded',
      running: 'Running',
      pass: 'Pass',
    },
    error: {
      title: 'This page could not be built',
      body: 'The page asked the local database for something it could not answer. The rest of the dashboard is unaffected — the data itself has not changed.',
      retry: 'Try again',
      home: 'Back to overview',
      reference: 'Reference',
      notFoundTitle: 'No such page',
      notFoundBody: 'That address does not match any screen in this dashboard.',
    },
    autoRefresh: {
      offline: 'Offline',
      lastChecked: 'last checked',
      refreshing: 'Refreshing...',
      lastRefresh: 'Last refresh',
      auto: (seconds: number) => `Auto-refresh every ${seconds}s`,
      paused: 'Auto-refresh paused',
      pausedSince: (clock: string) => `Auto-refresh paused · showing ${clock}`,
      pause: 'Pause auto-refresh',
      resume: 'Resume auto-refresh',
      refreshNow: 'Refresh now',
    },
    form: {
      saving: 'Saving…',
      saved: 'Saved',
      confirm: 'Press again to confirm',
      nameRequired: 'A plan needs a name before it can be saved.',
    },
  },
  ko: {
    common: {
      all: '전체',
      breadcrumb: '현재 위치',
      search: '검색',
      sort: '정렬',
      market: '시장',
      brokerage: '증권사',
      account: '계좌',
      status: '상태',
      details: '상세 보기',
      operatorDetails: '운영 정보',
      clearFilters: '필터 초기화',
      tickerFilter: (ticker: string) => `종목: ${ticker}`,
      removeTickerFilter: (ticker: string) => `종목 필터 해제: ${ticker}`,
      filters: '필터',
      noValue: EMPTY_VALUE,
      noRows: '표시할 데이터가 없습니다.',
      loading: '불러오는 중',
      help: '설명 보기',
      helpFor: (label: string) => `${label} 설명`,
      closeHelp: 'Esc 키를 누르면 닫힙니다.',
      notRecorded: '기록 없음',
      elapsed: '경과',
      skipToContent: '본문으로 바로가기',
      issueCount: (count: string) => `확인 ${count}건`,
      countAtLeast: (count: string) => `${count}+`,
      appDescription: '자산, 현금 흐름, 한·미 세금 이력을 비공개 로컬 증빙과 함께 봅니다.',
      privateAccess: {
        title: '승인된 본인 기기만 접근 가능',
        description:
          '이 웹사이트의 자산·세금·증빙은 Tailscale에서 승인된 본인 기기에서만 볼 수 있습니다. 새 기기나 재등록한 기기는 접근 검토가 필요합니다. SSH 연결 없이 브라우저로 이용할 수 있습니다.',
      },
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
      snapshotLabels: {
        kr_prices: '한국 주식 시세',
        us_prices: '미국 주식 시세',
        crypto_prices: '가상자산 시세',
        fx_rates: 'USD/KRW 환율',
        snapshot_prices: '수치에 쓰인 시세',
      },
      detail: {
        PRICE_SNAPSHOT: ({ count, marketDate }: { count: number; marketDate: string | null }) =>
          `시세 ${count}건 · 시장 기준일 ${marketDate ?? '미확인'}`,
        CRYPTO_SNAPSHOT: ({ count, quotes }: { count: number; quotes: string[] }) =>
          `시세 ${count}건 · ${quotes.join(', ') || '없음'}`,
        FX_RATE: ({ rate, source }: { rate: number; source: string }) => `${rate} · ${source}`,
        FX_RATE_MISSING: () => '환율이 설정되지 않았습니다.',
        SOURCE_MISSING: () => '원본 파일이 디스크에 없습니다.',
        SOURCE_CHANGED: ({ recordedBytes, currentBytes }: { recordedBytes: number; currentBytes: number }) =>
          `적재 이후 변경되었습니다. 기록된 크기 ${recordedBytes}바이트, 현재 ${currentBytes}바이트.`,
        SOURCE_MTIME_ONLY: () => '내용은 적재 시 기록한 SHA-256과 일치하며 수정 시각만 바뀌었습니다.',
        SOURCE_MATCHES: () => '적재 시 기록한 내용 지문과 일치합니다.',
        SNAPSHOT_PRICE_DATES: ({ markets }: { markets: SnapshotPriceDates }) =>
          `시장 기준일 ${markets
            .map(({ market, newest, oldest }) => `${({ KR: '한국', US: '미국', CRYPTO: '가상자산' } as const)[market]} ${newest}${oldest ? ` (가장 오래된 시세 ${oldest})` : ''}`)
            .join(' · ')}`,
      },
    },
    devCopy: {
      label: '개발 사본',
      ingested: (date: string) => `DB 적재 ${date}`,
      age: (days: number) => `${days}일 전`,
      unknown: '적재 시각 기록 없음',
      description:
        '이 개발 서버는 아무것도 갱신하지 않는 로컬 데이터베이스를 읽습니다. 운영 데이터베이스가 아닙니다. 최신본은 `make pull-prod-db`로 호스트에서 복사합니다.',
    },
    priority: {
      high: '높음',
      medium: '보통',
      low: '낮음',
    },
    transactionTypes: {
      BUY: '매수',
      SELL: '매도',
      DIVIDEND: '배당',
      INTEREST: '이자',
      REINVEST: '배당 재투자',
      TRANSFER_IN: '이체 입금',
      TRANSFER_OUT: '이체 출금',
      CASH_SWEEP: '현금 자동 이체',
      JOURNAL: '대체',
      STOCK_SPLIT: '주식 분할',
      STOCK_LENDING_INCOME: '주식 대여 수익',
      OTHER_INCOME: '기타 수입',
      INTERNAL_TRANSFER: '내부 이체',
      CORPORATE_ACTION: '기업 이벤트',
      FEE: '수수료',
      STAKING_REWARD: '스테이킹 보상',
      SHARE_REWARD: '주식 보상',
      DEPOSIT: '납입',
      TRUST_OUT: '신탁 상품 이동',
    } as Record<string, string>,
    incomeCategories: {
      dividend: '배당',
      interest: '이자',
      stock_lending: '주식 대여 수익',
      other: '기타',
      unknown: '미분류',
    } satisfies Record<IncomeCategoryCode, string>,
    runStatus: {
      success: '완료',
      failed: '실패',
      degraded: '일부 기능 저하',
      running: '진행 중',
      pass: '통과',
    },
    error: {
      title: '이 페이지를 만들 수 없었습니다',
      body: '페이지가 로컬 데이터베이스에 요청한 내용을 처리하지 못했습니다. 대시보드의 나머지는 영향을 받지 않으며, 데이터 자체는 그대로입니다.',
      retry: '다시 시도',
      home: '개요로 돌아가기',
      reference: '참조 번호',
      notFoundTitle: '없는 페이지입니다',
      notFoundBody: '이 주소에 해당하는 화면이 대시보드에 없습니다.',
    },
    autoRefresh: {
      offline: '오프라인',
      lastChecked: '마지막 확인',
      refreshing: '갱신 중...',
      lastRefresh: '마지막 갱신',
      auto: (seconds: number) => `${seconds}초마다 자동 갱신`,
      paused: '자동 갱신 멈춤',
      pausedSince: (clock: string) => `자동 갱신 멈춤 · ${clock} 기준`,
      pause: '자동 갱신 멈추기',
      resume: '자동 갱신 다시 시작',
      refreshNow: '지금 갱신',
    },
    form: {
      saving: '저장 중…',
      saved: '저장됨',
      confirm: '한 번 더 누르면 확정',
      nameRequired: '계획을 저장하려면 이름이 필요합니다.',
    },
  },
} as const
