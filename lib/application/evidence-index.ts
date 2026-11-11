import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Evidence } from '@/lib/domain/taxes/history'

export type EvidenceRoots = { records: string; tax: string | null }
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
export function resolveTaxEvidence(evidence: Evidence, roots: EvidenceRoots) {
  const configured = roots[evidence.root]
  if (!configured || evidence.deleted) throw new Error('Evidence root unavailable')
  const relative = evidence.relativePath
  if (
    !relative ||
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    relative.split('/').includes('..') ||
    path.posix.normalize(relative) !== relative
  )
    throw new Error('Invalid evidence relative path')
  let root: string, real: string
  try {
    root = fs.realpathSync(configured)
    real = fs.realpathSync(path.resolve(root, relative))
  } catch {
    throw new Error('Evidence missing; review a hash-matched relink')
  }
  if (!inside(root, real)) throw new Error('Evidence symlink leaves its named root')
  let component = root
  for (const segment of relative.split('/')) {
    component = path.join(component, segment)
    if (fs.lstatSync(component).isSymbolicLink()) throw new Error('Evidence symlink is not a real file reference')
  }
  let fd: number
  try {
    fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch {
    throw new Error('Evidence unavailable')
  }
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
      throw new Error('Evidence unavailable or exceeds preview size limit')
    const bytes = fs.readFileSync(fd)
    if (createHash('sha256').update(bytes).digest('hex') !== evidence.sha256)
      throw new Error('Evidence changed; expected document hash does not match')
    return { bytes, filename: path.basename(relative) }
  } finally {
    fs.closeSync(fd)
  }
}
export function indexEvidenceRoot(
  configured: string | null,
  expectedHash: string,
  limits: { maxFiles?: number; maxBytes?: number } = {},
) {
  const candidates: string[] = []
  if (!configured || !/^[a-f0-9]{64}$/.test(expectedHash)) return { candidates, complete: false }
  let root: string
  try {
    root = fs.realpathSync(configured)
  } catch {
    return { candidates, complete: false }
  }
  let files = 0,
    bytes = 0,
    complete = true
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      complete = false
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(target)
        continue
      }
      if (!entry.isFile()) continue
      if (files >= (limits.maxFiles ?? 512)) {
        complete = false
        return
      }
      try {
        const real = fs.realpathSync(target)
        if (!inside(root, real)) {
          complete = false
          continue
        }
        const stat = fs.statSync(real)
        if (bytes + stat.size > (limits.maxBytes ?? 64 * 1024 * 1024) || stat.size > 32 * 1024 * 1024) {
          complete = false
          continue
        }
        files++
        bytes += stat.size
        const relativePath = path.relative(root, real).split(path.sep).join('/')
        resolveTaxEvidence(
          { id: 'index', recordRevision: 1, root: 'records', relativePath, sha256: expectedHash },
          { records: root, tax: null },
        )
        candidates.push(relativePath)
      } catch (error) {
        // A different hash is an exhausted candidate; an unreadable/missing
        // file is an incomplete search, never proof that no matching file exists.
        if (!(error instanceof Error && error.message.startsWith('Evidence changed;'))) complete = false
      }
    }
  }
  walk(root)
  return { candidates: [...new Set(candidates)].sort(), complete }
}
