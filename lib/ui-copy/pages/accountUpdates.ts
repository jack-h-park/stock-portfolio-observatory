import { defineCopy } from '@/lib/ui-copy/define'

const INBOX_DIRECTORY = 'inbox'
const KINDS = {goldPrice: 'gold_price', pension: 'pension', gold: 'gold'}

export const accountUpdates = defineCopy({
  en: {
    title: 'Bank, pension and gold updates',
    info: 'Includes bank/CMA (30-day window), pension (180 days) and gold sources. Closed accounts are excluded.',
    caption: 'Bank, CMA and supplementary updates',
    empty: 'No registered sources.',
    account: 'Account / source',
    range: 'Balance history period',
    coverage: 'Covered through',
    status: 'Status',
    next: 'Next download / action',
    noAction: 'No additional data needed',
    noActionSoon: 'No additional data needed now · renewal due soon',
    downloadRange: (from: string | null, to: string) => from ? `${from} – ${to} (overlap included)` : `Full available history through ${to}`,
    regenerate: (artifact: string) => `Regenerate ${artifact}.`,
    inboxAction: 'Download the file and place it in inbox.',
    saveAction: (destination: string) => `Save the downloaded file to ${destination}.`,
    confirmPeriod: 'Confirm the query end date of the existing file.',
    historyGap: (from: string, to: string) => `Download account transaction history for ${from} – ${to} and place it in inbox.`,
    missingDisposals: (symbols: string) => `Missing sale records: ${symbols}`,
    closed: 'Closed account',
    closedAction: 'No further downloads · history retained',
    none: '—',
    rows: (count: string) => `${count} records`,
    window: (days: number) => `${days}-day window`,
    kinds: { deposit: 'Deposits', cma: 'CMA', pension: 'Pension', gold: 'Gold', gold_price: 'Gold price' },
    statuses: { unconfirmed: 'Confirm query period', action_needed: 'Update needed', missing: 'No data', due_soon: 'Due soon', current: 'Current' },
    action: (kind: string, date: string | null, _original: string, to: string) => {
      if (kind === KINDS.goldPrice) return 'Refresh KRX gold prices.'
      if (kind === KINDS.pension) return `Capture holdings as of ${to} and place the pension CSV in inbox.`
      const artifact = kind === KINDS.gold ? 'Gold transaction certificate' : 'Account transaction history'
      return date ? `${artifact}: ${date} – ${to}. Download and place it in inbox.` : `${artifact}: full available history through ${to}. Download and place it in inbox.`
    },
  },
  ko: {
    title: '은행·연금·금 자료 업데이트',
    info: '증권 계좌와 별도로 예금·CMA·연금·금 자료도 확인합니다. 은행·CMA는 30일, 연금은 180일 기준입니다. 종료 계좌는 업데이트 대상에서 제외합니다.',
    caption: '은행·CMA 및 추가 자료 업데이트',
    empty: '등록된 자료가 없습니다.',
    account: '계좌·자료',
    range: '잔고 기록 기간',
    coverage: '반영 기준일',
    status: '상태',
    next: '다음 다운로드·조치',
    noAction: '추가 자료 필요 없음',
    noActionSoon: '현재 추가 자료 필요 없음 · 곧 갱신 예정',
    downloadRange: (from: string | null, to: string) => from ? `${from} ~ ${to} (기존 자료와 중복 구간 포함)` : `가능한 전체 기간 ~ ${to}`,
    regenerate: (artifact: string) => `${artifact}을 다시 생성하세요.`,
    inboxAction: `자료를 다운로드해 ${INBOX_DIRECTORY}에 넣으세요.`,
    saveAction: (destination: string) => `받은 파일을 ${destination}에 저장하세요.`,
    confirmPeriod: '기존 파일의 조회 종료일을 확인해주세요.',
    historyGap: (from: string, to: string) => `누락된 계좌 거래내역을 ${from} ~ ${to} 기간으로 받아 inbox에 넣으세요.`,
    missingDisposals: (symbols: string) => `매도 기록 누락: ${symbols}`,
    closed: '종료 계좌',
    closedAction: '추가 다운로드 불필요 · 과거 기록 보존',
    none: '—',
    rows: (count: string) => `${count}건`,
    window: (days: number) => `${days}일 기준`,
    kinds: { deposit: '예금', cma: 'CMA', pension: '연금', gold: '금현물', gold_price: '금 시세' },
    statuses: { unconfirmed: '조회기간 확인 필요', action_needed: '업데이트 필요', missing: '자료 없음', due_soon: '곧 필요', current: '현재 기준' },
    action: (kind: string, date: string | null, _original: string, to: string) => {
      if (kind === KINDS.goldPrice) return '한국거래소 금 시세를 갱신하세요.'
      if (kind === KINDS.pension) return `${to} 기준 보유 현황을 캡처해 연금 보유내역 CSV를 ${INBOX_DIRECTORY}에 넣으세요.`
      const artifact = kind === KINDS.gold ? '금현물 거래내역증명서' : '계좌 거래내역'
      const range = date ? `${date} ~ ${to}` : `가능한 전체 기간 ~ ${to}`
      return `${artifact}을 ${range} 기간으로 받아 ${INBOX_DIRECTORY}에 넣으세요.`
    },
  },
})
