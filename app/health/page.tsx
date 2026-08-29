import { PageHeader } from '@/components/PageHeader'
import { FreshnessRows } from '@/components/Freshness'
import { Badge, Card, EmptyState, Label, marketTone, type Tone } from '@/components/ui'
import { getAccountCoverage, getEvidenceReports, getMeta, getOperationalHealth, getOverview, getReconciliationReview, getRefreshRuns, getValidationChecks, type ReconciliationReview } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtDuration, fmtNumber } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy, getUiCopy } from '@/lib/ui-copy'

type HealthCopy = ReturnType<typeof getPageCopy<'health'>>
import Link from 'next/link'
import { routeMetadata } from '@/lib/page-names'
import { CardRow } from '@/components/layout'

export const dynamic = 'force-dynamic'
export const generateMetadata = routeMetadata('/health')

function parseMetrics(value: string | null) {
  if (!value) return {} as Record<string, any>
  try {
    return JSON.parse(value) as Record<string, any>
  } catch {
    return {} as Record<string, any>
  }
}

function statusTone(status: string): Tone {
  if (status === 'success') return 'success'
  if (status === 'degraded') return 'warning'
  if (status === 'running') return 'info'
  return 'danger'
}

/**
 * A run that succeeded but lost an optional step reads as "degraded" here.
 *
 * A plain "success" badge would hide that a source is running on older data,
 * and a "failed" badge would overstate it — the figures are complete either
 * way. The step list below still shows exactly which step failed.
 */
function runStatusLabel(run: { status: string; degradedSteps: string[] }) {
  return run.status === 'success' && run.degradedSteps.length > 0 ? 'degraded' : run.status
}

function displayRunStatus(status: string, labels: Record<string, string>) {
  return labels[status] ?? status
}

/**
 * The adapter caps the break list at this many rows, so once the list is
 * full a per-brokerage count is a floor, not a total.
 */
const POSITION_BREAK_CAP = 100

type ReconciliationRow = {
  key: string
  market: string
  brokerage: string
  tone: Tone
  label: string
}

/**
 * One row per brokerage the reconciliation run covers, carrying the same
 * break state /reconciliation shows — not a literal.
 *
 * A brokerage whose holdings have no tax lots behind them cannot be
 * reconciled at all, and says so instead of passing by default.
 */
function reconciliationRows(review: ReconciliationReview, copy: HealthCopy): ReconciliationRow[] {
  const capped = review.positionBreaks.length >= POSITION_BREAK_CAP
  return review.coverage
    .filter((c) => c.holding_positions > 0 || c.lot_positions > 0)
    .map((c) => {
      const breaks = review.positionBreaks.filter((b) => b.market === c.market && b.brokerage === c.brokerage)
      const key = `${c.market}:${c.brokerage}`
      if (c.lot_positions === 0) return { key, market: c.market, brokerage: c.brokerage, tone: 'warning', label: copy.noLotDetail }
      if (breaks.length === 0) return { key, market: c.market, brokerage: c.brokerage, tone: 'success', label: copy.matched }
      const tone: Tone = breaks.some((b) => b.status === 'quantity_break') ? 'danger' : 'warning'
      return { key, market: c.market, brokerage: c.brokerage, tone, label: copy.breaks(breaks.length, capped) }
    })
}

export default async function HealthPage() {
  const language = await getLanguage()
  const uiCopy = getUiCopy(language)
  const copy = getPageCopy('health', language)
  const freshnessLabels = uiCopy.freshness.labels
  const runStatusLabels = uiCopy.runStatus
  const meta = getMeta()
  const overview = getOverview()
  const checks = getValidationChecks()
  const evidence = getEvidenceReports()
  const operational = getOperationalHealth()
  const accountCoverage = getAccountCoverage()
  const refreshRuns = getRefreshRuns()
  const reconciliation = reconciliationRows(getReconciliationReview(), copy)
  const reconciliationBreaks = reconciliation.filter((row) => row.tone !== 'success').length
  const latestRefresh = refreshRuns[0]
  const failed = checks.filter((c) => c.status !== 'pass')
  const errors = failed.filter((c) => c.severity === 'error')
  const fx = overview.fxRates.find((r: any) => r.from_currency === 'USD' && r.to_currency === 'KRW')
  const issueCount = failed.length + operational.staleItems.length
  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(fmtDateTime(meta.ingested_at))}
        action={issueCount ? <Badge tone={errors.length || operational.summary.missing ? 'danger' : 'warning'}>{copy.needsReview(fmtNumber(issueCount))}</Badge> : <Badge tone="success">{copy.allChecksPassed}</Badge>}
      />

      <CardRow columns={3}>
        <Card title={copy.accountCoverage} info={copy.accountCoverageInfo} accent={accountCoverage.actionNeeded > 0} className="xl:col-span-3" action={<Link href="/data-ops#account-coverage" className="text-caption font-medium text-info hover:underline">{copy.openUpdates}</Link>}>
          <div className="grid grid-cols-3 gap-3 text-caption">
            <div><div className="text-caption text-ink-3">{copy.actionNeeded}</div><div className="font-medium tabular-nums text-danger">{fmtNumber(accountCoverage.actionNeeded)}</div></div>
            <div><div className="text-caption text-ink-3">{copy.dueSoon}</div><div className="font-medium tabular-nums text-warning">{fmtNumber(accountCoverage.dueSoon)}</div></div>
            <div><div className="text-caption text-ink-3">{copy.current}</div><div className="font-medium tabular-nums text-success">{fmtNumber(accountCoverage.current)}</div></div>
          </div>
          <div className="mt-3 text-label leading-relaxed text-ink-3">{copy.accountCoverageNote}</div>
        </Card>
        <Card title={copy.operationalStatus} info={copy.operationalStatusInfo} accent={issueCount > 0}>
          <div className="grid grid-cols-2 gap-3 text-caption">
            <div>
              <div className="text-caption text-ink-3">{freshnessLabels.fresh}</div>
              <div className="font-medium tabular-nums text-success">{fmtNumber(operational.summary.fresh)}</div>
            </div>
            <div>
              <div className="text-caption text-ink-3">{freshnessLabels.stale}</div>
              <div className="font-medium tabular-nums text-warning">{fmtNumber(operational.summary.stale)}</div>
            </div>
            <div>
              <div className="text-caption text-ink-3">{freshnessLabels.drift}</div>
              <div className="font-medium tabular-nums text-warning">{fmtNumber(operational.summary.drift)}</div>
            </div>
            <div>
              <div className="text-caption text-ink-3">{freshnessLabels.missing}</div>
              <div className="font-medium tabular-nums text-danger">{fmtNumber(operational.summary.missing)}</div>
            </div>
          </div>
          <div className="mt-3 text-label leading-relaxed text-ink-3">{copy.stalenessNote}</div>
        </Card>

        <Card title={copy.priceFxFreshness}>
          <FreshnessRows items={operational.snapshots} language={language} />
        </Card>

        <Card
          title={copy.reconciliationCoverage}
          info={copy.reconciliationCoverageInfo}
          accent={reconciliationBreaks > 0}
          action={<Link href="/reconciliation" className="text-caption font-medium text-info hover:underline">{copy.openReconciliation}</Link>}
        >
          {reconciliation.length === 0 ? (
            <EmptyState>{copy.nothingToReconcile}</EmptyState>
          ) : (
            <ul className="space-y-2 text-body text-ink-2">
              {reconciliation.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                    <span className="truncate">{copy.holdingsVsLots(row.brokerage)}</span>
                  </span>
                  <Badge tone={row.tone}>{row.label}</Badge>
                </li>
              ))}
              <li className="text-label leading-relaxed text-ink-3">{copy.merrillNote}</li>
            </ul>
          )}
        </Card>
      </CardRow>

      <Card
        title={copy.refreshHistory}
        accent={latestRefresh?.status === 'failed'}
        action={
          latestRefresh ? (
            <Badge tone={statusTone(runStatusLabel(latestRefresh))}>{displayRunStatus(runStatusLabel(latestRefresh), runStatusLabels)}</Badge>
          ) : undefined
        }
      >
        {!latestRefresh ? (
          <EmptyState
            hint={copy.refreshRunsHint(getMeta().refresh_runs_path ?? 'data/refresh-runs.json')}
          >
            {copy.noRefreshRuns}
          </EmptyState>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 text-caption sm:grid-cols-4">
              <div>
                <div className="text-caption text-ink-3">{copy.latestStart}</div>
                <div className="font-medium tabular-nums text-ink">{fmtDateTime(latestRefresh.startedAt)}</div>
              </div>
              <div>
                <div className="text-caption text-ink-3">{copy.duration}</div>
                <div className="font-medium tabular-nums text-ink">{fmtDuration(latestRefresh.durationMs)}</div>
              </div>
              <div>
                <div className="text-caption text-ink-3">{copy.completedSteps}</div>
                <div className="font-medium tabular-nums text-ink">
                  {fmtNumber(latestRefresh.steps.filter((step) => step.status === 'success').length)} / {fmtNumber(latestRefresh.steps.length)}
                </div>
              </div>
              <div>
                <div className="text-caption text-ink-3">{copy.totalRuns}</div>
                <div className="font-medium tabular-nums text-ink">{fmtNumber(refreshRuns.length)}</div>
              </div>
            </div>

            {latestRefresh.degradedSteps.length > 0 ? (
              <div className="rounded-md border border-[color:var(--accent-warning)]/30 bg-[color:var(--accent-warning)]/5 px-3 py-2 text-label leading-relaxed text-ink-2">
                <span className="font-medium text-ink">{copy.degradedLead}</span>{' '}
                {copy.degradedBody(latestRefresh.degradedSteps)}
              </div>
            ) : null}

            <ul className="divide-y divide-line-subtle">
              {latestRefresh.steps.map((step) => (
                <li key={`${latestRefresh.id}:${step.name}`} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
                  <Badge tone={statusTone(step.status)}>{displayRunStatus(step.status, runStatusLabels)}</Badge>
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{step.name}</span>
                  <span className="text-caption tabular-nums text-ink-3">{fmtDuration(step.durationMs)}</span>
                  <code className="font-mono text-label text-ink-3">{step.command}</code>
                  {step.exitCode != null ? (
                    <span className="text-caption tabular-nums text-ink-3">{copy.exitCode(String(step.exitCode))}</span>
                  ) : null}
                </li>
              ))}
            </ul>

            {latestRefresh.steps.some((step) => step.status === 'failed' && step.stderrTail) ? (
              <div className="rounded-md border border-line-subtle bg-surface p-3">
                <Label className="mb-2">{copy.latestErrorTail}</Label>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-label leading-relaxed text-danger">
                  {latestRefresh.steps.find((step) => step.status === 'failed' && step.stderrTail)?.stderrTail}
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <CardRow>
        <Card title={copy.fxSnapshot}>
          {fx ? (
            <div className="space-y-2 text-body text-ink-2">
              <div className="flex items-center justify-between gap-3">
                <span>USD/KRW</span>
                <span className="font-medium tabular-nums text-ink">{fmtNumber(fx.rate, 2)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{copy.asOf}</span>
                <span className="tabular-nums text-ink-3">{fx.as_of_date}</span>
              </div>
              <div className="text-label leading-relaxed text-ink-3">{fx.source}</div>
            </div>
          ) : (
            <EmptyState>{copy.noFxRate}</EmptyState>
          )}
        </Card>

      </CardRow>

      <Card title={copy.freshnessIssues} accent={operational.staleItems.length > 0}>
        {operational.staleItems.length === 0 ? (
          <EmptyState ok>{copy.noFreshnessIssues}</EmptyState>
        ) : (
          <FreshnessRows items={operational.staleItems} language={language} />
        )}
      </Card>

      <Card title={copy.validationChecks} className="mt-5" accent={failed.length > 0}>
        {checks.length === 0 ? (
          <EmptyState>{copy.noChecks}</EmptyState>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {checks.map((check) => (
              <li key={check.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                <Badge tone={check.status === 'pass' ? 'success' : check.severity === 'warning' ? 'warning' : 'danger'}>
                  {displayRunStatus(check.status, runStatusLabels)}
                </Badge>
                <span className="min-w-0 flex-1 text-body font-medium text-ink">{check.name}</span>
                <span className="text-caption text-ink-3">{check.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={copy.pdfEvidence} className="mt-5">
        {evidence.length === 0 ? (
          <EmptyState>{copy.noPdfEvidence}</EmptyState>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {evidence.map((report) => {
              const metrics = parseMetrics(report.metrics_json)
              return (
                <li key={report.id} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
                  <Badge tone={report.category === 'us_gain_loss_pdf' ? 'info' : 'success'}>
                    {report.category === 'us_gain_loss_pdf' ? copy.gainLoss : '1099'}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{report.filename}</span>
                  <span className="text-caption tabular-nums text-ink-3">{copy.pages(fmtNumber(report.pages ?? 0))}</span>
                  <span className="text-caption tabular-nums text-ink-3">{copy.rows(fmtNumber(report.row_count ?? 0))}</span>
                  {metrics.tax_cost_usd != null ? (
                    <span className="text-caption tabular-nums text-ink-3">{copy.taxCost(`$${fmtNumber(metrics.tax_cost_usd, 2)}`)}</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

    </>
  )
}
