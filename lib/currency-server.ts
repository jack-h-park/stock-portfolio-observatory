import fs from 'node:fs'
import { cookies } from 'next/headers'
import { config } from '@/config'
import {
  DISPLAY_CURRENCY_COOKIE,
  normalizeDisplayCurrency,
  type CurrencyPreferences,
  type DisplayCurrency,
} from '@/lib/currency'

export async function getDisplayCurrency(): Promise<DisplayCurrency> {
  const cookieStore = await cookies()
  return normalizeDisplayCurrency(cookieStore.get(DISPLAY_CURRENCY_COOKIE)?.value)
}

export function getUsdKrwRate(): number | null {
  try {
    const raw = JSON.parse(fs.readFileSync(config.stockFxRatesPath, 'utf8'))
    const rates = Array.isArray(raw?.rates) ? raw.rates : []
    const direct = rates.find((rate: any) => rate.from === 'USD' && rate.to === 'KRW')
    const value = Number(direct?.rate)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export async function getCurrencyPreferences(): Promise<CurrencyPreferences> {
  return {
    displayCurrency: await getDisplayCurrency(),
    usdKrwRate: getUsdKrwRate(),
  }
}
