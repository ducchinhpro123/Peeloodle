/**
 * In-browser background removal journeys against the production build, with the
 * real ISNet model on whichever backend the headless browser offers (WASM in CI).
 *
 * The removal is proven end to end: the mask lands in IndexedDB as one undo step,
 * reaches the exported PNG, and its quality is gated by IoU against ground-truth
 * subject alpha for a person, a pet and an object (`e2e/fixtures/cutout/`).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { MODEL_SHA256 } from '../src/lib/cutout/modelInfo';

const FIXTURES = path.resolve('e2e/fixtures/cutout');
const fixture = (name: string) => path.join(FIXTURES, name);
const cutout = (page: Page) => page.getByTestId('cutout');

/** One row per quality-gate fixture; Task 5 writes the artifact from it. */
export type CutoutQualityRow = {
	fixture: string;
	/** False for the cluttered benchmark set, which is reported but never gates. */
	gating: boolean;
	iou: number;
	backend: string;
	downloadMs: number;
	inferenceMs: number;
};
const results: CutoutQualityRow[] = [];
/** Mask and exported sticker bytes per quality fixture, for the artifact. */
const artifacts = new Map<string, { mask: Buffer; sticker: Buffer }>();
/** The pinned onnxruntime-web version; its runtime is served from `/vendor/ort/<version>/`. */
const ORT_VERSION = JSON.parse(
	readFileSync(path.resolve('node_modules/onnxruntime-web/package.json'), 'utf8')
).version as string;
const HELP_COPY =
	'Runs on your device. Your photo is never uploaded. Refine with Erase and Restore.';

/** Opens a fresh editor with `photo` uploaded and the Adjust tab showing. */
async function openEditorWithPhoto(
	page: Page,
	photo: string,
	/** Runs once the editor has loaded, before the photo is uploaded. */
	beforeUpload?: () => Promise<void>
) {
	await page.goto('/');
	await page.getByRole('link', { name: /Create a Sticker/ }).click();
	await expect(page).toHaveURL(/\/editor\/[0-9a-z-]+/, { timeout: 20_000 });
	await beforeUpload?.();
	await page.setInputFiles('[data-testid="photo-file-input"]', photo);
	await expect(page.locator('.save-status')).toContainText(/Unsaved changes|Saving|Saved locally/, {
		timeout: 20_000
	});
	await page.getByRole('tab', { name: 'Layers' }).click();
	await expect(page.locator('.layer-stack .layer-row')).toHaveCount(1);
	await page.getByRole('tab', { name: 'Adjust' }).click();
	const projectId = page.url().match(/editor\/([^/?#]+)/)?.[1];
	if (!projectId) throw new Error('The editor URL has no project id');
	return projectId;
}

async function saveAndWait(page: Page) {
	await page.getByRole('button', { name: /Save to My Stickers/ }).click();
	await expect(page.locator('.save-status')).toContainText('Saved locally', { timeout: 20_000 });
}

/**
 * Clicks Remove background and waits for the run to finish. On a first run the
 * consent dialog appears and is accepted with "Download & remove".
 */
async function removeBackground(page: Page) {
	await page.getByRole('button', { name: 'Remove background' }).click();
	await expect(cutout(page)).not.toHaveAttribute('data-state', 'idle');
	if ((await cutout(page).getAttribute('data-state')) === 'consent') {
		await page.getByRole('button', { name: 'Download & remove' }).click();
	}
	await expect(cutout(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
}

/** The stored image layer's `maskKey`, read straight out of the app's IndexedDB. */
async function storedMaskKey(page: Page, projectId: string) {
	return page.evaluate(async (id) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('stickerlab-local');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const project = await new Promise<{ layers: Array<{ kind: string; maskKey?: string }> }>(
			(resolve, reject) => {
				const tx = db.transaction('projects', 'readonly');
				const request = tx.objectStore('projects').get(id);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			}
		);
		db.close();
		return project.layers.find((layer) => layer.kind === 'image')?.maskKey ?? null;
	}, projectId);
}

/**
 * IoU of the stored mask (alpha ≥ 128) against the ground truth (gray ≥ 128),
 * both decoded in the page.
 */
async function storedMaskIou(page: Page, projectId: string, truth: Buffer) {
	return page.evaluate(
		async ({ id, truthBytes }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('stickerlab-local');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const get = <T>(store: string, key: string) =>
				new Promise<T>((resolve, reject) => {
					const request = db.transaction(store, 'readonly').objectStore(store).get(key);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
			const project = await get<{ layers: Array<{ kind: string; maskKey?: string }> }>(
				'projects',
				id
			);
			const maskKey = project.layers.find((layer) => layer.kind === 'image')?.maskKey;
			if (!maskKey) throw new Error('The stored layer has no mask');
			const row = await get<{ blob: Blob | ArrayBuffer }>('masks', maskKey);
			db.close();
			const maskBlob =
				row.blob instanceof Blob ? row.blob : new Blob([row.blob], { type: 'image/png' });

			const pixels = async (blob: Blob) => {
				const bitmap = await createImageBitmap(blob);
				const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(bitmap, 0, 0);
				bitmap.close();
				return ctx.getImageData(0, 0, canvas.width, canvas.height);
			};
			const mask = await pixels(maskBlob);
			const gt = await pixels(new Blob([new Uint8Array(truthBytes)], { type: 'image/png' }));
			if (mask.width !== gt.width || mask.height !== gt.height)
				throw new Error(`Mask ${mask.width}×${mask.height} ≠ truth ${gt.width}×${gt.height}`);
			let intersection = 0;
			let union = 0;
			for (let i = 0; i < mask.data.length; i += 4) {
				const a = mask.data[i + 3] >= 128;
				const b = gt.data[i] >= 128;
				if (a && b) intersection += 1;
				if (a || b) union += 1;
			}
			const maskBytes = Array.from(new Uint8Array(await maskBlob.arrayBuffer()));
			return { iou: union === 0 ? 1 : intersection / union, maskBytes };
		},
		{ id: projectId, truthBytes: Array.from(truth) }
	);
}

/** Centroid of a ground-truth PNG's subject (gray ≥ 128), decoded in the page. */
async function truthCentroid(page: Page, truth: Buffer) {
	return page.evaluate(async (bytes) => {
		const bitmap = await createImageBitmap(
			new Blob([new Uint8Array(bytes)], { type: 'image/png' })
		);
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();
		const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
		let sx = 0;
		let sy = 0;
		let n = 0;
		for (let y = 0; y < height; y += 1)
			for (let x = 0; x < width; x += 1)
				if (data[(y * width + x) * 4] >= 128) {
					sx += x;
					sy += y;
					n += 1;
				}
		return { x: sx / n, y: sy / n, width, height };
	}, Array.from(truth));
}

/** Downloads the 512 px PNG export and returns its bytes. */
async function exportPng(page: Page): Promise<Buffer> {
	await page.getByRole('button', { name: /Export and share/ }).click();
	await page.getByRole('radio', { name: /512 px/ }).check();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: /Download PNG/ }).click();
	const download = await downloadPromise;
	const file = path.join(test.info().outputDir, `cutout-export-${Date.now()}.png`);
	await download.saveAs(file);
	await expect(page.locator('dialog [role="status"]')).toContainText('Download started');
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 10_000 });
	return readFileSync(file);
}

/** Alpha of a PNG at pixel points, decoded in the page. */
async function pngAlphaAt(page: Page, bytes: Buffer, points: Array<[number, number]>) {
	return page.evaluate(
		async ({ data, samplePoints }) => {
			const blob = new Blob([new Uint8Array(data)], { type: 'image/png' });
			const bitmap = await createImageBitmap(blob);
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(bitmap, 0, 0);
			bitmap.close();
			return samplePoints.map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]);
		},
		{ data: Array.from(bytes), samplePoints: points }
	);
}

test('removes the background of a pet photo in one undo step', async ({ page }) => {
	test.setTimeout(180_000);
	const projectId = await openEditorWithPhoto(page, fixture('sunny-corgi.png'));

	// The Background section states the new behaviour; the old "not available" copy is gone.
	const section = page
		.locator('.inspector-section')
		.filter({ has: page.getByText('Background', { exact: true }) });
	await expect(section).toContainText(HELP_COPY);
	await expect(page.getByText('Automatic background removal is not available')).toHaveCount(0);
	await expect(page.getByText('Backgrounds are not removed automatically')).toHaveCount(0);
	await expect(page.locator('[title*="Backgrounds are not removed automatically"]')).toHaveCount(0);

	await removeBackground(page);
	await expect(cutout(page).getByRole('status')).toContainText(
		'Background removed — use Erase/Restore to touch up.'
	);

	await saveAndWait(page);
	const maskKey = await storedMaskKey(page, projectId);
	expect(maskKey).toBeTruthy();

	// One removal is one undo step.
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBeNull();
	await page.getByRole('button', { name: 'Redo', exact: true }).click();
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBe(maskKey);

	// The 1024² photo fills the 1024 artboard at scale 1, so the 512 px export is
	// the photo at half size: a background corner is clear, the subject is kept.
	const centroid = await truthCentroid(page, readFileSync(fixture('sunny-corgi.truth.png')));
	const exported = await exportPng(page);
	const [corner, subject] = await pngAlphaAt(page, exported, [
		[20, 20],
		[Math.round(centroid.x / 2), Math.round(centroid.y / 2)]
	]);
	expect(corner).toBe(0);
	expect(subject).toBe(255);
});

test('cutout quality meets IoU ≥ 0.90 for person, pet and object', async ({ page }) => {
	test.setTimeout(900_000);
	mkdirSync(test.info().outputDir, { recursive: true });
	const runs = ['peace-selfie', 'sunny-corgi', 'boba-tea'].flatMap((name) => [
		{ name, file: `${name}.png`, gating: true },
		{ name, file: `${name}.clutter.png`, gating: false }
	]);
	for (const { name, file, gating } of runs) {
		const projectId = await openEditorWithPhoto(page, fixture(file));
		await removeBackground(page);
		await saveAndWait(page);
		const { iou, maskBytes } = await storedMaskIou(
			page,
			projectId,
			readFileSync(fixture(`${name}.truth.png`))
		);
		// Keep the produced mask next to the test output for inspection.
		writeFileSync(
			path.join(test.info().outputDir, file.replace(/\.png$/, '.mask.png')),
			Buffer.from(maskBytes)
		);
		const root = cutout(page);
		artifacts.set(file.replace(/\.png$/, ''), {
			mask: Buffer.from(maskBytes),
			sticker: await exportPng(page)
		});
		results.push({
			fixture: file.replace(/\.png$/, ''),
			gating,
			iou,
			backend: (await root.getAttribute('data-backend')) ?? '',
			downloadMs: Number(await root.getAttribute('data-download-ms')),
			inferenceMs: Number(await root.getAttribute('data-inference-ms'))
		});
		console.log(`cutout quality: ${JSON.stringify(results.at(-1))}`);
	}
	// Only the realistic set gates; the clutter benchmark is recorded, never asserted.
	for (const row of results.filter((item) => item.gating)) {
		expect(row.iou, `${row.fixture} IoU`).toBeGreaterThanOrEqual(0.9);
	}
});

test('falls back to WASM when WebGPU is broken', async ({ page }) => {
	test.setTimeout(180_000);
	// The backend is chosen inside the worker, which `addInitScript` never reaches:
	// serve the built worker chunk with a prefix that breaks `navigator.gpu` there.
	const stub = `Object.defineProperty(self.navigator, 'gpu', { configurable: true, value: { requestAdapter: () => Promise.reject(new Error('boom')) } });\n`;
	const stubbed: string[] = [];
	await page.route('**/_app/immutable/workers/cutout.worker-*.js', async (route) => {
		const response = await route.fetch();
		stubbed.push(route.request().url());
		await route.fulfill({ response, body: stub + (await response.text()) });
	});
	const workerLogs: string[] = [];
	page.on('worker', (worker) => worker.on('console', (message) => workerLogs.push(message.text())));
	const runtimeRequests: string[] = [];
	page.context().on('request', (request) => {
		if (request.url().includes('/vendor/ort/')) runtimeRequests.push(request.url());
	});

	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await removeBackground(page);
	await expect(cutout(page)).toHaveAttribute('data-backend', 'wasm');
	expect(stubbed).toHaveLength(1);
	// The stub ran in the worker: its rejected adapter request was observed there.
	expect(workerLogs).toContainEqual(
		expect.stringContaining('[cutout] WebGPU adapter request failed: boom')
	);
	// The immutable-cached runtime lives under a per-version folder, so an upgrade
	// changes every URL instead of serving a returning user a stale `.wasm`.
	expect(runtimeRequests.length).toBeGreaterThan(0);
	for (const url of runtimeRequests) {
		expect(new URL(url).pathname).toMatch(
			new RegExp(`^/vendor/ort/${ORT_VERSION.replaceAll('.', '\\.')}/[^/]+$`)
		);
	}
});

const MODEL_PATH = '/models/cutout/';
const CONSENT_TITLE = 'Download background remover?';

/** Records every request to the model, from the page or its worker. */
function watchModelRequests(page: Page) {
	const urls: string[] = [];
	page.context().on('request', (request) => {
		if (request.url().includes(MODEL_PATH)) urls.push(request.url());
	});
	return urls;
}

const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true });

test('asks for consent before the first download, then never again', async ({ page }) => {
	test.setTimeout(300_000);
	const modelRequests = watchModelRequests(page);
	await openEditorWithPhoto(page, fixture('boba-tea.png'));

	// Cancel: no download is made.
	await page.getByRole('button', { name: 'Remove background' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'consent');
	const dialog = page.getByRole('dialog', { name: CONSENT_TITLE });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(
		'One-time download of about 45 MB, saved in your browser so it works offline afterwards. Photos stay on your device.'
	);
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await expect(dialog).toBeHidden();
	expect(modelRequests).toHaveLength(0);

	// Accept: progress, then inference, then done.
	await page.getByRole('button', { name: 'Remove background' }).click();
	await page.getByRole('button', { name: 'Download & remove' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'downloading');
	await expect(cutout(page).getByRole('status')).toHaveText(/Downloading model… \d+%/);
	await expect(cutout(page)).toHaveAttribute('data-state', 'running', { timeout: 60_000 });
	await expect(cutout(page).getByRole('status')).toHaveText('Removing background…');
	await expect(cutout(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
	// The listener sees the worker's request, so the negative check below means something.
	expect(modelRequests.length).toBeGreaterThan(0);

	// Reload with another photo: no dialog, no model request, nothing downloaded.
	modelRequests.length = 0;
	await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	await page.getByRole('button', { name: 'Remove background' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
	await expect(page.getByRole('dialog', { name: CONSENT_TITLE })).toBeHidden();
	expect(modelRequests).toHaveLength(0);
	await expect(cutout(page)).toHaveAttribute('data-download-ms', '0');
});

test('works offline once the model is cached', async ({ page, context }) => {
	test.setTimeout(300_000);
	// Production serves /vendor/ort/ as `immutable` (vercel.json), so the runtime and
	// the lazily loaded worker chunk come from the HTTP cache offline; `vite preview`
	// sends no such header, and routing disables the cache anyway. Replay those files
	// from memory to stand in for it. The model is not
	// replayed: it must come from Cache Storage.
	const runtime = new Map<string, { body: Buffer; headers: Record<string, string> }>();
	await page.route(/\/(vendor\/ort|_app\/immutable)\//, async (route) => {
		const url = route.request().url();
		if (!runtime.has(url)) {
			const response = await route.fetch();
			runtime.set(url, { body: await response.body(), headers: response.headers() });
		}
		const entry = runtime.get(url)!;
		await route.fulfill({ status: 200, headers: entry.headers, body: entry.body });
	});
	const modelRequests = watchModelRequests(page);
	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await removeBackground(page);
	expect(modelRequests.length).toBeGreaterThan(0); // the listener does see the download
	let requestsWhenOnline = 0;

	// There is no service worker, so the app shell cannot be reloaded offline:
	// load the editor online, then go offline before uploading and removing.
	await openEditorWithPhoto(page, fixture('sunny-corgi.png'), async () => {
		requestsWhenOnline = modelRequests.length;
		await context.setOffline(true);
	});
	await page.getByRole('button', { name: 'Remove background' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
	await expect(page.getByRole('dialog', { name: CONSENT_TITLE })).toBeHidden();
	await expect(cutout(page)).toHaveAttribute('data-download-ms', '0');
	// Offline, the model came from Cache Storage: not even a failed request was made.
	expect(modelRequests).toHaveLength(requestsWhenOnline);
});

test('cancel during download caches nothing', async ({ page }) => {
	test.setTimeout(120_000);
	await page.route('**/models/cutout/**', async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 3_000));
		await route.continue().catch(() => {});
	});
	const projectId = await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await page.getByRole('button', { name: 'Remove background' }).click();
	await page.getByRole('button', { name: 'Download & remove' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'downloading');
	await cutout(page).getByRole('button', { name: 'Cancel' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	// Outlive the route's delay: a late completion must not cache the model.
	await page.waitForTimeout(6_000);
	expect(await page.evaluate(() => caches.has('cutout-isnet-v1'))).toBe(false);
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBeNull();
});

test('cancel during inference applies nothing', async ({ page }) => {
	test.setTimeout(300_000);
	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await removeBackground(page);

	const projectId = await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	// Adding the photo is itself an undo step: compare against that baseline.
	const undoDisabledBefore = await undoButton(page).isDisabled();
	await page.getByRole('button', { name: 'Remove background' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'running');
	await cutout(page).getByRole('button', { name: 'Cancel' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	// Let the abandoned inference finish in the worker; its result must be dropped.
	await waitForDropped(page, 1);
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	expect(await undoButton(page).isDisabled()).toBe(undoDisabledBefore);
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBeNull();
});

test('works when Cache Storage is unavailable', async ({ page }) => {
	test.setTimeout(300_000);
	await page.addInitScript(() => {
		delete (window as unknown as { caches?: unknown }).caches;
	});
	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	expect(await page.evaluate(() => typeof caches)).toBe('undefined');
	await page.getByRole('button', { name: 'Remove background' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'consent');
	await page.getByRole('button', { name: 'Download & remove' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
	await expect(cutout(page).getByRole('status')).toContainText('Background removed');
});

test('double click starts one job', async ({ page }) => {
	test.setTimeout(300_000);
	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await removeBackground(page);

	const projectId = await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	const modelRequests = watchModelRequests(page);
	await page.getByRole('button', { name: 'Remove background' }).dblclick();
	await expect(cutout(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
	expect(modelRequests).toHaveLength(0);
	await expect(page.getByRole('dialog', { name: CONSENT_TITLE })).toBeHidden();
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBeTruthy();
	// One Undo removes the mask. A second removal step would have left one behind.
	await undoButton(page).click();
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBeNull();
});

// ── Guards, errors, replace and degenerate results ─────────────────────────────

const DOWNLOAD_ERROR = "Couldn't download the model. Check your connection.";
const DEGENERATE = "Couldn't find a clear subject — try Erase instead.";

/** Every stored layer's `maskKey` (undefined ones dropped), from IndexedDB. */
async function storedMaskKeys(page: Page, projectId: string) {
	return page.evaluate(async (id) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('stickerlab-local');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const project = await new Promise<{ layers: Array<{ maskKey?: string }> }>(
			(resolve, reject) => {
				const request = db.transaction('projects', 'readonly').objectStore('projects').get(id);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			}
		);
		db.close();
		return project.layers.map((layer) => layer.maskKey).filter(Boolean);
	}, projectId);
}

/** Clicks Remove background (accepting consent if asked) and waits for `running`. */
async function startUntilRunning(page: Page) {
	await page.getByRole('button', { name: 'Remove background' }).click();
	await expect(cutout(page)).not.toHaveAttribute('data-state', 'idle');
	if ((await cutout(page).getAttribute('data-state')) === 'consent') {
		await page.getByRole('button', { name: 'Download & remove' }).click();
	}
	await expect(cutout(page)).toHaveAttribute('data-state', 'running', { timeout: 60_000 });
}

/**
 * Waits until `count` abandoned runs have settled in the worker and their late
 * output was dropped, so "nothing was applied" is asserted after the fact.
 */
async function waitForDropped(page: Page, count: number) {
	await expect(cutout(page)).toHaveAttribute('data-dropped', String(count), { timeout: 60_000 });
}

const modelCachedInPage = (page: Page) => page.evaluate(() => caches.has('cutout-isnet-v1'));

test('deleting or replacing the layer mid-run applies nothing', async ({ page }) => {
	test.setTimeout(300_000);
	// Delete: the Background section unmounts with the layer, so a second photo
	// brings the (shared) controller back into view to observe it.
	let projectId = await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	await startUntilRunning(page);
	await page.locator('.layer-card .layer-delete').click();
	await expect(cutout(page)).toHaveCount(0);
	await page.setInputFiles('[data-testid="photo-file-input"]', fixture('boba-tea.png'));
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await waitForDropped(page, 1);
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await expect(cutout(page).getByRole('status')).toHaveText('');
	await saveAndWait(page);
	expect(await storedMaskKeys(page, projectId)).toEqual([]);

	// Replace image: same layer id, new asset.
	projectId = await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	await startUntilRunning(page);
	await page.setInputFiles('#replacement-photo-input', fixture('boba-tea.png'));
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await waitForDropped(page, 1);
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await saveAndWait(page);
	expect(await storedMaskKeys(page, projectId)).toEqual([]);
});

test('locking the layer mid-run applies nothing', async ({ page }) => {
	test.setTimeout(300_000);
	const projectId = await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	await startUntilRunning(page);
	await page.getByRole('tab', { name: 'Layers' }).click();
	await page.getByRole('button', { name: /^Lock / }).click();
	await expect(page.getByRole('button', { name: /^Unlock / })).toBeVisible();
	await page.getByRole('tab', { name: 'Adjust' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	// The abandoned inference settles in the worker and its mask is discarded.
	await waitForDropped(page, 1);
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await expect(cutout(page).getByRole('status')).toHaveText('');
	await expect(page.getByRole('button', { name: 'Remove background' })).toBeDisabled();
	await saveAndWait(page);
	expect(await storedMaskKeys(page, projectId)).toEqual([]);
});

test('opening another project resets the cutout status', async ({ page }) => {
	test.setTimeout(300_000);
	const openAnotherProject = async (photo: string) => {
		// Client-side navigation: the root EditorState (and its controller) survive.
		await page.getByRole('link', { name: 'StickerLab home' }).click();
		await page.getByRole('link', { name: /Create a Sticker/ }).click();
		await expect(page).toHaveURL(/\/editor\/[0-9a-z-]+/, { timeout: 20_000 });
		await page.setInputFiles('[data-testid="photo-file-input"]', photo);
		await page.getByRole('tab', { name: 'Adjust' }).click();
		const id = page.url().match(/editor\/([^/?#]+)/)?.[1];
		if (!id) throw new Error('The editor URL has no project id');
		return id;
	};
	const firstProject = await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await removeBackground(page);
	await expect(cutout(page).getByRole('status')).toContainText('Background removed');

	// A finished run's message and timings do not follow the user to another project.
	const secondProject = await openAnotherProject(fixture('sunny-corgi.png'));
	expect(secondProject).not.toBe(firstProject);
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await expect(cutout(page).getByRole('status')).toHaveText('');
	await expect(cutout(page)).not.toHaveAttribute('data-backend', /.+/);

	// A running job is abandoned when its project closes.
	await startUntilRunning(page);
	const thirdProject = await openAnotherProject(fixture('boba-tea.png'));
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await waitForDropped(page, 1);
	await saveAndWait(page);
	expect(await storedMaskKeys(page, thirdProject)).toEqual([]);
});

test('download failure shows retry, and Retry recovers', async ({ page }) => {
	test.setTimeout(300_000);
	await page.route('**/models/cutout/**', (route) => route.abort());
	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await page.getByRole('button', { name: 'Remove background' }).click();
	await page.getByRole('button', { name: 'Download & remove' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
	await expect(cutout(page).getByRole('status')).toHaveText(DOWNLOAD_ERROR);
	const retry = cutout(page).getByRole('button', { name: 'Retry' });
	await expect(retry).toBeVisible();
	expect(await modelCachedInPage(page)).toBe(false);

	// Retry re-runs on the same layer; consent was already given.
	await page.unroute('**/models/cutout/**');
	await retry.click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
	await expect(page.getByRole('dialog', { name: CONSENT_TITLE })).toBeHidden();
	await expect(cutout(page).getByRole('status')).toContainText('Background removed');
	await expect(retry).toHaveCount(0);
});

test('corrupted model is rejected and not cached', async ({ page }) => {
	test.setTimeout(120_000);
	const size = 1024 * 1024;
	await page.route('**/models/cutout/**', (route) =>
		route.fulfill({
			status: 200,
			headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) },
			body: Buffer.alloc(size)
		})
	);
	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await page.getByRole('button', { name: 'Remove background' }).click();
	await page.getByRole('button', { name: 'Download & remove' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
	await expect(cutout(page).getByRole('status')).toHaveText(DOWNLOAD_ERROR);
	await expect(cutout(page).getByRole('button', { name: 'Retry' })).toBeVisible();
	expect(await modelCachedInPage(page)).toBe(false);
});

test('a photo whose decoded size disagrees with its record is reported as unreadable', async ({
	page
}) => {
	test.setTimeout(180_000);
	const projectId = await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await saveAndWait(page);
	// The stored asset claims one pixel less width than the photo decodes to.
	await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('stickerlab-local');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('assets', 'readwrite');
			const store = tx.objectStore('assets');
			const request = store.getAll();
			request.onsuccess = () => {
				for (const row of request.result as Array<{ width: number }>)
					store.put({ ...row, width: row.width - 1 });
			};
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
	});
	await page.reload();
	await page.getByRole('tab', { name: 'Layers' }).click();
	await expect(page.locator('.layer-stack .layer-row')).toHaveCount(1, { timeout: 20_000 });
	await page.getByRole('tab', { name: 'Adjust' }).click();

	await page.getByRole('button', { name: 'Remove background' }).click();
	await page.getByRole('button', { name: 'Download & remove' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
	await expect(cutout(page).getByRole('status')).toHaveText(
		"Couldn't read this photo. Try uploading it again."
	);
	await expect(cutout(page).getByRole('button', { name: 'Retry' })).toBeVisible();
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBeNull();
});

test('replacing a hand-painted mask is undoable', async ({ page }) => {
	test.setTimeout(300_000);
	const projectId = await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	// One Erase stroke, as in masks.spec.ts.
	const box = await page.getByTestId('editor-canvas').boundingBox();
	if (!box) throw new Error('The editor canvas has no bounding box');
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.getByRole('button', { name: 'Background Eraser' }).click();
	await page.mouse.move(center.x, center.y);
	await page.mouse.down();
	await page.mouse.move(center.x + 50, center.y + 30, { steps: 8 });
	await page.mouse.up();
	await saveAndWait(page);
	const painted = await storedMaskKey(page, projectId);
	expect(painted).toBeTruthy();

	await removeBackground(page);
	await saveAndWait(page);
	const removed = await storedMaskKey(page, projectId);
	expect(removed).toBeTruthy();
	expect(removed).not.toBe(painted);

	await undoButton(page).click();
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBe(painted);
});

test('Erase and Restore refine the removal result', async ({ page }) => {
	test.setTimeout(300_000);
	const projectId = await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	await removeBackground(page);
	await saveAndWait(page);
	const removed = await storedMaskKey(page, projectId);
	expect(removed).toBeTruthy();

	// The canvas centre is image pixel (512, 512), on the corgi; the 512 px export
	// is the photo at half size, so it reads back at (256, 256).
	const box = await page.getByTestId('editor-canvas').boundingBox();
	if (!box) throw new Error('The editor canvas has no bounding box');
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const stroke = async () => {
		await page.mouse.move(center.x, center.y);
		await page.mouse.down();
		await page.mouse.move(center.x + 50, center.y + 30, { steps: 8 });
		await page.mouse.up();
	};
	const exportedAlpha = async () =>
		pngAlphaAt(page, await exportPng(page), [
			[256, 256],
			[20, 20]
		]);
	expect(await exportedAlpha()).toEqual([255, 0]);

	// One Erase stroke on the result, as in masks.spec.ts: a hole in the subject,
	// and the removed background stays removed (the brush started from the result).
	await page.getByRole('button', { name: 'Background Eraser' }).click();
	await page.getByRole('slider', { name: 'Brush size' }).fill('120');
	await stroke();
	await saveAndWait(page);
	const erased = await storedMaskKey(page, projectId);
	expect(erased).toBeTruthy();
	expect(erased).not.toBe(removed);
	expect(await exportedAlpha()).toEqual([0, 0]);

	// Restore paints the subject back over the same spot.
	await page.getByRole('button', { name: 'Restore', exact: true }).click();
	await stroke();
	await saveAndWait(page);
	const restored = await storedMaskKey(page, projectId);
	expect(restored).not.toBe(erased);
	expect(await exportedAlpha()).toEqual([255, 0]);

	// Each stroke is one undo step back to the removal's mask.
	await undoButton(page).click();
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBe(erased);
	await undoButton(page).click();
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBe(removed);
});

test('no clear subject is reported honestly', async ({ page }) => {
	test.setTimeout(180_000);
	const projectId = await openEditorWithPhoto(page, fixture('no-subject.png'));
	await removeBackground(page);
	console.log(`no-subject keptFraction: ${await cutout(page).getAttribute('data-kept')}`);
	await expect(cutout(page).getByRole('status')).toHaveText(DEGENERATE);
	// Still applied: the user can refine it or undo it.
	await saveAndWait(page);
	expect(await storedMaskKey(page, projectId)).toBeTruthy();
});

test('editor stays responsive during inference', async ({ page }) => {
	test.setTimeout(180_000);
	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	const stageX = () =>
		page.evaluate(
			() =>
				(
					window as unknown as { Konva?: { stages: Array<{ x(): number }> } }
				).Konva?.stages[0]?.x() ?? Number.NaN
		);
	expect(Number.isFinite(await stageX())).toBe(true);
	await startUntilRunning(page);

	// Space-pan, as in masks.spec.ts: blur the button so Space reaches the canvas.
	const box = await page.getByTestId('editor-canvas').boundingBox();
	if (!box) throw new Error('The editor canvas has no bounding box');
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	});
	const before = await stageX();
	await page.keyboard.down('Space');
	await page.mouse.move(center.x, center.y);
	await page.mouse.down();
	await page.mouse.move(center.x + 90, center.y + 40, { steps: 8 });
	await page.mouse.up();
	await page.keyboard.up('Space');
	await expect.poll(stageX, { timeout: 1_000 }).not.toBe(before);
	// The pan happened while the model was still working.
	await expect(cutout(page)).toHaveAttribute('data-state', 'running');
	await expect(cutout(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
});

test('EXIF-rotated JPEG aligns', async ({ page }) => {
	test.setTimeout(180_000);
	const projectId = await openEditorWithPhoto(page, fixture('rotated-6.jpg'));
	await removeBackground(page);
	await saveAndWait(page);
	const { iou, maskBytes } = await storedMaskIou(
		page,
		projectId,
		readFileSync(fixture('rotated-6.truth.png'))
	);
	mkdirSync(test.info().outputDir, { recursive: true });
	writeFileSync(path.join(test.info().outputDir, 'rotated-6.mask.png'), Buffer.from(maskBytes));
	console.log(`rotated-6 IoU: ${iou}`);
	expect(iou).toBeGreaterThanOrEqual(0.9);
});

test('locked or non-image layer disables removal', async ({ page }) => {
	const modelRequests = watchModelRequests(page);
	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await page.getByRole('tab', { name: 'Layers' }).click();
	await page.getByRole('button', { name: /^Lock / }).click();
	await page.getByRole('tab', { name: 'Adjust' }).click();
	const remove = page.getByRole('button', { name: 'Remove background' });
	await expect(remove).toBeDisabled();
	await remove.click({ force: true });
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');

	await page.getByRole('button', { name: 'Text', exact: true }).click();
	await expect(page.getByRole('tab', { name: 'Adjust' })).toHaveAttribute('data-state', 'active');
	await expect(cutout(page)).toHaveCount(0);
	await expect(remove).toHaveCount(0);
	expect(modelRequests).toHaveLength(0);
});

/** Open `<dialog>`s named `title`, including any under a `display: none` ancestor. */
const openDialog = (page: Page, title: string) =>
	page.getByRole('dialog', { name: title, includeHidden: true }).and(page.locator('[open]'));

test('the properties sheet at 390x844 opens exactly one consent dialog', async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('link', { name: /Create a Sticker/ }).click();
	await expect(page).toHaveURL(/\/editor\/[0-9a-z-]+/, { timeout: 20_000 });
	await page.setInputFiles('[data-testid="photo-file-input"]', fixture('boba-tea.png'));
	await expect(page.locator('.save-status')).toContainText(/Unsaved changes|Saving|Saved locally/, {
		timeout: 20_000
	});

	// The inline inspector is hidden (but mounted) at this width; the sheet has its own.
	await page.getByRole('button', { name: 'Sticker properties', exact: true }).click();
	const sheet = openDialog(page, 'Sticker properties');
	await expect(sheet).toBeVisible();
	const panel = sheet.getByTestId('cutout');
	await sheet.getByRole('button', { name: 'Remove background' }).click();
	await expect(panel).toHaveAttribute('data-state', 'consent');

	const consent = openDialog(page, CONSENT_TITLE);
	await expect(consent).toHaveCount(1);
	await expect(consent).toBeVisible();
	await consent.getByRole('button', { name: 'Download & remove' }).click();
	await expect(panel).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
	await expect(consent).toHaveCount(0);
	// The sheet stays open underneath and shows the result.
	await expect(sheet).toBeVisible();
	await expect(panel.getByRole('status')).toContainText('Background removed');
});

test('the status, Retry and progress belong to the layer the run is on', async ({ page }) => {
	test.setTimeout(300_000);
	// A is the corgi (bottom row), B the boba tea added on top of it.
	await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	await page.setInputFiles('[data-testid="photo-file-input"]', fixture('boba-tea.png'));
	const rows = page.locator('.layer-stack .layer-row');
	await page.getByRole('tab', { name: 'Layers' }).click();
	await expect(rows).toHaveCount(2);
	const select = async (row: 'A' | 'B') => {
		await page.getByRole('tab', { name: 'Layers' }).click();
		await rows
			.nth(row === 'A' ? 1 : 0)
			.locator('.layer-kind-tag')
			.click();
		await page.getByRole('tab', { name: 'Adjust' }).click();
	};
	const remove = page.getByRole('button', { name: 'Remove background' });
	const status = cutout(page).getByRole('status');
	const retry = cutout(page).getByRole('button', { name: 'Retry' });

	// A's error and Retry stay with A.
	await page.route('**/models/cutout/**', (route) => route.abort());
	await select('A');
	await remove.click();
	await page.getByRole('button', { name: 'Download & remove' }).click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
	await expect(retry).toBeVisible();
	await select('B');
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await expect(status).toHaveText('');
	await expect(retry).toHaveCount(0);
	await expect(remove).toBeEnabled();

	// While A runs, B shows nothing of it and cannot start a second job.
	await page.unroute('**/models/cutout/**');
	await select('A');
	await retry.click();
	await expect(cutout(page)).toHaveAttribute('data-state', 'running', { timeout: 60_000 });
	await select('B');
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await expect(status).toHaveText('');
	await expect(cutout(page).locator('progress')).toHaveCount(0);
	await expect(cutout(page).getByRole('button', { name: 'Cancel' })).toHaveCount(0);
	await expect(remove).toBeDisabled();
	await expect(remove).toHaveAccessibleDescription(/another layer/i);

	// Selecting B did not cancel A's job: it finishes on A.
	await select('A');
	await expect(cutout(page)).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
	await expect(status).toContainText('Background removed');
	await select('B');
	await expect(cutout(page)).toHaveAttribute('data-state', 'idle');
	await expect(status).not.toContainText('Background removed');
	await expect(cutout(page)).not.toHaveAttribute('data-backend', /.+/);
	await expect(remove).toBeEnabled();
});

/** The stored image layer's position and `maskKey`, from IndexedDB. */
async function storedImageLayer(page: Page, projectId: string) {
	return page.evaluate(async (id) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('stickerlab-local');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const project = await new Promise<{
			layers: Array<{ kind: string; maskKey?: string; transform: { x: number; y: number } }>;
		}>((resolve, reject) => {
			const request = db.transaction('projects', 'readonly').objectStore('projects').get(id);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		db.close();
		const layer = project.layers.find((item) => item.kind === 'image');
		if (!layer) throw new Error('The stored project has no image layer');
		return { x: layer.transform.x, y: layer.transform.y, maskKey: layer.maskKey ?? null };
	}, projectId);
}

test('a result that lands during a drag is its own undo step', async ({ page }) => {
	test.setTimeout(300_000);
	const projectId = await openEditorWithPhoto(page, fixture('sunny-corgi.png'));
	await saveAndWait(page);
	const start = await storedImageLayer(page, projectId);
	await startUntilRunning(page);

	// Drag the layer with the Select tool and hold it until the result has arrived:
	// the run is either held back (`data-deferred`) or, wrongly, already applied.
	const box = await page.getByTestId('editor-canvas').boundingBox();
	if (!box) throw new Error('The editor canvas has no bounding box');
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(center.x, center.y);
	await page.mouse.down();
	await page.mouse.move(center.x + 60, center.y + 40, { steps: 8 });
	await expect
		.poll(
			async () =>
				(await cutout(page).getAttribute('data-deferred')) === 'true' ||
				(await cutout(page).getAttribute('data-state')) === 'done',
			{ timeout: 120_000 }
		)
		.toBe(true);
	await page.mouse.up();
	await expect(cutout(page)).toHaveAttribute('data-state', 'done');
	await expect(cutout(page)).not.toHaveAttribute('data-deferred', 'true');
	await saveAndWait(page);
	const after = await storedImageLayer(page, projectId);
	expect(after.maskKey).toBeTruthy();
	expect(after.x).not.toBe(start.x);

	// The drag committed first and the mask applied when it ended, so each Undo
	// takes back exactly one of them, newest first: the mask, then the drag.
	await undoButton(page).click();
	await saveAndWait(page);
	expect(await storedImageLayer(page, projectId)).toEqual({ ...after, maskKey: null });
	await undoButton(page).click();
	await saveAndWait(page);
	expect(await storedImageLayer(page, projectId)).toEqual(start);
});

// Keep this the LAST test: workers=1 runs it after the quality test has filled `results`.
test('artifact report is written', async () => {
	const outDir = path.resolve('proofs/out/cutout');
	mkdirSync(outDir, { recursive: true });
	expect(results.length, 'quality test must run first').toBeGreaterThan(0);

	// The previous run's mask hashes, read before they are overwritten.
	const reportPath = path.join(outDir, 'report.json');
	const previous = existsSync(reportPath)
		? (JSON.parse(readFileSync(reportPath, 'utf8')) as {
				results?: Array<{ fixture: string; maskSha256?: string }>;
			})
		: null;
	const previousHashes = new Map(
		(previous?.results ?? []).flatMap((row) =>
			row.maskSha256 ? [[row.fixture, row.maskSha256] as const] : []
		)
	);
	const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
	const rows = results.map((row) => {
		const data = artifacts.get(row.fixture);
		if (!data) throw new Error(`No artifact bytes for ${row.fixture}`);
		return { ...row, pass: row.iou >= 0.9, maskSha256: sha256(data.mask) };
	});
	const generatedAt = new Date().toISOString();
	writeFileSync(
		reportPath,
		JSON.stringify(
			{
				modelSha256: MODEL_SHA256,
				ortVersion: ORT_VERSION,
				results: rows,
				generatedAt
			},
			null,
			2
		)
	);

	const height = 512;
	for (const row of rows) {
		const data = artifacts.get(row.fixture);
		if (!data) throw new Error(`No artifact bytes for ${row.fixture}`);
		const source = readFileSync(fixture(`${row.fixture}.png`));
		writeFileSync(path.join(outDir, `${row.fixture}.source.png`), source);
		writeFileSync(path.join(outDir, `${row.fixture}.mask.png`), data.mask);
		writeFileSync(path.join(outDir, `${row.fixture}.sticker.png`), data.sticker);
		// Source, mask and sticker side by side on a neutral background.
		const panels = await Promise.all(
			[source, data.mask, data.sticker].map((buffer) =>
				sharp(buffer)
					.resize({ width: height, height, fit: 'contain', background: '#808080' })
					.flatten({ background: '#808080' })
					.png()
					.toBuffer()
			)
		);
		await sharp({
			create: { width: height * 3, height, channels: 3, background: '#808080' }
		})
			.composite(panels.map((input, i) => ({ input, left: i * height, top: 0 })))
			.png()
			.toFile(path.join(outDir, `${row.fixture}.sheet.png`));
	}

	expect(existsSync(path.join(outDir, 'report.json'))).toBe(true);
	for (const row of rows) {
		for (const kind of ['source', 'mask', 'sticker', 'sheet']) {
			expect(existsSync(path.join(outDir, `${row.fixture}.${kind}.png`))).toBe(true);
		}
	}
	// Only the realistic set gates; clutter rows are recorded with their IoU.
	// The summary, generated from the same rows; timings are reported against the
	// spec budget, and a miss is reported, not hidden.
	const BUDGET_MS = { webgpu: 2_000, wasm: 15_000 } as Record<string, number>;
	const withinBudget = (row: (typeof rows)[number]) =>
		row.backend in BUDGET_MS ? row.inferenceMs < BUDGET_MS[row.backend]! : false;
	const table = (subset: typeof rows) => [
		'| Fixture | IoU | Backend | Download ms | Inference ms | Within budget | Pass (IoU ≥ 0.90) |',
		'|---|---|---|---|---|---|---|',
		...subset.map(
			(row) =>
				`| ${row.fixture} | ${row.iou.toFixed(4)} | ${row.backend} | ${row.downloadMs} | ${row.inferenceMs} | ${withinBudget(row) ? 'yes' : 'no'} | ${row.pass ? 'yes' : 'no'} |`
		)
	];
	const gatingRows = rows.filter((row) => row.gating);
	const clutterRows = rows.filter((row) => !row.gating);
	const backends = [...new Set(rows.map((row) => row.backend))];
	const misses = rows.filter((row) => !withinBudget(row));
	const compared = rows.filter((row) => previousHashes.has(row.fixture));
	const changed = compared.filter((row) => previousHashes.get(row.fixture) !== row.maskSha256);
	const cpus = os.cpus();
	const lines = [
		'# In-browser background removal: proof',
		'',
		`Generated ${generatedAt} by \`e2e/cutout.spec.ts\` (production build, real model, headless Chromium).`,
		'',
		`- Model SHA-256: \`${MODEL_SHA256}\` (\`isnet-general-int8-v1.onnx\`)`,
		`- onnxruntime-web: \`${ORT_VERSION}\``,
		`- Machine: ${cpus[0]?.model ?? 'unknown CPU'}, ${cpus.length} logical cores, ${os.platform()} ${os.release()}`,
		'',
		'## Performance budget',
		'',
		'Spec targets for inference: WebGPU < 2 s, single-threaded WASM < 15 s on a mid-range laptop.',
		'',
		`- Backends used in this run: ${backends.join(', ')}.`,
		...(backends.includes('webgpu')
			? []
			: [
					'- WebGPU was not measured: headless Chromium has no WebGPU adapter, so every run fell back to single-threaded WASM. The WebGPU < 2 s target is unverified.'
				]),
		misses.length === 0
			? '- Every run was within the budget for its backend.'
			: `- Over budget: ${misses.map((row) => `${row.fixture} (${row.backend}, ${row.inferenceMs} ms)`).join(', ')}.`,
		'- The machine above is the test host, not a reference mid-range laptop.',
		'',
		'## Quality gate (person, pet, object)',
		'',
		...table(gatingRows),
		'',
		gatingRows.every((row) => row.pass) ? 'All gating rows pass.' : 'Some gating rows FAIL.',
		'',
		'## Clutter benchmark (non-gating)',
		'',
		'The subjects sit on a flat-shapes background; recorded for tracking only, never asserted.',
		'',
		...table(clutterRows),
		'',
		'## Artifacts',
		'',
		"`proofs/out/cutout/` holds `report.json` (with each mask's SHA-256) and, per fixture, `*.source.png`, `*.mask.png`, `*.sticker.png` (the 512 px export) and `*.sheet.png` (source | mask | sticker).",
		'',
		'## Re-run',
		'',
		'`npx playwright test e2e/cutout.spec.ts`; the last test writes this file and the artifacts.',
		'',
		'## Determinism',
		'',
		compared.length === 0
			? 'No previous `report.json` with mask hashes to compare against; re-run to check.'
			: changed.length === 0
				? `All ${compared.length} masks are byte-identical to the previous run (SHA-256 in \`report.json\`).`
				: `Masks differ from the previous run: ${changed.map((row) => row.fixture).join(', ')}.`,
		''
	];
	writeFileSync(path.resolve('proofs/cutout.md'), lines.join('\n'));

	const summary = readFileSync(path.resolve('proofs/cutout.md'), 'utf8');
	expect(summary).toContain('WebGPU < 2 s, single-threaded WASM < 15 s');
	expect(summary).toContain(`Generated ${generatedAt}`);
	for (const row of rows.filter((item) => item.gating)) expect(row.pass).toBe(true);
});
