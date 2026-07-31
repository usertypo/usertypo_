/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './pages/**/*.{html,js}',
    './js/**/*.{js,html}',
    './*.{js,html}',
  ],
  theme: {
    extend: {
      colors: {
        'on-primary': '#000000',
        'on-surface-variant': '#aaabb0',
        'on-surface': '#f3f3f9',
        'surface-container-highest': '#23262c',
        'surface-container-low': '#111318',
        'surface-container': '#171a1e',
        'tertiary-container': '#ff3333',
        tertiary: '#ff7166',
        /* Solid hex only — CSS vars break Tailwind opacity modifiers */
        primary: '#ffffff',
        'primary-dark': '#cccccc',
        'primary-light': '#dddddd',
        background: '#000000',
        'background-dark': '#000000',
        surface: '#1a1d23',
        'surface-light': '#252932',
        error: '#ff4444',
      },
      fontFamily: {
        display: ['Space Grotesk'],
        body: ['Inter'],
        mono: ['"Roboto Mono"', 'monospace'],
        sans: ['Inter', 'sans-serif'],
        headline: ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        breath: {
          '0%, 100%': { opacity: '1', textShadow: '0 0 10px rgba(255,255,255,0.45)' },
          '50%': { opacity: '0.2', textShadow: '0 0 2px rgba(255,255,255,0.1)' },
        },
        boxFadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        blink: 'blink 1s step-end infinite',
        breath: 'breath 2s ease-in-out infinite',
        boxFadeIn: 'boxFadeIn 0.5s ease-out forwards',
        'fade-in-up': 'fade-in-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-in': 'fade-in 1s ease-out forwards',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries'),
  ],
};
