import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { clsx } from 'clsx'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { SubmitButton } from '@/components/SubmitButton'
import { Badge, Card, EmptyState, Label, Signed, TextLink } from '@/components/ui'
import { Checkbox, Input, Select } from '@/components/form'
import { CardRow } from '@/components/layout'
import { dbAvailable, portfolioToday } from '@/lib/adapters/portfolio-db'
import { getRebalanceInput } from '@/lib/adapters/rebalance-input'
import { fmtDateShort, fmtDateTime, fmtKrw, fmtMoney, fmtNumber, fmtPct, fmtQuantity } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { routeSection } from '@/lib/page-names'
import { SLEEVES, accountKey, getAllocationPolicy, type AllocationPolicy, type Sleeve } from '@/lib/rebalance/allocation-policy'
import { computeAllocation } from '@/lib/rebalance/allocation'
import type { EngineWarning, Instruction, SleeveMove } from '@/lib/rebalance/engine'
import { getInstrumentClasses } from '@/lib/rebalance/instrument-classes'
import {
  PROPOSAL_STATUS_TONE,
  describeInstruction,
  isProposalDoneCode,
  policyChangedSince,
  isProposalErrorCode,
} from '@/lib/rebalance/proposal-actions'
import { getProposal, type Proposal } from '@/lib/rebalance/proposal-store'
import { getPageCopy } from '@/lib/ui-copy'
import {
  approvePlan,
  approveTargets,
  closeProposal,
  recomputePlan,
  recordFillAction,
  rejectProposal,
  saveTargetEdits,
} from './actions'

export const dynamic = 'force-dynamic'

type Tab = 'summary' | 'targets' | 'plan' | 'fills'
type Copy = ReturnType<typeof getPageCopy<'rebalanceProposal'>>

const DAY_MS = 86_400_000
const REJECTABLE = ['draft', 'targets_approved', 'plan_approved']

function loadProposal(id: string): Proposal | null {
  try {
    return getProposal(id)
  } catch {
    // An id the store refuses, or an unreadable file, reads as not found.
    return null
  }
}

// A nested route: it is not in the sidebar, so it names its own tab (as /tax-planning/plans/[id] does).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  return { title: getPageCopy('rebalanceProposal', await getLanguage()).metaTitle(id) }
}

function accountLabel(brokerage: string | null | undefined, account: string | undefined) {
  if (!account) return ''
  return brokerage ? `${brokerage} · ${account}` : account
}

function labelFromKey(key: string) {
  const at = key.indexOf('::')
  return at === -1 ? key : accountLabel(key.slice(0, at) || null, key.slice(at + 2))
}

function policyFor(proposal: Proposal): AllocationPolicy {
  return getAllocationPolicy().policy ?? proposal.policyAtCreation
}

/** The instrument classes, or null when the file cannot be read (the page then says so). */
function loadClasses() {
  try {
    return getInstrumentClasses()
  } catch (error) {
    console.error('[rebalance-proposal] instrument classes:', error)
    return null
  }
}

function Figure({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-3">
      <Label size="micro">{label}</Label>
      <div className="mt-1 text-title font-medium tabular-nums text-ink">{children}</div>
      {sub != null && <div className="mt-0.5 text-label tabular-nums text-ink-3">{sub}</div>}
    </div>
  )
}

/** Warnings grouped by code. Known codes read as fixed copy; an unknown code falls back to each message. */
function Warnings({ warnings, copy }: { warnings: EngineWarning[]; copy: Copy }) {
  if (warnings.length === 0) return <EmptyState ok>{copy.warnings.empty}</EmptyState>
  const groups = new Map<string, EngineWarning[]>()
  for (const w of warnings) groups.set(w.code, [...(groups.get(w.code) ?? []), w])
  return (
    <ul className="space-y-3">
      {[...groups.entries()].map(([code, items]) => {
        const title = copy.warnings.codes[code]
        return (
          <li key={code} className="rounded-md border border-line-subtle px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <span className="text-caption font-medium text-ink">{title ?? items[0].message}</span>
              <Badge tone="warning">{copy.warnings.count(items.length)}</Badge>
            </div>
            <ul className="mt-1 space-y-0.5 text-label text-ink-3">
              {items.map((w, index) => {
                const context = [w.ticker, accountLabel(w.brokerage, w.account), w.currency].filter(Boolean).join(' · ')
                return (
                  <li key={index}>
                    {context && <span className="font-mono text-ink-2">{context}</span>}
                    {context && title ? ' — ' : null}
                    {title ? w.message : !context && index === 0 ? null : w.message}
                  </li>
                )
              })}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

function Banner({ tone, children }: { tone: 'success' | 'warning'; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={clsx(
        'mb-4 rounded-md border px-3 py-2 text-caption',
        tone === 'success' ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'
      )}
    >
      {children}
    </div>
  )
}

function SummaryTab({ proposal, copy, language }: { proposal: Proposal; copy: Copy; language: 'en' | 'ko' }) {
  const tax = proposal.plan.taxSummary
  const snapshot = proposal.inputSnapshot
  const staleDays = proposal.policyAtCreation?.bounds?.staleDataDays
  const asOfMs = Date.parse(`${snapshot.asOf}T00:00:00Z`)
  const accountRows = Object.entries(snapshot.accountDataAsOf ?? {}).map(([key, date]) => {
    const age = date ? Math.floor((asOfMs - Date.parse(`${date}T00:00:00Z`)) / DAY_MS) : null
    return { key, label: labelFromKey(key), date, stale: age == null || (typeof staleDays === 'number' && age > staleDays) }
  })

  // Drift: the same rules (current policy, current classes) over the snapshot and over today's data.
  let drift: { sleeve: Sleeve; then: number; now: number }[] | null = null
  const classes = loadClasses()
  if (classes && dbAvailable()) {
    try {
      const policy = policyFor(proposal)
      const then = computeAllocation(snapshot, policy, classes)
      const now = computeAllocation(getRebalanceInput(portfolioToday()), policy, classes)
      drift = SLEEVES.map((sleeve) => ({
        sleeve,
        then: then.sleeves.find((r) => r.sleeve === sleeve)?.pct ?? 0,
        now: now.sleeves.find((r) => r.sleeve === sleeve)?.pct ?? 0,
      }))
    } catch (error) {
      console.error('[rebalance-proposal] drift:', error)
      drift = null
    }
  }

  const outlook = proposal.outlook
  const outlookText =
    typeof outlook === 'string'
      ? outlook
      : outlook && typeof outlook === 'object' && typeof (outlook as { summary?: unknown }).summary === 'string'
        ? (outlook as { summary: string }).summary
        : null

  return (
    <>
      {outlook != null && (
        <Card title={copy.outlook.title} className="mb-5">
          {outlookText ? (
            <p className="whitespace-pre-line text-caption leading-relaxed text-ink-2">{outlookText}</p>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap text-label text-ink-2">{JSON.stringify(outlook, null, 2)}</pre>
          )}
        </Card>
      )}

      <Card title={copy.figures.title} info={copy.figures.info} className="mb-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle md:grid-cols-4">
          <Figure label={copy.figures.turnover}>{fmtPct(tax.turnoverPct)}</Figure>
          <Figure
            label={copy.figures.estimatedTax}
            sub={`${copy.figures.yearTotalTax} ${tax.yearTotalTaxKrw == null ? '—' : fmtKrw(tax.yearTotalTaxKrw)}`}
          >
            {tax.estimatedTaxKrw < 0 ? `${fmtKrw(tax.estimatedTaxKrw)} ${copy.figures.taxReduction}` : fmtKrw(tax.estimatedTaxKrw)}
          </Figure>
          <Figure label={copy.figures.harvestedLoss}>{fmtKrw(tax.harvestedLossKrw)}</Figure>
          <Figure label={copy.figures.krGain}>{fmtKrw(tax.krGainKrw)}</Figure>
          <Figure label={copy.figures.krDeductionUsed}>{fmtKrw(tax.krDeductionUsedKrw)}</Figure>
          <Figure label={copy.figures.krDeductionRemaining}>{fmtKrw(tax.krDeductionRemainingKrw)}</Figure>
          <Figure label={copy.figures.usShort}>{fmtMoney(tax.usShortUsd, 'USD')}</Figure>
          <Figure label={copy.figures.usLong}>{fmtMoney(tax.usLongUsd, 'USD')}</Figure>
        </div>
      </Card>

      <CardRow>
        <Card title={copy.warnings.title}>
          <Warnings warnings={proposal.plan.warnings} copy={copy} />
        </Card>
        <Card title={copy.dataAsOf.title} info={copy.dataAsOf.info}>
          {accountRows.length === 0 ? (
            <EmptyState>{copy.dataAsOf.empty}</EmptyState>
          ) : (
            <DataTable
              minWidth="20rem"
              rows={accountRows}
              getRowKey={(r) => r.key}
              columns={[
                { key: 'label', label: copy.dataAsOf.account, render: (r) => <span className="text-ink">{r.label}</span> },
                { key: 'date', label: copy.dataAsOf.asOf, align: 'right', render: (r) => (r.date ? fmtDateShort(r.date, language) : copy.dataAsOf.unknown) },
                {
                  key: 'stale',
                  label: '',
                  render: (r) => <Badge tone={r.stale ? 'warning' : 'success'}>{r.stale ? copy.dataAsOf.stale : copy.dataAsOf.fresh}</Badge>,
                },
              ]}
            />
          )}
        </Card>
      </CardRow>

      <Card title={copy.drift.title} info={copy.drift.info} className="mb-5">
        {classes === null ? (
          <EmptyState>
            <span className="block text-warning">{copy.classesUnreadable}</span>
            <TextLink href="/rebalance/settings">{copy.openSettings}</TextLink>
          </EmptyState>
        ) : drift === null ? (
          <EmptyState>{copy.drift.unavailable}</EmptyState>
        ) : (
          <>
            <DataTable
              minWidth="24rem"
              rows={drift}
              getRowKey={(r) => r.sleeve}
              columns={[
                { key: 'sleeve', label: copy.drift.sleeve, render: (r) => <span className="font-medium text-ink">{copy.sleeves[r.sleeve as Sleeve]}</span> },
                { key: 'then', label: copy.drift.snapshot, align: 'right', render: (r) => fmtPct(r.then) },
                { key: 'now', label: copy.drift.now, align: 'right', render: (r) => fmtPct(r.now) },
                {
                  key: 'change',
                  label: copy.drift.change,
                  align: 'right',
                  render: (r) => <Signed value={r.now - r.then} format={(m) => copy.drift.points(fmtNumber(m, 2))} />,
                },
              ]}
            />
            <p className="mt-2 text-label text-ink-3">{copy.drift.snapshotDate(fmtDateShort(snapshot.asOf, language))}</p>
          </>
        )}
      </Card>
    </>
  )
}

function TargetsTab({ proposal, copy }: { proposal: Proposal; copy: Copy }) {
  const state = getAllocationPolicy()
  const policy = state.policy
  const editable = proposal.status === 'draft' && policy !== null && !state.error
  const change = proposal.targetChange
  const rows = SLEEVES.map((sleeve) => {
    const proposed = change.sleeves[sleeve]
    const current = policy?.targets[sleeve].target ?? proposal.policyAtCreation.targets[sleeve].target
    const bounds = (policy ?? proposal.policyAtCreation).bounds.sleeves[sleeve]
    return {
      sleeve,
      from: proposed?.from ?? current,
      to: proposed?.to ?? current,
      reason: proposed?.reason ?? '',
      edited: proposed?.editedBy === 'maintainer',
      changed: proposed != null && proposed.to !== proposed.from,
      bounds: `${fmtNumber(bounds.min, 1)}–${fmtNumber(bounds.max, 1)}%`,
    }
  })
  type Row = (typeof rows)[number]

  const table = (
    <DataTable
      minWidth="40rem"
      rows={rows}
      getRowKey={(r: Row) => r.sleeve}
      columns={[
        {
          key: 'sleeve',
          label: copy.targets.sleeve,
          render: (r: Row) => (
            <span className="flex items-center gap-2">
              <span className={clsx('text-ink', r.changed && 'font-medium')}>{copy.sleeves[r.sleeve]}</span>
              {r.edited && <Badge tone="info">{copy.targets.edited}</Badge>}
            </span>
          ),
        },
        { key: 'from', label: copy.targets.from, align: 'right', render: (r: Row) => fmtPct(r.from) },
        {
          key: 'to',
          label: copy.targets.to,
          align: 'right',
          render: (r: Row) =>
            editable ? (
              <Input size="sm" type="number" step="any" name={`to_${r.sleeve}`} defaultValue={r.to} aria-label={`${copy.sleeves[r.sleeve]} ${copy.targets.to}`} className="w-20 text-right" />
            ) : (
              fmtPct(r.to)
            ),
        },
        { key: 'bounds', label: copy.targets.bounds, align: 'right', render: (r: Row) => <span className="text-ink-3">{r.bounds}</span> },
        {
          key: 'reason',
          label: copy.targets.reason,
          render: (r: Row) =>
            editable ? (
              <Input size="sm" type="text" name={`reason_${r.sleeve}`} maxLength={500} defaultValue={r.reason} aria-label={`${copy.sleeves[r.sleeve]} ${copy.targets.reason}`} className="w-full min-w-[12rem]" />
            ) : (
              <span className="text-ink-2">{r.reason}</span>
            ),
        },
      ]}
    />
  )

  return (
    <Card title={copy.targets.title} info={copy.targets.info} className="mb-5">
      {change.boundsErrors.length > 0 && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-label text-warning">
          <div className="font-medium">{copy.targets.boundsErrors}</div>
          <ul className="mt-1 list-disc pl-5">
            {change.boundsErrors.map((e, index) => (
              <li key={index}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {!policy && <p className="mb-3 text-caption text-warning">{copy.targets.noPolicy}</p>}
      {policy && proposal.status !== 'draft' && <p className="mb-3 text-caption text-ink-3">{copy.targets.readOnly}</p>}
      {editable ? (
        <>
          <form action={saveTargetEdits} className="space-y-4">
            <input type="hidden" name="proposalId" value={proposal.id} />
            {table}
            <SubmitButton>{copy.targets.save}</SubmitButton>
          </form>
          <form action={approveTargets} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <SubmitButton variant="solid">{copy.targets.approve}</SubmitButton>
            <span className="text-label text-ink-3">{copy.targets.approveNote}</span>
          </form>
        </>
      ) : (
        table
      )}
    </Card>
  )
}

function MovesTable({ moves, copy }: { moves: SleeveMove[]; copy: Copy }) {
  if (moves.length === 0) return <EmptyState ok>{copy.plan.noMoves}</EmptyState>
  const krw = (m: number) => fmtKrw(m)
  return (
    <DataTable
      minWidth="40rem"
      rows={moves}
      getRowKey={(r: SleeveMove) => r.sleeve}
      columns={[
        { key: 'sleeve', label: copy.plan.sleeve, render: (r: SleeveMove) => <span className="font-medium text-ink">{copy.sleeves[r.sleeve]}</span> },
        { key: 'fromPct', label: copy.plan.fromPct, align: 'right', render: (r: SleeveMove) => fmtPct(r.fromPct) },
        { key: 'toPct', label: copy.plan.toPct, align: 'right', render: (r: SleeveMove) => fmtPct(r.toPct) },
        {
          key: 'wanted',
          label: copy.plan.wanted,
          align: 'right',
          render: (r: SleeveMove) =>
            r.intendedAmountKrw == null ? <span className="text-ink-3">{copy.plan.noBandMove}</span> : <Signed value={r.intendedAmountKrw} format={krw} />,
        },
        { key: 'amountKrw', label: copy.plan.planDoes, align: 'right', render: (r: SleeveMove) => <Signed value={r.amountKrw} format={krw} /> },
        {
          key: 'shortfall',
          label: copy.plan.shortfall,
          align: 'right',
          render: (r: SleeveMove) => {
            if (r.intendedAmountKrw == null) return <span className="text-ink-3">—</span>
            const gap = Math.abs(r.intendedAmountKrw - r.amountKrw)
            return gap >= 1 ? <Badge tone="warning">{fmtKrw(gap)}</Badge> : <span className="text-ink-3">—</span>
          },
        },
      ]}
    />
  )
}

function groupByAccount(instructions: Instruction[]) {
  const groups = new Map<string, { label: string; rows: Instruction[] }>()
  for (const i of instructions) {
    const key = accountKey(i.brokerage, i.account)
    const group = groups.get(key) ?? { label: accountLabel(i.brokerage, i.account), rows: [] }
    group.rows.push(i)
    groups.set(key, group)
  }
  return [...groups.entries()]
}

function KindBadge({ kind, copy }: { kind: Instruction['kind']; copy: Copy }) {
  return <Badge tone={kind === 'sell' ? 'warning' : kind === 'buy' ? 'info' : 'neutral'}>{copy.kindsOfInstruction[kind]}</Badge>
}

function PlanTab({ proposal, copy, language }: { proposal: Proposal; copy: Copy; language: 'en' | 'ko' }) {
  const editable = proposal.status === 'draft' || proposal.status === 'targets_approved'
  const canApprove = proposal.status === 'targets_approved' || (proposal.status === 'draft' && proposal.targetChange.decision === 'hold')
  const instructions = proposal.plan.instructions
  const present = new Set(instructions.map((i) => i.id))
  const skippedOut = proposal.planSkips.filter((id) => !present.has(id))
  const groups = groupByAccount(instructions)
  const describe = (id: string) => describeInstruction(id, instructions, (k) => copy.kindsOfInstruction[k])
  // A hold proposal plans against the policy's targets as they are now; say so when they moved after creation.
  const livePolicy = proposal.targetChange.decision === 'hold' && editable ? getAllocationPolicy().policy : null
  const changedAt = livePolicy ? policyChangedSince(livePolicy, proposal.createdAt) : null

  const columns = [
    ...(editable
      ? [
          {
            key: 'skip',
            label: copy.plan.skip,
            align: 'center' as const,
            render: (r: Instruction) => (
              <Checkbox name="skip" value={r.id} defaultChecked={proposal.planSkips.includes(r.id)} aria-label={`${copy.plan.skip} ${r.ticker}`} />
            ),
          },
        ]
      : []),
    { key: 'kind', label: copy.plan.kind, render: (r: Instruction) => <KindBadge kind={r.kind} copy={copy} /> },
    {
      key: 'ticker',
      label: copy.plan.ticker,
      render: (r: Instruction) => (
        <span className="font-mono text-caption text-ink">{r.kind === 'transfer' ? r.currency : `${r.market}:${r.ticker}`}</span>
      ),
    },
    {
      key: 'lots',
      label: copy.plan.lots,
      render: (r: Instruction) =>
        r.lots.length === 0 ? (
          <span className="text-ink-3">—</span>
        ) : (
          <details className="text-label">
            <summary className="cursor-pointer text-ink-2">{copy.plan.lotCount(r.lots.length)}</summary>
            <ul className="mt-1 space-y-0.5 tabular-nums text-ink-3">
              {r.lots.map((lot, index) => (
                <li key={index}>
                  #{lot.lotId} × {fmtQuantity(lot.quantity)} · {copy.tiers[lot.tier]}
                  {lot.gainKrw != null && <> · {fmtKrw(lot.gainKrw)}</>}
                </li>
              ))}
            </ul>
          </details>
        ),
    },
    { key: 'quantity', label: copy.plan.quantity, align: 'right' as const, render: (r: Instruction) => (r.kind === 'transfer' ? '—' : fmtQuantity(r.quantity)) },
    { key: 'estimatedKrw', label: copy.plan.krw, align: 'right' as const, render: (r: Instruction) => fmtKrw(r.estimatedKrw) },
    {
      key: 'gain',
      label: copy.plan.gain,
      align: 'right' as const,
      render: (r: Instruction) =>
        r.gainKrw == null && r.usGainUsd == null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <div className="tabular-nums">
            {r.gainKrw != null && <Signed value={r.gainKrw} format={(m) => fmtKrw(m)} />}
            {r.usGainUsd != null && (
              <div className="text-label">
                <Signed value={r.usGainUsd} format={(m) => fmtMoney(m, 'USD')} />
              </div>
            )}
          </div>
        ),
    },
    { key: 'tier', label: copy.plan.tier, render: (r: Instruction) => (r.tier ? <Badge tone={r.tier === 'loss' ? 'success' : r.tier === 'short_term' ? 'warning' : 'neutral'}>{copy.tiers[r.tier]}</Badge> : <span className="text-ink-3">—</span>) },
    { key: 'notes', label: copy.plan.notes, render: (r: Instruction) => <span className="text-label text-ink-3">{r.notes.join(' · ')}</span> },
  ]

  const body = (
    <>
      {instructions.length === 0 ? (
        <EmptyState>{copy.plan.empty}</EmptyState>
      ) : (
        <div className="space-y-5">
          {groups.map(([key, group]) => (
            <div key={key}>
              <div className="mb-1 text-caption font-medium text-ink">{group.label}</div>
              <DataTable minWidth="52rem" rows={group.rows} getRowKey={(r: Instruction) => r.id} columns={columns} />
            </div>
          ))}
        </div>
      )}
      {editable && skippedOut.length > 0 && (
        <div className="mt-4 rounded-md border border-line-subtle bg-surface px-3 py-2">
          <div className="text-caption font-medium text-ink">{copy.plan.skippedTitle}</div>
          <p className="text-label text-ink-3">{copy.plan.skippedNote}</p>
          <ul className="mt-1 space-y-1">
            {skippedOut.map((id, index) => (
              <li key={index} className="flex items-center gap-2 text-label">
                <Checkbox name="skip" value={id} defaultChecked aria-label={`${copy.plan.skip} ${describe(id)}`} />
                <span className="text-ink-2">{describe(id)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )

  return (
    <>
      <Card title={copy.plan.movesTitle} info={copy.plan.movesInfo} className="mb-5">
        <MovesTable moves={proposal.plan.moves} copy={copy} />
      </Card>

      <Card title={copy.plan.instructionsTitle} info={copy.plan.instructionsInfo} className="mb-5">
        {changedAt && (
          <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-label text-warning">
            {copy.plan.policyChanged(fmtDateTime(changedAt, language))}
          </p>
        )}
        {editable ? (
          <form action={recomputePlan} className="space-y-4">
            <input type="hidden" name="proposalId" value={proposal.id} />
            {body}
            <SubmitButton>{copy.plan.recompute}</SubmitButton>
          </form>
        ) : (
          body
        )}
        {canApprove && (
          <form action={approvePlan} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <SubmitButton variant="solid">{copy.plan.approve}</SubmitButton>
            <span className="text-label text-ink-3">{copy.plan.approveNote}</span>
          </form>
        )}
      </Card>

      <Card title={copy.warnings.title} className="mb-5">
        <Warnings warnings={proposal.plan.warnings} copy={copy} />
      </Card>
    </>
  )
}

function FillsTab({ proposal, copy, language }: { proposal: Proposal; copy: Copy; language: 'en' | 'ko' }) {
  const open = proposal.status === 'plan_approved' || proposal.status === 'executing'
  const instructions = proposal.plan.instructions
  const rec = proposal.reconciliation
  const today = portfolioToday()
  const describe = (id: string) => describeInstruction(id, instructions, (k) => copy.kindsOfInstruction[k])

  return (
    <>
      <Card title={copy.fills.title} info={copy.fills.info} className="mb-5">
        {!open && <p className="mb-3 text-caption text-ink-3">{copy.fills.notOpen}</p>}
        {instructions.length === 0 ? (
          <EmptyState>{copy.fills.empty}</EmptyState>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {instructions.map((i) => {
              const fill = proposal.fills[i.id]
              const isTransfer = i.kind === 'transfer'
              return (
                <li key={i.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <KindBadge kind={i.kind} copy={copy} />
                    <span className="font-mono text-caption text-ink">{isTransfer ? i.currency : `${i.market}:${i.ticker}`}</span>
                    <span className="text-label text-ink-3">{accountLabel(i.brokerage, i.account)}</span>
                    <span className="text-label tabular-nums text-ink-3">
                      {copy.fills.planned} {isTransfer ? fmtKrw(i.estimatedKrw) : `${fmtQuantity(i.quantity)} · ${fmtKrw(i.estimatedKrw)}`}
                    </span>
                    <span className="ml-auto">
                      {fill ? (
                        <Badge tone={fill.status === 'executed' ? 'success' : 'neutral'}>
                          {fill.status === 'executed' ? copy.fills.executed : copy.fills.skipped}
                        </Badge>
                      ) : (
                        <Badge tone="warning">{copy.fills.notRecorded}</Badge>
                      )}
                    </span>
                  </div>
                  {fill && (
                    <div className="mt-1 flex flex-wrap gap-x-4 text-label tabular-nums text-ink-2">
                      {fill.quantity != null && <span>{copy.fills.quantity} {fmtQuantity(fill.quantity)}</span>}
                      {fill.price != null && <span>{copy.fills.price} {fmtMoney(fill.price, i.currency)}</span>}
                      {fill.date && <span>{copy.fills.date} {fmtDateShort(fill.date, language)}</span>}
                      {fill.note && <span className="text-ink-3">{copy.fills.note}: {fill.note}</span>}
                    </div>
                  )}
                  {open && (
                    <form action={recordFillAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="proposalId" value={proposal.id} />
                      <input type="hidden" name="instructionId" value={i.id} />
                      <label className="text-label text-ink-3">
                        <span className="block">{copy.fills.status}</span>
                        <Select size="sm" name="status" defaultValue={fill?.status ?? 'executed'}>
                          <option value="executed">{copy.fills.executed}</option>
                          <option value="skipped">{copy.fills.skipped}</option>
                        </Select>
                      </label>
                      {!isTransfer && (
                        <>
                          <label className="text-label text-ink-3">
                            <span className="block">{copy.fills.quantity}</span>
                            <Input size="sm" type="number" step="any" name="quantity" defaultValue={fill?.quantity ?? ''} className="w-24 text-right" />
                          </label>
                          <label className="text-label text-ink-3">
                            <span className="block">{copy.fills.price} ({i.currency})</span>
                            <Input size="sm" type="number" step="any" name="price" defaultValue={fill?.price ?? ''} className="w-28 text-right" />
                          </label>
                        </>
                      )}
                      <label className="text-label text-ink-3">
                        <span className="block">{copy.fills.date}</span>
                        <Input size="sm" type="date" name="date" defaultValue={fill?.date ?? today} className="w-36" />
                      </label>
                      <label className="min-w-[12rem] flex-1 text-label text-ink-3">
                        <span className="block">{copy.fills.note}</span>
                        <Input size="sm" type="text" name="note" maxLength={500} defaultValue={fill?.note ?? ''} className="w-full" />
                      </label>
                      <SubmitButton>{copy.fills.save}</SubmitButton>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card
        title={copy.reconciliation.title}
        info={copy.reconciliation.info}
        className="mb-5"
        action={rec ? <Badge tone={rec.complete ? 'success' : 'warning'}>{rec.complete ? copy.reconciliation.complete : copy.reconciliation.incomplete}</Badge> : undefined}
      >
        {!rec ? (
          <EmptyState>{copy.reconciliation.none}</EmptyState>
        ) : (
          <div className="space-y-3 text-label">
            <p className="text-ink-3">{copy.reconciliation.at(fmtDateTime(rec.at, language))}</p>
            <ReconList title={copy.reconciliation.matched} items={rec.matched.map((m) => `${describe(m.instructionId)} · ${m.txDate}`)} />
            <ReconList title={copy.reconciliation.missing} items={rec.missing.map((m) => `${describe(m.instructionId)} · ${copy.reconciliation.days(m.daysSinceFill)}`)} warn />
            <ReconList
              title={copy.reconciliation.unplanned}
              items={rec.unplanned.map((u) => `${u.type} ${u.market}:${u.ticker} × ${fmtQuantity(u.quantity)} · ${accountLabel(u.brokerage, u.account)} · ${u.date}`)}
              warn
            />
            <ReconList title={copy.reconciliation.unfilled} items={(rec.unfilled ?? []).map(describe)} warn />
          </div>
        )}
      </Card>
    </>
  )
}

function ReconList({ title, items, warn }: { title: string; items: string[]; warn?: boolean }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className={clsx('font-medium', warn ? 'text-warning' : 'text-ink')}>
        {title} ({items.length})
      </div>
      <ul className="mt-1 space-y-0.5 text-ink-2">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

export default async function RebalanceProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; done?: string; error?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const language = await getLanguage()
  const copy = getPageCopy('rebalanceProposal', language)
  const proposal = loadProposal(id)
  if (!proposal) notFound()

  const hold = proposal.targetChange.decision === 'hold'
  // A hold proposal has no target change to review: it goes straight from the plan to approval.
  const tabs: Tab[] = hold ? ['summary', 'plan', 'fills'] : ['summary', 'targets', 'plan', 'fills']
  const tab: Tab = (tabs as string[]).includes(query.tab ?? '') ? (query.tab as Tab) : 'summary'
  const doneMessage = isProposalDoneCode(query.done) ? copy.done[query.done] : null
  const errorMessage = isProposalErrorCode(query.error) ? copy.errors[query.error] : null
  const nextKey =
    proposal.status === 'draft' ? (hold ? 'draft_hold' : 'draft_change') : (proposal.status as Exclude<typeof proposal.status, 'draft'>)
  const base = `/rebalance/proposals/${encodeURIComponent(proposal.id)}`
  // Approving targets wrote them to the policy; rejecting afterwards leaves them there.
  const targetsWritten = proposal.status === 'targets_approved' || (proposal.status === 'plan_approved' && !hold)

  return (
    <>
      <PageHeader
        eyebrow={routeSection('/rebalance', language)}
        title={`${copy.title} ${proposal.id}`}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(copy.kinds[proposal.kind], fmtDateShort(proposal.createdAt, language), fmtDateShort(proposal.expiresAt, language))}
        action={<TextLink href="/rebalance">{copy.back}</TextLink>}
      />

      <div className="mb-4 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption text-ink-2" role="note">
        {copy.disclaimer}
      </div>

      {doneMessage && <Banner tone="success">{doneMessage}</Banner>}
      {errorMessage && (
        <Banner tone="warning">
          <strong className="font-medium">{copy.errorTitle}:</strong> {errorMessage}
        </Banner>
      )}

      <Card
        title={copy.statusCard.title}
        className="mb-5"
        accent
        action={<Badge tone={PROPOSAL_STATUS_TONE[proposal.status]}>{copy.statuses[proposal.status]}</Badge>}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-2">
            <p className="text-caption text-ink">{copy.statusCard.next[nextKey]}</p>
            <dl className="grid grid-cols-2 gap-2 text-label sm:grid-cols-4">
              <div><dt className="text-ink-3">{copy.statusCard.created}</dt><dd className="tabular-nums text-ink">{fmtDateTime(proposal.createdAt, language)}</dd></div>
              <div><dt className="text-ink-3">{copy.statusCard.expires}</dt><dd className="tabular-nums text-ink">{fmtDateTime(proposal.expiresAt, language)}</dd></div>
              <div><dt className="text-ink-3">{copy.statusCard.updated}</dt><dd className="tabular-nums text-ink">{fmtDateTime(proposal.updatedAt, language)}</dd></div>
              <div><dt className="text-ink-3">{copy.statusCard.triggers}</dt><dd className="text-ink">{proposal.triggers.length ? proposal.triggers.join(', ') : copy.statusCard.none}</dd></div>
            </dl>
          </div>
          <div className="space-y-3">
            {proposal.status === 'reconciled' && (
              <form action={closeProposal}>
                <input type="hidden" name="proposalId" value={proposal.id} />
                <SubmitButton variant="solid">{copy.statusCard.close}</SubmitButton>
              </form>
            )}
            {REJECTABLE.includes(proposal.status) && (
              <form action={rejectProposal} className="space-y-2">
                <input type="hidden" name="proposalId" value={proposal.id} />
                <input type="hidden" name="tab" value={tab} />
                <label className="block text-label text-ink-3">
                  <span className="mb-1 block">{copy.statusCard.rejectLabel}</span>
                  <Input size="sm" type="text" name="reason" required maxLength={500} placeholder={copy.statusCard.rejectPlaceholder} className="w-full" />
                </label>
                {targetsWritten && <p className="text-label text-warning">{copy.statusCard.rejectKeepsTargets}</p>}
                <SubmitButton>{copy.statusCard.reject}</SubmitButton>
              </form>
            )}
          </div>
        </div>
      </Card>

      <nav aria-label={copy.title} className="mb-5 flex flex-wrap gap-1 border-b border-line-subtle">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`${base}?tab=${t}`}
            aria-current={t === tab ? 'page' : undefined}
            className={clsx(
              '-mb-px inline-flex min-h-8 items-center border-b-2 px-3 text-caption font-medium',
              t === tab ? 'border-info text-ink' : 'border-transparent text-ink-3 hover:text-ink'
            )}
          >
            {copy.tabs[t]}
          </Link>
        ))}
      </nav>

      {tab === 'summary' && <SummaryTab proposal={proposal} copy={copy} language={language} />}
      {tab === 'targets' && <TargetsTab proposal={proposal} copy={copy} />}
      {tab === 'plan' && <PlanTab proposal={proposal} copy={copy} language={language} />}
      {tab === 'fills' && <FillsTab proposal={proposal} copy={copy} language={language} />}
    </>
  )
}
