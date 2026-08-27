import { PageHeader } from '@/components/PageHeader'
import { FreshnessRows } from '@/components/Freshness'
import { Badge, Card, EmptyState, Label, marketTone, type Tone } from '@/components/ui'
import { getAccountCoverage, getEvidenceReports, getMeta, getOperationalHealth, getOverview, getReconciliationReview, getRefreshRuns, getValidationChecks, type ReconciliationReview } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtDuration, fmtNumber } from '@/lib/format'
import { getLanguage } from '@/lib/i18n-server'
import { getUiCopy } from '@/lib/ui-copy'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

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
function reconciliationRows(review: ReconciliationReview): ReconciliationRow[] {
  const capped = review.positionBreaks.length >= POSITION_BREAK_CAP
  return review.coverage
    .filter((c) => c.holding_positions > 0 || c.lot_positions > 0)
    .map((c) => {
      const breaks = review.positionBreaks.filter((b) => b.market === c.market && b.brokerage === c.brokerage)
      const key = `${c.market}:${c.brokerage}`
      if (c.lot_positions === 0) return { key, market: c.market, brokerage: c.brokerage, tone: 'warning', label: 'No lot detail' }
      if (breaks.length === 0) return { key, market: c.market, brokerage: c.brokerage, tone: 'success', label: 'Matched' }
      const tone: Tone = breaks.some((b) => b.status === 'quantity_break') ? 'danger' : 'warning'
      const count = `${fmtNumber(breaks.length)}${capped ? '+' : ''}`
      return { key, market: c.market, brokerage: c.brokerage, tone, label: `${count} ${breaks.length === 1 && !capped ? 'break' : 'breaks'}` }
    })
}

export default async function HealthPage() {
  const language = await getLanguage()
  const uiCopy = getUiCopy(language)
  const freshnessLabels = uiCopy.freshness.labels
  const runStatusLabels = uiCopy.runStatus
  const meta = getMeta()
  const overview = getOverview()
  const checks = getValidationChecks()
  const evidence = getEvidenceReports()
  const operational = getOperationalHealth()
  const accountCoverage = getAccountCoverage()
  const refreshRuns = getRefreshRuns()
  const reconciliation = reconciliationRows(getReconciliationReview())
  const reconciliationBreaks = reconciliation.filter((row) => row.tone !== 'success').length
  const latestRefresh = refreshRuns[0]
  const failed = checks.filter((c) => c.status !== 'pass')
  const errors = failed.filter((c) => c.severity === 'error')
  const fx = overview.fxRates.find((r: any) => r.from_currency === 'USD' && r.to_currency === 'KRW')
  const issueCount = failed.length + operational.staleItems.length
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Data Health"
        emphasis="Health"
        subtitle={`The latest data check ran at ${fmtDateTime(meta.ingested_at)}.`}
        action={issueCount ? <Badge tone={errors.length || operational.summary.missing ? 'danger' : 'warning'}>Needs review {issueCount}</Badge> : <Badge tone="success">All checks passed</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Account coverage" info="How far each brokerage account's source data reaches. This is separate from file integrity." accent={accountCoverage.actionNeeded > 0} className="xl:col-span-3" action={<Link href="/data-ops#account-coverage" className="text-caption font-medium text-info hover:underline">Open updates</Link>}>
          <div className="grid grid-cols-3 gap-3 text-caption">
            <div><div className="text-caption text-ink-3">Action needed</div><div className="font-medium tabular-nums text-danger">{fmtNumber(accountCoverage.actionNeeded)}</div></div>
            <div><div className="text-caption text-ink-3">Due soon</div><div className="font-medium tabular-nums text-warning">{fmtNumber(accountCoverage.dueSoon)}</div></div>
            <div><div className="text-caption text-ink-3">Current</div><div className="font-medium tabular-nums text-success">{fmtNumber(accountCoverage.current)}</div></div>
          </div>
          <div className="mt-3 text-label leading-relaxed text-ink-3">The account table names the exact document, account, cutoff date, and destination path. “Fresh” below continues to mean file integrity.</div>
        </Card>
        <Card title="Operational Status" info="Shows whether prices, FX rates, and source files are collected normally and agree with each other." accent={issueCount > 0}>
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
          <div className="mt-3 text-label leading-relaxed text-ink-3">
            Korean and US stock prices are marked stale after 36 hours, crypto after 8 hours, and FX after 7 days. Source files are marked changed when their size or modified time differs from ingestion.
          </div>
        </Card>

        <Card title="Price & FX Freshness">
          <FreshnessRows items={operational.snapshots} language={language} />
        </Card>

        <Card
          title="Reconciliation Coverage"
          info="Whether each brokerage's holding summary agrees with its tax-lot records in the latest ingest. Breaks are counted per position; the Reconciliation page lists them."
          accent={reconciliationBreaks > 0}
          action={<Link href="/reconciliation" className="text-caption font-medium text-info hover:underline">Open reconciliation</Link>}
        >
          {reconciliation.length === 0 ? (
            <EmptyState>No holdings or tax lots to reconcile</EmptyState>
          ) : (
            <ul className="space-y-2 text-body text-ink-2">
              {reconciliation.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge tone={marketTone(row.market)}>{row.market}</Badge>
                    <span className="truncate">{row.brokerage} holdings ↔ tax lots</span>
                  </span>
                  <Badge tone={row.tone}>{row.label}</Badge>
                </li>
              ))}
              <li className="text-label leading-relaxed text-ink-3">
                Merrill exports positions under two layouts, and only one carries tax-lot detail. When the flat layout was the last download, its lots
                drop out of the ingest and the row above reads “No lot detail” until the tax-lot view is exported again. Its reinvestments also arrive
                as one dateless grouped lot per position, so the match is by quantity and cost, not by acquisition date.
              </li>
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Refresh History"
        accent={latestRefresh?.status === 'failed'}
        action={
          latestRefresh ? (
            <Badge tone={statusTone(runStatusLabel(latestRefresh))}>{displayRunStatus(runStatusLabel(latestRefresh), runStatusLabels)}</Badge>
          ) : undefined
        }
      >
        {!latestRefresh ? (
          <EmptyState
            hint={`Run history is read from ${getMeta().refresh_runs_path ?? 'data/refresh-runs.json'}.`}
          >
            No refresh runs recorded
          </EmptyState>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 text-caption sm:grid-cols-4">
              <div>
                <div className="text-caption text-ink-3">Latest start</div>
                <div className="font-medium tabular-nums text-ink">{fmtDateTime(latestRefresh.startedAt)}</div>
              </div>
              <div>
                <div className="text-caption text-ink-3">Duration</div>
                <div className="font-medium tabular-nums text-ink">{fmtDuration(latestRefresh.durationMs)}</div>
              </div>
              <div>
                <div className="text-caption text-ink-3">Completed steps</div>
                <div className="font-medium tabular-nums text-ink">
                  {fmtNumber(latestRefresh.steps.filter((step) => step.status === 'success').length)} / {fmtNumber(latestRefresh.steps.length)}
                </div>
              </div>
              <div>
                <div className="text-caption text-ink-3">Total runs</div>
                <div className="font-medium tabular-nums text-ink">{fmtNumber(refreshRuns.length)}</div>
              </div>
            </div>

            {latestRefresh.degradedSteps.length > 0 ? (
              <div className="rounded-md border border-[color:var(--accent-warning)]/30 bg-[color:var(--accent-warning)]/5 px-3 py-2 text-label leading-relaxed text-ink-2">
                <span className="font-medium text-ink">Degraded, not failed.</span>{' '}
                {latestRefresh.degradedSteps.join(', ')} failed but {latestRefresh.degradedSteps.length > 1 ? 'are' : 'is'} marked
                optional, so the run continued and every figure is complete. The source behind{' '}
                {latestRefresh.degradedSteps.length > 1 ? 'those steps is' : 'that step is'} running on its previous snapshot —
                the freshness rows above say how old.
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
                    <span className="text-caption tabular-nums text-ink-3">exit {step.exitCode}</span>
                  ) : null}
                </li>
              ))}
            </ul>

            {latestRefresh.steps.some((step) => step.status === 'failed' && step.stderrTail) ? (
              <div className="rounded-md border border-line-subtle bg-surface p-3">
                <Label className="mb-2">Latest error tail</Label>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-label leading-relaxed text-danger">
                  {latestRefresh.steps.find((step) => step.status === 'failed' && step.stderrTail)?.stderrTail}
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="FX snapshot">
          {fx ? (
            <div className="space-y-2 text-body text-ink-2">
              <div className="flex items-center justify-between gap-3">
                <span>USD/KRW</span>
                <span className="font-medium tabular-nums text-ink">{fmtNumber(fx.rate, 2)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>As of</span>
                <span className="tabular-nums text-ink-3">{fx.as_of_date}</span>
              </div>
              <div className="text-label leading-relaxed text-ink-3">{fx.source}</div>
            </div>
          ) : (
            <EmptyState>No FX rate configured</EmptyState>
          )}
        </Card>

      </div>

      <Card title="Freshness issues" accent={operational.staleItems.length > 0}>
        {operational.staleItems.length === 0 ? (
          <EmptyState ok>No stale, drifted, or missing operational inputs</EmptyState>
        ) : (
          <FreshnessRows items={operational.staleItems} />
        )}
      </Card>

      <Card title="Validation checks" className="mt-5" accent={failed.length > 0}>
        {checks.length === 0 ? (
          <EmptyState>No checks found</EmptyState>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {checks.map((check) => (
              <li key={check.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                <Badge tone={check.status === 'pass' ? 'success' : check.severity === 'warning' ? 'warning' : 'danger'}>
                  {check.status}
                </Badge>
                <span className="min-w-0 flex-1 text-body font-medium text-ink">{check.name}</span>
                <span className="text-caption text-ink-3">{check.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="PDF evidence" className="mt-5">
        {evidence.length === 0 ? (
          <EmptyState>No PDF evidence extracted</EmptyState>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {evidence.map((report) => {
              const metrics = parseMetrics(report.metrics_json)
              return (
                <li key={report.id} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
                  <Badge tone={report.category === 'us_gain_loss_pdf' ? 'info' : 'success'}>
                    {report.category === 'us_gain_loss_pdf' ? 'Gain/Loss' : '1099'}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{report.filename}</span>
                  <span className="text-caption tabular-nums text-ink-3">{fmtNumber(report.pages ?? 0)} pages</span>
                  <span className="text-caption tabular-nums text-ink-3">{fmtNumber(report.row_count ?? 0)} rows</span>
                  {metrics.tax_cost_usd != null ? (
                    <span className="text-caption tabular-nums text-ink-3">${fmtNumber(metrics.tax_cost_usd, 2)} tax cost</span>
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
