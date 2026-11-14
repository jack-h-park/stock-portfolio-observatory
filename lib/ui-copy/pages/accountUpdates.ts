import { defineCopy } from '@/lib/ui-copy/define'

export const accountUpdates = defineCopy({
  en: {
    title: 'Bank, pension and gold updates',
    info: 'Includes bank/CMA (90-day window), pension (180 days) and gold sources. Closed accounts are excluded.',
    caption: 'Bank, CMA and supplementary updates',
    empty: 'No registered sources.',
    account: 'Account / source',
    range: 'Balance history period',
    coverage: 'Covered through',
    status: 'Status',
    next: 'Next download / action',
    closed: 'Closed account',
    closedAction: 'No further downloads · history retained',
    none: '—',
    rows: (count: string) => `${count} records`,
    window: (days: number) => `${days}-day window`,
    kinds: { deposit: 'Deposits', cma: 'CMA', pension: 'Pension', gold: 'Gold', gold_price: 'Gold price' },
    statuses: { unconfirmed: 'Confirm query period', action_needed: 'Update needed', missing: 'No data', due_soon: 'Due soon', current: 'Current' },
    action: (kind: string, date: string | null, original: string) => {
      if (!date && original.includes('조회 종료일')) return 'Confirm the query end date of the existing file before deciding whether to download again.'
      if (kind === 'gold_price') return 'Refresh KRX gold prices.'
      if (kind === 'pension') return 'Capture current holdings and file the pension CSV in inbox.'
      return date ? `Download history from ${date} and place it in inbox.` : 'Download the full available history and place it in inbox.'
    },
  },
  ko: {
    title: '은행·연금·금 자료 업데이트',
    info: '증권 계좌와 별도로 예금·CMA·연금·금 자료도 확인합니다. 은행·CMA는 90일, 연금은 180일 기준입니다. 종료 계좌는 업데이트 대상에서 제외합니다.',
    caption: '은행·CMA 및 추가 자료 업데이트',
    empty: '등록된 자료가 없습니다.',
    account: '계좌·자료',
    range: '잔고 기록 기간',
    coverage: '반영 기준일',
    status: '상태',
    next: '다음 다운로드·조치',
    closed: '종료 계좌',
    closedAction: '추가 다운로드 불필요 · 과거 기록 보존',
    none: '—',
    rows: (count: string) => `${count}건`,
    window: (days: number) => `${days}일 기준`,
    kinds: { deposit: '예금', cma: 'CMA', pension: '연금', gold: '금현물', gold_price: '금 시세' },
    statuses: { unconfirmed: '조회기간 확인 필요', action_needed: '업데이트 필요', missing: '자료 없음', due_soon: '곧 필요', current: '현재 기준' },
    action: (kind: string, date: string | null, original: string) => original,
  },
})
