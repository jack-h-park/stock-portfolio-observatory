import fs from 'node:fs'
import Ajv from 'ajv'
import path from 'node:path'
import { createHash } from 'node:crypto'

const hash = (body) => createHash('sha256').update(body).digest('hex')
const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/
const schema = JSON.parse(fs.readFileSync(new URL('../contracts/finance-connectors/v1/run.schema.json', import.meta.url), 'utf8'))
const validate = new Ajv({ strict: false }).compile(schema)
const required = ['accounts', 'balances', 'positions', 'activities']
function alias(env, name) {
  const a = env[`FINANCE_${name}`]?.trim(), b = env[`STOCK_${name}`]?.trim()
  if (a && b && path.resolve(a) !== path.resolve(b)) throw new Error('alias_conflict')
  return a || b
}
// Check every component, including ancestors of the configured root. No symlink
// is accepted even when it happens to point inside the permitted directory.
function checkedFile(root, relative) {
  if (!path.isAbsolute(root) || path.isAbsolute(relative)) throw new Error('invalid_path')
  const target = path.resolve(root, relative)
  if (target === root || !target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('path_escape')
  let current = path.parse(target).root
  for (const part of target.slice(current.length).split(path.sep)) {
    current = path.join(current, part)
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symlink')
  }
  if (!fs.statSync(target).isFile() || fs.statSync(target).size > 128 * 1024 * 1024) throw new Error('invalid_file')
  return fs.readFileSync(target)
}
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

/** Optional read-only consumer. Failure details are fixed codes, never paths,
 * account values or raw provider errors. Economic data is never written here. */
export function loadConnectorShadow(env = process.env, now = new Date()) {
  const configured = ['CONNECTOR_EXPORT_DIR', 'CONNECTOR_RECORDS_DIR', 'CONNECTOR_CONNECTION'].some(k => env[`FINANCE_${k}`]?.trim() || env[`STOCK_${k}`]?.trim())
  if (!configured) return null
  try {
    if (env.FINANCE_MODE === 'sample') throw new Error('sample_private_conflict')
    const runtime = alias(env, 'CONNECTOR_EXPORT_DIR'), records = alias(env, 'CONNECTOR_RECORDS_DIR')
    const connection = alias(env, 'CONNECTOR_CONNECTION')
    if (!runtime || !records || !keyPattern.test(connection || '')) throw new Error('invalid_config')
    const pointer = JSON.parse(checkedFile(runtime, `live/latest-good/${connection}.json`))
    if (pointer.schemaVersion !== '1.0' || !keyPattern.test(pointer.runId || '') || pointer.environment !== 'live' || pointer.connectionKey !== connection) throw new Error('invalid_pointer')
    const manifestBytes = checkedFile(records, `runs/${pointer.runId}/manifest.json`)
    if (hash(manifestBytes) !== pointer.manifestSha256) throw new Error('manifest_hash')
    const manifest = JSON.parse(manifestBytes)
    if (manifest.schemaVersion !== '1.0' || manifest.runId !== pointer.runId || manifest.provider !== 'snaptrade' || manifest.environment !== 'live' || manifest.sample !== false || manifest.connectionKey !== connection || !object(manifest.files)) throw new Error('invalid_manifest')
    const data = {}, bodies = new Map(), manifests = new Map([[manifest.runId, manifest]])
    for (const [filename, meta] of Object.entries(manifest.files)) {
      const bytes = checkedFile(records, `runs/${pointer.runId}/${filename}`)
      if (bytes.length !== meta.bytes || hash(bytes) !== meta.sha256) throw new Error('payload_hash')
      const body = JSON.parse(bytes)
      bodies.set(`${pointer.runId}/${filename}`, body)
      if (filename.startsWith('normalized/')) {
        if (!Array.isArray(body) || body.length !== meta.records) throw new Error('invalid_rows')
        data[path.basename(filename, '.json')] = body
      }
    }
    if (!validate({ manifest, data })) throw new Error('invalid_manifest')
    // Collector v1 emits complete snapshots. Unchanged needs a future contract
    // with section-specific lineage before it can be accepted here.
    if (required.some(k => manifest.sections[k]?.result !== 'complete')) throw new Error('incomplete_section')
    for (const dep of manifest.dependencies) {
      if (!keyPattern.test(dep.runId) || dep.runId === manifest.runId || manifests.has(dep.runId)) throw new Error('invalid_manifest')
      const bytes = checkedFile(records, `runs/${dep.runId}/manifest.json`)
      if (hash(bytes) !== dep.manifestSha256) throw new Error('manifest_hash')
      const prior = JSON.parse(bytes)
      if (prior.runId !== dep.runId || prior.connectionKey !== connection || prior.connectionId !== manifest.connectionId || prior.environment !== 'live' || prior.sample !== false || JSON.stringify([...prior.accountIds].sort()) !== JSON.stringify([...manifest.accountIds].sort())) throw new Error('invalid_manifest')
      manifests.set(dep.runId, prior)
    }
    const refs = new Set(data.accounts.map(x => x.accountRef))
    if (refs.size !== data.accounts.length || !refs.size || data.accounts.length !== manifest.accountIds.length || data.accounts.some(x => !manifest.accountIds.includes(x.providerAccountId))) throw new Error('invalid_accounts')
    for (const rows of Object.values(data)) for (const row of rows) {
      if (!refs.has(row.accountRef)) throw new Error('unknown_account')
      for (const source of [row.source, ...(row.priorSources || [])]) {
        const meta = manifests.get(source.runId)?.files?.[source.path]
        if (!meta || !source.path.startsWith('raw/')) throw new Error('invalid_provenance')
        const key = `${source.runId}/${source.path}`
        if (!bodies.has(key)) {
          const bytes = checkedFile(records, `runs/${key}`)
          if (hash(bytes) !== meta.sha256 || bytes.length !== meta.bytes) throw new Error('payload_hash')
          bodies.set(key, JSON.parse(bytes))
        }
        let target = bodies.get(key)
        for (const part of source.pointer.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'))) {
          if (!object(target) && !Array.isArray(target) || !Object.hasOwn(target, part)) throw new Error('invalid_provenance')
          target = target[part]
        }
      }
    }
    const fetched = Date.parse(manifest.fetchedAt)
    if (!Number.isFinite(fetched) || fetched > now.getTime() + 300000) throw new Error('invalid_fetched_at')
    const age = (now.getTime() - fetched) / 3600000
    // Status failure does not invalidate a historical last-good observation.
    let latestStatus = { status: 'unknown' }
    try {
      const status = JSON.parse(checkedFile(runtime, `live/status/${connection}.json`))
      if (['success', 'partial', 'failed', 'reauth'].includes(status.status) && Number.isFinite(Date.parse(status.attemptedAt)) && (status.status !== 'success' || status.runId === manifest.runId)) latestStatus = { status: status.status }
    } catch { /* Unreadable health remains unknown, independently of last-good. */ }
    return { ok: true, mode: 'shadow', manifest, data, latestStatus, ageHours: age, freshness: age > 72 ? 'error' : age > 36 ? 'warning' : 'fresh' }
  } catch (error) {
    const known = /^(alias_conflict|invalid_path|path_escape|symlink|invalid_file|sample_private_conflict|invalid_config|invalid_pointer|manifest_hash|invalid_manifest|incomplete_section|missing_section|payload_hash|invalid_rows|invalid_accounts|unknown_account|invalid_quantity|invalid_provenance|invalid_fetched_at)$/
    return { ok: false, mode: 'shadow', errorCode: known.test(error.message) ? error.message : 'unreadable_export' }
  }
}

export function compareConnectorPositions(positions, holdings, accounts) {
  const findings = []
  const core = new Set(['SPAXX', 'FDRXX', 'SPRXX', 'QACDS'])
  function decimal(value) {
    const text = String(value)
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text)
    if (!match || text.length > 1000 || Math.abs(Number(match[4] || 0)) > 1000) throw new Error('invalid_quantity')
    const scale = (match[3]?.length || 0) - Number(match[4] || 0)
    return { value: BigInt(`${match[1]}${match[2]}${match[3] || ''}`), scale }
  }
  function equalSum(values, target) {
    const all = [...values, target].map(decimal)
    const scale = Math.max(...all.map(x => x.scale))
    const aligned = all.map(x => x.value * 10n ** BigInt(scale - x.scale))
    return aligned.slice(0, -1).reduce((a, b) => a + b, 0n) === aligned.at(-1)
  }
  const identities = new Set()
  for (const position of positions) {
    const identity = JSON.stringify([position.accountRef, position.instrumentRef])
    if (identities.has(identity)) { findings.push({ code: 'duplicate_connector_position' }); continue }
    identities.add(identity)
    const mapped = accounts[position.accountRef]
    if (!mapped?.account) { findings.push({ code: 'unmapped_account' }); continue }
    if (core.has(position.ticker)) { findings.push({ code: 'core_cash_unverified' }); continue }
    const ticker = mapped.instruments?.[position.instrumentRef]
    if (typeof ticker !== 'string' || !ticker) { findings.push({ code: 'unmapped_instrument' }); continue }
    if (position.ticker && position.ticker !== ticker) { findings.push({ code: 'instrument_symbol_mismatch' }); continue }
    const legacy = holdings.filter(x => x.account === mapped.account && x.ticker === ticker)
    if (!legacy.length) { findings.push({ code: 'missing_legacy_position' }); continue }
    if (!equalSum(legacy.map(x => x.quantity), position.quantity)) findings.push({ code: 'quantity_mismatch' })
  }
  for (const mapped of Object.values(accounts)) {
    if (!mapped?.account) continue
    const selected = positions.filter(x => accounts[x.accountRef]?.account === mapped.account)
    for (const legacy of holdings.filter(x => x.account === mapped.account && !core.has(x.ticker))) {
      if (!selected.some(x => mapped.instruments?.[x.instrumentRef] === legacy.ticker)) findings.push({ code: 'missing_connector_position' })
    }
  }
  return findings
}
