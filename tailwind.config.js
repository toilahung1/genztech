/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./pages/**/*.html"
  ],
  theme: {
    extend: {
      colors: {
        'dark': '#0a0a0f',
        'facebook-blue': '#1877F2',
        'cyan': '#00D4FF',
        'gray': {
          400: '#9ca3af',
          500: '#6b7280',
        }
      },
      fontFamily: {
        'sans': ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        '9xl': '8rem',
        '10xl': '10rem',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '100': '25rem',
      },
      backdropBlur: {
        'xs': '2px',
      },
      boxShadow: {
        'glow': '0 0 30px -5px rgba(24, 119, 242, 0.5)',
        'glow-strong': '0 0 50px -5px rgba(24, 119, 242, 0.8)',
      },
      animation: {
        'pulse': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      perspective: {
        '1000': '1000px',
      }
    },
  },
  plugins: [],
}