import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, StatCard, type Tone } from '@/components/ui'
import { getMeta, getSourceInventory } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtNumber, shortHash } from '@/lib/format'

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

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Used" value={fmtNumber(inventory.summary.used)} tone="success" />
        <StatCard label="Unused" value={fmtNumber(inventory.summary.unused)} tone={inventory.summary.unused ? 'warning' : 'neutral'} />
        <StatCard label="Drift" value={fmtNumber(inventory.summary.drift)} tone={inventory.summary.drift ? 'warning' : 'neutral'} />
        <StatCard label="Missing" value={fmtNumber(inventory.summary.missing)} tone={inventory.summary.missing ? 'danger' : 'neutral'} />
        <StatCard label="Inventory Size" value={fmtBytes(inventory.summary.totalBytes)} />
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
