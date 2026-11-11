import * as React from 'react'
import type { Language } from '@/lib/i18n'

/** Deployment copy only. The gateway, not this notice, enforces device access. */
export function PrivateAccessNotice({
  language,
  mode,
  notice,
}: {
  language: Language
  mode: string
  notice?: string
}) {
  if (mode !== 'private' || notice !== 'owner-devices') return null

  const title = language === 'ko' ? '승인된 본인 기기만 접근 가능' : 'Approved owner devices only'
  const description = language === 'ko'
    ? '이 웹사이트의 자산·세금·증빙은 Tailscale에서 승인된 본인 기기에서만 볼 수 있습니다. 새 기기나 재등록한 기기는 접근 검토가 필요합니다. SSH 연결 없이 브라우저로 이용할 수 있습니다.'
    : 'This website, including assets, taxes and evidence, is limited to approved owner devices on Tailscale. New or re-enrolled devices require review. No SSH tunnel is needed for normal browser access.'

  return (
    <aside aria-label={title} className="mb-5 rounded-lg border border-line bg-card px-4 py-3 text-sm text-ink-2">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 leading-relaxed">{description}</p>
    </aside>
  )
}
