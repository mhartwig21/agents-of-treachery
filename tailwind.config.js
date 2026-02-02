/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Diplomacy power colors
        england: '#1e3a5f',
        france: '#5c8dc9',
        germany: '#4a4a4a',
        italy: '#2e7d32',
        austria: '#c62828',
        russia: '#7b1fa2',
        turkey: '#f9a825',
        neutral: '#9e9e9e',
      }
    },
  },
  plugins: [],
}
