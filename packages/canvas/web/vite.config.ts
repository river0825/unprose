import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react()],
  server: {
    port: 5174,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:4400',
      '/ws': { target: 'ws://localhost:4400', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
