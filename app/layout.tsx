import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { geistSans, geistMono } from '@/lib/fonts'
import '@/styles/jp-theme.css'
import '@/styles/globals.css'
import { LanguageProvider } from '@/components/LanguageProvider'
import { Sidebar } from '@/components/Sidebar'
import { getLanguage } from '@/lib/i18n-server'
import { getCurrencyPreferences } from '@/lib/currency-server'

export const metadata: Metadata = {
  title: {
    default: 'Stock Portfolio Observatory',
    template: '%s · Stock Portfolio Observatory',
  },
  description: 'Read-only portfolio monitoring for local stock-management data.',
  applicationName: 'Stock Portfolio Observatory',
  icons: {
    icon: '/favicon.ico',
  },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const language = await getLanguage()
  const currencyPreferences = await getCurrencyPreferences()
  const skipLabel = language === 'ko' ? '본문으로 바로가기' : 'Skip to main content'

  return (
    <html lang={language} data-theme="jp" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <a href="#main-content" className="sr-only z-[100] rounded-sm bg-card px-4 py-3 text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:ring-2 focus:ring-info">
          {skipLabel}
        </a>
        <LanguageProvider language={language} currencyPreferences={currencyPreferences}>
          <div className="flex min-h-screen flex-col lg:flex-row">
            <Sidebar language={language} displayCurrency={currencyPreferences.displayCurrency} />
            <main id="main-content" tabIndex={-1} className="jp-stagger min-w-0 flex-1 px-4 py-5 lg:px-8 lg:py-6">{children}</main>
          </div>
        </LanguageProvider>
      </body>
    </html>
  )
}
