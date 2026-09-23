/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--page)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        ink2: 'var(--ink-2)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        axis: 'var(--axis)',
        accent: 'var(--accent)',
        wash: 'var(--wash)',
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', 'system-ui', '-apple-system', '"Apple SD Gothic Neo"', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
