import { defineCopy } from '@/lib/ui-copy/define'

export const sidebar = defineCopy({
  en: {
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    navLabel: 'Main navigation',
    tagline: 'Portfolio monitoring',
    readOnly: 'Read-only portfolio',
    source: 'Generated from local sources',
    language: 'Language',
    currency: 'Currency',
    sections: [
      {
        label: 'Core Workflows',
        items: [
          { href: '/', label: 'Portfolio Overview' },
          { href: '/daily-briefing', label: "Today's Briefing" },
          { href: '/holdings', label: 'Holdings' },
          { href: '/review', label: 'Portfolio Review' },
          { href: '/rebalance', label: 'Rebalancing' },
          { href: '/income', label: 'Income' },
        ],
      },
      {
        label: 'Tax',
        items: [
          { href: '/tax-planning', label: 'Tax Planning' },
          { href: '/tax-settings', label: 'Tax Settings' },
          { href: '/lots', label: 'Tax Lots' },
        ],
      },
      {
        label: 'Detailed Records',
        collapsible: true,
        items: [
          { href: '/cost-basis', label: 'Cost Basis' },
          { href: '/dividends', label: 'Dividends' },
          { href: '/transactions', label: 'Transactions' },
          { href: '/fx', label: 'FX Exchange & Gain' },
          { href: '/crypto-premium', label: 'Korea Premium' },
        ],
      },
      {
        label: 'Operations & Data',
        collapsible: true,
        items: [
          { href: '/health', label: 'System Health' },
          { href: '/data-ops', label: 'Action Center' },
          { href: '/reconciliation', label: 'Reconciliation' },
          { href: '/data-map', label: 'Source & Retention' },
        ],
      },
    ],
  },
  ko: {
    openMenu: '메뉴 열기',
    closeMenu: '메뉴 닫기',
    navLabel: '주요 메뉴',
    tagline: '자산 모니터링',
    readOnly: '조회 전용 포트폴리오',
    source: '로컬 원본에서 생성됨',
    language: '언어',
    currency: '화폐',
    sections: [
      {
        label: '핵심 업무',
        items: [
          { href: '/', label: '포트폴리오 개요' },
          { href: '/daily-briefing', label: '오늘의 브리핑' },
          { href: '/holdings', label: '보유종목' },
          { href: '/review', label: '포트폴리오 검토' },
          { href: '/rebalance', label: '리밸런싱' },
          { href: '/income', label: '수익 내역' },
        ],
      },
      {
        label: '세금',
        items: [
          { href: '/tax-planning', label: '세금 계획' },
          { href: '/tax-settings', label: '세금 설정' },
          { href: '/lots', label: '세금 계산 단위' },
        ],
      },
      {
        label: '상세 기록',
        collapsible: true,
        items: [
          { href: '/cost-basis', label: '취득원가' },
          { href: '/dividends', label: '배당 내역' },
          { href: '/transactions', label: '거래 내역' },
          { href: '/fx', label: '환전 · 환차익' },
          { href: '/crypto-premium', label: '코리아 프리미엄' },
        ],
      },
      {
        label: '운영 · 데이터',
        collapsible: true,
        items: [
          { href: '/health', label: '시스템 상태' },
          { href: '/data-ops', label: '조치 센터' },
          { href: '/reconciliation', label: '정합성 확인' },
          { href: '/data-map', label: '원본 · 보존' },
        ],
      },
    ],
  },
})
