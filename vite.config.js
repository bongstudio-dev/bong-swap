import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project at /bong-swap/, so the production build needs
// that base path. Dev stays at / for a clean http://localhost:5173.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/bong-swap/' : '/',
  plugins: [react()],
}))
