import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(root, 'src') } },
  // Pre-bundle lazy export dependencies so the first import cannot trigger a
  // dev-server re-optimization (and page reload) mid-session.
  optimizeDeps: { include: ['pdf-lib', 'fflate'] },
  // Generated proof/report artifacts must not trigger dev-server HMR reloads.
  server: { watch: { ignored: ['**/proofs/out/**', '**/test-results/**', '**/playwright-report/**'] } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
