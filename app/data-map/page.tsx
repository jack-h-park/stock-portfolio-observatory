import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui'
import { getMeta, getSourceFiles } from '@/lib/adapters/portfolio-db'
import { fmtDateTime, fmtNumber, shortHash } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default function DataMapPage() {
  const meta = getMeta()
  const rows = getSourceFiles()
  return (
    <>
      <PageHeader eyebrow="System" title="Data Map" emphasis="Map" subtitle={`Payload directory: ${meta.payload_dir}`} />
      <Card title="Source TSV fingerprints">
        <DataTable
          rows={rows}
          columns={[
            { key: 'name', label: 'Dataset' },
            { key: 'filename', label: 'File' },
            { key: 'row_count', label: 'Rows', align: 'right', render: (r) => fmtNumber(r.row_count) },
            { key: 'bytes', label: 'Bytes', align: 'right', render: (r) => fmtNumber(r.bytes) },
            { key: 'mtime_ms', label: 'Modified', render: (r) => fmtDateTime(new Date(r.mtime_ms).toISOString()) },
            { key: 'sha256', label: 'SHA-256', render: (r) => <code className="font-mono text-[11px]">{shortHash(r.sha256)}</code> },
          ]}
        />
      </Card>
    </>
  )
}
