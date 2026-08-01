import { spawn } from 'node:child_process'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const pythonBin = process.env.STOCK_PYTHON_BIN || 'python3'

// Same trap as the extractors: a bare interpreter name resolves through PATH,
// and a scheduler's PATH is not a shell's. Say which interpreter was asked for
// at the point of use — a bare ImportError blames the module and hides that the
// wrong python was picked.
if (!pythonBin.includes('/')) {
  console.warn(
    `[file-downloads] STOCK_PYTHON_BIN="${pythonBin}" is resolved through PATH, which differs under a scheduler. ` +
    'Pin it to an absolute path (e.g. /usr/bin/python3) if the import fails below.'
  )
}

const child = spawn(pythonBin, ['scripts/file-downloads.py', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

child.on('close', (code) => {
  process.exitCode = code ?? 1
})
