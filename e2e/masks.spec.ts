/**
 * Mask brush journeys against the production build (port of the source
 * `e2e/mask-regressions.spec.ts`, React main `54eae61c`, adapted to drive the
 * Svelte editor through its UI).
 *
 * The mask is read back from IndexedDB (a separate store, keyed by `maskKey`) and
 * decoded in the page, the live Konva preview is sampled directly, and the
 * exported PNG's transparency is compared before and after a stroke, so the
 * journeys prove the mask survives save/reload and reaches the export — not only
 * that a click was accepted.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PHOTO = path.resolve('static/samples/cat-in-console.png');
const canvasHost = (page: Page) => page.locator('[data-testid="editor-canvas"]');

/**
 * Opens a fresh editor with the sample photo uploaded. The inline inspector is
 * hidden below 1150px, so the mobile journey skips its tab strip.
 */
async function openEditorWithPhoto(page: Page, tabs = true) {
	await page.goto('/');
	await page.getByRole('link', { name: /Create a Sticker/ }).click();
	await expect(page).toHaveURL(/\/editor\/[0-9a-z-]+/, { timeout: 20_000 });
	await page.setInputFiles('[data-testid="photo-file-input"]', PHOTO);
	await expect(page.locator('.save-status')).toContainText(/Unsaved changes|Saving|Saved locally/, {
		timeout: 20_000
	});
	if (tabs) {
		await page.getByRole('tab', { name: 'Layers' }).click();
		await expect(page.locator('.layer-stack .layer-row')).toHaveCount(1);
		await page.getByRole('tab', { name: 'Adjust' }).click();
	}
	const projectId = page.url().match(/editor\/([^/?#]+)/)?.[1];
	if (!projectId) throw new Error('The editor URL has no project id');
	return projectId;
}

async function saveAndWait(page: Page) {
	await page.getByRole('button', { name: /Save to My Stickers/ }).click();
	await expect(page.locator('.save-status')).toContainText('Saved locally', { timeout: 20_000 });
}

/** The centre of the canvas host in viewport coordinates (the artboard centre at pan 0). */
async function canvasCenter(page: Page) {
	const box = await canvasHost(page).boundingBox();
	if (!box) throw new Error('The editor canvas has no bounding box');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Alpha of the live Konva scene canvas at a viewport point. */
async function previewAlpha(page: Page, point: { x: number; y: number }) {
	return page.evaluate(({ x, y }) => {
		const host = document.querySelector('[data-testid="editor-canvas"]');
		if (!(host instanceof HTMLElement)) return -1;
		const box = host.getBoundingClientRect();
		const canvases = [...host.querySelectorAll('canvas')];
		if (canvases.length === 0) return -1;
		const sample = document.createElement('canvas');
		sample.width = canvases[0].width;
		sample.height = canvases[0].height;
		const ctx = sample.getContext('2d')!;
		for (const layer of canvases) ctx.drawImage(layer, 0, 0);
		const px = Math.round(((x - box.left) * sample.width) / box.width);
		const py = Math.round(((y - box.top) * sample.height) / box.height);
		return ctx.getImageData(px, py, 1, 1).data[3];
	}, point);
}

/** Reads the stored project row straight out of the app's IndexedDB. */
async function readStoredProject(page: Page, projectId: string) {
	return page.evaluate(async (id) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('stickerlab-local');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		return new Promise<{ layers: Array<{ kind: string; maskKey?: string }> }>((resolve, reject) => {
			const tx = db.transaction('projects', 'readonly');
			const request = tx.objectStore('projects').get(id);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}, projectId);
}

/**
 * Samples the persisted mask: the stored image layer's `maskKey` must resolve to
 * a mask row, and the decoded blob's alpha is read at image-local points.
 */
async function storedMaskAlpha(page: Page, projectId: string, points: Array<[number, number]>) {
	return page.evaluate(
		async ({ id, points: samplePoints }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('stickerlab-local');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const project = await new Promise<{ layers: Array<Record<string, unknown>> }>(
				(resolve, reject) => {
					const tx = db.transaction('projects', 'readonly');
					const request = tx.objectStore('projects').get(id);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				}
			);
			const layer = project.layers.find((item) => item.kind === 'image');
			const maskKey = layer?.maskKey;
			if (typeof maskKey !== 'string') return samplePoints.map(() => 255);
			const row = await new Promise<{ blob: Blob | ArrayBuffer }>((resolve, reject) => {
				const tx = db.transaction('masks', 'readonly');
				const request = tx.objectStore('masks').get(maskKey);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const blob =
				row.blob instanceof Blob ? row.blob : new Blob([row.blob], { type: 'image/png' });
			const bitmap = await createImageBitmap(blob);
			const canvas = document.createElement('canvas');
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(bitmap, 0, 0);
			bitmap.close();
			return samplePoints.map(([u, v]) => ctx.getImageData(u, v, 1, 1).data[3]);
		},
		{ id: projectId, points }
	);
}

/** Downloads the 512 px PNG export and returns its bytes. */
async function exportPng(page: Page): Promise<Buffer> {
	await page.getByRole('button', { name: /Export and share/ }).click();
	await page.getByRole('radio', { name: /512 px/ }).check();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: /Download PNG/ }).click();
	const download = await downloadPromise;
	const file = path.join(test.info().outputDir, `mask-export-${Date.now()}.png`);
	await download.saveAs(file);
	await expect(page.locator('dialog [role="status"]')).toContainText('Download started');
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 10_000 });
	return readFileSync(file);
}

/** Pixel counts of a downloaded PNG, decoded in the page. */
async function pngAlphaStats(page: Page, bytes: Buffer) {
	return page.evaluate(async (data) => {
		const blob = new Blob([new Uint8Array(data)], { type: 'image/png' });
		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();
		const { data: pixels, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
		let transparent = 0;
		let opaque = 0;
		for (let i = 3; i < pixels.length; i += 4) {
			if (pixels[i] === 0) transparent += 1;
			else if (pixels[i] > 200) opaque += 1;
		}
		return { transparent, opaque, width, height };
	}, Array.from(bytes));
}

test('erase paints a mask that the preview shows, IndexedDB keeps, and undo/redo handles', async ({
	page
}) => {
	const projectId = await openEditorWithPhoto(page);
	const center = await canvasCenter(page);
	await expect.poll(() => previewAlpha(page, center)).toBe(255);

	// One brush stroke: press, drag, release. The source commits on pointer-up.
	await page.getByRole('button', { name: 'Background Eraser' }).click();
	await page.mouse.move(center.x, center.y);
	await page.mouse.down();
	await page.mouse.move(center.x + 50, center.y + 30, { steps: 8 });
	await page.mouse.up();

	// The live preview shows the hole before any save.
	await expect.poll(() => previewAlpha(page, center)).toBe(0);
	await saveAndWait(page);

	const layer = (await readStoredProject(page, projectId)).layers[0]!;
	expect(layer.maskKey).toBeTruthy();
	// The 344 px photo sits unscaled and centered on the 1024 artboard, so the
	// artboard centre is image-local (172, 172): the stored mask keeps the hole
	// there and stays white elsewhere.
	expect(
		await storedMaskAlpha(page, projectId, [
			[172, 172],
			[30, 30]
		])
	).toEqual([0, 255]);

	// Undo removes the stroke (document revision), Redo restores it.
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(() => previewAlpha(page, center)).toBe(255);
	await page.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(() => previewAlpha(page, center)).toBe(0);

	// Reset Mask returns to the full image and clears the stored key after a save.
	await page.getByRole('button', { name: 'Reset Mask' }).click();
	await expect.poll(() => previewAlpha(page, center)).toBe(255);
	await saveAndWait(page);
	await expect
		.poll(async () => (await readStoredProject(page, projectId)).layers[0]!.maskKey ?? null)
		.toBeNull();
});

test('the mask reaches the exported PNG and Reset Mask removes it there again', async ({
	page
}) => {
	await openEditorWithPhoto(page);
	const before = await pngAlphaStats(page, await exportPng(page));

	const center = await canvasCenter(page);
	await page.getByRole('button', { name: 'Background Eraser' }).click();
	await page.getByRole('slider', { name: 'Brush size' }).fill('120');
	await page.mouse.move(center.x, center.y);
	await page.mouse.down();
	await page.mouse.move(center.x + 60, center.y + 40, { steps: 8 });
	await page.mouse.up();
	await expect.poll(() => previewAlpha(page, center)).toBe(0);

	const masked = await pngAlphaStats(page, await exportPng(page));
	expect(masked.width).toBe(before.width);
	expect(masked.height).toBe(before.height);
	// The 120 px document brush punches thousands of pixels of transparency at the
	// export scale, while Reset Mask returns the export to the unmasked count.
	expect(masked.transparent).toBeGreaterThan(before.transparent + 500);
	expect(masked.opaque).toBeLessThan(before.opaque);

	await page.getByRole('button', { name: 'Reset Mask' }).click();
	await expect.poll(() => previewAlpha(page, center)).toBe(255);
	const restored = await pngAlphaStats(page, await exportPng(page));
	expect(Math.abs(restored.transparent - before.transparent)).toBeLessThan(50);
});

test('a masked sticker travels through the pack ZIP with the same hole as the PNG export', async ({
	page
}) => {
	await openEditorWithPhoto(page);
	const center = await canvasCenter(page);
	await page.getByRole('button', { name: 'Background Eraser' }).click();
	await page.getByRole('slider', { name: 'Brush size' }).fill('120');
	await page.mouse.move(center.x, center.y);
	await page.mouse.down();
	await page.mouse.move(center.x + 50, center.y + 30, { steps: 6 });
	await page.mouse.up();
	await expect.poll(() => previewAlpha(page, center)).toBe(0);
	await saveAndWait(page);
	const exported = await pngAlphaStats(page, await exportPng(page));

	// Organize the masked sticker into a pack and download its ZIP.
	await page.goto('/my-stickers');
	await page.getByRole('button', { name: 'New Pack' }).click();
	const createDialog = page.locator('dialog[open]');
	await createDialog.getByLabel('Pack Name').fill('Masked Pack');
	await createDialog.getByRole('button', { name: 'Create Pack' }).click();
	await page.getByRole('button', { name: 'Add Stickers' }).click();
	const addDialog = page.locator('dialog[open]');
	const include = addDialog.getByRole('checkbox').first();
	if (!(await include.isChecked())) await include.click();
	await expect(include).toBeChecked();
	await addDialog.getByRole('button', { name: 'Done' }).click();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download ZIP' }).click()
	]);
	const zipPath = path.join(test.info().outputDir, `masked-${Date.now()}.zip`);
	await download.saveAs(zipPath);
	const zip = readFileSync(zipPath);

	// The STORE-only writer leaves PNG bytes readable: the single PNG entry must
	// carry the same hole the 512 px PNG export has.
	let offset = 0;
	let stickerPng: Buffer | undefined;
	while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
		const size = zip.readUInt32LE(offset + 18);
		const nameSize = zip.readUInt16LE(offset + 26);
		const extraSize = zip.readUInt16LE(offset + 28);
		const nameStart = offset + 30;
		const dataStart = nameStart + nameSize + extraSize;
		const name = zip.subarray(nameStart, nameStart + nameSize).toString('utf8');
		if (name.endsWith('.png')) stickerPng = zip.subarray(dataStart, dataStart + size);
		offset = dataStart + size;
	}
	expect(stickerPng).toBeDefined();
	const zipped = await pngAlphaStats(page, stickerPng!);
	expect(zipped.transparent).toBeGreaterThan(1000);
	expect(Math.abs(zipped.transparent - exported.transparent)).toBeLessThan(50);
});

test('Space-pan takes precedence over the brush and never paints', async ({ page }) => {
	const projectId = await openEditorWithPhoto(page);
	await saveAndWait(page);
	const center = await canvasCenter(page);
	await page.getByRole('button', { name: 'Background Eraser' }).click();

	// Space turns the canvas into a pan surface: the brush must stand down. Blur the
	// rail button first — Space on a focused button belongs to that button.
	const hasPanAttribute = (attribute: string) =>
		page.evaluate(
			(name) =>
				document.querySelector('[data-testid="editor-canvas"]')?.hasAttribute(name) ?? false,
			attribute
		);
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	});
	await page.keyboard.down('Space');
	await expect.poll(() => hasPanAttribute('data-space-pan')).toBe(true);
	await page.mouse.move(center.x, center.y);
	await page.mouse.down();
	await expect.poll(() => hasPanAttribute('data-panning')).toBe(true);
	await page.mouse.move(center.x + 90, center.y + 40, { steps: 8 });
	await page.mouse.up();
	await page.keyboard.up('Space');

	// The image moved with the pan (the old centre is off the photo now) and the new
	// centre is untouched: no live hole, no stored mask, document still saved.
	expect(await previewAlpha(page, center)).toBe(0);
	expect(await previewAlpha(page, { x: center.x + 90, y: center.y + 40 })).toBe(255);
	await expect
		.poll(async () => (await readStoredProject(page, projectId)).layers[0]!.maskKey ?? null)
		.toBeNull();
	await expect(page.locator('.save-status')).toContainText('Saved locally');
});

test('a failed mask encode retains the stroke and Save retries it exactly once', async ({
	page
}) => {
	const projectId = await openEditorWithPhoto(page);
	// Hold the next canvas encode until the test releases it (as a stalled toBlob would).
	await page.evaluate(() => {
		const native = HTMLCanvasElement.prototype.toBlob;
		HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
			HTMLCanvasElement.prototype.toBlob = native;
			(window as unknown as { releaseMask: (fail?: boolean) => void }).releaseMask = (fail) => {
				if (fail) callback(null);
				else native.call(this, callback, ...args);
			};
		};
	});

	const center = await canvasCenter(page);
	await page.getByRole('button', { name: 'Background Eraser' }).click();
	await page.mouse.move(center.x, center.y);
	await page.mouse.down();
	await page.mouse.move(center.x + 40, center.y, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator('.save-status')).toContainText('Mask edit pending');

	await page.getByRole('button', { name: /Save to My Stickers/ }).click();
	await expect
		.poll(() =>
			page.evaluate(() => typeof (window as unknown as { releaseMask?: unknown }).releaseMask)
		)
		.toBe('function');
	await page.evaluate(() =>
		(window as unknown as { releaseMask: (fail: boolean) => void }).releaseMask(true)
	);
	await expect(page.getByText(/Save to retry; the stroke is retained/)).toBeVisible({
		timeout: 10_000
	});

	// The retry encodes the same retained canvas and saves it as one entry.
	await saveAndWait(page);
	await expect(page.getByText(/Save to retry; the stroke is retained/)).toBeHidden();
	const layer = (await readStoredProject(page, projectId)).layers[0]!;
	expect(layer.maskKey).toBeTruthy();
	await page.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(() => previewAlpha(page, center)).toBe(255);
});

test.describe('mobile mask editing', () => {
	// `hasTouch` without `isMobile`: the emulated mobile layout viewport scales the
	// page and makes pointer coordinates unreliable, while a 390px viewport with
	// touch events exercises the same responsive layout and the touch pointer path.
	test.use({ hasTouch: true });

	test('touch erase and restore stay reachable at 390x844', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openEditorWithPhoto(page, false);
		const center = await canvasCenter(page);

		// The inline inspector is hidden at this width: the mask tools live in the
		// "Sticker properties" dialog.
		await page.getByRole('button', { name: 'Sticker properties', exact: true }).click();
		const dialog = page.locator('dialog[open]');
		await dialog.getByRole('button', { name: 'Erase', exact: true }).click();
		await page.keyboard.press('Escape');
		await expect(page.locator('dialog[open]')).toHaveCount(0);

		await page.touchscreen.tap(center.x, center.y);
		await expect.poll(() => previewAlpha(page, center)).toBe(0);

		await page.getByRole('button', { name: 'Sticker properties', exact: true }).click();
		await page
			.locator('dialog[open]')
			.getByRole('button', { name: 'Restore', exact: true })
			.click();
		await page.keyboard.press('Escape');
		await page.touchscreen.tap(center.x, center.y);
		await expect.poll(() => previewAlpha(page, center)).toBe(255);

		await expect(page.getByRole('button', { name: /Save to My Stickers/ })).toBeInViewport();
		await expect(page.getByRole('button', { name: /Export and share/ })).toBeInViewport();
	});
});
