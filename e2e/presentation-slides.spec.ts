import { expect, test, type Page } from '@playwright/test';
import {
	elementRectOnCanvas,
	openBlankEditor,
	paintedPixelsInRect,
	readStoredPresentation,
	readStoredPresentationJson
} from './presentations';

/**
 * The slide-rail and history journeys, ported from the source
 * `adds, duplicates, reorders, and deletes slides through the accessible rail` and
 * `undoes and redoes through the toolbar and keyboard without stealing text-field
 * undo`.
 *
 * The source seeded a fixture deck and read the React store. This port builds the
 * deck through the real UI and makes every claim against the stored IndexedDB row,
 * the rail's own accessible state and the pixels the canvas really paints.
 */

const PHOTO = 'static/samples/cat-in-console.png';

const canvasHost = (page: Page) => page.getByTestId('presentation-canvas');
const rail = (page: Page, name: string) => page.getByRole('button', { name });
const row = async (page: Page, id: string) =>
	JSON.parse(await readStoredPresentationJson(page, id));
const slideIds = async (page: Page, id: string) =>
	(await row(page, id)).slides.map((slide: { id: string }) => slide.id);
const elementIdsIn = async (page: Page, id: string, index: number) =>
	(await row(page, id)).slides[index].elements.map((element: { id: string }) => element.id);

test('adds, duplicates, reorders, and deletes slides through the accessible rail', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);

	// Real artwork on slide 1: the copy journey claims the duplicate reuses the
	// stored asset and paints it, so slide 1 has to have something to paint.
	await page.getByTestId('presentation-image-input').setInputFiles(PHOTO);
	await expect
		.poll(async () => (await readStoredPresentation(page, id))?.assets.length ?? 0)
		.toBe(1);
	const seeded = await row(page, id);
	const sourceSlideId = seeded.slides[0].id;
	const sourceElementIds = seeded.slides[0].elements.map((element: { id: string }) => element.id);
	const sourceAssetId = seeded.assets[0].id;
	expect(sourceElementIds).toHaveLength(1);

	await expect(rail(page, 'Show slide 1: Slide 1')).toHaveAttribute('aria-current', 'true');
	await rail(page, 'Duplicate active slide').click();
	await expect(rail(page, 'Show slide 2: Slide 1 copy')).toHaveAttribute('aria-current', 'true');

	// The copy is a real copy: a new slide id, fresh element ids, the same asset.
	await expect.poll(() => slideIds(page, id)).toHaveLength(2);
	const duplicated = await row(page, id);
	const copy = duplicated.slides[1];
	expect(copy.id).not.toBe(sourceSlideId);
	expect(
		copy.elements
			.map((element: { id: string }) => element.id)
			.filter((elementId: string) => sourceElementIds.includes(elementId))
	).toEqual([]);
	expect(copy.elements[0].assetId).toBe(sourceAssetId);
	expect(duplicated.assets.map((asset: { id: string }) => asset.id)).toEqual([sourceAssetId]);

	// The duplicate paints its reused bytes on the active slide.
	const artworkRect = await elementRectOnCanvas(page, copy.elements[0]);
	await expect.poll(() => paintedPixelsInRect(page, artworkRect)).toBeGreaterThan(30);

	// Add slide: it lands after the active copy and starts empty.
	await rail(page, 'Add slide').click();
	await expect(rail(page, 'Show slide 3: Slide 3')).toHaveAttribute('aria-current', 'true');
	await expect.poll(() => slideIds(page, id)).toHaveLength(3);
	const added = (await row(page, id)).slides[2];
	expect(added.elements).toHaveLength(0);

	// Reorder by dragging a thumbnail before another; the stored order follows.
	const third = rail(page, 'Show slide 3: Slide 3');
	const second = rail(page, 'Show slide 2: Slide 1 copy');
	const from = (await third.boundingBox())!;
	const to = (await second.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 4, { steps: 8 });
	await expect(second).toHaveAttribute('data-drop-position', 'before');
	await page.mouse.up();
	await expect(rail(page, 'Move slide 3 up')).toHaveCount(0);
	const movedOrder = [sourceSlideId, added.id, copy.id];
	await expect.poll(() => slideIds(page, id)).toEqual(movedOrder);
	await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({
		timeout: 10_000
	});

	// Reload and reopen from the library: the order, the copy's content and the
	// reused asset all come back from storage, not from in-memory state.
	await page.reload();
	await expect(canvasHost(page)).toHaveAttribute('data-ready', 'true');
	await page.goto('/presentations');
	await page.getByRole('link', { name: 'Open Untitled presentation' }).click();
	await expect(canvasHost(page)).toHaveAttribute('data-ready', 'true');

	const reopened = await row(page, id);
	expect(reopened.slides.map((slide: { id: string }) => slide.id)).toEqual(movedOrder);
	const reopenedCopy = reopened.slides.find((slide: { id: string }) => slide.id === copy.id);
	expect(reopenedCopy.elements).toEqual(copy.elements);
	expect(reopenedCopy.elements[0].assetId).toBe(sourceAssetId);
	expect(reopened.assets.map((asset: { id: string }) => asset.id)).toEqual([sourceAssetId]);

	await rail(page, 'Show slide 3: Slide 1 copy').click();
	await expect(rail(page, 'Show slide 3: Slide 1 copy')).toHaveAttribute('aria-current', 'true');
	await expect.poll(() => paintedPixelsInRect(page, artworkRect)).toBeGreaterThan(30);

	// Deleting the active slide hands focus to the slide that took its place, not to
	// the first slide.
	await rail(page, 'Show slide 2: Slide 3').click();
	const deleteSecond = rail(page, 'Delete slide 2');
	await page.getByRole('button', { name: 'Save', exact: true }).focus();
	await page.mouse.move(400, 110);
	await expect(deleteSecond).toHaveCSS('opacity', '0');
	await rail(page, 'Show slide 2: Slide 3').hover();
	await expect(deleteSecond).toHaveCSS('opacity', '1');
	await page.screenshot({ path: testInfo.outputPath('slide-rail-hover-delete.png') });
	const cardBounds = (await rail(page, 'Show slide 2: Slide 3').boundingBox())!;
	const deleteBounds = (await deleteSecond.boundingBox())!;
	expect(deleteBounds.x).toBeGreaterThan(cardBounds.x + cardBounds.width / 2);
	expect(deleteBounds.y).toBeLessThan(cardBounds.y + cardBounds.height / 2);
	await deleteSecond.click();
	await expect(rail(page, 'Show slide 2: Slide 1 copy')).toBeFocused();
	await expect(rail(page, 'Show slide 2: Slide 1 copy')).toHaveAttribute('aria-current', 'true');
	await expect.poll(() => slideIds(page, id)).toEqual([sourceSlideId, copy.id]);

	// Deleting the active survivor leaves one reachable slide, and every impossible
	// action on it is disabled.
	await rail(page, 'Show slide 2: Slide 1 copy').focus();
	await expect(rail(page, 'Delete slide 2')).toHaveCSS('opacity', '1');
	await rail(page, 'Delete slide 2').click();
	await expect(rail(page, 'Show slide 1: Slide 1')).toBeFocused();
	await expect(rail(page, 'Show slide 1: Slide 1')).toHaveAttribute('aria-current', 'true');
	await expect(rail(page, 'Move slide 1 up')).toHaveCount(0);
	await expect(rail(page, 'Move slide 1 down')).toHaveCount(0);
	await expect(rail(page, 'Delete slide 1')).toBeDisabled();
	await expect.poll(() => elementIdsIn(page, id, 0)).toEqual(sourceElementIds);
	await expect.poll(async () => (await row(page, id)).slides.length).toBe(1);
});

test('reorders with the keyboard while leaving the slide selected', async ({ page }) => {
	const id = await openBlankEditor(page);
	await rail(page, 'Add slide').click();
	await rail(page, 'Add slide').click();
	await expect.poll(() => slideIds(page, id)).toHaveLength(3);
	const initial = await slideIds(page, id);
	const third = rail(page, 'Show slide 3: Slide 3');
	await third.focus();
	await third.press('Alt+ArrowUp');
	await expect.poll(() => slideIds(page, id)).toEqual([initial[0], initial[2], initial[1]]);
	await expect(rail(page, 'Show slide 2: Slide 3')).toBeFocused();
	await rail(page, 'Show slide 2: Slide 3').press('Alt+ArrowDown');
	await expect.poll(() => slideIds(page, id)).toEqual(initial);
	await expect(rail(page, 'Show slide 3: Slide 3')).toHaveAttribute('aria-current', 'true');
});

test.describe('phone slide rail', () => {
	test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

	test('reorders slides across a horizontal phone rail with a touch drag', async ({ page }) => {
		const id = await openBlankEditor(page);
		await rail(page, 'Add slide').click();
		await rail(page, 'Add slide').click();
		await expect.poll(() => slideIds(page, id)).toHaveLength(3);
		const initial = await slideIds(page, id);
		const first = rail(page, 'Show slide 1: Slide 1');
		const second = rail(page, 'Show slide 2: Slide 2');
		await first.scrollIntoViewIfNeeded();
		await second.scrollIntoViewIfNeeded();
		const grip = rail(page, 'Drag slide 1 to reorder');
		await expect(grip).toHaveCSS('opacity', '1');
		const from = (await grip.boundingBox())!;
		const to = (await second.boundingBox())!;
		const startX = from.x + from.width / 2;
		const startY = from.y + from.height / 2;
		const endX = to.x + to.width * 0.75;
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: startX, y: startY }]
		});
		for (let step = 1; step <= 8; step++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x: startX + ((endX - startX) * step) / 8, y: startY }]
			});
		}
		await expect(second).toHaveAttribute('data-drop-position', 'after');
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect.poll(() => slideIds(page, id)).toEqual([initial[1], initial[0], initial[2]]);
		const newFirst = (await rail(page, 'Show slide 1: Slide 2').boundingBox())!;
		await page.touchscreen.tap(newFirst.x + newFirst.width / 2, newFirst.y + newFirst.height / 2);
		await expect(rail(page, 'Show slide 1: Slide 2')).toHaveAttribute('aria-current', 'true');
	});
});

test('undoes and redoes through the toolbar and keyboard without stealing text-field undo', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);

	const undo = page.getByRole('button', { name: 'Undo' });
	const redo = page.getByRole('button', { name: 'Redo' });
	await expect(undo).toBeDisabled();
	await expect(redo).toBeDisabled();

	await rail(page, 'Duplicate active slide').click();
	await expect(rail(page, 'Show slide 2: Slide 1 copy')).toHaveAttribute('aria-current', 'true');
	await expect(undo).toBeEnabled();
	await expect.poll(() => slideIds(page, id)).toHaveLength(2);

	await undo.click();
	await expect(rail(page, 'Show slide 2: Slide 1 copy')).toHaveCount(0);
	await expect(redo).toBeEnabled();

	// Ctrl+Shift+Z redoes; plain Ctrl+Z undoes again.
	await page.keyboard.press('Control+Shift+Z');
	await expect(rail(page, 'Show slide 2: Slide 1 copy')).toBeVisible();
	await expect(redo).toBeDisabled();
	await page.keyboard.press('Control+z');
	await expect(rail(page, 'Show slide 2: Slide 1 copy')).toHaveCount(0);

	// Inside the text field the browser's own undo belongs to the field: the app
	// shortcut must not remove the text box out from under the caret.
	await page.getByRole('button', { name: 'Add text' }).click();
	const field = page.getByTestId('text-edit-field');
	await expect(field).toBeFocused();
	await page.keyboard.type('Xin chào');
	await expect(field).toContainText('Xin chào');
	await page.keyboard.press('Control+z');
	await expect(field).toBeVisible();
	// The typing was undone, not the element: the box is still there to type into
	// and still listed as the slide's one layer.
	await expect(field).not.toContainText('Xin chào');
	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);

	// Ending the session commits exactly what the field showed — the undone text,
	// not the text that was typed. The zero-width placeholder an empty styled run
	// carries is stripped here because the bridge strips it on read-back.
	const fieldText = ((await field.textContent()) ?? '').replace(/\u200b/g, '').trim();
	expect(fieldText).not.toBe('Xin chào');
	await page.keyboard.press('Escape');
	await expect(field).toHaveCount(0);
	await expect.poll(async () => (await readStoredPresentation(page, id))?.text).toBe(fieldText);

	// One gesture is one history entry: the first app undo empties the box the
	// session edited, and only the second undo removes it from the slide.
	await expect(undo).toBeEnabled();
	await page.keyboard.press('Control+z');
	await expect.poll(async () => (await readStoredPresentation(page, id))?.text).toBe('');
	await expect.poll(() => elementIdsIn(page, id, 0)).toHaveLength(1);
	await page.keyboard.press('Control+z');
	await expect.poll(() => elementIdsIn(page, id, 0)).toHaveLength(0);
	await expect(canvasHost(page)).toHaveAttribute('data-ready', 'true');
});
