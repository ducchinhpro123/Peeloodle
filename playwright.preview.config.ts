import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /(?:fonts-stickers|render-parity)\.spec\.ts$/,
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
