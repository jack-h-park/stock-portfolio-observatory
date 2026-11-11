import type { NetWorth } from '@/lib/net-worth'
import type { Language } from '@/lib/i18n'

export function AssetCoverageNote({ summary, language }: { summary: NetWorth; language: Language }) {
  const count = summary.coverage?.omittedAssetCount ?? 0
  return (
    <p className="mt-3 text-body text-ink-2">
      {language === 'ko'
        ? `본인 소유의 확인 가능한 자산 합계입니다. 누락·평가 불가·출처 충돌 ${count}건은 제외했으며, 원본 커버리지는 전체 확인 전입니다. 부채를 반영한 순자산이 아닙니다. 각 잔액의 기준일을 확인하세요. 과거 추세의 현금 커버리지는 현재 잔액과 다를 수 있습니다.`
        : `Covered assets owned by self. ${count} missing, unpriced or conflicting asset record(s) are excluded; overall source coverage is unconfirmed. Liabilities are excluded, so this is not complete net worth. Review each balance date. Historical cash coverage can differ from current balances.`}
    </p>
  )
}
