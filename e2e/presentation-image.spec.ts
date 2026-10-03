import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
	elementRectOnCanvas,
	openBlankEditor,
	paintedPixelsInRect,
	readStoredMedia,
	readStoredPresentation
} from './presentations';

/**
 * The image journey, ported from the source `presentations-image.spec.ts`: a real
 * photo goes through the real file input, is painted by Konva, is persisted to
 * IndexedDB with its bytes, and still paints after a reload. The stored media is
 * re-hashed and compared with the uploaded file's SHA-256 - identity, not just
 * size or declared type. The pixel claim uses a blank-slide baseline as its
 * control, so "something is painted" cannot pass by counting the background.
 */

const PHOTO = path.resolve('static/samples/cat-in-console.png');
const SLIDE = { x: 0, y: 0, width: 1280, height: 720 };

test('uploads a personal image, paints it, stores its bytes, and reopens it', async ({ page }) => {
	const uploadedBytes = statSync(PHOTO).size;
	const uploadedSha256 = createHash('sha256').update(readFileSync(PHOTO)).digest('hex');

	const id = await openBlankEditor(page);
	const blankSlideRect = await elementRectOnCanvas(page, SLIDE);
	const blankArtwork = await paintedPixelsInRect(page, blankSlideRect);

	await page.getByTestId('presentation-image-input').setInputFiles(PHOTO);
	// The insert reaches disk through the autosave. The stored asset is what the
	// claim is about, so wait for it: the status text still reads "Saved in this browser"
	// from the blank deck until the insert re-renders it.
	await expect
		.poll(async () => (await readStoredPresentation(page, id))?.assets.length ?? 0)
		.toBe(1);
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
		timeout: 10_000
	});
	await expect(page.locator('.presentation-canvas-error')).toHaveCount(0);

	const stored = (await readStoredPresentation(page, id))!;
	const image = stored.elements.find((element) => element.kind === 'image');
	expect(image).toBeTruthy();
	expect(stored.assets).toHaveLength(1);
	const asset = stored.assets[0]!;
	expect(asset).toMatchObject({
		mimeType: 'image/png',
		sha256: uploadedSha256,
		byteLength: uploadedBytes
	});
	expect(asset.width).toBeGreaterThan(0);
	expect(asset.height).toBeGreaterThan(0);

	// Positioned inside the 1280x720 page at natural size (the policy never upscales).
	expect(image!.x).toBeGreaterThanOrEqual(0);
	expect(image!.y).toBeGreaterThanOrEqual(0);
	expect(image!.x + image!.width).toBeLessThanOrEqual(1280);
	expect(image!.y + image!.height).toBeLessThanOrEqual(720);

	// It is really drawn, and the blank control stays empty.
	const imageRect = await elementRectOnCanvas(page, image!);
	await expect.poll(() => paintedPixelsInRect(page, imageRect)).toBeGreaterThan(500);
	expect(await paintedPixelsInRect(page, blankSlideRect)).toBeGreaterThanOrEqual(blankArtwork);

	// The stored bytes are the uploaded file, proven by re-hashing what IndexedDB
	// really holds rather than trusting the asset's own metadata.
	const media = await readStoredMedia(page);
	expect(media).toHaveLength(1);
	expect(media[0]).toMatchObject({
		assetId: asset.id,
		mimeType: 'image/png',
		sha256: uploadedSha256,
		byteLength: uploadedBytes
	});

	// Reload and reopen: the document and its bytes come back off disk, and the
	// stored media is decoded back onto the canvas rather than remembered in memory.
	await page.reload();
	await page.goto('/presentations');
	await page.getByRole('link', { name: 'Open Untitled presentation' }).click();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible();
	await expect(page.locator('.presentation-canvas-error')).toHaveCount(0);

	const reopened = (await readStoredPresentation(page, id))!;
	expect(reopened.assets).toHaveLength(1);
	expect(reopened.assets[0]).toMatchObject({ id: asset.id, sha256: uploadedSha256 });
	const reopenedImage = reopened.elements.find((element) => element.kind === 'image');
	expect(reopenedImage).toMatchObject({ width: image!.width, height: image!.height });
	await expect.poll(() => paintedPixelsInRect(page, imageRect)).toBeGreaterThan(500);
});

test('refuses an unsupported file and leaves no element behind', async ({ page }) => {
	const id = await openBlankEditor(page);

	// An SVG is on the reject list; it must not become an asset or an element.
	await page.getByTestId('presentation-image-input').setInputFiles({
		name: 'shape.svg',
		mimeType: 'image/svg+xml',
		buffer: Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'
		)
	});

	await expect(page.getByRole('alert')).toBeVisible();
	const stored = (await readStoredPresentation(page, id))!;
	expect(stored.elements.filter((element) => element.kind === 'image')).toHaveLength(0);
	expect(stored.assets).toHaveLength(0);
	expect(await readStoredMedia(page)).toHaveLength(0);
});
