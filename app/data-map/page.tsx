import { DataTable } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Badge, Card, EmptyState, MetricField, MetricHeroCard, type Tone } from '@/components/ui'
import { getMeta, getSourceInventory } from '@/lib/adapters/portfolio-db'
import { fmtBytes, fmtDateTime, fmtNumber, shortHash } from '@/lib/format'
import { getGlossary } from '@/lib/glossary'
import { getLanguage } from '@/lib/i18n-server'

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

const COPY = {
  en: {
    eyebrow: 'System',
    title: 'Data Map',
    emphasis: 'Map',
    subtitle: (dir: string, ingestedAt: string) => `Source inventory for ${dir}. Last ingest: ${ingestedAt}.`,
    reviewItems: (count: string) => `${count} source issue(s)`,
    allMapped: 'No source issues',
    itemsToReview: 'Source Issues',
    itemsToReviewInfo: 'Source files that are missing or changed. Unused files are shown as inventory information because they may be retained for provenance.',
    inventoryHeadline: 'Inventory headline',
    issueHint: 'Drifted or missing sources',
    cleanHint: 'No missing or changed sources',
    unused: 'Inactive inventory',
    unusedHint: 'Present but not used by the latest ingest; may be retained',
    drift: 'Drift',
    driftHint: 'Changed versus expected',
    missing: 'Missing',
    missingHint: 'Expected but absent',
    inventoryCoverage: 'Inventory Coverage',
    inventoryCoverageInfo: 'Mapped source count and total inventory footprint from the latest ingest.',
    used: 'Used',
    usedHint: 'Sources mapped into the data model',
    inventorySize: 'Inventory Size',
    inventorySizeHint: 'Total bytes across tracked sources',
    readOrder: 'Read order: review queue first, then coverage, then full file inventory.',
    retentionGuide: 'Retention reason is the source role, not a delete instruction.',
    retentionLabels: { active: 'Active source', fallback: 'Fallback', archive: 'Archive', derived: 'Derived', review: 'Review' },
    reviewQueue: 'Source issue queue',
    noQueue: 'No drifted or missing source files',
    fullInventory: 'Full source inventory',
    columns: {
      status: 'Status',
      category: 'Category',
      file: 'File',
      size: 'Size',
      detail: 'Detail',
      retention: 'Retention',
      dataset: 'Dataset',
      path: 'Path',
      rows: 'Rows',
      modified: 'Modified',
      sha: 'SHA-256',
    },
  },
  ko: {
    eyebrow: '시스템',
    title: '데이터 원본',
    emphasis: '원본',
    subtitle: (dir: string, ingestedAt: string) => `${dir}의 원본 인벤토리입니다. 마지막 ingest: ${ingestedAt}.`,
    reviewItems: (count: string) => `원본 이슈 ${count}건`,
    allMapped: '원본 이슈 없음',
    itemsToReview: '원본 이슈',
    itemsToReviewInfo: '변경되었거나 누락된 원본 파일입니다. 미사용 파일은 provenance 보존을 위해 정보성 목록으로 표시합니다.',
    inventoryHeadline: '인벤토리 핵심 지표',
    issueHint: '변경 또는 누락된 원본',
    cleanHint: '변경·누락된 원본이 없습니다.',
    unused: '비활성 인벤토리',
    unusedHint: '현재 ingest에는 쓰이지 않지만 보존될 수 있는 파일',
    drift: '변경',
    driftHint: '예상 상태와 달라짐',
    missing: '누락',
    missingHint: '예상 파일이 없음',
    inventoryCoverage: '인벤토리 범위',
    inventoryCoverageInfo: '마지막 ingest 기준 매핑된 원본 수와 전체 인벤토리 크기입니다.',
    used: '사용 중',
    usedHint: '데이터 모델에 매핑된 원본',
    inventorySize: '인벤토리 크기',
    inventorySizeHint: '추적 중인 원본의 총 바이트',
    readOrder: '읽는 순서: 확인 대기열, 범위, 전체 파일 인벤토리 순으로 봅니다.',
    retentionGuide: '보존 이유는 파일의 역할을 설명하며, 삭제 지시가 아닙니다.',
    retentionLabels: { active: '운영 원본', fallback: '대체 원본', archive: '보관 원본', derived: '파생 산출물', review: '추가 확인' },
    reviewQueue: '원본 이슈 대기열',
    noQueue: '변경되거나 누락된 원본 파일이 없습니다.',
    fullInventory: '전체 원본 인벤토리',
    columns: {
      status: '상태',
      category: '분류',
      file: '파일',
      size: '크기',
      detail: '상세',
      retention: '보존 이유',
      dataset: '데이터셋',
      path: '경로',
      rows: '행',
      modified: '수정일',
      sha: 'SHA-256',
    },
  },
} as const

export default async function DataMapPage() {
  const language = await getLanguage()
  const copy = COPY[language]
  const glossary = getGlossary(language)
  const meta = getMeta()
  const inventory = getSourceInventory()
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

      <Card title={copy.fullInventory} className="mt-5">
        <DataTable
          rows={inventory.items}
          columns={[
            { key: 'status', label: copy.columns.status, render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
            { key: 'category', label: copy.columns.category },
            { key: 'name', label: copy.columns.dataset },
            { key: 'relativePath', label: copy.columns.path, render: (r) => <span className="block max-w-[32rem] truncate">{r.relativePath}</span> },
            { key: 'rowCount', label: copy.columns.rows, align: 'right', render: (r) => (r.rowCount == null ? 'n/a' : fmtNumber(r.rowCount)) },
            { key: 'bytes', label: copy.columns.size, align: 'right', render: (r) => fmtBytes(r.bytes) },
            { key: 'mtimeMs', label: copy.columns.modified, render: (r) => (r.mtimeMs ? fmtDateTime(new Date(r.mtimeMs).toISOString()) : 'n/a') },
            { key: 'sha256', label: copy.columns.sha, render: (r) => (r.sha256 ? <code className="font-mono text-label">{shortHash(r.sha256)}</code> : 'n/a') },
            { key: 'retention', label: copy.columns.retention, render: (r) => <div className="min-w-[16rem]"><Badge tone={retentionTone(r.retention)}>{copy.retentionLabels[r.retention as keyof typeof copy.retentionLabels]}</Badge><div className="mt-1 text-label leading-relaxed text-ink-3">{r.retentionReason}</div></div> },
          ]}
        />
      </Card>
    </>
  )
}
