/**
 * Slide editor canvas behaviour (redesign stage 4): the PowerPoint conventions
 * for fitting, panning, selecting, moving and placeholders.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import {
	addShape,
	at,
	canvasView,
	clickAt,
	drag,
	openBlankEditor,
	readStoredPresentationJson
} from './presentations';

const host = (page: Page) => page.getByTestId('presentation-canvas');

/** The slide's rectangle on screen, from the canvas's own view attributes. */
async function slideRect(page: Page) {
	return host(page).evaluate((node) => {
		const zoom = Number(node.getAttribute('data-view-zoom'));
		const panX = Number(node.getAttribute('data-view-pan-x'));
		const panY = Number(node.getAttribute('data-view-pan-y'));
		const rect = node.getBoundingClientRect();
		const fit = Math.min(rect.width / 1280, rect.height / 720);
		const scale = fit * zoom;
		const width = 1280 * scale;
		const height = 720 * scale;
		const x = rect.left + (rect.width - width) / 2 + panX;
		const y = rect.top + (rect.height - height) / 2 + panY;
		return {
			x,
			y,
			width,
			height,
			host: { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
		};
	});
}

test('the slide stays fully visible and cannot be lost', async ({ page }) => {
	const id = await openBlankEditor(page);
	const report: Record<string, unknown>[] = [];
	for (const [width, height] of [
		[1440, 900],
		[1280, 800],
		[1100, 800],
		[1024, 768]
	]) {
		await page.setViewportSize({ width, height });
		await page.waitForTimeout(250);
		const slide = await slideRect(page);
		// Fitted: nothing of the slide is outside the canvas, and no pane covers it.
		expect(slide.x).toBeGreaterThanOrEqual(slide.host.x - 1);
		expect(slide.x + slide.width).toBeLessThanOrEqual(slide.host.x + slide.host.w + 1);
		expect(slide.y).toBeGreaterThanOrEqual(slide.host.y - 1);
		expect(slide.y + slide.height).toBeLessThanOrEqual(slide.host.y + slide.host.h + 1);
		const pane = page.getByRole('complementary', { name: 'Task pane' });
		const paneBox = await pane.boundingBox();
		if (paneBox) expect(paneBox.x).toBeGreaterThanOrEqual(slide.host.x + slide.host.w - 1);
		report.push({ width, height, slide });
	}

	// Dragging empty canvas does not pan any more (it draws a selection box).
	await page.setViewportSize({ width: 1440, height: 900 });
	const before = await readStoredPresentationJson(page, id);
	const box = (await host(page).boundingBox())!;
	await page.mouse.move(box.x + 10, box.y + 10);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 });
	await page.mouse.up();
	await expect(host(page)).toHaveAttribute('data-view-pan-x', '0');
	await expect(host(page)).toHaveAttribute('data-view-pan-y', '0');

	// Space+drag pans, and the pan is clamped so most of the slide stays in view.
	await host(page).focus();
	await page.keyboard.down('Space');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 3, box.y + box.height * 3, { steps: 8 });
	await expect(host(page)).toHaveClass(/is-panning/);
	await page.mouse.up();
	await page.keyboard.up('Space');
	const panned = await slideRect(page);
	const visibleWidth =
		Math.min(panned.x + panned.width, panned.host.x + panned.host.w) -
		Math.max(panned.x, panned.host.x);
	const visibleHeight =
		Math.min(panned.y + panned.height, panned.host.y + panned.host.h) -
		Math.max(panned.y, panned.host.y);
	expect(visibleWidth).toBeGreaterThanOrEqual(panned.width * 0.25 - 1);
	expect(visibleHeight).toBeGreaterThanOrEqual(panned.height * 0.25 - 1);
	await expect(host(page)).not.toHaveAttribute('data-view-pan-x', '0');
	expect(await readStoredPresentationJson(page, id)).toBe(before);

	await mkdir('proofs/out', { recursive: true });
	await writeFile(
		'proofs/out/slide-editor-stage4-fit-report.json',
		JSON.stringify({ fits: report, panned }, null, 2)
	);
});

/** Places the selected element through the Format pane's exact fields. */
async function place(page: Page, x: number, y: number, width: number, height: number) {
	const pane = page.getByRole('complementary', { name: 'Task pane' });
	for (const [label, value] of [
		['Width', width],
		['Height', height],
		['X position', x],
		['Y position', y]
	] as const) {
		const field = pane.getByLabel(label, { exact: true });
		await field.fill(String(value));
		await field.press('Enter');
	}
}

const selectedCount = (page: Page) =>
	host(page).evaluate((node) => Number(node.getAttribute('data-selected-count')));
const layerCount = (page: Page) => page.locator('.presentation-layer-item').count();

test('selects several elements with a box, Shift-click and Ctrl+A', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const id = await openBlankEditor(page);
	await addShape(page, 'Rectangle');
	await place(page, 40, 40, 200, 120);
	await addShape(page, 'Ellipse');
	await place(page, 300, 40, 200, 120);
	await addShape(page, 'Rectangle');
	await place(page, 900, 500, 200, 120);
	await expect(page.locator('.presentation-layer-item')).toHaveCount(3);
	const view = await canvasView(page);

	// A box around the top two selects exactly those two.
	await drag(page, at(view, 20, 20), at(view, 560, 200));
	await expect.poll(() => selectedCount(page)).toBe(2);
	await expect(page.locator('.presentation-layer-item[data-selected="true"]')).toHaveCount(2);

	// Shift-click adds and removes.
	await page.keyboard.down('Shift');
	await clickAt(page, at(view, 1000, 560));
	await expect.poll(() => selectedCount(page)).toBe(3);
	await clickAt(page, at(view, 400, 100));
	await expect.poll(() => selectedCount(page)).toBe(2);
	await page.keyboard.up('Shift');

	// A click on empty slide clears; Ctrl+A selects everything on the slide.
	await clickAt(page, at(view, 700, 330));
	await expect.poll(() => selectedCount(page)).toBe(0);
	await host(page).focus();
	await page.keyboard.press('Control+a');
	await expect.poll(() => selectedCount(page)).toBe(3);

	// Delete and duplicate act on the whole selection, as one undo step each.
	await page.keyboard.press('Delete');
	await expect.poll(() => layerCount(page)).toBe(0);
	await page.keyboard.press('Control+z');
	await expect.poll(() => layerCount(page)).toBe(3);
	await host(page).focus();
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Control+d');
	await expect.poll(() => layerCount(page)).toBe(6);
	await page.keyboard.press('Control+z');
	await expect.poll(() => layerCount(page)).toBe(3);

	// Tab on the focused canvas walks the elements one at a time.
	await clickAt(page, at(view, 700, 330));
	await host(page).focus();
	await page.keyboard.press('Tab');
	await expect.poll(() => selectedCount(page)).toBe(1);
	const first = await host(page).getAttribute('data-selected-element');
	await page.keyboard.press('Tab');
	await expect.poll(() => host(page).getAttribute('data-selected-element')).not.toBe(first);

	// A locked element survives deleting the whole selection.
	await page.getByRole('button', { name: 'Lock Rectangle', exact: true }).first().click();
	await host(page).focus();
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Delete');
	await expect.poll(() => layerCount(page)).toBe(1);
	await expect
		.poll(
			async () => JSON.parse(await readStoredPresentationJson(page, id)).slides[0].elements.length
		)
		.toBe(1);

	await mkdir('proofs/out', { recursive: true });
	await writeFile(
		'proofs/out/slide-editor-stage4-selection-report.json',
		JSON.stringify({ deck: id, remaining: await layerCount(page) }, null, 2)
	);
});
