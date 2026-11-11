export function assertOperationalPublishing(db, env = process.env) {
  const has = (name) =>
    Boolean(db.prepare("select 1 from sqlite_master where name = ? and type in ('table','view')").get(name))
  const mode = has('meta') ? db.prepare("select value from meta where key = 'data_mode'").get()?.value : undefined
  const table = has('holdings_all') ? 'holdings_all' : 'holdings'
  const hasSource =
    has(table) &&
    db
      .prepare(`pragma table_info(${table})`)
      .all()
      .some((column) => column.name === 'source_system')
  const synthetic = hasSource && db.prepare(`select 1 from ${table} where source_system = 'sample' limit 1`).get()
  if (env.FINANCE_MODE === 'sample' || mode === 'sample' || synthetic)
    throw new Error('Refusing to publish synthetic/sample positions into an operational sheet')
}
