// failing-checks.mjs — print the ids of the validation checks the current
// database does not pass, one line, for deploy/hermes/refresh-now.sh.
//
// The refresh prints a count ("Validation: 13/15 checks passing") and the full
// JSON of failed ERROR checks only, so a warning that fails is counted and never
// named. The database's validation_checks table names every one. Read-only.
//
// Output: `Failing checks: a, b (warning)` or `Failing checks: none`. Exit 1 only
// when the database cannot be read.
import Database from 'better-sqlite3'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const dbPath =
  process.env.STOCK_DB_PATH ||
  path.join(process.env.STOCK_DATA_DIR || path.join(process.cwd(), 'private-data'), 'outputs/stock-portfolio-observatory/stock-portfolio-observatory.db')

try {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const rows = db.prepare("select name, severity from validation_checks where status != 'pass' order by severity, name").all()
    const ids = rows.map((row) => (row.severity === 'error' ? row.name : `${row.name} (${row.severity})`))
    console.log(`Failing checks: ${ids.length ? ids.join(', ') : 'none'}`)
  } finally {
    db.close()
  }
} catch (error) {
  console.log(`Failing checks: unknown (${error.message})`)
  process.exitCode = 1
}
