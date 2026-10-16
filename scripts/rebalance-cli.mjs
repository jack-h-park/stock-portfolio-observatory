// rebalance-cli.mjs — the one CLI that writes rebalance proposals:
// `pnpm rebalance:propose`, `pnpm rebalance:reconcile`, `pnpm rebalance:status`.
//
// Separate from observatory-cli.mjs on purpose: those commands are read-only, and an agent
// is entitled to assume so. This one creates and updates files under data/rebalance-proposals.
// It places no order and sends nothing.
//
// A .mjs file in front of the TypeScript for the reason observatory-cli.mjs gives: `.env.local`
// must be in process.env before @/config is evaluated.
//
// usage: tsx scripts/rebalance-cli.mjs <propose|reconcile|status> [--kind manual|trigger|monthly] [--trigger <text>] [--today YYYY-MM-DD] [--no-llm]

import { loadLocalEnv } from './env.mjs'

loadLocalEnv()

const { runRebalanceCli } = await import('../lib/rebalance/cli.ts')

process.exitCode = await runRebalanceCli(
  process.argv.slice(2),
  { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) },
)
