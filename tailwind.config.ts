import type { Config } from 'tailwindcss'

// Tailwind utilities are bound to the jp-theme CSS variables (styles/jp-theme.css,
// copied from nextjs-react-notion-x) so both projects share one visual language.
/**
 * A theme colour that still takes Tailwind's opacity modifier.
 *
 * The jp-theme variables hold hex values, and Tailwind 3 cannot split a colour
 * it only sees as `var(...)` into channels, so `bg-info/10` or
 * `border-[color:var(--accent-danger)]/30` used to generate no CSS at all.
 * color-mix applies the alpha in the browser instead, which keeps the CSS
 * variables as the single source of truth for both themes. Without a modifier
 * Tailwind substitutes 1 (or its `--tw-*-opacity` variable), so plain `bg-info`
 * still resolves to the solid colour.
 */
const themeColor = (variable: string) =>
  `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: themeColor('--bg-page'),
        surface: themeColor('--bg-surface'),
        card: themeColor('--bg-card'),
        ink: themeColor('--text-primary'),
        'ink-2': themeColor('--text-secondary'),
        'ink-3': themeColor('--text-tertiary'),
        line: themeColor('--border-default'),
        'line-subtle': themeColor('--border-subtle'),
        info: themeColor('--accent-info'),
        success: themeColor('--accent-success'),
        warning: themeColor('--accent-warning'),
        danger: themeColor('--accent-danger'),
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        elevated: 'var(--shadow-elevated)',
        popover: 'var(--shadow-popover)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      /**
       * The type scale, named by role.
       *
       * Before this the app carried 514 arbitrary `text-[Npx]` literals across
       * sixteen distinct sizes, so nothing stopped a seventeenth appearing and
       * two labels doing the same job could differ by a pixel.
       *
       * The steps are derived from what the app actually used rather than
       * imposed: 12, 11, 10, 18 and 13 px alone accounted for 93% of those
       * literals, so they are kept exactly. Only sixteen genuine outliers
       * (9, 15, 16, 19, 20, 22, 44, 52) snap to their nearest step.
       *
       * Values are size-only, deliberately. Tailwind's arbitrary `text-[11px]`
       * sets font-size and leaves line-height inherited; attaching a
       * line-height here would re-space every block in the app.
       */
      fontSize: {
        micro: '10px',
        label: '11px',
        caption: '12px',
        body: '13px',
        'body-lg': '14px',
        title: '18px',
        metric: '28px',
        hero: '42px',
        display: '52px',
      },
    },
  },
  plugins: [],
}

export default config
