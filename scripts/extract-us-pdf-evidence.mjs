import { spawn } from 'node:child_process'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const pythonBin = process.env.STOCK_PYTHON_BIN || 'python3'

const child = spawn(pythonBin, ['scripts/extract-us-pdf-evidence.py'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

child.on('close', (code) => {
  process.exitCode = code ?? 1
})
