/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        chrome: token('chrome'),
        canvas: token('canvas'),
        sunken: token('sunken'),
        'line-strong': token('line-strong'),
        surface: token('surface'),
        raised: token('raised'),
        line: token('line'),
        ink: token('ink'),
        muted: token('muted'),
        faint: token('faint'),
        accent: token('accent'),
        'accent-ink': token('accent-ink'),
        ok: token('ok'),
        warn: token('warn'),
        danger: token('danger'),
        seg1: token('seg1'),
        seg2: token('seg2'),
        seg3: token('seg3'),
        seg4: token('seg4'),
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        display: ['"Segoe UI Variable Display"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        stripes: { '0%': { backgroundPosition: '0 0' }, '100%': { backgroundPosition: '24px 0' } },
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        stripes: 'stripes 0.8s linear infinite',
      },
    },
  },
  plugins: [],
}
