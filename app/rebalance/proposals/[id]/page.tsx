import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { clsx } from 'clsx'
import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Tabs } from '@/components/Tabs'
import { SubmitButton } from '@/components/SubmitButton'
import { Badge, Callout, Card, EmptyState, Note, Panel, SectionHeading, Signed, TextLink } from '@/components/ui'
import { Checkbox, Input, Select } from '@/components/form'
import { CardRow, Stat, StatStrip } from '@/components/layout'
import { dbAvailable, portfolioToday } from '@/lib/adapters/portfolio-db'
import { getRebalanceInput } from '@/lib/adapters/rebalance-input'
import { EMPTY_VALUE, fmtDateShort, fmtDateTime, fmtKrw, fmtMoney, fmtNumber, fmtPct, fmtPctRange, fmtQuantity, fmtSigned } from '@/lib/format'
import { displayAccount, displayAccountKey, maskAccountsIn } from '@/lib/account-label'
import { getLanguage } from '@/lib/i18n-server'
import { routeSection } from '@/lib/page-names'
import { SLEEVES, accountKey, getAllocationPolicy, rebalanceWrappers, type AllocationPolicy, type Sleeve } from '@/lib/rebalance/allocation-policy'
import { bandEdges, computeAllocation } from '@/lib/rebalance/allocation'
import type { EngineWarning, Instruction, SleeveMove } from '@/lib/rebalance/engine'
import { buildHarvestScenario, type HarvestScenario } from '@/lib/rebalance/harvest'
import { getInstrumentClasses, type InstrumentClasses } from '@/lib/rebalance/instrument-classes'
import {
  PROPOSAL_STATUS_TONE,
  canCloseWithoutTrades,
  describeInstruction,
  ideaAccountOptions,
  ideaListed,
  isProposalDoneCode,
  policyChangedSince,
  isProposalErrorCode,
} from '@/lib/rebalance/proposal-actions'
import { MAX_ANSWER, getProposal, planHasTrades, type Proposal } from '@/lib/rebalance/proposal-store'
import { getTaxPolicyState } from '@/lib/tax-policy'
import { llmStatusLine, safeSourceHref } from '@/lib/rebalance/proposal-view'
import { getPageCopy } from '@/lib/ui-copy'
import { proposalHeading } from '@/lib/page-headings'
import {
  addIdeaAction,
  answerQuestionAction,
  approvePlan,
  approveTargets,
  closeProposal,
  closeWithoutTrades,
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

// Display only: the account identifier is cut to its last four characters (lib/account-label.ts).
const accountLabel = displayAccount
const labelFromKey = displayAccountKey

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

/** Warnings grouped by code. Known codes read as fixed copy; an unknown code falls back to each message. */
function Warnings({ warnings, copy }: { warnings: EngineWarning[]; copy: Copy }) {
  if (warnings.length === 0) return <EmptyState ok>{copy.warnings.empty}</EmptyState>
  const groups = new Map<string, EngineWarning[]>()
  for (const w of warnings) groups.set(w.code, [...(groups.get(w.code) ?? []), w])
  return (
    <ul className="space-y-3">
      {[...groups.entries()].map(([code, items]) => {
        const title = copy.warnings.codes[code]
        const first = items[0]
        return (
          <li key={code} className="rounded-md border border-line-subtle px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <span className="text-caption font-medium text-ink">{title ?? maskAccountsIn(first.message, [first.account])}</span>
              <Badge tone="warning">{copy.warnings.count(items.length)}</Badge>
            </div>
            <ul className="mt-1 space-y-0.5 text-label text-ink-3">
              {items.map((w, index) => {
                const context = [w.ticker, accountLabel(w.brokerage, w.account), w.currency].filter(Boolean).join(' · ')
                return (
                  <li key={index}>
                    {context && <span className="font-mono text-ink-2">{context}</span>}
                    {context && title ? ' — ' : null}
                    {title ? maskAccountsIn(w.message, [w.account]) : !context && index === 0 ? null : maskAccountsIn(w.message, [w.account])}
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

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-3">
      <SectionHeading level={3} size="minor">{title}</SectionHeading>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-caption text-ink-2">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

/** The "add to buy list" control under one idea, or why there is none. */
function IdeaAdd({ proposal, policy, index, copy }: { proposal: Proposal; policy: AllocationPolicy | null; index: number; copy: Copy }) {
  const idea = proposal.ideas[index]
  if (!idea.market) return null
  if (ideaListed(policy, idea)) return <div className="mt-1 text-label text-ink-3">{copy.outlook.ideaListed}</div>
  if (!policy) return null
  const options = ideaAccountOptions(proposal, policy, idea.market)
  const blocked = proposal.inputSnapshot.washSaleBlockedBuys?.find((b) => b.ticker === idea.ticker)
  return (
    <div className="mt-1 space-y-1">
      {blocked && <div className="text-label text-warning">{copy.outlook.ideaWashSale(blocked.blockedThrough)}</div>}
      {policy.investor?.usTaxPerson && idea.market !== 'US' && idea.market !== 'CRYPTO' && (
        <div className="text-label text-warning">{copy.outlook.ideaPficCheck}</div>
      )}
      {options.length === 0 ? (
        <div className="text-label text-ink-3">{copy.outlook.ideaNoAccount}</div>
      ) : (
        <form action={addIdeaAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="ideaIndex" value={index} />
          <Select size="sm" name="account" aria-label={copy.outlook.ideaAccount}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {accountLabel(o.brokerage, o.account)}
              </option>
            ))}
          </Select>
          <SubmitButton>{copy.outlook.ideaAdd}</SubmitButton>
        </form>
      )}
    </div>
  )
}

function OutlookSection({ proposal, copy, language }: { proposal: Proposal; copy: Copy; language: 'en' | 'ko' }) {
  const { outlook, llm, ideas, questionsForMaintainer: questions } = proposal
  const policy = getAllocationPolicy().policy
  if (!outlook && !llm && ideas.length === 0 && questions.length === 0) return null
  const tone = { low: 'warning', medium: 'neutral', high: 'success' } as const
  return (
    <>
      {llm && (
        <Note size="caption" spacing="below-3" tone={llm.status === 'ok' ? 'muted' : 'warning'}>
          <span className="font-medium">{copy.outlook.llmTitle}</span> · {llmStatusLine(llm, language)}
        </Note>
      )}
      {outlook && (
        <Card title={copy.outlook.title} className="mb-5">
          <p className="whitespace-pre-line text-caption leading-relaxed text-ink-2">{outlook.summary}</p>
          <Note row spacing="above-3">
            {copy.outlook.confidence}
            <Badge tone={tone[outlook.confidence] ?? 'neutral'}>{copy.outlook.levels[outlook.confidence] ?? outlook.confidence}</Badge>
          </Note>
          <BulletList title={copy.outlook.drivers} items={outlook.drivers} />
          <BulletList title={copy.outlook.risks} items={outlook.risks} />
          <BulletList title={copy.outlook.wouldChange} items={outlook.whatWouldChangeMyView} />
          {outlook.sources.length > 0 && (
            <div className="mt-3">
              <SectionHeading level={3} size="minor">{copy.outlook.sources}</SectionHeading>
              <ul className="mt-1 space-y-0.5 text-caption text-ink-2">
                {outlook.sources.map((source, i) => {
                  const href = safeSourceHref(source.url)
                  return (
                    <li key={i}>
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-info underline hover:no-underline">
                          {source.title}
                        </a>
                      ) : (
                        <span>
                          {source.title} <span className="break-all text-ink-3">({source.url})</span>
                        </span>
                      )}{' '}
                      <span className="text-ink-3">· {source.date}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </Card>
      )}
      {ideas.length > 0 && (
        <Card title={copy.outlook.ideasTitle} className="mb-5">
          <ul className="space-y-1 text-caption text-ink-2">
            {ideas.map((idea, i) => (
              <li key={i}>
                <span className="font-medium text-ink">{idea.market ? `${idea.market}:${idea.ticker}` : idea.ticker}</span>{' '}
                <Badge>{copy.sleeves[idea.sleeve] ?? idea.sleeve}</Badge> {idea.why}
                <IdeaAdd proposal={proposal} policy={policy} index={i} copy={copy} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {questions.length > 0 && (
        <Card title={copy.outlook.questionsTitle} info={copy.outlook.questionsNote} className="mb-5">
          <ol className="list-decimal space-y-4 pl-5 text-caption text-ink-2">
            {questions.map((q, i) => {
              const saved = proposal.answers?.find((a) => a.index === i)
              return (
                <li key={i}>
                  <span>{q}</span>
                  <form action={answerQuestionAction} className="mt-2 space-y-1.5">
                    <input type="hidden" name="proposalId" value={proposal.id} />
                    <input type="hidden" name="questionIndex" value={i} />
                    <textarea
                      name="answer"
                      rows={2}
                      maxLength={MAX_ANSWER}
                      defaultValue={saved?.answer ?? ''}
                      placeholder={copy.outlook.answerPlaceholder}
                      aria-label={copy.outlook.answerLabel(i + 1)}
                      className="w-full rounded-md border border-line bg-card px-3 py-2 text-caption text-ink focus:outline-none focus-visible:border-info focus-visible:ring-2 focus-visible:ring-info/30"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <SubmitButton>{copy.outlook.answerSave}</SubmitButton>
                      {saved && <span className="text-label text-ink-3">{copy.outlook.answeredAt(fmtDateShort(saved.at, language))}</span>}
                    </div>
                  </form>
                </li>
              )
            })}
          </ol>
        </Card>
      )}
    </>
  )
}

const HARVEST_ROWS = 15

/**
 * The stored loss-harvest scenario, or one computed now from the proposal's frozen snapshot for a proposal created
 * before the scenario was stored (`live`). Null when it cannot be computed.
 */
function harvestFor(proposal: Proposal, classes: InstrumentClasses | null): { scenario: HarvestScenario; live: boolean } | null {
  if (proposal.harvest) return { scenario: proposal.harvest, live: false }
  if (!classes) return null
  try {
    const snapshot = proposal.inputSnapshot
    const scenario = buildHarvestScenario({
      input: snapshot,
      policy: proposal.policyAtCreation,
      classes,
      taxPolicy: getTaxPolicyState().policy,
      today: snapshot.asOf,
    })
    return { scenario, live: true }
  } catch (error) {
    console.error('[rebalance-proposal] harvest scenario:', error)
    return null
  }
}

function HarvestCard({ scenario, live, copy, language }: { scenario: HarvestScenario; live: boolean; copy: Copy; language: 'en' | 'ko' }) {
  const h = copy.harvest
  const rows = scenario.rows.slice(0, HARVEST_ROWS)
  type Row = (typeof rows)[number]
  const hasKr = [...scenario.rows, ...scenario.excludedForWashSale].some((r) => r.market === 'KR')
  return (
    <Card title={h.title} info={h.info} className="mb-5">
      {live && <Note spacing="below-3">{h.computedLive}</Note>}
      <StatStrip columns="md-4">
        <Stat label={h.totalLoss} sub={h.lots(scenario.lotCount)} value={fmtKrw(scenario.totalLossKrw)} />
        <Stat
          label={h.taxEffect}
          value={scenario.taxEffectKrw < 0 ? `${fmtKrw(scenario.taxEffectKrw)} ${h.taxReduction}` : fmtKrw(scenario.taxEffectKrw)}
        />
        <Stat label={h.yearWith} value={fmtKrw(scenario.yearTotalWithKrw)} />
        <Stat label={h.yearWithout} value={fmtKrw(scenario.yearTotalWithoutKrw)} />
      </StatStrip>
      <div className="mt-4">
        <DataTable
          minWidth="44rem"
          rows={rows}
          getRowKey={(r: Row) => `${r.market}:${r.ticker}`}
          columns={[
            { key: 'security', label: h.security, render: (r: Row) => <span className="font-mono text-caption text-ink">{`${r.market}:${r.ticker}`}</span> },
            { key: 'name', label: h.name, render: (r: Row) => <span className="text-ink-2">{r.name}</span> },
            { key: 'sleeve', label: h.sleeve, render: (r: Row) => <span className="text-ink-3">{r.sleeve ? copy.sleeves[r.sleeve] : h.unclassified}</span> },
            { key: 'loss', label: h.loss, align: 'right', render: (r: Row) => fmtKrw(r.lossKrw) },
            { key: 'lots', label: h.lotCount, align: 'right', render: (r: Row) => fmtNumber(r.lotCount) },
            { key: 'short', label: h.shortTerm, align: 'right', render: (r: Row) => (r.shortLossKrw > 0 ? fmtKrw(r.shortLossKrw) : EMPTY_VALUE) },
            { key: 'long', label: h.longTerm, align: 'right', render: (r: Row) => (r.longLossKrw > 0 ? fmtKrw(r.longLossKrw) : EMPTY_VALUE) },
            { key: 'accounts', label: h.accounts, align: 'right', render: (r: Row) => fmtNumber(r.accountCount) },
          ]}
        />
        {scenario.rows.length > rows.length && <Note spacing="above-2">{h.topNote(rows.length, scenario.rows.length)}</Note>}
      </div>
      {scenario.excludedForWashSale.length > 0 && (
        <div className="mt-4">
          <SectionHeading level={3} size="minor">{h.excludedTitle}</SectionHeading>
          <ul className="mt-1 space-y-0.5 text-label text-ink-2">
            {scenario.excludedForWashSale.map((e) => (
              <li key={`${e.market}:${e.ticker}`}>
                <span className="font-mono text-ink">{`${e.market}:${e.ticker}`}</span> {e.name} · {fmtKrw(e.lossKrw)} ·{' '}
                <span className="text-ink-3">{h.excludedItem(fmtDateShort(e.lastBuy, language))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="mt-4 list-disc space-y-0.5 pl-5 text-label text-ink-3">
        <li>{h.caveatWashSale}</li>
        {hasKr && <li>{scenario.usTaxPerson ? h.caveatKrUs : h.caveatKrNotUs}</li>}
        <li className="text-ink-2">{h.notInstructions}</li>
      </ul>
      <Note spacing="above-2">{h.asOf(fmtDateShort(scenario.asOf, language))}</Note>
    </Card>
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

  // Drift: the same rules (current policy, current classes) over the snapshot and over today's data, read against
  // the target and band the proposal was created with.
  type DriftRow = { sleeve: Sleeve; target: number | null; lower: number | null; upper: number | null; then: number; now: number }
  let drift: DriftRow[] | null = null
  const classes = loadClasses()
  const driftPolicy = policyFor(proposal)
  if (classes && dbAvailable()) {
    try {
      const then = computeAllocation(snapshot, driftPolicy, classes)
      const now = computeAllocation(getRebalanceInput(portfolioToday(), undefined, rebalanceWrappers(driftPolicy)), driftPolicy, classes)
      drift = SLEEVES.map((sleeve) => {
        const t = proposal.policyAtCreation?.targets?.[sleeve]
        const known = t != null && Number.isFinite(t.target) && Number.isFinite(t.band)
        return {
          sleeve,
          target: known ? t.target : null,
          lower: known ? bandEdges(t.target, t.band).lower : null,
          upper: known ? bandEdges(t.target, t.band).upper : null,
          then: then.sleeves.find((r) => r.sleeve === sleeve)?.pct ?? 0,
          now: now.sleeves.find((r) => r.sleeve === sleeve)?.pct ?? 0,
        }
      })
    } catch (error) {
      console.error('[rebalance-proposal] drift:', error)
      drift = null
    }
  }
  const driftScope = rebalanceWrappers(driftPolicy).includes('isa') ? copy.drift.scopes.taxableIsa : copy.drift.scopes.taxable
  // The engine's band check: edges inclusive.
  const bandStatus = (r: DriftRow): 'below' | 'within' | 'above' | null =>
    r.lower == null || r.upper == null ? null : r.now < r.lower ? 'below' : r.now > r.upper ? 'above' : 'within'
  const harvest = harvestFor(proposal, classes)

  return (
    <>
      <OutlookSection proposal={proposal} copy={copy} language={language} />

      <Card title={copy.figures.title} info={copy.figures.info} className="mb-5">
        <StatStrip columns="md-4">
          <Stat label={copy.figures.turnover} value={fmtPct(tax.turnoverPct)} />
          <Stat
            label={copy.figures.estimatedTax}
            sub={`${copy.figures.yearTotalTax} ${tax.yearTotalTaxKrw == null ? EMPTY_VALUE : fmtKrw(tax.yearTotalTaxKrw)}`}
            value={tax.estimatedTaxKrw < 0 ? `${fmtKrw(tax.estimatedTaxKrw)} ${copy.figures.taxReduction}` : fmtKrw(tax.estimatedTaxKrw)}
          />
          <Stat label={copy.figures.harvestedLoss} value={fmtKrw(tax.harvestedLossKrw)} />
          <Stat label={copy.figures.krGain} value={fmtKrw(tax.krGainKrw)} />
          <Stat label={copy.figures.krDeductionUsed} value={fmtKrw(tax.krDeductionUsedKrw)} />
          <Stat label={copy.figures.krDeductionRemaining} value={fmtKrw(tax.krDeductionRemainingKrw)} />
          <Stat label={copy.figures.usShort} value={fmtMoney(tax.usShortUsd, 'USD')} />
          <Stat label={copy.figures.usLong} value={fmtMoney(tax.usLongUsd, 'USD')} />
        </StatStrip>
      </Card>

      {harvest && harvest.scenario.totalLossKrw > 0 && <HarvestCard scenario={harvest.scenario} live={harvest.live} copy={copy} language={language} />}

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

      <Card title={copy.drift.title} info={copy.drift.info(driftScope)} className="mb-5">
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
              minWidth="36rem"
              rows={drift}
              getRowKey={(r) => r.sleeve}
              columns={[
                { key: 'sleeve', label: copy.drift.sleeve, render: (r) => <span className="font-medium text-ink">{copy.sleeves[r.sleeve as Sleeve]}</span> },
                { key: 'target', label: copy.drift.target, align: 'right', render: (r) => (r.target == null ? EMPTY_VALUE : fmtPct(r.target)) },
                {
                  key: 'band',
                  label: copy.drift.band,
                  align: 'right',
                  render: (r) => <span className="text-ink-3">{r.lower == null || r.upper == null ? EMPTY_VALUE : fmtPctRange(r.lower, r.upper, 1)}</span>,
                },
                { key: 'then', label: copy.drift.snapshot, align: 'right', render: (r) => fmtPct(r.then) },
                { key: 'now', label: copy.drift.now, align: 'right', render: (r) => fmtPct(r.now) },
                {
                  key: 'change',
                  label: copy.drift.change,
                  align: 'right',
                  render: (r) => <Signed value={r.now - r.then} format={(m) => copy.drift.points(fmtNumber(m, 2))} />,
                },
                {
                  key: 'status',
                  label: copy.drift.status,
                  render: (r) => {
                    const status = bandStatus(r)
                    if (!status) return <span className="text-ink-3">{EMPTY_VALUE}</span>
                    return <Badge tone={status === 'within' ? 'success' : 'warning'}>{copy.drift.statuses[status]}</Badge>
                  },
                },
              ]}
            />
            <Note spacing="above-2">{copy.drift.snapshotDate(fmtDateShort(snapshot.asOf, language))}</Note>
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
  const llmProposed = proposal.llm?.status === 'ok'
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
      llm: llmProposed && change.decision === 'change' && proposed != null && proposed.editedBy !== 'maintainer',
      changed: proposed != null && proposed.to !== proposed.from,
      bounds: fmtPctRange(bounds.min, bounds.max, 1),
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
              {r.llm && (
                <span title={copy.outlook.llmBadgeInfo}>
                  <Badge tone="info">{copy.outlook.llmBadge}</Badge>
                </span>
              )}
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
        <Callout tone="warning" emphasis="strong" size="label" spacing="mb-4">
          <div className="font-medium">{copy.targets.boundsErrors}</div>
          <ul className="mt-1 list-disc pl-5">
            {change.boundsErrors.map((e, index) => (
              <li key={index}>{e}</li>
            ))}
          </ul>
        </Callout>
      )}
      {!policy && <p className="mb-3 text-caption text-warning">{copy.targets.noPolicy}</p>}
      {policy && proposal.status !== 'draft' && <Note size="caption" spacing="below-3">{copy.targets.readOnly}</Note>}
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
          key: 'gap',
          label: copy.plan.gap,
          align: 'right',
          render: (r: SleeveMove) => {
            if (r.intendedAmountKrw == null) return <span className="text-ink-3">{EMPTY_VALUE}</span>
            // What the plan does minus what the band asked: positive is more bought (or less sold)
            // than the band needed, negative is less.
            const gap = r.amountKrw - r.intendedAmountKrw
            if (Math.abs(gap) < 1) return <span className="text-ink-3">{EMPTY_VALUE}</span>
            return <Badge tone="warning">{fmtSigned(gap, fmtKrw)}</Badge>
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
  // A plan with no buy or sell cannot be approved (empty_plan); its step is closing the proposal instead.
  const closeInstead = canCloseWithoutTrades(proposal)
  const canApprove =
    planHasTrades(proposal.plan) && (proposal.status === 'targets_approved' || (proposal.status === 'draft' && proposal.targetChange.decision === 'hold'))
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
          <span className="text-ink-3">{EMPTY_VALUE}</span>
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
    { key: 'quantity', label: copy.plan.quantity, align: 'right' as const, render: (r: Instruction) => (r.kind === 'transfer' ? EMPTY_VALUE : fmtQuantity(r.quantity)) },
    { key: 'estimatedKrw', label: copy.plan.krw, align: 'right' as const, render: (r: Instruction) => fmtKrw(r.estimatedKrw) },
    {
      key: 'gain',
      label: copy.plan.gain,
      align: 'right' as const,
      render: (r: Instruction) =>
        r.gainKrw == null && r.usGainUsd == null ? (
          <span className="text-ink-3">{EMPTY_VALUE}</span>
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
    { key: 'tier', label: copy.plan.tier, render: (r: Instruction) => (r.tier ? <Badge tone={r.tier === 'loss' ? 'success' : r.tier === 'short_term' ? 'warning' : 'neutral'}>{copy.tiers[r.tier]}</Badge> : <span className="text-ink-3">{EMPTY_VALUE}</span>) },
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
        <Panel spacing="mt-4">
          <div className="text-caption font-medium text-ink">{copy.plan.skippedTitle}</div>
          <Note>{copy.plan.skippedNote}</Note>
          <ul className="mt-1 space-y-1">
            {skippedOut.map((id, index) => (
              <li key={index} className="flex items-center gap-2 text-label">
                <Checkbox name="skip" value={id} defaultChecked aria-label={`${copy.plan.skip} ${describe(id)}`} />
                <span className="text-ink-2">{describe(id)}</span>
              </li>
            ))}
          </ul>
        </Panel>
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
          <Callout tone="warning" emphasis="strong" size="label" as="p" spacing="mb-3">
            {copy.plan.policyChanged(fmtDateTime(changedAt, language))}
          </Callout>
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
        {closeInstead && (
          <form action={closeWithoutTrades} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <SubmitButton variant="solid">{copy.plan.closeNoTrades}</SubmitButton>
            <span className="text-label text-ink-3">{copy.plan.closeNoTradesNote}</span>
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
        {!open && <Note size="caption" spacing="below-3">{copy.fills.notOpen}</Note>}
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
                            <Input size="sm" type="number" step="any" name="quantity" aria-label={copy.fills.quantity} defaultValue={fill?.quantity ?? ''} className="w-24 text-right" />
                          </label>
                          <label className="text-label text-ink-3">
                            <span className="block">{copy.fills.price} ({i.currency})</span>
                            <Input size="sm" type="number" step="any" name="price" aria-label={copy.fills.price} defaultValue={fill?.price ?? ''} className="w-28 text-right" />
                          </label>
                        </>
                      )}
                      <label className="text-label text-ink-3">
                        <span className="block">{copy.fills.date}</span>
                        <Input size="sm" type="date" name="date" defaultValue={fill?.date ?? today} className="w-36" />
                      </label>
                      <label className="min-w-[12rem] flex-1 text-label text-ink-3">
                        <span className="block">{copy.fills.note}</span>
                        <Input size="sm" type="text" name="note" aria-label={copy.fills.note} maxLength={500} defaultValue={fill?.note ?? ''} className="w-full" />
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
            <Note size="inherit">{copy.reconciliation.at(fmtDateTime(rec.at, language))}</Note>
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

/** Which "Next:" line the status card shows; a plan with nothing to trade says to close the proposal instead. */
function proposalNextKey(proposal: Proposal): keyof Copy['statusCard']['next'] {
  if (canCloseWithoutTrades(proposal)) return proposal.status === 'draft' ? 'draft_hold_empty' : 'targets_approved_empty'
  if (proposal.status === 'draft') return proposal.targetChange.decision === 'hold' ? 'draft_hold' : 'draft_change'
  return proposal.status
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
  const nextKey = proposalNextKey(proposal)
  const base = `/rebalance/proposals/${encodeURIComponent(proposal.id)}`
  // Approving targets wrote them to the policy; rejecting afterwards leaves them there.
  const targetsWritten = proposal.status === 'targets_approved' || (proposal.status === 'plan_approved' && !hold)

  return (
    <>
      <PageHeader
        autoRefresh={false}
        eyebrow={routeSection('/rebalance', language)}
        {...proposalHeading(copy, proposal.id)}
        subtitle={copy.subtitle(copy.kinds[proposal.kind], fmtDateShort(proposal.createdAt, language), fmtDateShort(proposal.expiresAt, language))}
        action={<TextLink href="/rebalance">{copy.back}</TextLink>}
      />

      <Panel text="caption-2" spacing="mb-4" role="note">
        {copy.disclaimer}
      </Panel>

      {doneMessage && <Callout tone="success" emphasis="strong" size="caption" role="status" spacing="mb-4">{doneMessage}</Callout>}
      {errorMessage && (
        <Callout tone="warning" emphasis="strong" size="caption" role="status" spacing="mb-4">
          <strong className="font-medium">{copy.errorTitle}:</strong> {errorMessage}
        </Callout>
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

      <Tabs label={copy.title} items={tabs.map((t) => ({ key: t, href: `${base}?tab=${t}`, label: copy.tabs[t] }))} current={tab} />

      {tab === 'summary' && <SummaryTab proposal={proposal} copy={copy} language={language} />}
      {tab === 'targets' && <TargetsTab proposal={proposal} copy={copy} />}
      {tab === 'plan' && <PlanTab proposal={proposal} copy={copy} language={language} />}
      {tab === 'fills' && <FillsTab proposal={proposal} copy={copy} language={language} />}
    </>
  )
}
