import { defineConfig } from '@playwright/test';

export default defineConfig({
	// Serial: the presentation scale/export journeys are CPU-heavy enough that
	// running files in parallel made unrelated long journeys exceed their default
	// timeout. A deterministic three-minute run beats a one-in-ten flake.
	workers: 1,
	// Builds and serves the production output; the primary journey is verified
	// against the real SvelteKit build, not a dev server.
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 240_000
	},
	testMatch: ['**/*.e2e.{ts,js}', 'e2e/**/*.spec.ts'],
	// The optional-cloud suite needs a build with synthetic public config and its own
	// backend interceptors; it runs through `playwright.cloud.config.js` instead.
	testIgnore: ['e2e/cloud.spec.ts'],
	use: {
		baseURL: 'http://localhost:4173',
		viewport: { width: 1440, height: 900 },
		// The bundled Playwright Chromium is used by default; set
		// PLAYWRIGHT_CHROMIUM_PATH (for example /usr/bin/chromium) to use a system browser.
		launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
			? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
			: {}
	},
	reporter: [['list']]
});
