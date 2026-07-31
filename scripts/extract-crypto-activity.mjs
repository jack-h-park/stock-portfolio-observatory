import { spawn } from 'node:child_process'
import path from 'node:path'
import { loadLocalEnv } from './env.mjs'
import { resolveCryptoFiles } from './source-files.mjs'

loadLocalEnv()

const dataDir = process.env.STOCK_DATA_DIR || path.join(process.cwd(), 'private-data')
const outPath = process.env.STOCK_CRYPTO_ACTIVITY_PATH || path.join(process.cwd(), 'data/crypto-activity.json')
const pythonBin = process.env.STOCK_PYTHON_BIN || 'python3'

// Same warning as the US PDF extractor: a bare interpreter name resolves through
// PATH, and a scheduler's PATH is not a shell's. That difference silently broke
// the US extract on every cron run while passing every manual test.
if (!pythonBin.includes('/')) {
  console.warn(
    `[extract:crypto] STOCK_PYTHON_BIN="${pythonBin}" is resolved through PATH, which differs under a scheduler. ` +
    'Pin it to an absolute path (e.g. /usr/bin/python3) if the import fails below.'
  )
}

const { files, missing } = resolveCryptoFiles(dataDir)
for (const file of files) {
  console.error(`[source] ${file.venue} (${file.category}): ${path.basename(file.filename)}`)
}
for (const gap of missing) {
  console.error(`[source] MISSING — no file matches ${gap}`)
}

// The resolved list is handed to Python rather than re-globbed there, so
// source-files.mjs stays the only thing that decides which files are read.
const child = spawn(pythonBin, ['scripts/extract-crypto-activity.py'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['pipe', 'inherit', 'inherit'],
})
child.stdin.write(JSON.stringify({ outPath, files }))
child.stdin.end()

child.on('close', (code) => {
  process.exitCode = code ?? 1
})
