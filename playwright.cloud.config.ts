import { defineConfig } from '@playwright/test'

const required = ['SUPABASE_TEST_URL', 'SUPABASE_TEST_KEY', 'SUPABASE_TEST_EMAIL_A', 'SUPABASE_TEST_EMAIL_B', 'SUPABASE_TEST_PASSWORD'] as const
const missing = required.filter((name) => !process.env[name])
if (process.env.STICKERLAB_CLOUD_TEST !== '1' || missing.length) {
  throw new Error(`Cloud browser verification requires STICKERLAB_CLOUD_TEST=1 and ${missing.length ? `these variables: ${missing.join(', ')}` : 'dedicated test variables'}. Use npm run test:cloud.`)
}

const port = 4174
const origin = `http://127.0.0.1:${port}`
const viteEnv = {
  ...process.env,
  VITE_SUPABASE_URL: process.env.SUPABASE_TEST_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_TEST_KEY,
  VITE_AUTH_ALLOWED_ORIGINS: origin,
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'cloud.spec.ts',
  workers: 1,
  timeout: 120000,
  use: { baseURL: origin, browserName: 'chromium', launchOptions: { executablePath: '/usr/bin/chromium' } },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    port,
    reuseExistingServer: false,
    env: viteEnv,
  },
})
