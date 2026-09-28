import { expect, test, type Page } from '@playwright/test';
import {
	addShape,
	dominantCanvasColor,
	elementRectOnCanvas,
	openBlankEditor,
	paintedPixelsInRect,
	readGeometry,
	readStoredPresentationJson
} from './presentations';

/**
 * The view-state journey, ported from the source "renders the active fixture
 * slide and keeps zoom, pan, and slide changes view-only": the slide paints real
 * artwork, the canvas controls and a background drag change only the view, a
 * slide switch repaints the canvas, and the stored row is byte-for-byte the same
 * before and after. The port has no fixture deck in the production build, so the
 * deck is built through the UI and the claim is made against the stored row.
 */

const SLIDE = { x: 0, y: 0, width: 1280, height: 720 };
const canvasHost = (page: Page) => page.getByTestId('presentation-canvas');
const inspector = (page: Page) => page.locator('.presentation-inspector');

test('paints the slide and keeps zoom, pan and slide changes view-only', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);

	// Slide 1 carries a filled ellipse, so "the slide paints" has artwork to lose.
	await addShape(page, 'ellipse');
	const ellipse = await readGeometry(page);
	const ellipseRect = await elementRectOnCanvas(page, ellipse);
	await expect.poll(() => paintedPixelsInRect(page, ellipseRect)).toBeGreaterThan(500);

	// The copy gets a dark slide background, so switching slides visibly repaints.
	await page.getByRole('button', { name: 'Duplicate active slide' }).click();
	await expect(page.getByRole('button', { name: 'Show slide 2: Slide 1 copy' })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await expect
		.poll(async () => JSON.parse(await readStoredPresentationJson(page, id)).slides.length)
		.toBe(2);
	// The colour input is a gesture: its history group stays open until the field
	// blurs, and the autosave deliberately waits for that group to end.
	const background = inspector(page).getByLabel('Slide background');
	await background.fill('#102030');
	await background.blur();
	await expect
		.poll(async () => JSON.parse(await readStoredPresentationJson(page, id)).slides[1]?.background)
		.toBe('#102030');

	const before = await readStoredPresentationJson(page, id);

	// Zoom is a view number: the control moves it, the document does not.
	await page.getByRole('button', { name: 'Zoom in' }).click();
	await expect(canvasHost(page)).toHaveAttribute('data-view-zoom', '1.25');

	// Panning starts on the slide background above the artwork, and the canvas says
	// so while the pointer is down.
	const box = (await canvasHost(page).boundingBox())!;
	const start = { x: box.x + box.width / 2, y: box.y + 12 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 35, start.y + 20);
	await expect(canvasHost(page)).toHaveClass(/is-panning/);
	await page.mouse.up();
	await expect(canvasHost(page)).not.toHaveClass(/is-panning/);
	await expect(canvasHost(page)).not.toHaveAttribute('data-view-pan-x', '0');
	await expect(canvasHost(page)).toHaveAttribute('data-view-zoom', '1.25');

	// Slide navigation is view state too: the painted background changes, the row does not.
	await expect.poll(() => dominantCanvasColor(page, SLIDE)).not.toBe('255,255,255');
	await page.getByRole('button', { name: 'Show slide 1: Slide 1' }).click();
	await expect(page.getByRole('button', { name: 'Show slide 1: Slide 1' })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await expect.poll(() => dominantCanvasColor(page, SLIDE)).toBe('255,255,255');
	// The ellipse is still painted after the slide switch, at the panned/zoomed view.
	await expect.poll(() => paintedPixelsInRect(page, ellipseRect)).toBeGreaterThan(500);

	await page.getByRole('button', { name: 'Show slide 2: Slide 1 copy' }).click();
	await expect.poll(() => dominantCanvasColor(page, SLIDE)).toBe('16,32,48');

	expect(await readStoredPresentationJson(page, id)).toBe(before);
});

test('wheel zoom responds gradually to small scrolls and still handles a full wheel notch', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);
	const before = await readStoredPresentationJson(page, id);
	const host = canvasHost(page);
	await host.hover();
	await page.mouse.wheel(0, -2);
	await expect
		.poll(async () => Number(await host.getAttribute('data-view-zoom')))
		.toBeGreaterThan(1);
	expect(Number(await host.getAttribute('data-view-zoom'))).toBeLessThan(1.02);
	await page.mouse.wheel(0, -120);
	await expect
		.poll(async () => Number(await host.getAttribute('data-view-zoom')))
		.toBeGreaterThan(1.02);
	expect(Number(await host.getAttribute('data-view-zoom'))).toBeLessThan(1.2);
	expect(await readStoredPresentationJson(page, id)).toBe(before);
});

test('the fit control returns the view to 100% without touching the document', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const id = await openBlankEditor(page);
	await addShape(page, 'rectangle');
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

	const before = await readStoredPresentationJson(page, id);
	const box = (await canvasHost(page).boundingBox())!;
	const start = { x: box.x + box.width / 2, y: box.y + 12 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 40, start.y + 24);
	await page.mouse.up();
	await page.getByRole('button', { name: 'Zoom in' }).click();
	await expect(canvasHost(page)).not.toHaveAttribute('data-view-zoom', '1');
	await expect(canvasHost(page)).not.toHaveAttribute('data-view-pan-x', '0');

	await page.getByRole('button', { name: 'Fit slide to window' }).click();
	await expect(canvasHost(page)).toHaveAttribute('data-view-zoom', '1');
	await expect(canvasHost(page)).toHaveAttribute('data-view-pan-x', '0');
	await expect(canvasHost(page)).toHaveAttribute('data-view-pan-y', '0');
	expect(await readStoredPresentationJson(page, id)).toBe(before);
});
