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
}

export type AppConfig = typeof config
