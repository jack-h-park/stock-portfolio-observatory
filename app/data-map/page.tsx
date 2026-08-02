import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, type Tone } from '@/components/ui'
import { getMeta, getSourceInventory } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtNumber, shortHash } from '@/lib/format'
import { GLOSSARY } from '@/lib/glossary'

export const dynamic = 'force-dynamic'

function statusTone(status: string): Tone {
  if (status === 'used') return 'success'
  if (status === 'unused') return 'warning'
  if (status === 'drift') return 'warning'
  return 'danger'
}

function fmtBytes(value: number | null | undefined) {
  const n = Number(value ?? 0)
  if (n >= 1024 * 1024 * 1024) return `${fmtNumber(n / (1024 * 1024 * 1024), 1)} GB`
  if (n >= 1024 * 1024) return `${fmtNumber(n / (1024 * 1024), 1)} MB`
  if (n >= 1024) return `${fmtNumber(n / 1024, 1)} KB`
  return `${fmtNumber(n)} B`
}

export default function DataMapPage() {
  const meta = getMeta()
  const inventory = getSourceInventory()
  const actionItems = inventory.items.filter((item) => item.status !== 'used').slice(0, 20)
  const reviewCount = inventory.summary.missing + inventory.summary.drift + inventory.summary.unused
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Data Map"
        emphasis="Map"
        subtitle={`Source inventory for ${inventory.dataDir}. Last ingest: ${fmtDateTime(meta.ingested_at)}.`}
        action={
          inventory.summary.missing || inventory.summary.drift || inventory.summary.unused ? (
            <Badge tone="warning">{fmtNumber(inventory.summary.missing + inventory.summary.drift + inventory.summary.unused)} item(s) to review</Badge>
          ) : (
            <Badge tone="success">All sources mapped</Badge>
          )
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.9fr)]">
        <MetricHeroCard
          title="Items to Review"
          info="Source files that are unused, drifted, or missing. This is the first signal for whether the data map needs attention."
          eyebrow="Inventory headline"
          value={fmtNumber(reviewCount)}
          hint={reviewCount ? 'Unmapped, drifted, or missing sources' : 'All tracked sources are mapped'}
        >
          <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-3">
            <MetricField
              label="Unused"
              value={fmtNumber(inventory.summary.unused)}
              hint="Present but not used"
              tone={inventory.summary.unused ? 'warning' : 'success'}
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Drift"
              value={fmtNumber(inventory.summary.drift)}
              info={GLOSSARY.drift.description}
              hint="Changed versus expected"
              tone={inventory.summary.drift ? 'warning' : 'success'}
              valueClassName="text-[18px]"
            />
            <MetricField
              label="Missing"
              value={fmtNumber(inventory.summary.missing)}
              hint="Expected but absent"
              tone={inventory.summary.missing ? 'danger' : 'success'}
              valueClassName="text-[18px]"
            />
          </div>
        </MetricHeroCard>

        <Card title="Inventory Coverage" info="Mapped source count and total inventory footprint from the latest ingest.">
          <div className="flex min-h-[16rem] flex-col justify-between gap-4">
            <div className="space-y-4">
              <MetricField
                label="Used"
                value={fmtNumber(inventory.summary.used)}
                hint="Sources mapped into the data model"
                tone="success"
                valueClassName="text-[28px]"
              />
              <div className="h-px bg-line-subtle" />
              <MetricField
                label="Inventory Size"
                value={fmtBytes(inventory.summary.totalBytes)}
                hint="Total bytes across tracked sources"
                valueClassName="text-[18px]"
              />
            </div>
            <div className="rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-3">
              Read order: review queue first, then coverage, then full file inventory.
            </div>
          </div>
        </Card>
      </div>

      <Card title="Inventory review queue" accent={actionItems.length > 0}>
        {actionItems.length === 0 ? (
          <EmptyState ok>No unmapped, drifted, or missing source files</EmptyState>
        ) : (
          <DataTable
            rows={actionItems}
            columns={[
              { key: 'status', label: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
              { key: 'category', label: 'Category' },
              { key: 'relativePath', label: 'File', render: (r) => <span className="block max-w-[34rem] truncate">{r.relativePath}</span> },
              { key: 'bytes', label: 'Size', align: 'right', render: (r) => fmtBytes(r.bytes) },
              { key: 'detail', label: 'Detail', render: (r) => <span className="text-[11px] text-ink-3">{r.detail}</span> },
            ]}
          />
        )}
      </Card>

      <Card title="Full source inventory" className="mt-5">
        <DataTable
          rows={inventory.items}
          columns={[
            { key: 'status', label: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
            { key: 'category', label: 'Category' },
            { key: 'name', label: 'Dataset' },
            { key: 'relativePath', label: 'Path', render: (r) => <span className="block max-w-[32rem] truncate">{r.relativePath}</span> },
            { key: 'rowCount', label: 'Rows', align: 'right', render: (r) => (r.rowCount == null ? 'n/a' : fmtNumber(r.rowCount)) },
            { key: 'bytes', label: 'Size', align: 'right', render: (r) => fmtBytes(r.bytes) },
            { key: 'mtimeMs', label: 'Modified', render: (r) => (r.mtimeMs ? fmtDateTime(new Date(r.mtimeMs).toISOString()) : 'n/a') },
            { key: 'sha256', label: 'SHA-256', render: (r) => (r.sha256 ? <code className="font-mono text-[11px]">{shortHash(r.sha256)}</code> : 'n/a') },
          ]}
        />
      </Card>
    </>
  )
}
