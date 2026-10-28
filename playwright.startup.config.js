import { defineConfig } from '@playwright/test';

// Development serves native icon modules, where a blocked unused import can
// stop hydration. Production bundles hide that failure, so verify both browsers
// against Vite as well as keeping these journeys in the production suite.
export default defineConfig({
	workers: 1,
	testMatch: 'e2e/presentation-startup.spec.ts',
	webServer: {
		command: 'npm run dev -- --host 127.0.0.1 --port 5173',
		url: 'http://127.0.0.1:5173/presentations',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	},
	use: {
		baseURL: 'http://127.0.0.1:5173',
		viewport: { width: 1440, height: 900 }
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{ name: 'firefox', use: { browserName: 'firefox' } }
	],
	reporter: [['list']]
});
