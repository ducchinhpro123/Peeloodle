import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
	elementRectOnCanvas,
	paintedPixelsInRect,
	readStoredMedia,
	readStoredPresentation
} from './presentations';

/**
 * The milestone journey, ported from the source
 * `presentations-milestone-journey.spec.ts`: library → create → type text →
 * insert a real image → autosave → rename from the library → reload the whole
 * page → reopen from the library, at desktop and tablet widths.
 *
 * The title, revision, slide count, text runs and asset identity are read back
 * from IndexedDB, and the composition is claimed from the pixels Konva really
 * painted - the stored media is re-hashed against the uploaded file, so a
 * DOM-only or metadata-only claim cannot pass. The empty-slide region is the
 * control: it must read 0, so "it paints" cannot be satisfied by a measure that
 * counts the background.
 */

const JOURNEY_IMAGE = path.resolve('static/samples/cat-in-console.png');
const TYPED_TEXT = 'Milestone one survives';
const RENAMED_TITLE = 'Milestone reload proof';

const VIEWPORTS = [
	{ label: 'desktop 1440x900', width: 1440, height: 900 },
	{ label: 'tablet 1024x768', width: 1024, height: 768 }
];

test.describe('milestone journey', () => {
	for (const viewport of VIEWPORTS) {
		test(`create, edit, save, reload and reopen — ${viewport.label}`, async ({ page }) => {
			const uploadedBytes = statSync(JOURNEY_IMAGE).size;
			const uploadedSha256 = createHash('sha256').update(readFileSync(JOURNEY_IMAGE)).digest('hex');

			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await page.goto('/presentations');

			// 1. Create a presentation from the library (the hero button exists empty or not).
			await page.getByRole('button', { name: 'Start a blank presentation' }).click();
			await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
			await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
			const presentationId = decodeURIComponent(page.url().split('/').pop()!);

			// 2. Add a text box and type into the DOM overlay; closing it commits the run.
			await page.getByRole('button', { name: 'Add text' }).click();
			const field = page.getByTestId('text-edit-field');
			await expect(field).toBeFocused();
			await page.keyboard.type(TYPED_TEXT);
			await page.keyboard.press('Escape');
			await expect(field).not.toBeVisible();

			// 3. Insert a real repo PNG through the real file input: sniffing, decode,
			// hashing, the atomic document + bytes write and the canvas draw all run.
			await page.getByTestId('presentation-image-input').setInputFiles(JOURNEY_IMAGE);
			await expect(page.getByText('Saved locally', { exact: true })).toBeVisible({
				timeout: 10_000
			});
			await expect(page.locator('.presentation-canvas-error')).toHaveCount(0);

			const edited = (await readStoredPresentation(page, presentationId))!;
			expect(edited.text).toContain(TYPED_TEXT);
			const image = edited.elements.find((element) => element.kind === 'image');
			const textElement = edited.elements.find((element) => element.kind === 'text');
			if (!image || !textElement) throw new Error('the edit did not reach disk');

			// 4. The composition is really painted, and the untouched corner is not.
			const imageRect = await elementRectOnCanvas(page, image);
			const textRect = await elementRectOnCanvas(page, textElement);
			const emptyRect = await elementRectOnCanvas(page, { x: 1180, y: 640, width: 80, height: 60 });
			await expect.poll(() => paintedPixelsInRect(page, imageRect)).toBeGreaterThan(1_000);
			await expect.poll(() => paintedPixelsInRect(page, textRect)).toBeGreaterThan(100);
			expect(await paintedPixelsInRect(page, emptyRect)).toBe(0);

			// 5. Rename from the library: a library operation inside the same journey,
			// on the same stored row the editor has been writing.
			await page.getByLabel('Back to presentations').click();
			await expect(page).toHaveURL(/\/presentations$/);
			await page.getByRole('button', { name: `Rename ${edited.title}` }).click();
			const dialog = page.getByRole('dialog', { name: 'Rename this presentation' });
			const titleField = dialog.getByRole('textbox', { name: 'Presentation name' });
			await expect(titleField).toHaveValue(edited.title);
			await titleField.fill(RENAMED_TITLE);
			await page.keyboard.press('Enter');
			await expect(dialog).toBeHidden();
			const renamed = (await readStoredPresentation(page, presentationId))!;
			expect(renamed.title).toBe(RENAMED_TITLE);
			expect(renamed.revision).toBe(edited.revision + 1);

			// 6. Reload the whole page, then reopen the deck from the library.
			await page.reload();
			await page.getByRole('link', { name: `Open ${RENAMED_TITLE}` }).click();
			await expect(page).toHaveURL(`/presentations/${presentationId}`);
			await expect(page.getByTestId('presentation-canvas')).toBeVisible();
			await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
			await expect(page.locator('.presentation-canvas-error')).toHaveCount(0);

			// 7. The composition came back: same text, same image geometry, same
			// painted pixels - and the media had to come off disk to draw them.
			const reopened = (await readStoredPresentation(page, presentationId))!;
			expect(reopened).toMatchObject({ id: presentationId, revision: renamed.revision });
			expect(reopened.text).toContain(TYPED_TEXT);
			const reopenedImage = reopened.elements.find((element) => element.kind === 'image');
			expect(reopenedImage).toMatchObject({
				x: image.x,
				y: image.y,
				width: image.width,
				height: image.height
			});
			// The stored geometry above is the placement claim. The screen rect is read
			// again rather than compared with the pre-reload one: the editor bar wraps its
			// action row at tablet width, so the canvas is not at the same pixel after a
			// reload that starts with nothing selected.
			const reopenedRect = await elementRectOnCanvas(page, reopenedImage!);
			await expect.poll(() => paintedPixelsInRect(page, reopenedRect)).toBeGreaterThan(1_000);
			expect(
				await paintedPixelsInRect(
					page,
					await elementRectOnCanvas(page, { x: 1180, y: 640, width: 80, height: 60 })
				)
			).toBe(0);

			// 8. Inspect the persisted output: the stored row and the stored bytes.
			expect(reopened.slideIds).toHaveLength(1);
			expect(reopened.assets).toHaveLength(1);
			expect(reopened.assets[0]).toMatchObject({
				id: `asset-${uploadedSha256}`,
				sha256: uploadedSha256,
				byteLength: uploadedBytes,
				mimeType: 'image/png'
			});
			expect(reopenedImage!.assetId ?? image.assetId).toBe(`asset-${uploadedSha256}`);

			const media = await readStoredMedia(page);
			expect(media).toHaveLength(1);
			expect(media[0]).toMatchObject({
				assetId: `asset-${uploadedSha256}`,
				sha256: uploadedSha256,
				byteLength: uploadedBytes,
				mimeType: 'image/png'
			});
		});
	}
});
