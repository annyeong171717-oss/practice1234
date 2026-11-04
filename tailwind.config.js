/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/index.html', './public/js/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        script: ['"Dancing Script"', 'cursive'],
        hand: ['Caveat', 'cursive'],
      },
      colors: {
        ink: {
          DEFAULT: '#1d1a39',
          700: '#3a3660',
          500: '#6b6889',
          400: '#9895b3',
          300: '#c3c1d6',
        },
        lav: {
          50: '#f6f5ff',
          100: '#eeecff',
          200: '#dedaff',
          300: '#c5bdfd',
          400: '#a99cf8',
          500: '#8d7ff2',
          600: '#7465e6',
          700: '#5f50c9',
          800: '#463a99',
          900: '#2b2466',
        },
        surface: '#f8f7fe',
      },
      boxShadow: {
        soft: '0 10px 30px -14px rgba(116, 101, 230, 0.28)',
        lift: '0 14px 30px -12px rgba(116, 101, 230, 0.55)',
        shell: '0 0 80px -20px rgba(80, 60, 180, 0.35)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        'sheet-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        blink: {
          '0%, 80%, 100%': { opacity: 0.2 },
          '40%': { opacity: 1 },
        },
        wave: {
          '0%, 100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
        sway: {
          '0%, 100%': { transform: 'rotate(var(--r, 0deg))' },
          '50%': { transform: 'rotate(calc(var(--r, 0deg) + 7deg))' },
        },
        twinkle: {
          '0%, 100%': { opacity: 0.25 },
          '50%': { opacity: 1 },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        pop: {
          '0%': { transform: 'scale(.6)', opacity: 0 },
          '60%': { transform: 'scale(1.08)', opacity: 1 },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .35s ease-out both',
        'sheet-up': 'sheet-up .3s cubic-bezier(.2,.8,.2,1) both',
        blink: 'blink 1.4s infinite both',
        wave: 'wave 1s ease-in-out infinite',
        sway: 'sway 7s ease-in-out infinite',
        twinkle: 'twinkle 3s ease-in-out infinite',
        float: 'float 3.5s ease-in-out infinite',
        pop: 'pop .45s cubic-bezier(.2,.8,.2,1) both',
      },
    },
  },
  plugins: [],
};
