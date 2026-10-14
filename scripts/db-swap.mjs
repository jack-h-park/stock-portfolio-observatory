// db-swap.mjs — build the database beside the live one and swap it in whole.
//
// The ingest used to delete the database and rebuild it at the same path. For
// the minute or so that took, a reader (a page, the summary, a CLI an agent ran)
// found either no file or a half-built one, and nothing in what it read said so:
// a half-built database answers queries, it just answers them from the tables
// written so far. Now the ingest writes `<db>.building-<pid>` in the same
// directory and renames it over the live path at the end. A rename within one
// directory is atomic, so a reader opens the old file or the new one, never a
// mix. A connection opened before the swap keeps reading the old file until it
// closes. A failed ingest leaves the old database where it was.
//
// The WAL sidecars are the one trap. SQLite pairs `<db>-wal` and `<db>-shm` with
// whatever file sits at `<db>`, and it does not check that they belong to it. A
// stale `-wal` left by the old database would be replayed on top of the new one.
// The build is checkpointed and closed before the swap, so it leaves no sidecars
// of its own, and the old file's sidecars are removed just before the rename. A
// reader still holding the old file keeps its own handles to them.
import fs from 'node:fs'
import path from 'node:path'

const BUILD_MARK = '.building-'

/** Where this process builds the database that will replace `dbPath`. */
export function buildPathFor(dbPath, pid = process.pid) {
  return `${dbPath}${BUILD_MARK}${pid}`
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists and belongs to someone else.
    return error?.code === 'EPERM'
  }
}

/** Remove a database file and its sidecars. Missing files are fine. */
export function removeDbFiles(filePath) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${filePath}${suffix}`, { force: true })
}

/**
 * Remove build files left by an ingest that died before its swap (a kill -9, a
 * power cut). Only builds whose process is gone: a live one belongs to another
 * ingest that is still running.
 */
export function removeAbandonedBuilds(dbPath) {
  const dir = path.dirname(dbPath)
  const prefix = `${path.basename(dbPath)}${BUILD_MARK}`
  if (!fs.existsSync(dir)) return []
  const removed = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue
    const pid = Number(name.slice(prefix.length).replace(/-(wal|shm|journal)$/, ''))
    if (pidAlive(pid) && pid !== process.pid) continue
    fs.rmSync(path.join(dir, name), { force: true })
    removed.push(name)
  }
  return removed
}

/**
 * Put the finished build at `dbPath`. The build must already be closed. Throws,
 * leaving the live database untouched, when the build still has a WAL with
 * frames in it: renaming the file without them would publish a database missing
 * its last writes.
 */
export function publishBuiltDb(buildPath, dbPath) {
  const wal = `${buildPath}-wal`
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
    throw new Error(`refusing to publish ${buildPath}: its WAL still holds frames; close the database first`)
  }
  fs.rmSync(wal, { force: true })
  fs.rmSync(`${buildPath}-shm`, { force: true })
  for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(`${dbPath}${suffix}`, { force: true })
  fs.renameSync(buildPath, dbPath)
}
