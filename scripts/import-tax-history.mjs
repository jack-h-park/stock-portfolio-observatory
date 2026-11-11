import fs from 'node:fs'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()
const { validateTaxHistory } = await import('../lib/domain/taxes/history.ts')
const { previewTaxHistoryImport, applyTaxHistoryImport } = await import('../lib/application/import-tax-history.ts')
const { readTaxHistory, taxHistoryPath } = await import('../lib/adapters/tax-history-store.ts')

try {
  const args = process.argv.slice(2), options = new Map()
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === '--apply') options.set(key, true)
    else if (['--input', '--expected-revision', '--decisions', '--reason'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options.set(key, args[++i])
    else throw new Error('Usage: tax:import --input file.json [--apply --expected-revision N --reason text --decisions decisions.json]')
  }
  if (!options.has('--input')) throw new Error('--input is required')
  const incoming = validateTaxHistory(JSON.parse(fs.readFileSync(options.get('--input'), 'utf8'))), file = taxHistoryPath()
  const preview = previewTaxHistoryImport(readTaxHistory(file), incoming)
  if (!options.has('--apply')) console.log(JSON.stringify(preview, null, 2))
  else {
    const revision = String(options.get('--expected-revision') ?? '')
    if (!/^(0|[1-9][0-9]*)$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw new Error('--expected-revision is required')
    const decisions = options.has('--decisions') ? JSON.parse(fs.readFileSync(options.get('--decisions'), 'utf8')) : {}
    const store = applyTaxHistoryImport(file, { expectedRevision: Number(revision), incoming, reason: String(options.get('--reason') ?? ''), reviewedMatchDecisions: decisions.matches ?? [], reviewedRecordChanges: decisions.changes ?? [] })
    console.log(JSON.stringify({ schemaVersion: 1, stateRevision: store.revision }))
  }
} catch (error) { console.error(`${error.name}: ${error.message}`); process.exitCode = 1 }
