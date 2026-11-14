import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { config } from '@/config'
import { buildAccountInventoryReview, type RecordedAccountFact } from '@/lib/application/account-inventory'
import type { MapRead, SourceKind } from '@/lib/domain/assets/account-inventory'
import { object, providerId, text, validateInventoryMap } from '@/lib/domain/assets/account-inventory/validation'
import { readStatementPeriodEvidence } from '@/lib/domain/assets/statement-periods'
import { cryptoStatementCoverageEnd, strictIsoDate } from '@/lib/domain/assets/query-coverage'

export type InventoryReadPaths = { mapPath: string; dbPath: string; krMetadataPath: string; cryptoPath: string; robinhoodPath: string; tossPath: string }
const defaults = (): InventoryReadPaths => ({ mapPath: config.stockAccountMapPath, dbPath: config.stockDbPath,
  krMetadataPath: path.join(config.stockKrStatementsDir, 'as-of.json'), cryptoPath: config.stockCryptoActivityPath,
  robinhoodPath: config.stockRobinhoodSnapshotPath, tossPath: config.stockTossSnapshotPath })
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const ref = (value: unknown) => typeof value === 'string' ? path.basename(value) : 'recorded-source'
function json(file: string): MapRead {
  let bytes: Buffer
  try { bytes = fs.readFileSync(file) } catch (error) { return { state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'read_error' } }
  try { return { state: 'available', value: JSON.parse(bytes.toString('utf8')), fingerprint: hash(bytes) } } catch { return { state: 'invalid' } }
}

/** Read configured metadata and SQLite only; never originals, refresh or a writer. */
export function getAccountInventoryReview(options: { paths?: InventoryReadPaths; clock?: string } = {}) {
  const paths = options.paths ?? defaults(), clock = options.clock ?? new Date().toISOString(), today = clock.slice(0, 10)
  const mapRead = json(paths.mapPath), normalized = validateInventoryMap(mapRead)
  const facts: RecordedAccountFact[] = [], readIssues: string[] = []
  const fingerprintRows: { name: string; sha256: string }[] = []
  let db: Database.Database | null = null
  try {
    db = new Database(paths.dbPath, { readonly: true, fileMustExist: true })
    db.exec('BEGIN') // Consistent read snapshot across the existing DB tables.
    const table = (name: string) => Boolean(db!.prepare('select 1 from sqlite_master where name = ? and type in (\'table\',\'view\')').get(name))
    const columns = (name: string) => new Set((db!.prepare(`pragma table_info(${name})`).all() as { name: string }[]).map(r => r.name))
    const datasets: [string, SourceKind, string, string][] = [ ['holdings', 'positions', 'as_of_date', 'brokerage'], ['transactions', 'activity', 'date', 'brokerage'], ['cash_balances', 'balance', 'as_of_date', 'institution'] ]
    let observedTables = 0
    for (const [base, kind, date, institution] of datasets) {
      const name = table(`${base}_all`) ? `${base}_all` : base
      if (!table(name)) continue
      const cols = columns(name)
      if (![date, institution, 'account'].every(c => cols.has(c))) { readIssues.push('database_schema_incomplete'); continue }
      observedTables++
      for (const row of db.prepare(`select ${institution} as provider, account, max(${date}) as date from ${name} group by ${institution}, account`).all() as { provider: string; account: string; date: string | null }[]) {
        if (!text(row.account)) continue
        facts.push({ provider: row.provider ?? 'unknown', account: row.account, kind, date: row.date, refs: [`database:${base}`], basis: 'database_observation', state: 'unconfirmed' })
      }
    }
    if (!observedTables) readIssues.push('database_schema_unavailable')
    if (table('source_files') && columns('source_files').has('sha256')) fingerprintRows.push(...db.prepare('select name,sha256 from source_files').all() as { name: string; sha256: string }[])
    const mapFingerprint = fingerprintRows.find(r => r.name === 'account_map')?.sha256
    if (mapRead.state === 'available' && mapFingerprint && mapRead.fingerprint !== mapFingerprint) readIssues.push('account_map_changed_since_ingest')
    // No fingerprint cannot prove cache consistency; make that boundary explicit.
    if (mapRead.state === 'available' && !mapFingerprint) readIssues.push('account_map_fingerprint_unavailable')
    if (table('bank_statement_coverage')) {
      for (const row of db.prepare('select institution,account,period_start,period_end,source from bank_statement_coverage').all() as { institution: string; account: string; period_start: string | null; period_end: string; source: string }[]) {
        const valid = strictIsoDate(row.period_start) && strictIsoDate(row.period_end) && row.period_start! <= row.period_end && row.period_end <= today
        facts.push({ provider: row.institution, account: row.account, kind: 'activity', date: row.period_end, refs: [ref(row.source)], basis: 'declared_period', state: valid ? 'present' : 'unconfirmed', ...(valid ? { periods: [{ from: row.period_start!, to: row.period_end }] } : {}) })
      }
    }
    if (table('source_coverage_confirmations')) {
      for (const row of db.prepare('select scope,institution,account,kind,through_date,source,empty_holdings from source_coverage_confirmations').all() as { scope: string; institution: string; account: string; kind: string; through_date: string; source: string; empty_holdings: number }[]) {
        if (!['bank','investment'].includes(row.scope) || !['holdings','transactions'].includes(row.kind)) continue
        facts.push({ provider: row.institution, account: row.account, kind: row.kind === 'transactions' ? 'activity' : row.scope === 'bank' ? 'balance' : 'positions', date: row.through_date, refs: [ref(row.source)], basis: 'owner_confirmation', state: strictIsoDate(row.through_date) && row.through_date <= today ? 'present' : 'unconfirmed', empty: Boolean(row.empty_holdings) })
      }
    }
    if (table('missing_disposals')) {
      const transactionTable = table('transactions_all') ? 'transactions_all' : 'transactions'
      const canBind = table(transactionTable) && columns(transactionTable).has('account_type')
      for (const row of db.prepare('select brokerage,account_type,ticker from missing_disposals').all() as { brokerage: string; account_type: string; ticker: string }[]) {
        const accounts = canBind ? db.prepare(`select distinct account from ${transactionTable} where brokerage = ? and account_type = ?`).all(row.brokerage,row.account_type) as { account: string }[] : []
        if (accounts.length !== 1) { readIssues.push('missing_disposals_identity_unresolved'); continue }
        facts.push({ provider: row.brokerage, account: accounts[0].account, kind: 'activity', date: null,
          refs: ['validation:missing_disposals'], basis: 'database_observation', state: 'unconfirmed', missingDisposal: true })
      }
    }
    // Pension filenames are the existing generated snapshot protocol, not mtimes.
    if (table('source_files')) {
      const sources = db.prepare('select name,filename from source_files').all() as { name: string; filename: string }[]
      for (const registration of normalized.registrations.filter(r => r.section === 'pensionAccounts')) {
        const token = registration.legacy.token
        if (!text(token)) continue
        const identities = new Set(normalized.registrations.filter(r => r.section === 'pensionAccounts' && r.legacy.token === token).map(r => r.metadata?.accountId ?? r.key))
        if (identities.size !== 1) {
          readIssues.push('pension_token_ambiguous')
          facts.push({ provider: registration.providerId ?? 'unknown', account: registration.label, kind: 'pension_snapshot', date: null, refs: ['generated:pension-token-conflict'], basis: 'snapshot', state: 'conflicting' })
          continue
        }
        for (const source of sources.filter(s => s.name.startsWith(`pension:${token}-holdings-`))) {
          const m = /-holdings-(\d{4})(\d{2})(\d{2})\.csv$/.exec(source.filename)
          const date = m && strictIsoDate(`${m[1]}-${m[2]}-${m[3]}`)
          if (date) facts.push({ provider: registration.providerId ?? 'unknown', account: registration.label, kind: 'pension_snapshot', date, refs: [ref(source.filename)], basis: 'snapshot', state: date <= today ? 'present' : 'unconfirmed' })
        }
      }
    }
  } catch { readIssues.push('database_unavailable') } finally { db?.close() }

  function generated(file: string, name: string) {
    const read = json(file)
    const fingerprint = fingerprintRows.find(row => row.name === name)?.sha256
    if (read.state !== 'available') {
      if (read.state === 'missing' && fingerprint) readIssues.push(`${name}_missing`)
      else if (read.state !== 'missing') readIssues.push(`${name}_unreadable`)
      return null
    }
    const value = read.value
    const valid = object(value) && (name === 'kr_statement_metadata'
      ? object(value.statementPeriods) && value.statementPeriods.schemaVersion === 1 && object(value.statementPeriods.accounts)
      : name === 'crypto_activity' ? Array.isArray(value.documents) && value.documents.every(object)
      : Array.isArray(value.accounts) && value.accounts.every(object) && text(value.fetchedAt))
    if (!valid || !object(value)) { readIssues.push(`${name}_invalid`); return null }
    if (fingerprint && fingerprint !== read.fingerprint) readIssues.push(`${name}_changed_since_ingest`)
    return value
  }
  const kr = generated(paths.krMetadataPath, 'kr_statement_metadata')
  if (object(kr?.statementPeriods) && object(kr.statementPeriods.accounts)) {
    for (const account of Object.keys(kr.statementPeriods.accounts)) {
      const evidence = readStatementPeriodEvidence(kr, account)
      const providers = new Set([...facts.filter(f => f.account === account).map(f => providerId(f.provider)), ...normalized.registrations.filter(r => r.label === account).map(r => r.providerId)].filter(Boolean))
      const provider = providers.size === 1 ? [...providers][0]! : 'unknown'
      facts.push({ provider, account, kind: 'activity', date: evidence.periodEnd,
        refs: evidence.sources.length ? evidence.sources.map(s => s.source) : ['generated:kr-period'], basis: 'declared_period', state: evidence.state === 'conflicting' ? 'conflicting' : evidence.state === 'declared' ? 'present' : 'unconfirmed',
        ...(evidence.state === 'declared' ? { periods: evidence.sources.map(s => ({ from: s.start, to: s.end })) } : {}) })
    }
  }
  const crypto = generated(paths.cryptoPath, 'crypto_activity')
  if (Array.isArray(crypto?.documents)) {
    const selections = new Map<string, { venue: string; account: string; category: string }>()
    for (const doc of crypto.documents) if (object(doc) && text(doc.venue) && text(doc.account) && ['bithumb_statement','robinhood_crypto_statement'].includes(String(doc.category))) selections.set(JSON.stringify([doc.venue,doc.account,doc.category]), { venue: doc.venue, account: doc.account, category: doc.category as string })
    for (const selection of selections.values()) {
      const date = cryptoStatementCoverageEnd(crypto, { ...selection, today })
      const docs = crypto.documents.filter(d => object(d) && d.venue === selection.venue && d.account === selection.account && d.category === selection.category)
      facts.push({ provider: selection.venue, account: selection.account, kind: 'activity', date,
        refs: docs.map((d: Record<string, unknown>) => ref(d.source ?? d.filename)), basis: 'declared_period', state: date ? 'present' : 'unconfirmed',
        ...(date ? { periods: docs.map((d: Record<string, unknown>) => ({ from: (d.metrics as Record<string,string>).periodStart, to: (d.metrics as Record<string,string>).periodEnd })) } : {}) })
    }
  }
  for (const [file, name, provider] of [[paths.robinhoodPath,'robinhood_snapshot','robinhood'],[paths.tossPath,'toss_snapshot','toss']]) {
    const snapshot = generated(file, name)
    if (!Array.isArray(snapshot?.accounts)) continue
    for (const account of snapshot.accounts) {
      // No global snapshot date applied to accounts not explicitly named here.
      if (!object(account)) continue
      const accountLabel = text(account.account) ? account.account
        : provider === 'toss' && text(account.accountNo) ? `Toss accountNo ${account.accountNo}` : null
      if (!accountLabel) { readIssues.push(`${name}_identity_unresolved`); continue }
      const date = strictIsoDate(String(snapshot?.fetchedAt ?? '').slice(0,10))
      facts.push({ provider, account: accountLabel, kind: 'positions', date, refs: [`generated:${name}`], basis: 'snapshot', state: date && date <= today ? 'present' : 'unconfirmed' })
    }
  }
  return buildAccountInventoryReview({ mapRead, facts, readIssues }, clock)
}
