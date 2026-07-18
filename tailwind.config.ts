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
    },
  },
  plugins: [],
}

export default config
