// No server-only imports here: the sidebar is a client component and reads BRAND.

/**
 * The product name, in one place. The root layout builds its title template
 * from this, and `/` has to spell the template out itself: Next applies a
 * template to child segments only, and `app/page.tsx` shares a segment with
 * `app/layout.tsx`, so without this the home tab was the one tab missing the
 * product name.
 */
export const APP_NAME = 'Personal Finance Observatory'

// The product name in the parts the sidebar wordmark reads, so the name cannot
// drift; tests/page-names.test.ts checks the parts spell APP_NAME. The manifest
// reads APP_NAME, not BRAND.
export const BRAND = { eyebrow: 'Personal', wordmark: 'Finance Observatory', short: 'Personal Finance' } as const
