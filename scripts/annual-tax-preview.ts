/** Standalone read-only preview: no environment/config loading or operating adapters. */
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { calculateAnnualComponents } from '../lib/domain/taxes/annual/calculate'

const usage = 'Usage: pnpm --silent tax:annual:preview --input scenario.json\nRead-only component preview; annual total unavailable. A valid blocked preview exits 0; inspect status and component reasons.\n'
const maxBytes = 1024 * 1024

function readScenario(file: string): unknown {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > maxBytes) throw new Error('Invalid input file')
    const buffer = Buffer.alloc(maxBytes + 1)
    let size = 0
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null)
      if (!count) break
      size += count
    }
    if (size > maxBytes) throw new Error('Input too large')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)))
  } finally {
    closeSync(fd)
  }
}

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write(usage)
} else if (args.length !== 2 || args[0] !== '--input' || !args[1] || args[1].startsWith('--')) {
  process.stderr.write(usage)
  process.exitCode = 2
} else {
  try {
    const result = calculateAnnualComponents(readScenario(args[1]))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch {
    // Parser/validator/filesystem errors may contain private input values or paths.
    process.stderr.write('Annual preview failed: expected a readable regular JSON file up to 1 MiB matching the supported annual input contract.\n')
    process.exitCode = 2
  }
}
