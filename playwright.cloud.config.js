import { defineConfig } from '@playwright/test';

/**
 * The optional-cloud suite. It runs against a production build whose public
 * Supabase configuration points at a synthetic project, and the spec intercepts
 * every auth/REST/Storage request with an in-memory backend. No real Supabase
 * project, credentials or emails are involved.
 *
 * Kept out of the default config on purpose: the main suite must keep proving the
 * app stays fully local without cloud configuration. Live cross-user RLS/Storage
 * verification still needs dedicated test accounts and is reported as unavailable.
 */
export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview -- --port 4174 --strictPort',
		port: 4174,
		reuseExistingServer: false,
		timeout: 240_000,
		env: {
			VITE_SUPABASE_URL: 'https://synthetic-test.supabase.co',
			VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(24)}`,
			VITE_AUTH_ALLOWED_ORIGINS: 'http://localhost:4174,http://127.0.0.1:4174'
		}
	},
	testMatch: ['e2e/cloud.spec.ts'],
	use: {
		baseURL: 'http://localhost:4174',
		viewport: { width: 1440, height: 900 },
		launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
			? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
			: {}
	},
	reporter: [['list']]
});
