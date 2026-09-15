import { expect, test } from '@playwright/test';
import path from 'node:path';
import {
	addShape,
	at,
	canvasView,
	clickAt,
	drag,
	elementRectOnCanvas,
	listStoredPresentations,
	openBlankEditor,
	paintedPixelsInRect,
	readGeometry,
	readStoredMedia,
	readStoredPresentation,
	selectFromElementList,
	waitForHittable,
	writeNewerRevision
} from './presentations';

/** The sample photo the sticker editor's own journey already uploads. */
const PHOTO = path.resolve('static/samples/cat-in-console.png');

test('the presentation library creates a local deck and shows it after returning', async ({
	page
}) => {
	await page.goto('/presentations');

	await expect(
		page.getByRole('heading', { name: 'Tell your story. Make it stick.' })
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'No presentations yet' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Presentations' }).first()).toHaveAttribute(
		'aria-current',
		'page'
	);

	await page.getByRole('button', { name: 'Create your first presentation' }).click();
	await expect(page).toHaveURL(/\/presentations\/[^/]+$/);

	await page.goto('/presentations');
	await expect(page.getByText('Untitled presentation', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('1 saved presentation in this browser')).toBeVisible();
});

/**
 * The editor journeys: every claim below is read back from the production build's
 * own surfaces, and the persisted row is read straight out of IndexedDB, so a
 * green run means the edit really reached disk rather than only the screen.
 */

test('moves a shape in document units and undoes the move', async ({ page }) => {
	const id = await openBlankEditor(page);
	await addShape(page, 'ellipse');
	const inserted = await readGeometry(page);
	// The insert is centred on the 16:9 page at its own size, so the numbers are
	// the page's, not the viewport's.
	expect(inserted.width).toBe(480);
	expect(inserted.height).toBe(270);

	// One gesture, measured against the canvas's own document mapping.
	const view = await canvasView(page);
	const centre = at(view, inserted.x + inserted.width / 2, inserted.y + inserted.height / 2);
	await waitForHittable(page, inserted);
	await drag(page, centre, { x: centre.x + 120, y: centre.y + 60 });

	const moved = await readGeometry(page);
	expect(moved.x - inserted.x).toBeCloseTo(120 / view.scale, 1);
	expect(moved.y - inserted.y).toBeCloseTo(60 / view.scale, 1);
	// A move must not resize.
	expect(moved.width).toBe(inserted.width);
	expect(moved.height).toBe(inserted.height);

	// The keyboard path is global, so it works with the canvas focused.
	await page.keyboard.press('Control+z');
	await expect.poll(async () => (await readGeometry(page)).x).toBe(inserted.x);
	await page.keyboard.press('Control+Shift+z');
	await expect.poll(async () => (await readGeometry(page)).x).toBe(moved.x);

	// The click path keeps both of its jobs: a click on the slide's empty corner
	// clears the selection, and a click on the element takes it back. Only a
	// gesture's own trailing click is dropped (which the reads above depend on:
	// the inspector shows nothing without a selection).
	const host = page.getByTestId('presentation-canvas');
	await clickAt(page, at(view, 40, 40));
	await expect(host).toHaveAttribute('data-selected-element', '');
	await waitForHittable(page, moved);
	await clickAt(page, at(view, moved.x + moved.width / 2, moved.y + moved.height / 2));
	await expect(host).not.toHaveAttribute('data-selected-element', '');

	// And the move reached disk: the stored element carries the same numbers.
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const stored = await readStoredPresentation(page, id);
	const element = stored?.elements[0];
	expect(element).toMatchObject({ kind: 'shape', width: moved.width, height: moved.height });
	expect(element.x).toBeCloseTo(moved.x, 1);
	expect(element.y).toBeCloseTo(moved.y, 1);
});

test('resizes from a corner handle and keeps document units across zoom levels', async ({
	page
}) => {
	await openBlankEditor(page);
	await addShape(page, 'rectangle');
	const inserted = await readGeometry(page);

	// The same client-pixel pull at two zoom levels must produce two different
	// document deltas: that is what makes a gesture zoom-independent.
	const pull = { x: 96, y: 48 };
	const atZoom = async () => {
		const view = await canvasView(page);
		const handle = page.getByTestId('presentation-handle-se');
		const box = await handle.boundingBox();
		if (!box) throw new Error('the south-east handle is not on screen');
		await drag(
			page,
			{ x: box.x + box.width / 2, y: box.y + box.height / 2 },
			{ x: box.x + box.width / 2 + pull.x, y: box.y + box.height / 2 + pull.y }
		);
		return { view, geometry: await readGeometry(page) };
	};

	const full = await atZoom();
	// Geometry is stored in whole document units, so the gesture's own accuracy is
	// what is under test here, not the rounding.
	expect(full.geometry.width - inserted.width).toBeCloseTo(pull.x / full.view.scale, 0);
	expect(full.geometry.height - inserted.height).toBeCloseTo(pull.y / full.view.scale, 0);

	await page.getByLabel('Zoom out').click();
	await expect(page.getByLabel('Canvas zoom')).toHaveText('80%');
	const quarter = await atZoom();
	expect(quarter.view.scale).toBeLessThan(full.view.scale);
	expect(quarter.geometry.width - full.geometry.width).toBeCloseTo(pull.x / quarter.view.scale, 0);
	expect(quarter.geometry.height - full.geometry.height).toBeCloseTo(
		pull.y / quarter.view.scale,
		0
	);
});

test('autosaves typed text and keeps it across a reload', async ({ page }) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text' }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await page.keyboard.type('Typed on the real build');
	await page.keyboard.press('Escape');
	await expect(field).not.toBeVisible();

	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const stored = await readStoredPresentation(page, id);
	expect(stored?.text).toContain('Typed on the real build');

	// A real reload, then the user's own route back to the text: the slide must
	// still carry it.
	await page.reload();
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const reloaded = await readStoredPresentation(page, id);
	expect(reloaded?.elements.filter((element) => element.kind === 'text')).toHaveLength(1);
	await selectFromElementList(page, 'Text');
	await page.getByRole('button', { name: 'Edit text: Text' }).click();
	await expect(page.getByTestId('text-edit-field')).toContainText('Typed on the real build');
});

test('adds a photo, stores its bytes, and paints it on the slide', async ({ page }) => {
	const id = await openBlankEditor(page);
	await page.getByTestId('presentation-image-input').setInputFiles(PHOTO);
	// The insert reaches disk through the autosave. Wait for the stored row first:
	// the status text still reads "Saved locally" from the blank deck until the
	// insert re-renders it, so it cannot synchronize this read by itself.
	await expect
		.poll(async () => (await readStoredPresentation(page, id))?.assetIds.length ?? 0)
		.toBe(1);
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

	const stored = await readStoredPresentation(page, id);
	const image = stored?.elements.find((element) => element.kind === 'image');
	expect(image).toBeTruthy();
	// The bytes travel with the document, in the same write.
	expect(stored?.assetIds).toHaveLength(1);
	const media = await readStoredMedia(page);
	expect(media).toHaveLength(1);
	expect(media[0]).toMatchObject({ assetId: stored!.assetIds[0], mimeType: 'image/png' });
	expect(media[0].byteLength).toBeGreaterThan(1000);

	// And the artwork is really on the canvas, not only in the model.
	const painted = await paintedPixelsInRect(page, await elementRectOnCanvas(page, image!));
	expect(painted).toBeGreaterThan(0);
});

test('leaving mid-edit writes the pending text before it navigates', async ({ page }) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text' }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await page.keyboard.type('Leaving must not lose this');

	// Leave inside the autosave debounce, with the session still open: the guard
	// has to flush the edit before the route changes.
	await page.getByLabel('Back to presentations').click();
	await expect(page).toHaveURL(/\/presentations$/);
	const stored = await readStoredPresentation(page, id);
	expect(stored?.text).toContain('Leaving must not lose this');

	// It is still there when the deck is reopened from the library.
	await page.getByRole('link', { name: 'Open Untitled presentation' }).click();
	await expect(page).toHaveURL(/\/presentations\/[^/]+$/);
	await expect(page.getByTestId('presentation-canvas')).toBeVisible();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
});

test('a newer stored revision becomes a conflict that keeps the local copy', async ({ page }) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text' }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await page.keyboard.type('Work from this tab');

	// Another tab saves a newer revision of the same deck while this one is open.
	// A live text session defers autosave, so the newer revision is guaranteed to
	// be on disk before this editor tries to write.
	const revision = await writeNewerRevision(page, id, 'Newer from another tab');
	await page.keyboard.press('Escape');
	await expect(page.getByText('Save conflict', { exact: false })).toBeVisible({ timeout: 10_000 });

	// The other tab's revision is intact: a conflict is a refusal to overwrite it.
	const stored = await readStoredPresentation(page, id);
	expect(stored?.title).toBe('Newer from another tab');
	expect(stored?.revision).toBe(revision);
	expect(stored?.text).not.toContain('Work from this tab');

	await page.getByRole('button', { name: 'Keep my copy' }).click();
	await expect(page.getByText(/saved as a separate conflict copy/)).toBeVisible();
	const rows = await listStoredPresentations(page);
	expect(rows).toHaveLength(2);
	expect(rows.some((row) => row.title.includes('conflict copy'))).toBe(true);
	// The editor adopts the newer stored revision and keeps working.
	await expect(page.locator('.presentation-editor-title h1')).toHaveText('Newer from another tab');
});
