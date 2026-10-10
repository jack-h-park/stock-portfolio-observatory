import { spawn } from 'node:child_process'
import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const child = spawn(process.env.STOCK_PYTHON_BIN || 'python3', ['scripts/extract-pension-evidence.py'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

child.on('close', (code) => {
  process.exitCode = code ?? 1
})
