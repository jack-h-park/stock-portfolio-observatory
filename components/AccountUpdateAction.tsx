import React, {type ReactNode} from 'react'
import {getPageCopy} from '@/lib/ui-copy'
import type {Language} from '@/lib/i18n'
import {portfolioToday, type AccountCoverage, type AccountCoverageStatus} from '@/lib/adapters/portfolio-db'
import {fmtDate} from '@/lib/format'

export function AccountUpdateAction({status, language, confirmation, children}: {
  status: AccountCoverageStatus
  language: Language
  confirmation: string
  children?: ReactNode
}) {
  const copy = getPageCopy('accountUpdates', language)
  if (status === 'current') return copy.noAction
  if (status === 'due_soon') return copy.noActionSoon
  if (status === 'unconfirmed') return confirmation
  return children
}

export function InvestmentUpdateAction({row, language}: {row: AccountCoverage; language: Language}) {
  const copy = getPageCopy('accountUpdates', language)
  const pending = row.sources.length > 1
    ? row.sources.filter(source => !['current','due_soon'].includes(source.status))
    : [{...row, label: row.brokerage}]
  const actionStatus = row.sources.length > 1 && row.status === 'unconfirmed' ? 'action_needed' : row.status
  return <AccountUpdateAction status={actionStatus} language={language} confirmation={row.action}>
    {pending.map((source, index) => <div key={index} className="mb-2 last:mb-0">
      <div className="font-medium text-ink">{source.requiredArtifact}</div>
      {source.status === 'unconfirmed' ? <div>{copy.confirmPeriod}</div> : source.method === 'mcp' || source.method === 'api'
        ? <div className="mt-1 text-label text-ink-3">{copy.regenerate(source.requiredArtifact)}</div>
        : <>
          <div className="mt-1 text-label text-info">{copy.downloadRange(source.downloadFrom ? fmtDate(source.downloadFrom) : null, fmtDate(portfolioToday()))}</div>
          <div className="mt-1 text-label text-ink-3">{source.method === 'manual' ? copy.saveAction(source.destination) : copy.inboxAction}</div>
        </>}
      {source.missingDisposals?.length ? <div className="mt-1 text-label text-danger">{copy.missingDisposals(source.missingDisposals.join(', '))}</div> : null}
    </div>)}
  </AccountUpdateAction>
}
