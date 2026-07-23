import { spawn } from 'node:child_process'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const pythonBin = process.env.STOCK_PYTHON_BIN || 'python3'

// A bare interpreter name resolves through PATH, and a scheduler's PATH is not
// a shell's: Hermes cron puts its own virtualenv first, so `python3` became that
// venv's 3.11 (no pdfplumber) and this step failed on every scheduled run while
// passing every manual test. Say so at the point of use — the traceback alone
// blames a missing module and hides which interpreter was even asked.
if (!pythonBin.includes('/')) {
  console.warn(
    `[extract] STOCK_PYTHON_BIN="${pythonBin}" is resolved through PATH, which differs under a scheduler. ` +
    'Pin it to an absolute path (e.g. /usr/bin/python3) if the import fails below.'
  )
}

const child = spawn(pythonBin, ['scripts/extract-us-pdf-evidence.py'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

child.on('close', (code) => {
  process.exitCode = code ?? 1
})
