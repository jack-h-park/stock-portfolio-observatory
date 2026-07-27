import path from 'node:path'

const repoPath = (...parts: string[]) => path.join(process.cwd(), ...parts)

function env(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.length > 0 ? process.env[name]! : fallback
}

export const config = {
  stockDataDir: env('STOCK_DATA_DIR', repoPath('private-data')),
  stockDbPath: env(
    'STOCK_DB_PATH',
    repoPath('private-data/outputs/stock-portfolio-observatory/stock-portfolio-observatory.db')
  ),
  stockFxRatesPath: env('STOCK_FX_RATES_PATH', repoPath('data/fx-rates.json')),
  stockKrPricesPath: env('STOCK_KR_PRICES_PATH', repoPath('data/kr-prices.json')),
  stockUsPricesPath: env('STOCK_US_PRICES_PATH', repoPath('data/us-prices.json')),
  stockUsPdfEvidencePath: env('STOCK_US_PDF_EVIDENCE_PATH', repoPath('data/us-pdf-evidence.json')),
  stockManualMappingsPath: env('STOCK_MANUAL_MAPPINGS_PATH', repoPath('data/manual-mappings.json')),
  stockRefreshRunsPath: env('STOCK_REFRESH_RUNS_PATH', repoPath('data/refresh-runs.json')),
  // Daily portfolio briefing archive, written by the briefing cron on the iMac.
  // Read-only here. Private (position sizes) so the real path lives outside the
  // repo and is set per host in .env.local; the default keeps sample mode working.
  stockBriefingArchiveDir: env('STOCK_BRIEFING_ARCHIVE_DIR', repoPath('private-data/briefing-archive')),
  // Machine-readable portfolio summary, WRITTEN by `pnpm summary` (and by the
  // tail of `pnpm refresh`) for the briefing and trading-agent crons to read.
  // Published, not served: a file means those jobs never depend on this app
  // running. Private — it carries position values — so it lives beside the
  // database rather than in the repo.
  stockBriefingSummaryPath: env(
    'STOCK_BRIEFING_SUMMARY_PATH',
    repoPath('private-data/outputs/stock-portfolio-observatory/briefing-summary.json')
  ),
  stockTaxPolicyPath: env('STOCK_TAX_POLICY_PATH', repoPath('data/tax-policy.json')),
  stockTaxPolicyExamplePath: env('STOCK_TAX_POLICY_EXAMPLE_PATH', repoPath('data/tax-policy.example.json')),
}

export type AppConfig = typeof config
