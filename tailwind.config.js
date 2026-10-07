/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'media',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#f4fbf5',
        muted: '#9aa9a0',
        panel: '#0c1511',
        'panel-soft': '#101d17',
        line: 'rgba(186, 255, 207, 0.14)',
        neon: '#b8ffcf',
        'neon-strong': '#78ff9c',
      },
      boxShadow: {
        glass: '0 24px 80px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        neon: '0 0 34px rgba(120, 255, 156, 0.2), 0 14px 32px rgba(0, 0, 0, 0.32)',
      },
      backgroundImage: {
        'mesh-dark': 'radial-gradient(circle at 15% 0%, rgba(38, 104, 69, 0.28), transparent 34%), radial-gradient(circle at 86% 18%, rgba(56, 130, 91, 0.12), transparent 28%), linear-gradient(135deg, #07100c 0%, #030505 58%, #06110b 100%)',
      },
    },
  },
  plugins: [],
}
