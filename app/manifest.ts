import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Personal Finance Observatory',
    short_name: 'Finance',
    description: 'Assets, cash flow and KR/US tax history from private local records',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F6F3',
    theme_color: '#FFFFFF',
  }
}
