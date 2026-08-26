import type { Config } from 'tailwindcss'

// Tailwind utilities are bound to the jp-theme CSS variables (styles/jp-theme.css,
// copied from nextjs-react-notion-x) so both projects share one visual language.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--bg-page)',
        surface: 'var(--bg-surface)',
        card: 'var(--bg-card)',
        ink: 'var(--text-primary)',
        'ink-2': 'var(--text-secondary)',
        'ink-3': 'var(--text-tertiary)',
        line: 'var(--border-default)',
        'line-subtle': 'var(--border-subtle)',
        info: 'var(--accent-info)',
        success: 'var(--accent-success)',
        warning: 'var(--accent-warning)',
        danger: 'var(--accent-danger)',
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
