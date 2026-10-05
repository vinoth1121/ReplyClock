import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        void: '#0A0A0A',
        panel: '#0E0E0E',
        panel2: '#121212',
        phosphor: '#39FF14',
        amber: '#FFB000',
        breach: '#FF3B3B',
        dim: '#6B7280',
        chrome: '#9CA3AF',
        rule: '#1F1F1F',
      },
      // Terminal identity: nothing is rounded. DEFAULT is pinned to 0 so a bare
      // `rounded` / `rounded-lg` in any component still renders square.
      borderRadius: {
        none: '0',
        DEFAULT: '0',
        sm: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        '3xl': '0',
      },
      keyframes: {
        // Must stay in sync with the `crt-sweep` @keyframes in app/globals.css.
        'crt-sweep': {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(100%)' },
        },
      },
      animation: {
        'crt-sweep': 'crt-sweep 8s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
