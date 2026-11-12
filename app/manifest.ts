import type { MetadataRoute } from 'next'
import { APP_NAME } from '@/lib/brand'
import { UI_COPY_BY_LANG } from '@/lib/ui-copy'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: 'Finance',
    // Static metadata has no request, so it stays English by design.
    description: UI_COPY_BY_LANG.en.common.appDescription,
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F6F3',
    theme_color: '#FFFFFF',
  }
}
