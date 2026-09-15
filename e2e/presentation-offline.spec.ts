/**
 * Production-build offline journey (P45 follow-up).
 *
 * The presentation routes are separate chunks fetched over the network, and a static
 * host cannot serve them again once the connection is gone. This spec drives the real
 * UI only — no debug globals — and claims exactly what the readiness module claims:
 *
 * - Before it says "Ready for offline use.", opening the library has fetched the
 *   modules the local flow needs.
 * - Once ready, a disconnect does not break local edit/save/reopen or a *first-use*
 *   PDF, PPTX and backup export.
 * - A page that never opened the presentation flow, and reloading while offline, stay
 *   unsupported: there is no service worker.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { elementRectOnCanvas, openBlankEditor, paintedPixelsInRect } from './presentations';

const READY_LABEL = 'Ready for offline use.';
const TEXT = 'Ngoại tuyến giữ nguyên bố cục';
const EDITED = `${TEXT} và sửa khi mất mạng`;
const FAILURE_LABEL = 'Offline use could not be prepared in this page.';

/**
 * The two failure paths, ported from the source `presentations-production-offline.spec.ts`:
 * a disconnect that lands before the warm-up runs (nothing was fetched, so nothing is
 * poisoned) and a builder fetch that really failed (the session reports how to recover
 * and needs a reload). Both drive the real UI only, like the journey above.
 */
const PHOTO = path.resolve('static/samples/cat-in-console.png');
const BEFORE_LOAD_LABEL =
	'Offline use needs one online load. Reconnect and reload the page. Your saved work is not affected.';
const UNPREPARED_LABEL =
	'Offline use could not be prepared in this page. Reconnect and reload the page. Your saved work is not affected.';

/**
 * The three export-builder chunks, read from the Vite manifest of the build under
 * test: SvelteKit emits opaque hashed names, so the manifest is the only honest
 * mapping from `presentations/exports/{snapshot,pdf,pptx}.ts` to a served URL.
 */
async function builderChunkPaths(): Promise<Set<string>> {
	const manifest = JSON.parse(
		await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
	) as Record<string, { file: string }>;
	return new Set(
		['snapshot.ts', 'pdf.ts', 'pptx.ts'].map((name) => {
			const key = Object.keys(manifest).find((candidate) => candidate.endsWith(`/exports/${name}`));
			if (!key) throw new Error(`the build manifest has no ${name}`);
			return `/${manifest[key]!.file}`;
		})
	);
}

/**
 * Real presentation faces the page holds, with the status each face reports.
 * `document.fonts.check` answers `true` from the fallback, so the faces themselves
 * are read: a font readiness claim that never fetched the files would fail here.
 */
async function presentationFontFaces(page: Page): Promise<string[]> {
	return page
		.evaluate(() =>
			[...document.fonts]
				.filter((face) => face.family === 'Be Vietnam Pro' || face.family === 'Spectral')
				.map((face) => `${face.family} ${face.style} ${face.weight} ${face.status}`)
		)
		.then((faces) => faces.sort());
}

/** Opens the export dialog and makes sure it is the one the assertions read. */
async function openExportDialog(page: Page) {
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog).toBeVisible();
	return dialog;
}

/** The image the editor stores, with the geometry the inspector shows for it. */
async function insertPhoto(page: Page) {
	await page.getByTestId('presentation-image-input').setInputFiles(PHOTO);
	// The same fields are also rendered inside the (closed) mobile properties dialog,
	// so every read is scoped to the pane the user sees.
	const inspector = page.locator('.presentation-inspector');
	// A 1:1 insert gives the geometry fields the artwork's own pixel size, so these
	// numbers describe the picture, not whatever element was selected before.
	await expect(inspector.getByLabel('Width', { exact: true })).toHaveValue('344');
	const box = {
		x: Number(await inspector.getByLabel('X position', { exact: true }).inputValue()),
		y: Number(await inspector.getByLabel('Y position', { exact: true }).inputValue()),
		width: Number(await inspector.getByLabel('Width', { exact: true }).inputValue()),
		height: Number(await inspector.getByLabel('Height', { exact: true }).inputValue())
	};
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	return box;
}

/** Paints a saved image again after a reopen, so those pixels came from IndexedDB. */
async function paintedArtwork(
	page: Page,
	box: { x: number; y: number; width: number; height: number }
): Promise<number> {
	const rect = await elementRectOnCanvas(page, box);
	let painted = 0;
	await expect
		.poll(
			async () => {
				painted = await paintedPixelsInRect(page, rect);
				return painted;
			},
			{ timeout: 20_000, message: 'the reopened editor should repaint saved artwork' }
		)
		.toBeGreaterThan(1_000);
	return painted;
}

function pptxText(xml: string): string {
	return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join('');
}

/** Chooses one format in the already-open dialog and returns the downloaded bytes. */
async function exportVia(page: Page, label: string): Promise<Uint8Array> {
	const dialog = page.locator('dialog[open]');
	await expect(dialog).toBeVisible();
	const [download] = await Promise.all([
		page.waitForEvent('download', { timeout: 90_000 }),
		dialog.getByRole('button', { name: label, exact: true }).click()
	]);
	await expect(dialog.getByText('Export ready')).toBeVisible();
	const file = await download.path();
	if (!file) throw new Error('the download produced no file');
	return new Uint8Array(await (await import('node:fs/promises')).readFile(file));
}

test('a prepared session keeps editing, saving and first-use exports after the network drops', async ({
	page,
	context
}) => {
	test.setTimeout(300_000);

	// 1 — a real deck, built through the UI while the connection is up.
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text' }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await page.keyboard.type(TEXT);
	await page.keyboard.press('Escape');
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await page.close();

	// 2 — a fresh page. Building the deck above fetched the editor's route code into
	// *that* page's module registry, so the session under test is a new one: whatever
	// it can do offline, it can do only with what opening the library prepared.
	const session = await context.newPage();
	await session.goto('/presentations');
	// Readiness is observable in the UI and only claims what actually finished.
	await expect(session.getByText(READY_LABEL)).toBeVisible({ timeout: 60_000 });

	// 3 — the network goes away. Everything below runs offline. The HTTP cache is
	// cleared first: the preview build serves hashed chunks as immutable, and a warm
	// HTTP cache would let Chromium answer offline from disk regardless of what this
	// page ever loaded. With it cleared, only the modules this page fetched are left.
	const cdp = await context.newCDPSession(session);
	await cdp.send('Network.clearBrowserCache');
	await context.setOffline(true);

	// The deck reopens from the library through an in-app navigation: its route code
	// is part of what readiness had to fetch, and it must still be in memory.
	await session
		.getByRole('link', { name: /^Open / })
		.first()
		.click();
	await expect(session.getByTestId('presentation-canvas')).toBeVisible();
	await expect(session.getByText('Saved locally', { exact: true })).toBeVisible();

	// 4 — edit and autosave with no connection.
	await session
		.locator('.presentation-layer-item')
		.filter({ hasText: 'Text' })
		.first()
		.locator('.presentation-layer-select')
		.click();
	await session.getByRole('button', { name: 'Edit text: Text' }).click();
	await expect(session.getByTestId('text-edit-field')).toContainText(TEXT);
	await session.getByTestId('text-edit-field').press('End');
	await session.keyboard.type(' và sửa khi mất mạng');
	await session.keyboard.press('Escape');
	await expect(session.getByText('Saved locally', { exact: true })).toBeVisible({
		timeout: 15_000
	});

	// 5 — first use of each format on this deck, all with no connection.
	await session.getByRole('button', { name: 'Export', exact: true }).click();
	const pdfBytes = await exportVia(session, 'Export PDF');
	expect(Buffer.from(pdfBytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
	const pptxBytes = await exportVia(session, 'Export PPTX');
	expect(Buffer.from(pptxBytes.subarray(0, 2)).toString('latin1')).toBe('PK');
	const slideXml = strFromU8(unzipSync(pptxBytes)['ppt/slides/slide1.xml']);
	expect(pptxText(slideXml)).toContain(EDITED);
	const backupBytes = await exportVia(session, 'Download backup (.zip)');
	const backupEntries = unzipSync(backupBytes);
	expect(JSON.parse(strFromU8(backupEntries['manifest.json'])).documentId).toBe(id);

	// 6 — reconnect so a failure message has somewhere to point; the deck is intact.
	await context.setOffline(false);
	await session.keyboard.press('Escape');
	await expect(session.getByText(FAILURE_LABEL)).toHaveCount(0);
	await expect(session.getByTestId('presentation-canvas')).toBeVisible();
	await session.close();
});

test('a disconnect before the warm-up finishes is reported honestly and poisons nothing', async ({
	page,
	context
}) => {
	test.setTimeout(240_000);

	const builders = await builderChunkPaths();
	const builderRequestsWhileOffline: string[] = [];
	let offlineWindow = false;
	page.on('request', (request) => {
		if (!offlineWindow) return;
		const path = new URL(request.url()).pathname;
		if (builders.has(path)) builderRequestsWhileOffline.push(path);
	});

	// The app schedules the warm-up for an idle moment. Holding that moment is how
	// the disconnect provably lands first: the stub is test-side only, the app ships
	// no hook, and the idle callback fires 8 s after mount.
	await page.addInitScript(() => {
		window.requestIdleCallback = (callback: IdleRequestCallback) =>
			window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 8_000);
		window.cancelIdleCallback = (handle: number) => window.clearTimeout(handle);
	});

	await page.goto('/presentations');
	await expect(page.getByRole('button', { name: /Create your first presentation/ })).toBeVisible();
	await expect(page.getByText('Preparing offline use…')).toBeVisible();

	// 1 — the disconnect lands before the warm-up runs, so nothing was fetched.
	await context.setOffline(true);
	offlineWindow = true;
	await expect(page.getByText(BEFORE_LOAD_LABEL)).toBeVisible({ timeout: 30_000 });
	expect(builderRequestsWhileOffline).toEqual([]);

	// 2 — reconnecting in the same page restores local work and a first export: the
	// skipped warm-up left no failed module behind to poison them.
	offlineWindow = false;
	await context.setOffline(false);
	await page.getByRole('button', { name: /Create your first presentation/ }).click();
	await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Add text' }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await field.fill(TEXT);
	await page.keyboard.press('Escape');
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({
		timeout: 15_000
	});
	const imageBox = await insertPhoto(page);
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	const pdfBytes = await exportVia(page, 'Export PDF');
	expect(Buffer.from(pdfBytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');

	// 3 — a reloaded session warms properly while online (all eight faces fetched),
	// and *that* is what makes an offline reopen work from this page.
	await page.goto('/presentations');
	await expect(page.getByText(READY_LABEL)).toBeVisible({ timeout: 30_000 });
	const faces = await presentationFontFaces(page);
	expect(faces).toHaveLength(8);
	expect(faces.every((face) => face.endsWith(' loaded'))).toBe(true);

	await context.setOffline(true);
	await page
		.getByRole('link', { name: /^Open / })
		.first()
		.click();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	// The artwork can only be painted from IndexedDB: the network is gone and the
	// module holding the decoded bitmap belongs to the page that just reloaded.
	expect(await paintedArtwork(page, imageBox)).toBeGreaterThan(1_000);
	await context.setOffline(false);
});

test('a builder that cannot be fetched says how to recover and needs a reload', async ({
	page,
	context
}) => {
	test.setTimeout(240_000);

	const builders = await builderChunkPaths();
	const downloadNames: string[] = [];
	page.on('download', (download) => downloadNames.push(download.suggestedFilename()));

	// Hold the three builder chunks the warm-up fetches. The library, editor and
	// canvas chunks are not held, so the failure under test is exactly "the builder
	// fetches did not arrive" while local work keeps its own modules.
	const heldPaths: string[] = [];
	let releaseBuilders = () => {};
	const held = new Promise<void>((resolve) => {
		releaseBuilders = resolve;
	});
	await page.route('**/_app/immutable/chunks/*.js', async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (!builders.has(path)) return route.continue();
		heldPaths.push(path);
		if (heldPaths.length === builders.size) releaseBuilders();
		await held;
		return route.abort('internetdisconnected');
	});

	await page.goto('/presentations');
	await expect(page.getByRole('button', { name: /Create your first presentation/ })).toBeVisible();
	// All three builders were really requested while the connection was up, then the
	// disconnect turned those fetches into failures instead of a replayed message.
	await held;
	await context.setOffline(true);
	releaseBuilders();
	await expect(page.getByText(UNPREPARED_LABEL)).toBeVisible({ timeout: 30_000 });
	expect(heldPaths).toHaveLength(builders.size);

	// A failed warm-up must not touch local work that its modules can still serve.
	await page.getByRole('button', { name: /Create your first presentation/ }).click();
	await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Add text' }).click();
	await page.getByTestId('text-edit-field').fill(TEXT);
	await page.keyboard.press('Escape');
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({
		timeout: 15_000
	});

	// The export explains how to recover instead of repeating the browser's module error.
	const dialog = await openExportDialog(page);
	await expect(dialog.getByText(UNPREPARED_LABEL)).toBeVisible();
	await dialog.getByRole('button', { name: 'Export PDF' }).click();
	const alert = dialog.getByRole('alert');
	await expect(alert).toBeVisible({ timeout: 30_000 });
	const failureMessage = (await alert.innerText()).trim();
	expect(failureMessage).toContain('Reconnect and reload the page');
	expect(failureMessage).not.toContain('dynamically imported module');
	expect(downloadNames).toEqual([]);

	// Retrying in the same page cannot work: the failed import is cached for the page.
	await dialog.getByRole('button', { name: 'Export PDF' }).click();
	await expect(alert).toContainText('Reconnect and reload the page', { timeout: 30_000 });
	await page.keyboard.press('Escape');

	// Recovery is a reload while online: the next page session warms and exports again.
	await context.setOffline(false);
	await page.unroute('**/_app/immutable/chunks/*.js');
	await page.goto('/presentations');
	await expect(page.getByText(READY_LABEL)).toBeVisible({ timeout: 30_000 });
	await page
		.getByRole('link', { name: /^Open / })
		.first()
		.click();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	const pdfBytes = await exportVia(page, 'Export PDF');
	expect(Buffer.from(pdfBytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
});
