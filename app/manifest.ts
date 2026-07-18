import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Stock Observatory',
    short_name: 'Stocks',
    description: 'Read-only portfolio monitoring dashboard',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F6F3',
    theme_color: '#FFFFFF',
  }
}
