import { DataTable } from '@/components/DataTable'
import { FreshnessRows } from '@/components/Freshness'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, type Tone } from '@/components/ui'
import { getMeta, getOperationalHealth, getSourceInventory } from '@/lib/adapters/portfolio-db'
import { fmtBytes, fmtDateTime, fmtNumber, shortHash } from '@/lib/format'
import { getGlossary } from '@/lib/glossary'
import { formatSort, parseSort, sortRows, type TableSort } from '@/lib/table-sort'
import { getLanguage } from '@/lib/i18n-server'
import { getPageCopy } from '@/lib/ui-copy'

export const dynamic = 'force-dynamic'

function statusTone(status: string): Tone {
  if (status === 'used') return 'success'
  if (status === 'derived' || status === 'archive') return 'neutral'
  if (status === 'unused') return 'info'
  if (status === 'drift') return 'warning'
  return 'danger'
}

function retentionTone(retention: string): Tone {
  if (retention === 'active') return 'success'
  if (retention === 'fallback') return 'info'
  if (retention === 'derived') return 'neutral'
  if (retention === 'archive') return 'neutral'
  return 'warning'
}


export default async function DataMapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  // Newest file first: the inventory is read to answer "what arrived recently".
  const sort = parseSort(params.sort, { key: 'mtimeMs', direction: 'desc' })
  const sortHref = (next: TableSort) => `/data-map?sort=${formatSort(next)}#inventory`
  const language = await getLanguage()
  const copy = getPageCopy('dataMap', language)
  const glossary = getGlossary(language)
  const meta = getMeta()
  const inventory = getSourceInventory()
  const operational = getOperationalHealth()
  const actionItems = inventory.items.filter((item) => ['drift', 'missing'].includes(item.status)).slice(0, 20)
  const reviewCount = inventory.summary.missing + inventory.summary.drift
  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        emphasis={copy.emphasis}
        subtitle={copy.subtitle(inventory.dataDir, fmtDateTime(meta.ingested_at))}
        action={
          inventory.summary.missing || inventory.summary.drift ? (
            <Badge tone="warning">{copy.reviewItems(fmtNumber(reviewCount))}</Badge>
          ) : (
            <Badge tone="success">{copy.allMapped}</Badge>
          )
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title={copy.itemsToReview}
          info={copy.itemsToReviewInfo}
          eyebrow={copy.inventoryHeadline}
          value={fmtNumber(reviewCount)}
          hint={reviewCount ? copy.issueHint : copy.cleanHint}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label={copy.unused}
              value={fmtNumber(inventory.summary.unused)}
              hint={copy.unusedHint}
              tone="info"
              valueClassName="text-title"
            />
            <MetricField
              label={copy.drift}
              value={fmtNumber(inventory.summary.drift)}
              info={glossary.drift.description}
              hint={copy.driftHint}
              tone={inventory.summary.drift ? 'warning' : 'success'}
              valueClassName="text-title"
            />
            <MetricField
              label={copy.missing}
              value={fmtNumber(inventory.summary.missing)}
              hint={copy.missingHint}
              tone={inventory.summary.missing ? 'danger' : 'success'}
              valueClassName="text-title"
            />
          </div>
        </MetricHeroCard>

        <Card title={copy.inventoryCoverage} info={copy.inventoryCoverageInfo}>
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label={copy.used}
                value={fmtNumber(inventory.summary.used)}
                hint={copy.usedHint}
                tone="success"
                valueClassName="text-metric"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label={copy.inventorySize}
                value={fmtBytes(inventory.summary.totalBytes)}
                hint={copy.inventorySizeHint}
                valueClassName="text-title"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-label leading-relaxed text-ink-3">
              {copy.readOrder}
            </div>
          </div>
        </Card>
      </div>

      <Card title={copy.reviewQueue} accent={actionItems.length > 0}>
        <div className="border-b border-line-subtle bg-surface px-4 py-3 text-label leading-relaxed text-ink-3">
          {copy.retentionGuide}
        </div>
        {actionItems.length === 0 ? (
          <EmptyState ok>{copy.noQueue}</EmptyState>
        ) : (
          <DataTable
            rows={actionItems}
            columns={[
              { key: 'status', label: copy.columns.status, render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
              { key: 'category', label: copy.columns.category },
              { key: 'relativePath', label: copy.columns.file, render: (r) => <span className="block max-w-[34rem] truncate">{r.relativePath}</span> },
              { key: 'bytes', label: copy.columns.size, align: 'right', render: (r) => fmtBytes(r.bytes) },
              { key: 'retention', label: copy.columns.retention, render: (r) => <div className="min-w-[14rem]"><Badge tone={retentionTone(r.retention)}>{copy.retentionLabels[r.retention as keyof typeof copy.retentionLabels]}</Badge><div className="mt-1 text-label text-ink-3">{r.retentionReason}</div></div> },
              { key: 'detail', label: copy.columns.detail, render: (r) => <span className="text-label text-ink-3">{r.detail}</span> },
            ]}
          />
        )}
      </Card>

      {/* Whether a source file changed after the ingest read it. This lived on
          /health, which is about whether the pipeline is running; a file that
          moved under the ingest is a fact about the file, and belongs beside
          the inventory that lists it. */}
      <Card
        title={copy.driftMonitor}
        info={copy.driftMonitorInfo}
        className="mt-5"
        accent={operational.sourceDrift.some((item) => item.status !== 'fresh')}
      >
        <FreshnessRows items={operational.sourceDrift} language={language} />
      </Card>

      <Card title={copy.fullInventory} className="mt-5">
        <DataTable
          sort={sort}
          sortHref={sortHref}
          rows={sortRows(inventory.items, sort, (row, key) => (row as Record<string, any>)[key])}
          columns={[
            { key: 'status', sortable: true, sortFirst: 'asc', label: copy.columns.status, render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
            { key: 'category', sortable: true, sortFirst: 'asc', label: copy.columns.category },
            { key: 'name', sortable: true, sortFirst: 'asc', label: copy.columns.dataset },
            { key: 'relativePath', sortable: true, sortFirst: 'asc', label: copy.columns.path, render: (r) => <span className="block max-w-[32rem] truncate">{r.relativePath}</span> },
            { key: 'rowCount', sortable: true, sortFirst: 'desc', label: copy.columns.rows, align: 'right', render: (r) => (r.rowCount == null ? 'n/a' : fmtNumber(r.rowCount)) },
            { key: 'bytes', sortable: true, sortFirst: 'desc', label: copy.columns.size, align: 'right', render: (r) => fmtBytes(r.bytes) },
            { key: 'mtimeMs', sortable: true, sortFirst: 'desc', label: copy.columns.modified, render: (r) => (r.mtimeMs ? fmtDateTime(new Date(r.mtimeMs).toISOString()) : 'n/a') },
            { key: 'sha256', label: copy.columns.sha, render: (r) => (r.sha256 ? <code className="font-mono text-label">{shortHash(r.sha256)}</code> : 'n/a') },
            { key: 'retention', label: copy.columns.retention, render: (r) => <div className="min-w-[16rem]"><Badge tone={retentionTone(r.retention)}>{copy.retentionLabels[r.retention as keyof typeof copy.retentionLabels]}</Badge><div className="mt-1 text-label leading-relaxed text-ink-3">{r.retentionReason}</div></div> },
          ]}
        />
      </Card>
    </>
  )
}
