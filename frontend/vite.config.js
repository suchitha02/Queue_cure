import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy /api and /socket.io to the backend so the browser URL stays clean
    // Dev: http://localhost:5173  (no :5000 ever visible to the user)
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,  // WebSocket proxy — critical for Socket.IO
      },
    },
  },
})
