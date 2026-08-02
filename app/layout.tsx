import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { geistSans, geistMono } from '@/lib/fonts'
import '@/styles/jp-theme.css'
import '@/styles/globals.css'
import { Sidebar } from '@/components/Sidebar'

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-theme="jp" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <a href="#main-content" className="sr-only z-[100] rounded-sm bg-card px-4 py-3 text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:ring-2 focus:ring-info">
          본문으로 바로가기
        </a>
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar />
          <main id="main-content" tabIndex={-1} className="jp-stagger min-w-0 flex-1 px-4 py-5 lg:px-8 lg:py-6">{children}</main>
        </div>
      </body>
    </html>
  )
}
