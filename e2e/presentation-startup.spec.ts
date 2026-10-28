import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { listStoredPresentations, readStoredPresentation } from './presentations';

test('a blocked unused icon does not prevent the presentation library from starting', async ({
	page
}, testInfo) => {
	const errors: string[] = [];
	const iconRequests: string[] = [];
	const blocked: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('request', (request) => {
		if (request.url().includes('/lucide-svelte/')) iconRequests.push(request.url());
	});
	// Privacy filters can block this filename even though it is only an SVG icon.
	// No screen in this app uses it, so loading it must not be a startup dependency.
	await page.route('**/lucide-svelte/dist/icons/fingerprint*', async (route) => {
		blocked.push(route.request().url());
		await route.abort('blockedbyclient');
	});
	try {
		await page.goto('/presentations');
		const start = page.getByRole('button', { name: 'Start a blank presentation', exact: true });
		await expect(start).toBeEnabled({ timeout: 15_000 });
		await start.click();
		await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
		await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
		await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();
		expect(blocked).toEqual([]);
		expect(errors).toEqual([]);
		await mkdir('proofs/out/presentation-startup', { recursive: true });
		const screenshot = 'proofs/out/presentation-startup/blocked-icon-editor.png';
		await page.screenshot({ path: screenshot });
		await testInfo.attach('Blank slide with privacy filtering enabled', {
			path: screenshot,
			contentType: 'image/png'
		});
	} finally {
		await testInfo.attach('Icon requests and startup errors', {
			body: JSON.stringify({ iconRequests, blocked, errors }, null, 2),
			contentType: 'application/json'
		});
	}
});

for (const entry of [
	{ name: 'hero', selector: '.presentation-hero-actions button' },
	{ name: 'gallery', selector: '.blank-template' }
]) {
	test(`${entry.name} blank presentation button waits for initialization and opens a saved slide`, async ({
		page
	}, testInfo) => {
		// Hold the real client scripts so the server-rendered page stays visible
		// without its event handlers, even on a fast machine or a warm dev server.
		let releaseScripts!: () => void;
		const scriptsReady = new Promise<void>((resolve) => (releaseScripts = resolve));
		await page.route('**/*', async (route) => {
			if (route.request().resourceType() === 'script') await scriptsReady;
			await route.continue();
		});
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await mkdir('proofs/out/presentation-startup', { recursive: true });
		try {
			await page.goto('/presentations', { waitUntil: 'domcontentloaded' });
			const start = page.locator(entry.selector);
			await expect(start).toBeVisible();
			await expect(start).toBeDisabled({ timeout: 1_000 });
			await expect(start).toContainText('Loading');
			const loading = `proofs/out/presentation-startup/${entry.name}-loading.png`;
			await page.screenshot({ path: loading, fullPage: true });
			await testInfo.attach('Waiting for initialization', {
				path: loading,
				contentType: 'image/png'
			});

			releaseScripts();
			await expect(start).toBeEnabled({ timeout: 30_000 });
			await start.click();
			await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
			await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
			await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();
			const id = decodeURIComponent(page.url().split('/').pop()!);
			expect(await readStoredPresentation(page, id)).toMatchObject({
				title: 'Untitled presentation',
				slideCount: 1,
				elements: []
			});
			expect(await listStoredPresentations(page)).toHaveLength(1);

			await page.reload();
			await expect(page.getByTestId('presentation-canvas')).toHaveAttribute('data-ready', 'true');
			const editor = `proofs/out/presentation-startup/${entry.name}-editor.png`;
			await page.screenshot({ path: editor });
			await testInfo.attach('Saved blank slide after reload', {
				path: editor,
				contentType: 'image/png'
			});
			expect(errors).toEqual([]);
		} finally {
			releaseScripts();
		}
	});
}
