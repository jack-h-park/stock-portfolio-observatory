// observatory-cli.mjs — entry point for the read-only CLIs an agent calls:
// `pnpm tax:scenario`, `pnpm tax:calendar`, `pnpm tax:realized`, `pnpm sources:status`.
//
// A .mjs file in front of the TypeScript for the reason summary.mjs gives:
// `.env.local` must be in process.env before @/config is evaluated, and an
// `import` is hoisted, so only a file boundary guarantees the order.
//
// usage: tsx scripts/observatory-cli.mjs <command> [options]

import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const { commands } = await import('../lib/cli/commands.ts')
const { runCli } = await import('../lib/cli/common.ts')

const [name, ...argv] = process.argv.slice(2)
const command = commands[name]
if (!command) {
  process.stderr.write(`unknown command: ${name ?? '(none)'}; expected one of ${Object.keys(commands).join(', ')}\n`)
  process.exitCode = 2
} else {
  process.exitCode = runCli(command, argv)
}
