import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '@/config'
import {
  COLLECTIONS,
  emptyTaxHistory,
  validateTaxHistory,
  type TaxHistoryStoreV1,
  type HistoryRecord,
  type Change,
} from '@/lib/domain/taxes/history'

export class TaxHistoryReadOnlyError extends Error {
  name = 'TaxHistoryReadOnlyError'
  constructor() {
    super('This host is read-only for tax history')
  }
}
export class TaxHistoryConflictError extends Error {
  name = 'TaxHistoryConflictError'
  constructor() {
    super('Tax history changed; reload and review the new revision')
  }
}
export class TaxHistoryLockedError extends Error {
  name = 'TaxHistoryLockedError'
  constructor() {
    super('Tax history writer lock exists; verify its owner before recovery')
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function taxHistoryPath() {
  return path.join(config.finance.stateDir, 'tax-history.json')
}
export function readTaxHistory(filePath = taxHistoryPath()): TaxHistoryStoreV1 {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyTaxHistory()
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 20 * 1024 * 1024)
    throw new Error('Invalid tax-history state file')
  return validateTaxHistory(JSON.parse(fs.readFileSync(filePath, 'utf8')))
}
export type CommitTaxHistory = {
  expectedRevision: number
  next: TaxHistoryStoreV1
  actor: Change['actor']
  reason: string
  stateWritable?: boolean
}
export function commitTaxHistory(filePath: string, options: CommitTaxHistory): TaxHistoryStoreV1 {
  if (!(options.stateWritable ?? config.finance.stateWritable)) throw new TaxHistoryReadOnlyError()
  if (!options.reason.trim() || options.reason.length > 2000) throw new Error('A review reason is required')
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const lock = filePath + '.lock'
  let lockFd: number
  try {
    lockFd = fs.openSync(lock, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new TaxHistoryLockedError()
    throw error
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(lockFd, `${process.pid}\n`)
    const current = readTaxHistory(filePath)
    if (options.expectedRevision !== current.revision) throw new TaxHistoryConflictError()
    if (options.next.revision !== current.revision || canonical(options.next.changes) !== canonical(current.changes))
      throw new Error('Cannot replace tax-history revision or change history')
    // Validate after removals become tombstones, so ordinary deletion cannot erase history.
    const next = structuredClone(options.next)
    const records: Change['records'] = []
    for (const collection of COLLECTIONS) {
      const proposed = next[collection] as HistoryRecord[],
        old = current[collection] as HistoryRecord[]
      for (const before of old)
        if (!proposed.some((row) => row.id === before.id)) proposed.push({ ...before, deleted: true })
      for (const after of proposed) {
        const before = old.find((row) => row.id === after.id)
        if (before && after.recordRevision !== before.recordRevision) throw new Error('Unexpected record revision')
        if (!before && after.recordRevision !== 1) throw new Error('New record revision must be 1')
        if (before && canonical(before) === canonical(after)) continue
        after.recordRevision = before ? before.recordRevision + 1 : 1
        records.push({ collection, id: after.id, before: before ?? null, after: structuredClone(after) })
      }
    }
    if (!records.length) return current
    next.revision = current.revision + 1
    next.changes.push({
      id: randomUUID(),
      storeRevision: next.revision,
      changedAt: new Date().toISOString(),
      actor: options.actor,
      reason: options.reason.trim(),
      records,
    })
    const valid = validateTaxHistory(next)
    const fd = fs.openSync(temporary, 'wx', 0o600)
    try {
      fs.writeFileSync(fd, `${JSON.stringify(valid, null, 2)}\n`)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temporary, filePath)
    return valid
  } finally {
    fs.rmSync(temporary, { force: true })
    fs.closeSync(lockFd)
    fs.unlinkSync(lock)
  }
}
