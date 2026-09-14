import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // The production build is the shared premise: fonts/render parity and the
  // presentation offline journey all measure what a static host actually serves.
  testMatch: /(?:fonts-stickers|render-parity|presentations-production-offline)\.spec\.ts$/,
  use: {
    baseURL: 'http://127.0.0.1:4176',
    browserName: 'chromium',
    launchOptions: { executablePath: '/usr/bin/chromium' },
  },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4176 --strictPort',
    port: 4176,
    reuseExistingServer: false,
    timeout: 120000,
  },
})
