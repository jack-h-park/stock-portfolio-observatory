import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { FILE_CATEGORY_CODES, RETENTION_REASON_CODES, type RetentionReasonCode, type SourceInventoryItem } from '@/lib/adapters/portfolio-db'
import { dataMap } from '@/lib/ui-copy/pages/dataMap'

// /data-map renders the retention reason and the file category from codes the
// adapter returns. Invented file names throughout; the repository is public.

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/
// Latin words the Korean half may keep: allowed acronyms, a product name, and
// the file name of a derived artifact.
const KO_LATIN_OK = new Set(['CMA', 'PDF', 'CSV', 'TSV', 'JSON', 'Merrill', 'pension', 'evidence', 'json'])

test('every retention reason code has a non-empty label in both languages', () => {
  for (const code of RETENTION_REASON_CODES) {
    for (const language of ['en', 'ko'] as const) {
      const label = dataMap[language].retentionReasons[code]
      assert.ok(typeof label === 'string' && label.trim().length > 0, `${language} ${code}`)
    }
  }
  assert.deepEqual(Object.keys(dataMap.en.retentionReasons).sort(), [...RETENTION_REASON_CODES].sort())
  assert.deepEqual(Object.keys(dataMap.ko.retentionReasons).sort(), [...RETENTION_REASON_CODES].sort())
})

test('English retention labels hold no Hangul; Korean ones hold no English word beyond the allowed names', () => {
  for (const code of RETENTION_REASON_CODES) {
    const en = dataMap.en.retentionReasons[code]
    const ko = dataMap.ko.retentionReasons[code]
    assert.doesNotMatch(en, HANGUL, `${code}: ${en}`)
    assert.match(ko, HANGUL, `${code}: ${ko}`)
    const stray = (ko.match(/[A-Za-z]+/g) ?? []).filter((word) => !KO_LATIN_OK.has(word))
    assert.deepEqual(stray, [], `${code}: ${ko}`)
  }
})

test('each file category code has an English label equal to the code and a Korean label', () => {
  const en = dataMap.en.categoryLabels as Record<string, string>
  const ko = dataMap.ko.categoryLabels as Record<string, string>
  assert.deepEqual(Object.keys(en).sort(), [...FILE_CATEGORY_CODES].sort())
  assert.deepEqual(Object.keys(ko).sort(), [...FILE_CATEGORY_CODES].sort())
  for (const code of FILE_CATEGORY_CODES) {
    assert.equal(en[code], code)
    assert.match(ko[code], HANGUL, code)
  }
})

test('the source inventory returns a retention code for each path rule, and a labelled category for each file kind', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'data-map-copy-'))
  const expected: Record<string, RetentionReasonCode> = {
    'outputs/sample-report.json': 'DERIVED_ARTIFACT',
    '.codex_sheet_payloads/sample.tsv': 'DERIVED_ARTIFACT',
    '.codex_drive_pdfs/text/sample.txt': 'DERIVED_ARTIFACT',
    '.codex_drive_pdfs/sample.pdf': 'DERIVED_ARTIFACT',
    'briefing-archive/sample-day.json': 'BRIEFING_ARCHIVE',
    'briefing-archive.backup-sample/sample-day.json': 'BRIEFING_ARCHIVE_BACKUP',
    'kr-statements-superseded/sample.pdf': 'KR_STATEMENT_SUPERSEDED',
    'kr-statements/_partial-overlap/sample.pdf': 'KR_STATEMENT_OVERLAP',
    'kr-statements/sample.pdf': 'KR_STATEMENT',
    'bank-statements/sample-bank.xls': 'BANK_STATEMENT',
    'pension/evidence/sample-certificate.pdf': 'PENSION_EVIDENCE',
    'pension/sample-holdings.csv': 'PENSION_SNAPSHOT',
    // The two lot fallbacks and the two newer transaction files are named in the adapter.
    'us-holdings/merrill-holdings-20260715.csv': 'MERRILL_LOT_FALLBACK',
    'us-transactions/chase-transactions-20260715-20260805.csv': 'US_NEWER_TRANSACTIONS',
    'us-holdings/sample-broker-holdings.csv': 'US_EARLIER_EXPORT',
    'korea_stock_tax_lots_updated.xlsx': 'MANUAL_LOT_WORKBOOK',
    '.codex_extracted_korea.json': 'LEGACY_KR_EXTRACT',
    'README.md': 'DATA_DIR_README',
    'misc/sample-notes.txt': 'NEEDS_REVIEW',
    'misc/sample-image.png': 'NEEDS_REVIEW',
    'misc/sample-payload.tsv': 'NEEDS_REVIEW',
  }
  for (const rel of Object.keys(expected)) {
    mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true })
    writeFileSync(path.join(dataDir, rel), 'x')
  }
  const inventoryDb = path.join(dataDir, 'inventory.db')
  const conn = new Database(inventoryDb)
  conn.exec(`
create table meta (key text primary key, value text not null);
create table source_files (name text primary key, filename text not null, path text not null, bytes integer not null, mtime_ms integer not null, sha256 text not null, row_count integer not null);
`)
  conn.prepare("insert into meta (key, value) values ('data_dir', ?)").run(dataDir)
  // A tracked source whose file is gone: still a tracked source, not one to review.
  conn
    .prepare('insert into source_files (name, filename, path, bytes, mtime_ms, sha256, row_count) values (?, ?, ?, 1, 0, ?, 1)')
    .run('sample:tracked', 'tracked-sample.tsv', path.join(dataDir, 'tracked-sample.tsv'), 'a'.repeat(64))
  conn.close()

  const { config } = await import('@/config')
  const { getSourceInventory } = await import('../lib/adapters/portfolio-db')
  const saved = config.stockDbPath
  config.stockDbPath = inventoryDb
  try {
    const items: SourceInventoryItem[] = getSourceInventory().items
    const byPath = Object.fromEntries(items.map((item) => [item.relativePath, item]))
    for (const [rel, code] of Object.entries(expected)) {
      assert.ok(byPath[rel], `${rel} not discovered`)
      assert.equal(byPath[rel].retentionReason, code, rel)
    }
    assert.equal(byPath['tracked-sample.tsv']?.retentionReason, 'TRACKED_SOURCE')
    const seen = new Set<RetentionReasonCode>(items.map((item) => item.retentionReason))
    assert.deepEqual([...seen].sort(), [...RETENTION_REASON_CODES].sort())
    const categories = new Set(items.map((item) => item.category))
    assert.deepEqual([...categories].sort(), [...FILE_CATEGORY_CODES].sort())
  } finally {
    config.stockDbPath = saved
  }
})
