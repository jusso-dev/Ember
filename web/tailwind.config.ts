import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
        coal: {
          800: '#1c1410',
          900: '#140f0c',
          950: '#0c0907',
        },
      },
      boxShadow: {
        ember: '0 0 24px -4px oklch(0.65 0.18 45 / 0.35)',
        'ember-sm': '0 0 12px -2px oklch(0.65 0.16 45 / 0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
