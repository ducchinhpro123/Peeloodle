/**
 * In-browser background removal journeys against the production build, with the
 * real ISNet model on whichever backend the headless browser offers (WASM in CI).
 *
 * The removal is proven end to end: the mask lands in IndexedDB as one undo step,
 * reaches the exported PNG, and its quality is gated by IoU against ground-truth
 * subject alpha for a person, a pet and an object (`e2e/fixtures/cutout/`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const FIXTURES = path.resolve('e2e/fixtures/cutout');
const fixture = (name: string) => path.join(FIXTURES, name);
const cutout = (page: Page) => page.getByTestId('cutout');

/** One row per quality-gate fixture; Task 5 writes the artifact from it. */
export type CutoutQualityRow = {
	fixture: string;
	iou: number;
	backend: string;
	downloadMs: number;
	inferenceMs: number;
};
const results: CutoutQualityRow[] = [];

/** Opens a fresh editor with `photo` uploaded and the Adjust tab showing. */
async function openEditorWithPhoto(page: Page, photo: string) {
	await page.goto('/');
	await page.getByRole('link', { name: /Create a Sticker/ }).click();
	await expect(page).toHaveURL(/\/editor\/[0-9a-z-]+/, { timeout: 20_000 });
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

/** Clicks Remove background and waits for the run to finish. */
async function removeBackground(page: Page) {
	await page.getByRole('button', { name: 'Remove background' }).click();
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
	test.setTimeout(600_000);
	mkdirSync(test.info().outputDir, { recursive: true });
	for (const name of ['peace-selfie', 'sunny-corgi', 'boba-tea']) {
		const projectId = await openEditorWithPhoto(page, fixture(`${name}.png`));
		await removeBackground(page);
		await saveAndWait(page);
		const { iou, maskBytes } = await storedMaskIou(
			page,
			projectId,
			readFileSync(fixture(`${name}.truth.png`))
		);
		// Keep the produced mask next to the test output for inspection.
		writeFileSync(path.join(test.info().outputDir, `${name}.mask.png`), Buffer.from(maskBytes));
		const root = cutout(page);
		results.push({
			fixture: name,
			iou,
			backend: (await root.getAttribute('data-backend')) ?? '',
			downloadMs: Number(await root.getAttribute('data-download-ms')),
			inferenceMs: Number(await root.getAttribute('data-inference-ms'))
		});
		console.log(`cutout quality: ${JSON.stringify(results.at(-1))}`);
	}
	for (const row of results) {
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

	await openEditorWithPhoto(page, fixture('boba-tea.png'));
	await removeBackground(page);
	await expect(cutout(page)).toHaveAttribute('data-backend', 'wasm');
	expect(stubbed).toHaveLength(1);
	// The stub ran in the worker: its rejected adapter request was observed there.
	expect(workerLogs).toContainEqual(
		expect.stringContaining('[cutout] WebGPU adapter request failed: boom')
	);
});
