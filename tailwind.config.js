/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html", // Asegúrate de incluir tu HTML si usas clases ahí
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'sans-serif'], // Añadir la fuente Inter
      },
    },
  },
  plugins: [],
}