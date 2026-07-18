import { Geist, Geist_Mono } from 'next/font/google'

// Brand mandates Geist + Geist Mono only (three weights, no serif). These expose
// the --font-geist-* CSS variables that styles/jp-theme.css resolves --font-sans
// / --font-mono against, matching nextjs-react-notion-x.
export const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

export const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})
