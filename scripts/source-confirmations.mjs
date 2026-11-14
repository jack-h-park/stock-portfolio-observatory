import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value

/** Only explicit owner statements, bound to original bytes, become query-end evidence. */
export function verifiedSourceConfirmations(entries, root, {today = new Date().toISOString().slice(0,10)} = {}) {
  const accepted = [], problems = []
  for (const entry of entries ?? []) {
    try {
      if (!entry || entry.basis !== 'owner-confirmed' || !isoDay(entry.through) || entry.through > today || !isoDay(entry.confirmedAt) || entry.confirmedAt > today) throw new Error('invalid confirmation date or basis')
      const supported = entry.scope === 'bank' ? entry.institution === 'fidelity' : entry.institution === 'Fidelity' || (entry.institution === 'Merrill' && entry.kind === 'transactions')
      if (!['investment','bank'].includes(entry.scope) || !['transactions','holdings'].includes(entry.kind) || !supported || !String(entry.account ?? '').trim()) throw new Error('unsupported account or source kind')
      const dir = entry.scope === 'bank' ? 'bank-statements' : entry.kind === 'holdings' ? 'us-holdings' : 'us-transactions'
      if (typeof entry.source !== 'string' || path.posix.dirname(entry.source) !== dir || !/^[a-zA-Z0-9._-]+\.csv$/.test(path.posix.basename(entry.source))) throw new Error('source must be a CSV under its owning directory')
      const source = fs.realpathSync(path.join(root,entry.source))
      const base = fs.realpathSync(root) + path.sep
      if (!source.startsWith(base)) throw new Error('source escapes records root')
      if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== entry.sha256) throw new Error('source bytes changed or hash missing')
      accepted.push({...entry, path:source})
    } catch (error) {
      problems.push(`${path.posix.basename(String(entry?.source ?? 'unknown'))}: ${error.message}`)
    }
  }
  return {accepted,problems}
}

/** Facts from a confirmed Fidelity positions CSV. Cash observations never become transactions. */
export function fidelitySnapshotFacts(rows, receipt, map) {
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const footer=rows.flat().map(String).join('\n').match(/Date downloaded ([A-Z][a-z]{2})-(\d{1,2})-(\d{4})/)
  const asOf=footer && `${footer[3]}-${String(months.indexOf(footer[1])+1).padStart(2,'0')}-${footer[2].padStart(2,'0')}`
  if (!isoDay(asOf) || asOf !== receipt.through) throw new Error('snapshot date does not match its confirmation')
  const header=rows.find(row=>row.includes('Account number') && row.includes('Symbol') && row.includes('Current value'))
  if (!header) throw new Error('not a positions CSV')
  const accountAt=header.indexOf('Account number'), symbolAt=header.indexOf('Symbol'), valueAt=header.indexOf('Current value')
  const positions=rows.filter(row=>/^[A-Z0-9]{6,}$/.test(String(row[accountAt] ?? '').trim()))
  if (receipt.scope === 'investment') {
    if (receipt.emptyHoldings !== true || positions.length) throw new Error('empty holdings must be explicitly confirmed and contain no positions')
    return {empty:true,balance:null}
  }
  const entry=(map.bankAccounts ?? []).find(e=>e.institution === 'fidelity' && e.kind === 'cma' && e.alias === receipt.account)
  if (!entry?.accountId || !positions.length) throw new Error('CMA account identity missing')
  let balance=0
  for(const row of positions) {
    if (row[accountAt] !== entry.accountId || !['SPAXX','FDRXX','FZFXX','SPRXX','FCASH'].includes(String(row[symbolAt]).replace(/\*+$/,''))) throw new Error('CMA snapshot has an unmatched account or non-cash position')
    const amount=String(row[valueAt] ?? '').replace(/[$,]/g,'').trim()
    if (!/^[+-]?\d+(\.\d+)?$/.test(amount) || !Number.isFinite(Number(amount))) throw new Error('unreadable cash snapshot amount')
    balance+=Number(amount)
  }
  return {empty:false,balance:Math.round(balance*100)/100}
}
