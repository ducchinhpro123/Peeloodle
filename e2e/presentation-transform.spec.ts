import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	addShape,
	at,
	canvasView,
	clickAt,
	drag,
	listStoredPresentations,
	openBlankEditor,
	readGeometry,
	readStoredPresentation,
	selectFromElementList,
	waitForHittable
} from './presentations';

/**
 * The transform journeys, ported from the source
 * `presentations-transform.spec.ts`: move/resize/rotate happen in 1280x720
 * document units, so the same gesture produces the same geometry at every zoom;
 * the handles the user grabs and the numbers in the inspector agree; the live
 * gesture preview never touches the document; and a locked element cannot be
 * manipulated. Pointer geometry cannot be proven in jsdom, so it is proven here.
 *
 * The source read the React store directly. This port reads the app's own DOM
 * seams instead - the inspector fields (which show the live preview), the canvas
 * host's selection/view attributes, the selection frame's box and the stored
 * IndexedDB row - because the production build exposes no store.
 */

const canvasHost = (page: Page) => page.getByTestId('presentation-canvas');
const inspector = (page: Page) => page.locator('.presentation-inspector');
const frameBox = async (page: Page) => {
	const box = await page.getByTestId('presentation-selection-frame').boundingBox();
	if (!box) throw new Error('the selection frame has no box');
	return box;
};

/** The centre of a client-pixel box, in client pixels. */
function centreOfBox(box: { x: number; y: number; width: number; height: number }) {
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The pointer target of a handle: the pseudo-element the browser hit-tests. */
async function pointerTarget(handle: Locator): Promise<{ width: number; height: number }> {
	return handle.evaluate((element) => {
		const pseudo = getComputedStyle(element, '::before');
		return { width: Number.parseFloat(pseudo.width), height: Number.parseFloat(pseudo.height) };
	});
}

/** Which labelled element a real hit test lands on at one client point. */
async function hitTest(page: Page, point: { x: number; y: number }): Promise<string | null> {
	return page.evaluate(
		({ x, y }) =>
			document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid') ??
			null,
		point
	);
}

/** The element id a canvas hit test finds at one client point, or null. */
async function hitTestAt(page: Page, point: { x: number; y: number }): Promise<string | null> {
	return page.evaluate(({ x, y }) => {
		const konva = (window as unknown as { Konva?: any }).Konva;
		const stage = konva?.stages?.[0];
		const host = document.querySelector('[data-testid="presentation-canvas"]');
		if (!stage || !host) return null;
		const rect = host.getBoundingClientRect();
		const hit = stage.getIntersection?.({ x: x - rect.left, y: y - rect.top });
		return hit?.findAncestor?.('.presentation-element', true)?.id?.() ?? null;
	}, point);
}

/** One point on the circle around `centre` through `point`, turned by `degrees`. */
function turnAround(
	centre: { x: number; y: number },
	point: { x: number; y: number },
	degrees: number
) {
	const radians = (degrees * Math.PI) / 180;
	const offset = { x: point.x - centre.x, y: point.y - centre.y };
	return {
		x: centre.x + offset.x * Math.cos(radians) - offset.y * Math.sin(radians),
		y: centre.y + offset.x * Math.sin(radians) + offset.y * Math.cos(radians)
	};
}

async function setField(page: Page, label: string, value: string): Promise<void> {
	// Scoped to the visible pane: the (closed) properties dialog holds a second,
	// hidden copy of every field, so an unscoped label would be ambiguous.
	const field = inspector(page).getByLabel(label, { exact: true });
	await field.fill(value);
	await field.press('Enter');
	await expect(field).toHaveValue(value);
}

/** A prepared text box of known geometry, selected on the canvas. */
async function boxedText(page: Page, x = 200, y = 200) {
	await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text' }).click();
	await expect(page.getByTestId('text-edit-field')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('text-edit-field')).not.toBeVisible();
	// Let the autosave settle before touching the canvas. The save swaps the status
	// text ("Unsaved changes" -> "Saved locally"), and at this width that can change
	// how many rows the editor bar's action group needs, which moves the canvas.
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

	await setField(page, 'X position', String(x));
	await setField(page, 'Y position', String(y));
	await setField(page, 'Width', '320');
	await setField(page, 'Height', '160');

	const geometry = await readGeometry(page);
	const view = await canvasView(page);
	await waitForHittable(page, geometry);
	await clickAt(page, at(view, geometry.x + geometry.width / 2, geometry.y + geometry.height / 2));
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', /.+/);
	return geometry;
}

test('moves in document units at two zoom levels and commits one history entry per gesture', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	// Off-centre enough that no drag below lands on a slide alignment guide
	// (threshold 6 document units), so the measured delta is the gesture's own.
	const start = await boxedText(page, 100, 100);
	expect(start).toMatchObject({ x: 100, y: 100, width: 320, height: 160, rotation: 0 });
	const id = decodeURIComponent(page.url().split('/').pop()!);
	// Let the field edits reach disk first, so the mid-gesture read below is about
	// the gesture and not about the autosave debounce.
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await expect
		.poll(
			async () =>
				(await readStoredPresentation(page, id))?.elements.find(
					(element) => element.kind === 'text'
				)?.x
		)
		.toBe(start.x);

	const view = await canvasView(page);
	const from = at(view, start.x + start.width / 2, start.y + start.height / 2);

	// Move: the document changes only when the gesture ends, and then exactly once.
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 20, from.y + 8);
	await page.mouse.move(from.x + 40, from.y + 16);
	const during = await readGeometry(page);
	expect({ x: during.x, y: during.y }).not.toEqual({ x: start.x, y: start.y });
	// The persisted document has not moved while the gesture is still running.
	const notYet = await readStoredPresentation(page, id);
	const storedDuring = notYet?.elements.find((element) => element.kind === 'text');
	expect({ x: storedDuring?.x, y: storedDuring?.y }).toEqual({ x: start.x, y: start.y });
	await page.mouse.up();

	const moved = await readGeometry(page);
	expect(Math.abs(moved.x - Math.round(start.x + 40 / view.scale))).toBeLessThanOrEqual(1);
	expect(Math.abs(moved.y - Math.round(start.y + 16 / view.scale))).toBeLessThanOrEqual(1);
	expect({ width: moved.width, height: moved.height }).toEqual({
		width: start.width,
		height: start.height
	});

	// One gesture, one history entry: undo puts the whole move back.
	await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(async () => (await readGeometry(page)).x).toBe(start.x);
	await page.getByRole('button', { name: 'Redo' }).click();
	await expect.poll(async () => (await readGeometry(page)).x).toBe(moved.x);

	// The same document-space move at 125% zoom: the view scale changed, the result did not.
	await page.getByRole('button', { name: 'Zoom in' }).click();
	const zoomed = await canvasView(page);
	expect(zoomed.scale).toBeGreaterThan(view.scale);
	const beforeSecond = await readGeometry(page);
	const secondFrom = at(
		zoomed,
		beforeSecond.x + beforeSecond.width / 2,
		beforeSecond.y + beforeSecond.height / 2
	);
	await drag(page, secondFrom, {
		x: secondFrom.x + 40 * (zoomed.scale / view.scale),
		y: secondFrom.y + 16 * (zoomed.scale / view.scale)
	});
	const afterSecond = await readGeometry(page);
	expect(Math.abs(afterSecond.x - beforeSecond.x - (moved.x - start.x))).toBeLessThanOrEqual(1);
	expect(Math.abs(afterSecond.y - beforeSecond.y - (moved.y - start.y))).toBeLessThanOrEqual(1);

	// The move reached disk: the stored element carries the same numbers.
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await expect
		.poll(async () => (await readStoredPresentation(page, id))?.elements[0]?.x)
		.toBeCloseTo(afterSecond.x, 0);
});

test('shows full slide centrelines while snapping a dragged box and clears them on release', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const start = await boxedText(page, 100, 100);
	const view = await canvasView(page);
	const from = at(view, start.x + start.width / 2, start.y + start.height / 2);
	const target = at(view, 640, 360);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(target.x, target.y, { steps: 5 });
	const vertical = page.getByTestId('presentation-guide-x');
	const horizontal = page.getByTestId('presentation-guide-y');
	await expect(vertical).toBeVisible();
	await expect(horizontal).toBeVisible();
	const [v, h] = await Promise.all([vertical.boundingBox(), horizontal.boundingBox()]);
	expect(v!.width).toBeGreaterThanOrEqual(1);
	expect(v!.height).toBeGreaterThan(300);
	expect(h!.width).toBeGreaterThan(500);
	expect(h!.height).toBeGreaterThanOrEqual(1);
	await page.screenshot({ path: testInfo.outputPath('slide-alignment-guides.png') });
	await page.mouse.up();
	await expect(vertical).toHaveCount(0);
	await expect(horizontal).toHaveCount(0);
});

test('resizes from the south-east handle keeping the origin, and the frame keeps agreeing', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	const start = await boxedText(page);
	await page.getByRole('button', { name: 'Fit slide to window' }).click();
	await expect(page.locator('.presentation-canvas-controls').getByLabel('Canvas zoom')).toHaveText(
		'100%'
	);
	const view = await canvasView(page);

	// The frame really is the element's document rect, mapped through the view.
	const beforeFrame = await frameBox(page);
	const expectedFrame = at(view, start.x, start.y);
	expect(Math.abs(beforeFrame.x - expectedFrame.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(beforeFrame.y - expectedFrame.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(beforeFrame.width - start.width * view.scale)).toBeLessThanOrEqual(1.5);
	expect(Math.abs(beforeFrame.height - start.height * view.scale)).toBeLessThanOrEqual(1.5);

	const seBox = (await page.getByTestId('presentation-handle-se').boundingBox())!;
	const seFrom = centreOfBox(seBox);
	await page.mouse.move(seFrom.x, seFrom.y);
	await page.mouse.down();
	await page.mouse.move(seFrom.x + 30 * view.scale, seFrom.y + 15 * view.scale);
	await page.mouse.move(seFrom.x + 60 * view.scale, seFrom.y + 30 * view.scale);
	const during = await readGeometry(page);
	expect(during.width).toBeGreaterThan(start.width);
	await page.mouse.up();

	const resized = await readGeometry(page);
	expect({ x: resized.x, y: resized.y }).toEqual({ x: start.x, y: start.y });
	expect(Math.abs(resized.width - (start.width + 60))).toBeLessThanOrEqual(1);
	expect(Math.abs(resized.height - (start.height + 30))).toBeLessThanOrEqual(1);
	await expect(inspector(page).getByLabel('Width', { exact: true })).toHaveValue(
		String(resized.width)
	);

	const afterFrame = await frameBox(page);
	expect(Math.abs(afterFrame.width - resized.width * view.scale)).toBeLessThanOrEqual(1.5);
	expect(Math.abs(afterFrame.height - resized.height * view.scale)).toBeLessThanOrEqual(1.5);
});

test('resizing a text box changes its frame without stretching the painted letters', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	await boxedText(page);
	await page.getByRole('button', { name: /^Edit text/ }).click();
	await page.getByTestId('text-edit-field').fill('this is good');
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('text-edit-field')).not.toBeVisible();
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Fit slide to window' }).click();
	const view = await canvasView(page);
	const start = await readGeometry(page);

	// Measure the actual dark glyph pixels in the scene canvas, not the selection
	// outline or the stored font size. A group-scale preview stretches this ink.
	const inkBounds = () =>
		page.evaluate(
			({ origin, scale, x, y }) => {
				const canvas = (window as any).Konva.stages[0].getLayers()[0].getCanvas()._canvas;
				const context = canvas.getContext('2d')!;
				const host = document.querySelector('[data-testid="presentation-canvas"]')!;
				const rect = host.getBoundingClientRect();
				const ratio = canvas.width / rect.width;
				const left = Math.round((origin.x - rect.x + x * scale) * ratio);
				const top = Math.round((origin.y - rect.y + y * scale) * ratio);
				const { data, width, height } = context.getImageData(left, top, 300, 110);
				let minX = width,
					maxX = -1,
					minY = height,
					maxY = -1;
				for (let py = 0; py < height; py++)
					for (let px = 0; px < width; px++) {
						const index = (py * width + px) * 4;
						if (
							data[index + 3] < 200 ||
							data[index] > 100 ||
							data[index + 1] > 100 ||
							data[index + 2] > 140
						)
							continue;
						minX = Math.min(minX, px);
						maxX = Math.max(maxX, px);
						minY = Math.min(minY, py);
						maxY = Math.max(maxY, py);
					}
				return { width: maxX - minX + 1, height: maxY - minY + 1 };
			},
			{ origin: view.origin, scale: view.scale, x: start.x, y: start.y }
		);

	const before = await inkBounds();
	expect(before.width).toBeGreaterThan(30);
	expect(before.height).toBeGreaterThan(10);
	const handle = (await page.getByTestId('presentation-handle-se').boundingBox())!;
	const from = centreOfBox(handle);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 90 * view.scale, from.y + 90 * view.scale, { steps: 5 });
	const during = await inkBounds();
	await page
		.getByTestId('presentation-canvas')
		.screenshot({ path: testInfo.outputPath('text-resize-preview.png') });
	expect(during.width).toBeGreaterThanOrEqual(before.width - 3);
	expect(during.width).toBeLessThanOrEqual(before.width + 3);
	expect(during.height).toBeGreaterThanOrEqual(before.height - 3);
	expect(during.height).toBeLessThanOrEqual(before.height + 3);
	await page.mouse.up();
	const resized = await readGeometry(page);
	expect(resized.width).toBeGreaterThan(start.width);
	expect(resized.height).toBeGreaterThan(start.height);
	await expect.poll(inkBounds).toEqual(before);
});

test('clicking a selected text box then pressing Delete removes it, but editing text does not', async ({
	page
}, testInfo) => {
	const id = await openBlankEditor(page);
	await page.getByRole('button', { name: 'Add text' }).click();
	await page.getByTestId('text-edit-field').fill('this is good');
	await page.keyboard.press('Backspace');
	await expect(page.getByTestId('text-edit-field')).toContainText('this is goo');
	await page.keyboard.press('Escape');
	const geometry = await readGeometry(page);
	const view = await canvasView(page);
	await waitForHittable(page, geometry);
	await clickAt(page, at(view, geometry.x + geometry.width / 2, geometry.y + geometry.height / 2));
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', /.+/);
	await page.keyboard.press('Delete');
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', '');
	await expect(page.locator('.presentation-layer-item')).toHaveCount(0);
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await expect.poll(async () => (await readStoredPresentation(page, id))?.elements.length).toBe(0);
	await page.screenshot({ path: testInfo.outputPath('text-deleted.png') });

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);
	await waitForHittable(page, geometry);
	await clickAt(
		page,
		at(await canvasView(page), geometry.x + geometry.width / 2, geometry.y + geometry.height / 2)
	);
	await page.keyboard.press('Backspace');
	await expect(page.locator('.presentation-layer-item')).toHaveCount(0);
});

test('canvas shortcuts duplicate the selected element and Escape clears selection', async ({
	page
}, testInfo) => {
	const id = await openBlankEditor(page);
	await addShape(page, 'rectangle');
	const original = await readGeometry(page);
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	await clickAt(
		page,
		at(await canvasView(page), original.x + original.width / 2, original.y + original.height / 2)
	);
	await page.keyboard.press('Control+d');
	await expect(page.locator('.presentation-layer-item')).toHaveCount(2);
	const copyId = await canvasHost(page).getAttribute('data-selected-element');
	expect(copyId).toBeTruthy();
	await expect.poll(async () => (await readStoredPresentation(page, id))?.elements.length).toBe(2);
	const copy = (await readStoredPresentation(page, id))?.elements.find(
		(element) => element.id === copyId
	);
	expect(copy).toMatchObject({ x: original.x + 24, y: original.y + 24 });
	await page
		.getByTestId('presentation-canvas')
		.screenshot({ path: testInfo.outputPath('canvas-duplicated.png') });

	await page.keyboard.press('Escape');
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', '');
	await page.keyboard.press('Control+d');
	await expect(page.locator('.presentation-layer-item')).toHaveCount(2);
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator('.presentation-layer-item')).toHaveCount(1);
});

test('keeps the visual centre through the numeric rotation field and a rotate-handle turn', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	await boxedText(page);
	const centreBefore = centreOfBox(await frameBox(page));

	// The numeric field replaces the angle about the visual centre: the stored
	// origin moves so the frame stays where it was (same numbers as the source).
	await setField(page, 'Rotation', '90');
	const quarter = await readGeometry(page);
	expect(quarter.rotation).toBe(90);
	expect({ x: quarter.x, y: quarter.y }).toEqual({ x: 440, y: 120 });
	const centreAfterField = centreOfBox(await frameBox(page));
	expect(Math.abs(centreAfterField.x - centreBefore.x)).toBeLessThanOrEqual(2);
	expect(Math.abs(centreAfterField.y - centreBefore.y)).toBeLessThanOrEqual(2);

	// Dragging the round handle again turns the already-rotated element about the
	// same visual centre instead of around its stored origin.
	const handleBox = (await page.getByTestId('presentation-handle-rotate').boundingBox())!;
	const from = centreOfBox(handleBox);
	await drag(page, from, turnAround(centreAfterField, from, 85), 6);
	const turned = await readGeometry(page);
	expect(Math.abs(turned.rotation - 175)).toBeLessThanOrEqual(2);
	const centreAfterDrag = centreOfBox(await frameBox(page));
	expect(Math.abs(centreAfterDrag.x - centreBefore.x)).toBeLessThanOrEqual(3);
	expect(Math.abs(centreAfterDrag.y - centreBefore.y)).toBeLessThanOrEqual(3);

	// The angle survives a real reload and reopen.
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const id = decodeURIComponent(page.url().split('/').pop()!);
	await page.reload();
	await expect(canvasHost(page)).toBeVisible();
	await selectFromElementList(page, 'Body text');
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', /.+/);
	const reopened = await readGeometry(page);
	expect(Math.abs(reopened.rotation - turned.rotation)).toBeLessThanOrEqual(1);
	expect({ x: reopened.x, y: reopened.y }).toEqual({ x: turned.x, y: turned.y });
	const stored = await readStoredPresentation(page, id);
	expect(Math.abs((stored?.elements[0]?.rotation ?? 0) - turned.rotation)).toBeLessThanOrEqual(1);
});

test('gives every handle a 44px pointer target without moving its visible centre', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	await boxedText(page);

	// A finger, not a mouse, has to land on these handles: the phone layout is
	// where the 44px minimum matters, and handle sizes do not vary with width.
	await page.setViewportSize({ width: 390, height: 844 });
	const host = canvasHost(page);
	await host.scrollIntoViewIfNeeded();
	const geometry = await readGeometry(page);
	const view = await canvasView(page);
	await waitForHittable(page, geometry);
	const hostBox = (await host.boundingBox())!;
	const centre = at(view, geometry.x + geometry.width / 2, geometry.y + geometry.height / 2);
	// Clear the selection on the background first. Two clicks on one element
	// inside Konva's double-click window open the text editor, and this test is
	// about the handle layout, so the selecting click must stand alone.
	const offText = at(view, geometry.x - 100, geometry.y - 100);
	await host.click({ position: { x: offText.x - hostBox.x, y: offText.y - hostBox.y } });
	await expect(host).toHaveAttribute('data-selected-element', '');
	await host.click({ position: { x: centre.x - hostBox.x, y: centre.y - hostBox.y } });
	await expect(host).toHaveAttribute('data-selected-element', /.+/);

	const box = await frameBox(page);
	const expectedCentre = {
		nw: { x: box.x, y: box.y },
		ne: { x: box.x + box.width, y: box.y },
		se: { x: box.x + box.width, y: box.y + box.height },
		sw: { x: box.x, y: box.y + box.height },
		rotate: { x: box.x + box.width / 2, y: box.y - 32 }
	};
	const visibleSize = { nw: 14, ne: 14, se: 14, sw: 14, rotate: 16 };

	for (const handle of ['nw', 'ne', 'se', 'sw', 'rotate'] as const) {
		const target = page.getByTestId(`presentation-handle-${handle}`);
		const size = await pointerTarget(target);
		expect.soft(size.width, `${handle} pointer width`).toBeGreaterThanOrEqual(44);
		expect.soft(size.height, `${handle} pointer height`).toBeGreaterThanOrEqual(44);

		const targetBox = (await target.boundingBox())!;
		expect(targetBox.width, `${handle} visible width`).toBeCloseTo(visibleSize[handle], 1);
		expect(targetBox.height, `${handle} visible height`).toBeCloseTo(visibleSize[handle], 1);
		const targetCentre = centreOfBox(targetBox);
		expect(Math.abs(targetCentre.x - expectedCentre[handle].x)).toBeLessThanOrEqual(2);
		expect(Math.abs(targetCentre.y - expectedCentre[handle].y)).toBeLessThanOrEqual(2);

		// A press near the required edge lands on this handle: 21px from the centre
		// is outside a 40px corner target and 22px is outside a 42px rotate target.
		const reach = handle === 'rotate' ? 22 : 21;
		expect
			.soft(
				await hitTest(page, { x: targetCentre.x + reach, y: targetCentre.y }),
				`${handle} at ${reach}px from centre`
			)
			.toBe(`presentation-handle-${handle}`);
	}
});

test.describe('coarse pointer at a desktop width', () => {
	// A touch-capable laptop or large tablet: the 1150px inspector breakpoint does
	// not apply, but the pointer is still a finger, so the target must stay 44px.
	test.use({ hasTouch: true, viewport: { width: 1280, height: 768 } });

	test('keeps the handle expansion for a coarse pointer', async ({ page }) => {
		await boxedText(page);

		const handle = page.getByTestId('presentation-handle-se');
		await expect(handle).toBeVisible();
		const size = await pointerTarget(handle);
		expect(size.width).toBeGreaterThanOrEqual(44);
		expect(size.height).toBeGreaterThanOrEqual(44);
		const centre = centreOfBox(await handle.boundingBox());
		expect(await hitTest(page, { x: centre.x + 21, y: centre.y })).toBe('presentation-handle-se');
	});
});

test('selects every visible element kind and leaves a locked element alone', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 768 });
	await openBlankEditor(page);
	await addShape(page, 'ellipse');
	await page.getByRole('button', { name: 'Add text' }).click();
	await expect(page.getByTestId('text-edit-field')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('text-edit-field')).not.toBeVisible();

	// Shape and text are both selectable by clicking what is painted.
	const shape = await (async () => {
		await selectFromElementList(page, 'Ellipse');
		return readGeometry(page);
	})();
	const text = await (async () => {
		await selectFromElementList(page, 'Body text');
		return readGeometry(page);
	})();

	// Click below the text box's own area, so only the ellipse can be under the pointer.
	// Every point re-reads the mapping rather than reusing one capture: the bar grows
	// an "Edit text" action while a text element is selected and drops it again for a
	// shape, so the canvas moves with the selection.
	await clickAt(
		page,
		at(await canvasView(page), shape.x + shape.width / 2, shape.y + shape.height - 20)
	);
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', /.+/);
	await expect(inspector(page).getByLabel('Width', { exact: true })).toHaveValue(
		String(shape.width)
	);
	await clickAt(
		page,
		at(await canvasView(page), text.x + text.width / 2, text.y + text.height / 2)
	);
	await expect(inspector(page).getByLabel('Width', { exact: true })).toHaveValue(
		String(text.width)
	);

	// A locked element still selects and shows its frame, but has no handles and
	// no gesture can change it.
	await selectFromElementList(page, 'Ellipse');
	await page.getByRole('button', { name: 'Lock Ellipse' }).click();
	// Locking re-renders the canvas; wait for the new hit graph before clicking, so
	// the click cannot race the repaint.
	const ellipsePoint = at(
		await canvasView(page),
		shape.x + shape.width / 2,
		shape.y + shape.height - 20
	);
	await expect.poll(() => hitTestAt(page, ellipsePoint)).not.toBeNull();
	const panBefore = {
		x: await canvasHost(page).getAttribute('data-view-pan-x'),
		y: await canvasHost(page).getAttribute('data-view-pan-y')
	};
	await clickAt(page, ellipsePoint);
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', /.+/);
	await expect(page.getByTestId('presentation-handle-se')).toHaveCount(0);
	// The numeric path is disabled too, so nothing on screen offers a move it would refuse.
	await expect(inspector(page).getByLabel('Width', { exact: true })).toBeDisabled();

	// The row already on disk, so the drag's claims can be compared against it.
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const listed = (await listStoredPresentations(page))[0];
	const storedBefore = await readStoredPresentation(page, listed.id);

	// The drag starts on the same ellipse-only point as the click above: the text
	// box spans the ellipse centre, and a drag there would grab the text instead.
	// The point is mapped after every earlier wait has settled, and the gesture
	// waits for its own hit graph, so the press cannot be read as a pan on the
	// slide background instead of a locked element that must not move.
	const ellipseCentre = at(
		await canvasView(page),
		shape.x + shape.width / 2,
		shape.y + shape.height - 20
	);
	await expect.poll(() => hitTestAt(page, ellipseCentre)).not.toBeNull();

	await drag(page, ellipseCentre, { x: ellipseCentre.x + 60, y: ellipseCentre.y + 40 }, 3);
	// The release lands on the empty canvas below the ellipse, so the click that
	// closes the press clears the selection - the same Konva click the source
	// has. Select it again to read what the gesture did to the document.
	await selectFromElementList(page, 'Ellipse');
	await expect(canvasHost(page)).toHaveAttribute('data-selected-element', /.+/);
	await expect
		.poll(async () => JSON.stringify(await readGeometry(page)))
		.toBe(JSON.stringify(shape));
	expect(await canvasHost(page).getAttribute('data-view-pan-x')).toBe(panBefore.x);
	expect(await canvasHost(page).getAttribute('data-view-pan-y')).toBe(panBefore.y);
	// The gesture also left no revision behind: the save state never moved, and
	// the stored row is the same document.
	await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
	const storedAfter = await readStoredPresentation(page, listed.id);
	const geometryOf = ({ x, y, width, height, rotation }) => ({ x, y, width, height, rotation });
	expect(geometryOf(storedAfter.elements.find((element) => element.kind === 'shape'))).toEqual(
		geometryOf(storedBefore.elements.find((element) => element.kind === 'shape'))
	);
	expect(storedAfter.revision).toBe(storedBefore.revision);
});
