import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cool ops neutrals (mapped from design.md paper/ink)
        coal: {
          800: '#1e1f24',
          900: '#16171c',
          950: '#101114',
        },
        // Single brand accent — use sparingly
        ember: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
          950: '#431407',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        control: '4px',
        panel: '6px',
      },
      boxShadow: {
        // No glow — enterprise chrome is border-first
        ember: 'none',
        'ember-sm': 'none',
      },
      transitionDuration: {
        short: '120ms',
      },
    },
  },
  plugins: [],
};

export default config;
