import { PageHeader } from '@/components/PageHeader'
import { FreshnessRows } from '@/components/Freshness'
import { Badge, Card, EmptyState, type Tone } from '@/components/ui'
import { getEvidenceReports, getMeta, getOperationalHealth, getOverview, getRefreshRuns, getSourceFiles, getValidationChecks } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtDuration, fmtNumber, shortHash } from '@/lib/format'

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

export default function HealthPage() {
  const meta = getMeta()
  const overview = getOverview()
  const checks = getValidationChecks()
  const sources = getSourceFiles()
  const evidence = getEvidenceReports()
  const operational = getOperationalHealth()
  const refreshRuns = getRefreshRuns()
  const latestRefresh = refreshRuns[0]
  const failed = checks.filter((c) => c.status !== 'pass')
  const errors = failed.filter((c) => c.severity === 'error')
  const warnings = failed.filter((c) => c.severity === 'warning')
  const fx = overview.fxRates.find((r: any) => r.from_currency === 'USD' && r.to_currency === 'KRW')
  const issueCount = failed.length + operational.staleItems.length
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Data Health"
        emphasis="Health"
        subtitle={`Last validation ran ${fmtDateTime(meta.ingested_at)}.`}
        action={issueCount ? <Badge tone={errors.length || operational.summary.missing ? 'danger' : 'warning'}>{issueCount} issue(s)</Badge> : <Badge tone="success">All checks passing</Badge>}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Operational status" accent={issueCount > 0}>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Fresh</div>
              <div className="font-medium tabular-nums text-success">{fmtNumber(operational.summary.fresh)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Stale</div>
              <div className="font-medium tabular-nums text-warning">{fmtNumber(operational.summary.stale)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Drift</div>
              <div className="font-medium tabular-nums text-warning">{fmtNumber(operational.summary.drift)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Missing</div>
              <div className="font-medium tabular-nums text-danger">{fmtNumber(operational.summary.missing)}</div>
            </div>
          </div>
          <div className="mt-3 text-[11px] leading-relaxed text-ink-3">
            KR/US prices turn stale after 36h, crypto after 8h — a 24/7 book has no close to be as fresh as. FX turns stale after 7d. Source files drift when disk size or modified time no longer matches ingest.
          </div>
        </Card>

        <Card title="Price & FX freshness">
          <FreshnessRows items={operational.snapshots} />
        </Card>

        <Card title="Reconciliation coverage">
          <ul className="space-y-2 text-[13px] text-ink-2">
            <li className="flex items-center justify-between gap-3">
              <span>KR holdings ↔ lots</span>
              <Badge tone="success">reconciled</Badge>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span>Chase holdings ↔ lots</span>
              <Badge tone="success">reconciled</Badge>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span>Merrill holdings</span>
              <Badge tone="warning">summary-led</Badge>
            </li>
            <li className="text-[11px] leading-relaxed text-ink-3">
              Merrill lot detail excludes reinvestment buckets in the export, so the app uses its summary rows for positions and keeps lot rows as drilldown evidence.
            </li>
          </ul>
        </Card>
      </div>

      <Card
        title="Refresh run history"
        accent={latestRefresh?.status === 'failed'}
        action={
          latestRefresh ? (
            <Badge tone={statusTone(runStatusLabel(latestRefresh))}>{runStatusLabel(latestRefresh)}</Badge>
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
            <div className="grid gap-3 text-[12px] sm:grid-cols-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Latest start</div>
                <div className="font-medium tabular-nums text-ink">{fmtDateTime(latestRefresh.startedAt)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Duration</div>
                <div className="font-medium tabular-nums text-ink">{fmtDuration(latestRefresh.durationMs)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Steps</div>
                <div className="font-medium tabular-nums text-ink">
                  {fmtNumber(latestRefresh.steps.filter((step) => step.status === 'success').length)} / {fmtNumber(latestRefresh.steps.length)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">History</div>
                <div className="font-medium tabular-nums text-ink">{fmtNumber(refreshRuns.length)} run(s)</div>
              </div>
            </div>

            {latestRefresh.degradedSteps.length > 0 ? (
              <div className="rounded-md border border-[color:var(--accent-warning)]/30 bg-[color:var(--accent-warning)]/5 px-3 py-2 text-[11px] leading-relaxed text-ink-2">
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
                  <Badge tone={statusTone(step.status)}>{step.status}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{step.name}</span>
                  <span className="text-[12px] tabular-nums text-ink-3">{fmtDuration(step.durationMs)}</span>
                  <code className="font-mono text-[11px] text-ink-3">{step.command}</code>
                  {step.exitCode != null ? (
                    <span className="text-[12px] tabular-nums text-ink-3">exit {step.exitCode}</span>
                  ) : null}
                </li>
              ))}
            </ul>

            {latestRefresh.steps.some((step) => step.status === 'failed' && step.stderrTail) ? (
              <div className="rounded-md border border-line-subtle bg-surface p-3">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Latest error tail</div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-danger">
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
            <div className="space-y-2 text-[13px] text-ink-2">
              <div className="flex items-center justify-between gap-3">
                <span>USD/KRW</span>
                <span className="font-medium tabular-nums text-ink">{fmtNumber(fx.rate, 2)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>As of</span>
                <span className="tabular-nums text-ink-3">{fx.as_of_date}</span>
              </div>
              <div className="text-[11px] leading-relaxed text-ink-3">{fx.source}</div>
            </div>
          ) : (
            <EmptyState>No FX rate configured</EmptyState>
          )}
        </Card>

        <Card title="Source freshness">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink-2">Tracked files</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(sources.length)}</span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink-2">Rows observed</span>
              <span className="font-medium tabular-nums text-ink">{fmtNumber(sources.reduce((sum: number, s: any) => sum + Number(s.row_count || 0), 0))}</span>
            </div>
            <div className="text-[11px] leading-relaxed text-ink-3">
              Source file size, mtime, row count, and SHA-256 fingerprints are captured on every ingest, including KR/US price snapshots when present.
            </div>
          </div>
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
                <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">{check.name}</span>
                <span className="text-[12px] text-ink-3">{check.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Source drift monitor" className="mt-5" accent={operational.sourceDrift.some((item) => item.status !== 'fresh')}>
        <FreshnessRows items={operational.sourceDrift} />
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
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{report.filename}</span>
                  <span className="text-[12px] tabular-nums text-ink-3">{fmtNumber(report.pages ?? 0)} pages</span>
                  <span className="text-[12px] tabular-nums text-ink-3">{fmtNumber(report.row_count ?? 0)} rows</span>
                  {metrics.tax_cost_usd != null ? (
                    <span className="text-[12px] tabular-nums text-ink-3">${fmtNumber(metrics.tax_cost_usd, 2)} tax cost</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card title="Source fingerprints" className="mt-5">
        <ul className="divide-y divide-line-subtle">
          {sources.map((source: any) => (
            <li key={source.name} className="flex flex-col gap-1 py-2.5 lg:flex-row lg:items-center lg:gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{source.name}</span>
              <span className="text-[12px] tabular-nums text-ink-3">{fmtNumber(source.row_count)} rows</span>
              <span className="text-[12px] tabular-nums text-ink-3">{fmtDateTime(new Date(source.mtime_ms).toISOString())}</span>
              <code className="font-mono text-[11px] text-ink-3">{shortHash(source.sha256)}</code>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
