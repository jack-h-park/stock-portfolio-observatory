import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function noSymlinks(target) {
  let part = path.resolve(target)
  while (part !== path.dirname(part)) {
    try {
      if (fs.lstatSync(part).isSymbolicLink())
        throw new Error('Migration refuses symlink paths; use the canonical real path')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    part = path.dirname(part)
  }
}
const nested = (parent, child) => child.startsWith(parent + path.sep)
export function planFinanceStateMigration(mappings) {
  if (!Array.isArray(mappings) || !mappings.length) throw new Error('Explicit source/destination mappings are required')
  const files = [],
    destinations = new Set()
  for (const mapping of mappings) {
    if (
      typeof mapping.source !== 'string' ||
      typeof mapping.destination !== 'string' ||
      !['state', 'archive', 'runtime'].includes(mapping.kind) ||
      typeof mapping.owner !== 'string' ||
      !mapping.owner.trim()
    )
      throw new Error('Invalid migration mapping')
    const source = path.resolve(mapping.source),
      destination = path.resolve(mapping.destination)
    noSymlinks(source)
    noSymlinks(destination)
    if (nested(source, destination) || nested(destination, source))
      throw new Error('Source/destination trees must not overlap')
    const visit = (from, to) => {
      noSymlinks(from)
      noSymlinks(to)
      const stat = fs.lstatSync(from)
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(from).sort()) visit(path.join(from, name), path.join(to, name))
        return
      }
      if (!stat.isFile()) throw new Error('Only regular state/archive files can be copied')
      if (destinations.has(to)) throw new Error('Duplicate migration destination')
      destinations.add(to)
      const sha256 = hash(from),
        exists = fs.existsSync(to)
      if (exists && (!fs.statSync(to).isFile() || hash(to) !== sha256))
        throw new Error('Destination conflict; no files copied')
      files.push({
        source: from,
        destination: to,
        sha256,
        owner: mapping.owner,
        kind: mapping.kind,
        status: exists ? 'matching' : 'copy',
      })
    }
    visit(source, destination)
  }
  return { schemaVersion: 1, files }
}
export function applyFinanceStateMigration(plan) {
  if (plan?.schemaVersion !== 1 || !Array.isArray(plan.files) || !plan.files.length)
    throw new Error('A prepared migration manifest is required')
  // Verify every input before writing the first file; a stale preview cannot apply.
  const destinations = new Set()
  for (const file of plan.files) {
    if (
      !file ||
      typeof file.source !== 'string' ||
      typeof file.destination !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error('Invalid prepared manifest')
    if (destinations.has(path.resolve(file.destination))) throw new Error('Duplicate destination')
    destinations.add(path.resolve(file.destination))
    noSymlinks(file.source)
    noSymlinks(file.destination)
    if (!fs.statSync(file.source).isFile() || hash(file.source) !== file.sha256)
      throw new Error('Source changed since preview')
    if (
      fs.existsSync(file.destination) &&
      (!fs.statSync(file.destination).isFile() || hash(file.destination) !== file.sha256)
    )
      throw new Error('Destination conflict')
  }
  for (const file of plan.files) {
    if (fs.existsSync(file.destination)) continue
    fs.mkdirSync(path.dirname(file.destination), { recursive: true, mode: 0o700 })
    noSymlinks(file.destination)
    const temporary = `${file.destination}.${randomUUID()}.tmp`
    try {
      fs.copyFileSync(file.source, temporary, fs.constants.COPYFILE_EXCL)
      fs.chmodSync(temporary, 0o600)
      if (hash(temporary) !== file.sha256) throw new Error('Source changed during copy')
      // An exclusive link publishes the verified copy without clobbering a file
      // another writer created after preflight. Originals are never removed.
      fs.linkSync(temporary, file.destination)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  }
  return { ...plan, status: 'copied-and-verified', files: plan.files.map((file) => ({ ...file, status: 'matching' })) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2),
      apply = args.includes('--apply'),
      at = args.indexOf(apply ? '--expected-manifest' : '--mappings')
    if (at < 0 || !args[at + 1])
      throw new Error('Use --mappings file.json for preview, or --apply --expected-manifest reviewed-plan.json')
    const input = JSON.parse(fs.readFileSync(args[at + 1], 'utf8'))
    console.log(JSON.stringify(apply ? applyFinanceStateMigration(input) : planFinanceStateMigration(input), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
