import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// En desarrollo, Vite reenvía /api al backend (puerto 3000): así el
// navegador ve un solo origen y no hay problemas de CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
